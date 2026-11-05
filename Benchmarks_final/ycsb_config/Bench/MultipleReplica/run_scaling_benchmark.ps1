# Usage:
#   .\run_scaling_benchmark.ps1 -WhatSystem "graphOnly"     -MaxReplicas 4                    # CRUD only
#   .\run_scaling_benchmark.ps1 -WhatSystem "fullRefract"   -MaxReplicas 4 -IncludeSMO        # CRUD

param(
    [ValidateSet("graphOnly", "fullRefract")]
    [string]$WhatSystem = "graphOnly",

    [ValidateSet("hub", "mesh")]
    [string]$SyncMode = "hub",

    [ValidateRange(1, 4)]
    [int]$MaxReplicas = 4,

    [int]$NodeCount = 20000,
    [int]$InsertCount = 12000,
    [int]$OperationCount = 12000,
    [int]$ThreadCount = 1,

    [int]$Runs = 1,

    [switch]$IncludeSMO,
    [switch]$SMOOnly,
    [int]$SMOOperationCount = 12000,
    [int]$SMOThreadCount = 1,
    [int]$SMOWarmupSeconds = 3
)

$ErrorActionPreference = "Stop"
$env:NODE_OPTIONS = "--max-semi-space-size=128 --max-old-space-size=4096"

$workspaceRoot = (Resolve-Path "$PSScriptRoot\..\..\..\..").Path
$apiScript     = "$workspaceRoot\src\API.ts"
$seedScript    = "$PSScriptRoot\..\..\seed.ts"
$ycsbBatch     = "$PSScriptRoot\..\..\bin\ycsb.bat"
$ycsbRoot      = (Resolve-Path "$PSScriptRoot\..\.." ).Path


if ($WhatSystem -eq "fullRefract") {
    $wlDir      = "$PSScriptRoot\..\..\workloads_full"
    $resultsDir = "$PSScriptRoot\results_full_scaling"
    $fieldCount = 2
} else {
    $wlDir      = "$PSScriptRoot\..\..\workloads"
    $resultsDir = "$PSScriptRoot\results_scaling"
    $fieldCount = 2
}

if (-not (Test-Path $resultsDir)) { New-Item -ItemType Directory -Path $resultsDir | Out-Null }
if (-not (Test-Path $wlDir))      { New-Item -ItemType Directory -Path $wlDir | Out-Null }


$wsPort     = 1234
$basePorts  = @(3001, 3002, 3003, 3004)

$wsProcess  = $null
$replicas   = @()

$cpuCount = (Get-CimInstance Win32_Processor | Measure-Object -Property NumberOfLogicalProcessors -Sum).Sum
Write-Host "Detected $cpuCount logical processors" -ForegroundColor Gray

if ($cpuCount -ge 10) {
    # Plenty of cores: WS=0, Replicas=1-4, YCSB=5-8, seed=9
    $wsAffinity      = [IntPtr]0x1        # core 0
    $replicaAffinity = @([IntPtr]0x2, [IntPtr]0x4, [IntPtr]0x8, [IntPtr]0x10)   # cores 1-4
    $ycsbAffinity    = @([IntPtr]0x20, [IntPtr]0x40, [IntPtr]0x80, [IntPtr]0x100) # cores 5-8
} elseif ($cpuCount -ge 6) {
    # Moderate cores: WS=0, each replica+YCSB pair shares 1 core
    $wsAffinity      = [IntPtr]0x1
    $replicaAffinity = @([IntPtr]0x2, [IntPtr]0x4, [IntPtr]0x8, [IntPtr]0x10)
    $ycsbAffinity    = @([IntPtr]0x2, [IntPtr]0x4, [IntPtr]0x8, [IntPtr]0x10) # same as replica
} else {
    # Few cores: no pinning (use all cores)
    $wsAffinity      = [IntPtr]([math]::Pow(2, $cpuCount) - 1)
    $allCores        = [IntPtr]([math]::Pow(2, $cpuCount) - 1)
    $replicaAffinity = @($allCores, $allCores, $allCores, $allCores)
    $ycsbAffinity    = @($allCores, $allCores, $allCores, $allCores)
}

function Set-Affinity($proc, [IntPtr]$mask, [string]$label) {
    try {
        $proc.ProcessorAffinity = $mask
        Write-Host "    Pinned $label (PID $($proc.Id)) to CPU mask 0x$($mask.ToInt64().ToString('X'))" -ForegroundColor DarkGray
    } catch {
        Write-Host "    Could not pin $label affinity: $_" -ForegroundColor DarkYellow
    }
}

function Stop-ProcessSafely($proc) {
    if ($proc -and -not $proc.HasExited) {
        try {
            $proc.Kill()
            $proc.WaitForExit(3000)
        } catch {}
    }
}

function Wait-PortReady($port, $timeoutSeconds = 15) {
    $start = Get-Date
    while ($true) {
        try {
            $tcp = New-Object System.Net.Sockets.TcpClient
            $tcp.Connect("localhost", $port)
            $tcp.Close()
            return $true
        } catch {}
        if (((Get-Date) - $start).TotalSeconds -gt $timeoutSeconds) { return $false }
        Start-Sleep -Milliseconds 500
    }
}

function Clear-Port($port) {
    try {
        $conns = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
        if ($conns) {
            foreach ($c in $conns) {
                if ($c.OwningProcess -and $c.OwningProcess -gt 0) {
                    Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue
                }
            }
            Start-Sleep -Milliseconds 1000
        }
    } catch {}
}

function Start-WsServer {
    if ($SyncMode -eq "mesh") {
        Write-Host "  [Mesh mode] Skipping WS hub server" -ForegroundColor DarkGray
        return
    }
    Clear-Port $wsPort
    $env:PORT = "$wsPort"
    $script:wsProcess = Start-Process npx.cmd -ArgumentList "y-websocket" -NoNewWindow -PassThru
    Start-Sleep -Seconds 2
    if (-not (Wait-PortReady $wsPort)) { throw "WS server failed to start on port $wsPort" }
    Set-Affinity $script:wsProcess $wsAffinity "WS server"
}

function Stop-WsServer {
    if ($SyncMode -eq "mesh") { return }
    Clear-Port $wsPort
    Stop-ProcessSafely $script:wsProcess
    $script:wsProcess = $null
}

function Start-Replicas([int]$count) {
    $script:replicas = @()

    $syncPorts = @()
    for ($i = 0; $i -lt $count; $i++) {
        $syncPorts += ($basePorts[$i] + 1000)
    }

    for ($i = 0; $i -lt $count; $i++) {
        $port = $basePorts[$i]
        Clear-Port $port
        $env:PORT = "$port"
        $env:DB_DRIVER = "none"
        $env:WHAT_SYSTEM = $WhatSystem

        if ($SyncMode -eq "mesh") {
            $env:SYNC_MODE = "mesh"
            $env:SYNC_PORT = "$($syncPorts[$i])"
            $peerList = @()
            for ($j = 0; $j -lt $count; $j++) {
                if ($j -ne $i) {
                    $peerList += "ws://localhost:$($syncPorts[$j])"
                }
            }
            $env:PEERS = $peerList -join ","
            Clear-Port $syncPorts[$i]
        } else {
            $env:SYNC_MODE = "hub"
            $env:WS_SERVER_URL = "ws://localhost:$wsPort"
            $env:PEERS = ""
        }

        $proc = Start-Process npx.cmd -ArgumentList "tsx", "$apiScript" -NoNewWindow -PassThru
        if (-not (Wait-PortReady $port)) { throw "Replica $($i+1) failed to start on port $port" }
        Set-Affinity $proc $replicaAffinity[$i] "Replica $($i+1)"
        $script:replicas += $proc
        Write-Host "  Replica $($i+1) on :$port (sync :$($syncPorts[$i]))" -ForegroundColor Green
    }

    if ($SyncMode -eq "mesh" -and $count -gt 1) {
        Write-Host "  Waiting 3s for mesh peer connections..." -ForegroundColor Gray
        Start-Sleep -Seconds 3
    }
}

function Stop-Replicas {
    for ($i = 0; $i -lt $script:replicas.Count; $i++) {
        Clear-Port $basePorts[$i]
        if ($SyncMode -eq "mesh") { Clear-Port ($basePorts[$i] + 1000) }
        Stop-ProcessSafely $script:replicas[$i]
    }
    $script:replicas = @()
}

function Extract-Throughput($logPath) {
    if (-not (Test-Path $logPath)) { return 0.0 }
    $tp = 0.0
    $lines = Get-Content $logPath | Where-Object { $_ -match "Throughput\(ops/sec\)" }
    foreach ($line in $lines) {
        if ($line -match "Throughput\(ops/sec\),\s*([0-9.,]+)") {
            $valStr = $Matches[1].Replace(",", ".")
            $tp = [double]::Parse($valStr, [System.Globalization.CultureInfo]::InvariantCulture)
        }
    }
    return $tp
}

function Extract-AvgLatency($logPath, $opType) {
    if (-not (Test-Path $logPath)) { return 0.0 }
    $lat = 0.0
    $pattern = "\[$opType\], AverageLatency\(us\)"
    $lines = Get-Content $logPath | Where-Object { $_ -match "\[$opType\], AverageLatency" }
    foreach ($line in $lines) {
        if ($line -match "AverageLatency\(us\),\s*([0-9.,]+)") {
            $valStr = $Matches[1].Replace(",", ".")
            $lat = [double]::Parse($valStr, [System.Globalization.CultureInfo]::InvariantCulture)
        }
    }
    return $lat
}

function Extract-P99Latency($logPath, $opType) {
    if (-not (Test-Path $logPath)) { return 0.0 }
    $lat = 0.0
    $pattern = "\[$opType\], 99thPercentileLatency\(us\)"
    $lines = Get-Content $logPath | Where-Object { $_ -match "\[$opType\], 99thPercentileLatency" }
    foreach ($line in $lines) {
        if ($line -match "99thPercentileLatency\(us\),\s*([0-9.,]+)") {
            $valStr = $Matches[1].Replace(",", ".")
            $lat = [double]::Parse($valStr, [System.Globalization.CultureInfo]::InvariantCulture)
        }
    }
    return $lat
}

$operations = @(
    @{ Name = "INSERT"; Prop = "insertproportion=1`nreadproportion=0`nupdateproportion=0`ndeleteproportion=0"; YcsbOp = "INSERT" },
    @{ Name = "UPDATE"; Prop = "insertproportion=0`nreadproportion=0`nupdateproportion=1`ndeleteproportion=0"; YcsbOp = "UPDATE" },
    @{ Name = "READ";   Prop = "insertproportion=0`nreadproportion=1`nupdateproportion=0`ndeleteproportion=0"; YcsbOp = "READ" },
    @{ Name = "DELETE"; Prop = "insertproportion=0`nreadproportion=0`nupdateproportion=0`ndeleteproportion=1"; YcsbOp = "DELETE" }
)

$csvPath = "$resultsDir\scaling_results_${WhatSystem}.csv"
"system,operation,replicas,run,combined_throughput_ops_sec,avg_latency_us,p99_latency_us" | Out-File -FilePath $csvPath -Encoding utf8

$summaryCsvPath = "$resultsDir\scaling_summary_${WhatSystem}.csv"
"system,operation,replicas,runs,mean_throughput,sd_throughput,mean_avg_latency,sd_avg_latency,mean_p99_latency,sd_p99_latency" | Out-File -FilePath $summaryCsvPath -Encoding utf8

try {
    Write-Host "Generating trace files..." -ForegroundColor Yellow
    $traceContent = 1..$NodeCount | ForEach-Object { "node$_" }
    $traceContent | Out-File -FilePath "$wlDir\dynamic_read_trace.txt" -Encoding ascii
    $traceContent | Out-File -FilePath "$wlDir\dynamic_update_trace.txt" -Encoding ascii
    $traceContent | Out-File -FilePath "$wlDir\dynamic_delete_trace.txt" -Encoding ascii

  if (-not $SMOOnly) {
    Write-Host "==========================================" -ForegroundColor Cyan
    Write-Host "  SCALING BENCHMARK: $WhatSystem" -ForegroundColor Cyan
    Write-Host "  Replicas: 1..$MaxReplicas | Ops: $OperationCount | Threads: $ThreadCount | Runs: $Runs" -ForegroundColor Cyan
    Write-Host "==========================================" -ForegroundColor Cyan

    foreach ($op in $operations) {
        $opName = $op.Name
        $ycsbOp = $op.YcsbOp

        for ($nReplicas = 1; $nReplicas -le $MaxReplicas; $nReplicas++) {
            $runThroughputs = @()
            $runAvgLats = @()
            $runP99Lats = @()

            for ($run = 1; $run -le $Runs; $run++) {
            Write-Host "`n--- $opName | $nReplicas replica(s) | Run $run/$Runs ---" -ForegroundColor Cyan

            Start-WsServer

            Start-Replicas $nReplicas

            $runId = Get-Date -Format "yyyyMMddHHmmss"
            for ($r = 0; $r -lt $nReplicas; $r++) {
                1..$InsertCount | ForEach-Object { "insert_${runId}_r$($r+1)_$_" } | Out-File -FilePath "$wlDir\dynamic_insert_trace_r$($r+1).txt" -Encoding ascii
            }

            Write-Host "  Seeding $NodeCount nodes to replica 1..." -ForegroundColor Yellow
            npx.cmd tsx "$seedScript" $NodeCount 3001

            if ($nReplicas -gt 1) {
                Write-Host "  Waiting 5s for Yjs sync across $nReplicas replicas..." -ForegroundColor Gray
                Start-Sleep -Seconds 5
            }

            $wlRelDir = if ($WhatSystem -eq "fullRefract") { "workloads_full" } else { "workloads" }

            Write-Host "  Launching $nReplicas YCSB processes ($OperationCount ops each, $ThreadCount threads)..." -ForegroundColor Yellow
            $ycsbProcs = @()
            $logPaths  = @()

            for ($r = 0; $r -lt $nReplicas; $r++) {
                $port = $basePorts[$r]
                $logFile    = "$resultsDir\ycsb_${opName}_${nReplicas}rep_run${run}_r$($r+1).log"
                $errLogFile = "$resultsDir\ycsb_${opName}_${nReplicas}rep_run${run}_r$($r+1)_err.log"
                $logPaths += $logFile

                $replicaWorkload = @"
workload=site.ycsb.workloads.RestWorkload
$($op.Prop)
scanproportion=0
url.prefix=http://localhost:$port/nodes/
timeout.connect=10
timeout.read=10
log.enable=false
url.trace.read=$wlRelDir/dynamic_read_trace.txt
url.trace.insert=$wlRelDir/dynamic_insert_trace_r$($r+1).txt
url.trace.update=$wlRelDir/dynamic_update_trace.txt
url.trace.delete=$wlRelDir/dynamic_delete_trace.txt
fieldcount=$fieldCount
fieldlength=100
readzipfconstant=0.9
updatezipfconstant=0.9
insertzipfconstant=0.9
deletezipfconstant=0.9
readrecordcount=$NodeCount
updaterecordcount=$NodeCount
insertrecordcount=$InsertCount
deleterecordcount=$NodeCount
"@
                $replicaWorkloadPath = "$wlDir\dynamic_scaling_workload_r$($r+1)"
                $replicaWorkload | Out-File -FilePath $replicaWorkloadPath -Encoding utf8

                $proc = Start-Process "$ycsbBatch" -WorkingDirectory $ycsbRoot -ArgumentList @(
                    "run", "rest",
                    "-P", "$replicaWorkloadPath",
                    "-p", "operationcount=$OperationCount",
                    "-p", "threadcount=$ThreadCount"
                ) -NoNewWindow -PassThru -RedirectStandardOutput $logFile -RedirectStandardError $errLogFile

                $ycsbProcs += $proc
                Set-Affinity $proc $ycsbAffinity[$r] "YCSB r$($r+1)"
            }

            foreach ($proc in $ycsbProcs) {
                $proc.WaitForExit()
            }

            $totalThroughput = 0.0
            $totalAvgLat     = 0.0
            $totalP99Lat     = 0.0

            for ($r = 0; $r -lt $nReplicas; $r++) {
                $tp  = Extract-Throughput $logPaths[$r]
                $avg = Extract-AvgLatency $logPaths[$r] $ycsbOp
                $p99 = Extract-P99Latency $logPaths[$r] $ycsbOp
                $totalThroughput += $tp
                $totalAvgLat     += $avg
                $totalP99Lat     += $p99
                Write-Host "    Replica $($r+1): $([math]::Round($tp, 2)) ops/sec | avg=$([math]::Round($avg, 1))us | p99=$([math]::Round($p99, 1))us" -ForegroundColor Gray
            }

            $avgLat = if ($nReplicas -gt 0) { $totalAvgLat / $nReplicas } else { 0 }
            $avgP99 = if ($nReplicas -gt 0) { $totalP99Lat / $nReplicas } else { 0 }

            Write-Host "  ► Combined: $([math]::Round($totalThroughput, 2)) ops/sec | avg=$([math]::Round($avgLat, 1))us | p99=$([math]::Round($avgP99, 1))us" -ForegroundColor Green

            "$WhatSystem,$opName,$nReplicas,$run,$([math]::Round($totalThroughput, 2)),$([math]::Round($avgLat, 2)),$([math]::Round($avgP99, 2))" | Out-File -FilePath $csvPath -Append -Encoding utf8

            $runThroughputs += $totalThroughput
            $runAvgLats += $avgLat
            $runP99Lats += $avgP99

            Stop-Replicas
            Stop-WsServer
            Start-Sleep -Seconds 2
            } # end of runs loop

            $meanTp   = ($runThroughputs | Measure-Object -Average).Average
            $meanAvg  = ($runAvgLats | Measure-Object -Average).Average
            $meanP99  = ($runP99Lats | Measure-Object -Average).Average

            if ($Runs -gt 1) {
                $sdTp  = [math]::Sqrt(($runThroughputs | ForEach-Object { [math]::Pow($_ - $meanTp, 2) } | Measure-Object -Sum).Sum / ($Runs - 1))
                $sdAvg = [math]::Sqrt(($runAvgLats | ForEach-Object { [math]::Pow($_ - $meanAvg, 2) } | Measure-Object -Sum).Sum / ($Runs - 1))
                $sdP99 = [math]::Sqrt(($runP99Lats | ForEach-Object { [math]::Pow($_ - $meanP99, 2) } | Measure-Object -Sum).Sum / ($Runs - 1))
                Write-Host "  ★ Mean over $Runs runs: $([math]::Round($meanTp, 2)) ops/sec (±$([math]::Round($sdTp, 2))) | avg=$([math]::Round($meanAvg, 1))us (±$([math]::Round($sdAvg, 1))) | p99=$([math]::Round($meanP99, 1))us (±$([math]::Round($sdP99, 1)))" -ForegroundColor Magenta
            } else {
                $sdTp = 0; $sdAvg = 0; $sdP99 = 0
            }

            "$WhatSystem,$opName,$nReplicas,$Runs,$([math]::Round($meanTp, 2)),$([math]::Round($sdTp, 2)),$([math]::Round($meanAvg, 2)),$([math]::Round($sdAvg, 2)),$([math]::Round($meanP99, 2)),$([math]::Round($sdP99, 2))" | Out-File -FilePath $summaryCsvPath -Append -Encoding utf8
        }
    }
  }

    if (-not $SMOOnly) {
        Write-Host "`n==========================================" -ForegroundColor Cyan
        Write-Host "  CRUD BENCHMARK COMPLETE" -ForegroundColor Cyan
        Write-Host "  Results: $csvPath" -ForegroundColor Cyan
        Write-Host "==========================================" -ForegroundColor Cyan
    }

#     # ══════════════════════════════════════════════════════════════════════
#     # SMO IMPACT EXPERIMENT
#     # ══════════════════════════════════════════════════════════════════════
#     if ($IncludeSMO -or $SMOOnly) {
#         Write-Host "`n==========================================" -ForegroundColor Magenta
#         Write-Host "  SMO IMPACT EXPERIMENT: $WhatSystem" -ForegroundColor Magenta
#         Write-Host "  Replicas: 1..$MaxReplicas | Ops: $SMOOperationCount | Threads: $SMOThreadCount" -ForegroundColor Magenta
#         Write-Host "==========================================" -ForegroundColor Magenta

#         $smoResultsDir = "$resultsDir\smo_impact"
#         if (-not (Test-Path $smoResultsDir)) { New-Item -ItemType Directory -Path $smoResultsDir | Out-Null }

#         $smoCsvPath = "$smoResultsDir\smo_timeseries_${WhatSystem}.csv"
#         "system,replicas,time_sec,throughput_ops_sec" | Out-File -FilePath $smoCsvPath -Encoding utf8

#         $smoSummaryCsv = "$smoResultsDir\smo_summary_${WhatSystem}.csv"
#         "system,replicas,throughput_before_smo,throughput_during_smo,throughput_after_smo,smo_duration_ms" | Out-File -FilePath $smoSummaryCsv -Encoding utf8

#         for ($nReplicas = 1; $nReplicas -le $MaxReplicas; $nReplicas++) {
#             Write-Host "`n--- SMO Impact | $nReplicas replica(s) ---" -ForegroundColor Magenta

#             Start-WsServer
#             Start-Replicas $nReplicas


#             Write-Host "  Seeding $NodeCount nodes to replica 1..." -ForegroundColor Yellow
#             npx.cmd tsx "$seedScript" $NodeCount 3001

#             if ($nReplicas -gt 1) {
#                 Write-Host "  Waiting 5s for Yjs sync..." -ForegroundColor Gray
#                 Start-Sleep -Seconds 5
#             }


#             $wlRelDir = if ($WhatSystem -eq "fullRefract") { "workloads_full" } else { "workloads" }
#             $smoYcsbProcs = @()
#             $smoLogPaths  = @()
#             $smoErrPaths  = @()

#             for ($r = 0; $r -lt $nReplicas; $r++) {
#                 $port = $basePorts[$r]
#                 $logFile    = "$smoResultsDir\smo_${nReplicas}rep_r$($r+1)_stdout.log"
#                 $errLogFile = "$smoResultsDir\smo_${nReplicas}rep_r$($r+1)_stderr.log"
#                 $smoLogPaths += $logFile
#                 $smoErrPaths += $errLogFile

#                 $smoWorkload = @"
# workload=site.ycsb.workloads.RestWorkload
# readproportion=0.95
# updateproportion=0.05
# insertproportion=0
# scanproportion=0
# deleteproportion=0
# url.prefix=http://localhost:$port/nodes/
# timeout.connect=10
# timeout.read=10
# log.enable=false
# url.trace.read=$wlRelDir/dynamic_read_trace.txt
# url.trace.update=$wlRelDir/dynamic_update_trace.txt
# url.trace.insert=$wlRelDir/dynamic_insert_trace_r$($r+1).txt
# url.trace.delete=$wlRelDir/dynamic_delete_trace.txt
# fieldcount=$fieldCount
# fieldlength=100
# readzipfconstant=0.9
# updatezipfconstant=0.9
# readrecordcount=$NodeCount
# updaterecordcount=$NodeCount
# "@
#                 $smoWlPath = "$wlDir\dynamic_smo_workload_r$($r+1)"
#                 $smoWorkload | Out-File -FilePath $smoWlPath -Encoding utf8

#                 $proc = Start-Process "$ycsbBatch" -WorkingDirectory $ycsbRoot -ArgumentList @(
#                     "run", "rest",
#                     "-P", "$smoWlPath",
#                     "-p", "operationcount=$SMOOperationCount",
#                     "-p", "threadcount=$SMOThreadCount",
#                     "-s",
#                     "-p", "status.interval=1",
#                     "-p", "measurementtype=timeseries",
#                     "-p", "timeseries.granularity=1000"
#                 ) -NoNewWindow -PassThru -RedirectStandardOutput $logFile -RedirectStandardError $errLogFile

#                 $smoYcsbProcs += $proc
#                 Set-Affinity $proc $ycsbAffinity[$r] "YCSB-SMO r$($r+1)"
#             }


#             Write-Host "  Waiting ${SMOWarmupSeconds}s for YCSB warmup..." -ForegroundColor Gray
#             Start-Sleep -Seconds $SMOWarmupSeconds

#             Write-Host "  TRIGGERING SMO on all $nReplicas replicas..." -ForegroundColor Red
#             $smoStartTime = Get-Date
#             for ($r = 0; $r -lt $nReplicas; $r++) {
#                 $port = $basePorts[$r]
#                 try {
#                     $bodyJson = @{identifying="Person"; oldPropertyKey="lastName"; newPropertyKey="familyName"} | ConvertTo-Json
#                     $res = Invoke-RestMethod -Uri "http://localhost:$port/schema/smo/rename-property" -Method Post -Body $bodyJson -ContentType "application/json" -TimeoutSec 30
#                     Write-Host "    Replica $($r+1): $($res.message)" -ForegroundColor Green
#                 } catch {
#                     Write-Host "    Replica $($r+1) SMO failed: $_" -ForegroundColor Red
#                 }
#             }
#             $smoEndTime = Get-Date
#             $smoDurationMs = [math]::Round(($smoEndTime - $smoStartTime).TotalMilliseconds, 0)
#             Write-Host "  SMO completed in ${smoDurationMs}ms" -ForegroundColor Yellow

#             # 6. Wait for YCSB to finish
#             foreach ($proc in $smoYcsbProcs) { $proc.WaitForExit() }

#             # 7. Parse timeseries from stderr (YCSB writes status to stderr with -s flag)
#             Write-Host "  Parsing timeseries results..." -ForegroundColor Yellow
#             $timeseriesData = @{}

#             foreach ($errPath in $smoErrPaths) {
#                 if (-not (Test-Path $errPath)) { continue }
#                 $lines = Get-Content $errPath | Where-Object { $_ -match "current ops/sec" }
#                 foreach ($line in $lines) {
#                     if ($line -match "^\s*([0-9]+)\s+sec:.*?([0-9.,]+)\s+current ops/sec") {
#                         $sec = [int]$Matches[1]
#                         $valStr = $Matches[2].Replace(",", ".")
#                         $ops = [double]::Parse($valStr, [System.Globalization.CultureInfo]::InvariantCulture)
#                         if (-not $timeseriesData.ContainsKey($sec)) { $timeseriesData[$sec] = 0.0 }
#                         $timeseriesData[$sec] += $ops  # Sum across replicas
#                     }
#                 }
#             }


#             foreach ($sec in ($timeseriesData.Keys | Sort-Object)) {
#                 $ops = [math]::Round($timeseriesData[$sec], 2)
#                 "$WhatSystem,$nReplicas,$sec,$ops" | Out-File -FilePath $smoCsvPath -Append -Encoding utf8
#                 Write-Host "    t=${sec}s: $ops ops/sec" -ForegroundColor Gray
#             }

  
#             $sortedSecs = $timeseriesData.Keys | Sort-Object
#             $smoTriggerSec = $SMOWarmupSeconds
#             $beforeOps = ($sortedSecs | Where-Object { $_ -le $smoTriggerSec } | ForEach-Object { $timeseriesData[$_] } | Measure-Object -Average).Average
#             $duringOps = ($sortedSecs | Where-Object { $_ -gt $smoTriggerSec -and $_ -le ($smoTriggerSec + 3) } | ForEach-Object { $timeseriesData[$_] } | Measure-Object -Average).Average
#             $afterOps  = ($sortedSecs | Where-Object { $_ -gt ($smoTriggerSec + 5) } | ForEach-Object { $timeseriesData[$_] } | Measure-Object -Average).Average

#             $beforeOps = if ($beforeOps) { [math]::Round($beforeOps, 2) } else { 0 }
#             $duringOps = if ($duringOps) { [math]::Round($duringOps, 2) } else { 0 }
#             $afterOps  = if ($afterOps)  { [math]::Round($afterOps, 2) }  else { 0 }

#             Write-Host "  ► Before SMO: $beforeOps ops/sec | During: $duringOps ops/sec | After: $afterOps ops/sec" -ForegroundColor Cyan
#             "$WhatSystem,$nReplicas,$beforeOps,$duringOps,$afterOps,$smoDurationMs" | Out-File -FilePath $smoSummaryCsv -Append -Encoding utf8

#             # 8. Cleanup
#             Stop-Replicas
#             Stop-WsServer
#             Start-Sleep -Seconds 2
#         }

#     }

} finally {
    Stop-Replicas
    Stop-WsServer
    Write-Host "All processes cleaned up." -ForegroundColor Yellow
}
