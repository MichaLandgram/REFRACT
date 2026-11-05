# run_ycsb_experiments.ps1
# Powershell script to run YCSB experiments for REFRACT.

$ErrorActionPreference = "Stop"

# Get absolute paths to avoid location issues
$workspaceRoot = (Resolve-Path "$PSScriptRoot\..\..").Path
$apiScript = "$workspaceRoot\src\API.ts"
$seedScript = "$PSScriptRoot\seed.ts"
$ycsbBatch = "$PSScriptRoot\bin\ycsb.bat"
$workloadPath = "$PSScriptRoot\workloads\dynamic_refract_workload"

$wsProcess = $null
$rep1 = $null
$rep2 = $null
$rep3 = $null
$rep4 = $null

function Stop-ProcessSafely($proc) {
    if ($proc -and -not $proc.HasExited) {
        try {
            Write-Host "Stopping process $($proc.Id)..." -ForegroundColor Gray
            $proc.Kill()
            $proc.WaitForExit(3000)
        } catch {
            Write-Host "Failed to stop process: $_" -ForegroundColor Red
        }
    }
}

function Wait-PortReady($port, $timeoutSeconds = 15) {
    Write-Host "Waiting for port $port to become active..." -ForegroundColor Gray
    $start = Get-Date
    while ($true) {
        try {
            $tcp = New-Object System.Net.Sockets.TcpClient
            $tcp.Connect("localhost", $port)
            $tcp.Close()
            Write-Host "Port $port is ready!" -ForegroundColor Green
            return $true
        } catch {}
        if (((Get-Date) - $start).TotalSeconds -gt $timeoutSeconds) {
            Write-Host "Timeout waiting for port $port" -ForegroundColor Red
            return $false
        }
        Start-Sleep -Milliseconds 500
    }
}

function Clear-Port($port) {
    try {
        $conns = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
        if ($conns) {
            Write-Host "Port $port is in use. Cleaning up process..." -ForegroundColor Yellow
            foreach ($c in $conns) {
                if ($c.OwningProcess -and $c.OwningProcess -gt 0) {
                    Write-Host "Killing process $($c.OwningProcess) using port $port" -ForegroundColor Gray
                    Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue
                }
            }
            Start-Sleep -Milliseconds 1000
        }
    } catch {
        # Fallback if Get-NetTCPConnection fails or is not available
        Write-Host "Could not clean port $port automatically: $_" -ForegroundColor Gray
    }
}

try {
    # 0. Clean up any leftover servers from previous runs to clear WebSocket memory state
    Write-Host "Cleaning up ports 1234, 3001, 3002, 3003, 3004..." -ForegroundColor Yellow
    Clear-Port 1234
    Clear-Port 3001
    Clear-Port 3002
    Clear-Port 3003
    Clear-Port 3004

    Write-Host "==========================================" -ForegroundColor Cyan
    Write-Host "       REFRACT YCSB BENCHMARK SUITE       " -ForegroundColor Cyan
    Write-Host "==========================================" -ForegroundColor Cyan

    $nodeCount = 20000
    Write-Host "Generating trace files for $nodeCount nodes..." -ForegroundColor Yellow
    $traceDir = "$PSScriptRoot\workloads"
    if (-not (Test-Path $traceDir)) {
        New-Item -ItemType Directory -Path $traceDir | Out-Null
    }

    $traceContent = 1..$nodeCount | ForEach-Object { "node$_" }
    $traceContent | Out-File -FilePath "$traceDir\dynamic_read_trace.txt" -Encoding utf8
    $traceContent | Out-File -FilePath "$traceDir\dynamic_update_trace.txt" -Encoding utf8
    $traceContent | Out-File -FilePath "$traceDir\dynamic_insert_trace.txt" -Encoding utf8
    $traceContent | Out-File -FilePath "$traceDir\dynamic_delete_trace.txt" -Encoding utf8

    # Create dynamic workload config
    $workloadConfig = @"
workload=site.ycsb.workloads.RestWorkload
readproportion=0.95
updateproportion=0.5
insertproportion=0
scanproportion=0
url.prefix=http://localhost:3001/nodes/
timeout.connect=10
timeout.read=10
log.enable=false
url.trace.read=workloads/dynamic_read_trace.txt
url.trace.insert=workloads/dynamic_insert_trace.txt
url.trace.update=workloads/dynamic_update_trace.txt
url.trace.delete=workloads/dynamic_delete_trace.txt
readzipfconstant=0.9
updatezipfconstant=0.9
insertzipfconstant=0.9
deletezipfconstant=0.9
readrecordcount=$nodeCount
updaterecordcount=$nodeCount
insertrecordcount=$nodeCount
deleterecordcount=$nodeCount
"@
    $workloadConfig | Out-File -FilePath $workloadPath -Encoding utf8

    # Start WebSocket server
    Write-Host "Starting WebSocket server (y-websocket)..." -ForegroundColor Yellow
    $env:PORT = "1234"
    $wsProcess = Start-Process npx.cmd -ArgumentList "y-websocket" -NoNewWindow -PassThru
    Start-Sleep -Seconds 2
    if (-not (Wait-PortReady 1234)) { throw "WS server failed to start" }


    # ==========================================
    # EXPERIMENT 3: SMO Impact on Throughput
    # ==========================================
    Write-Host "`n--- Experiment 3: SMO Impact on Throughput (REFRACT vs GraphOnly) ---" -ForegroundColor Cyan

    # --- 3a. REFRACT (Coordination-free Schema Evolution)
    Write-Host "[3a] Running REFRACT SMO test..." -ForegroundColor Yellow
    $env:PORT = "3001"
    $env:WHAT_SYSTEM = "fullRefract"
    $rep1 = Start-Process npx.cmd -ArgumentList "tsx", "$apiScript" -NoNewWindow -PassThru
    if (-not (Wait-PortReady 3001)) { throw "Replica 1 failed to start" }
    npx.cmd tsx "$seedScript" $nodeCount 3001

    $statusLogRefract = "$PSScriptRoot\refract_smo_status.log"
    $ycsbJob = Start-Process "$ycsbBatch" -ArgumentList "run", "rest", "-P", "$workloadPath", "-p", "url.prefix=http://localhost:3001/nodes/", "-p", "operationcount=30000", "-p", "threadcount=1", "-s", "-p", "status.interval=1", "-p", "measurementtype=timeseries", "-p", "timeseries.granularity=100" -NoNewWindow -PassThru -RedirectStandardOutput "$PSScriptRoot\refract_stdout.log" -RedirectStandardError "$statusLogRefract"

    Write-Host "Waiting 3 seconds before triggering SMO..." -ForegroundColor Gray
    Start-Sleep -Seconds 3

    Write-Host "Triggering SMO: Rename lastName to familyName (coordination-free)..." -ForegroundColor Magenta
    try {
        $bodyObj = @{identifying="Person"; oldPropertyKey="lastName"; newPropertyKey="familyName"}
        $bodyJson = $bodyObj | ConvertTo-Json
        $res = Invoke-RestMethod -Uri "http://localhost:3001/schema/smo/rename-property" -Method Post -Body $bodyJson -ContentType "application/json"
        Write-Host "SMO Result: $($res.message)" -ForegroundColor Green
    } catch {
        Write-Host "SMO Trigger Failed: $_" -ForegroundColor Red
    }

    $ycsbJob.WaitForExit()
    Clear-Port 3001
    Stop-ProcessSafely $rep1
    $rep1 = $null

    # Reset ws server state by restarting it
    Write-Host "Restarting WS server to clear sync document memory..." -ForegroundColor Yellow
    Clear-Port 1234
    Stop-ProcessSafely $wsProcess
    $env:PORT = "1234"
    $wsProcess = Start-Process npx.cmd -ArgumentList "y-websocket" -NoNewWindow -PassThru
    Start-Sleep -Seconds 2
    if (-not (Wait-PortReady 1234)) { throw "WS server failed to start" }

    # --- 3b. GraphOnly (Eager Migration)
    Write-Host "`n[3b] Running GraphOnly (Eager Migration) SMO test..." -ForegroundColor Yellow
    $env:PORT = "3001"
    $env:WHAT_SYSTEM = "graphOnly"
    $rep1 = Start-Process npx.cmd -ArgumentList "tsx", "$apiScript" -NoNewWindow -PassThru
    if (-not (Wait-PortReady 3001)) { throw "Replica 1 failed to start" }
    npx.cmd tsx "$seedScript" $nodeCount 3001

    $statusLogEager = "$PSScriptRoot\eager_smo_status.log"
    $ycsbJob = Start-Process "$ycsbBatch" -ArgumentList "run", "rest", "-P", "$workloadPath", "-p", "url.prefix=http://localhost:3001/nodes/", "-p", "operationcount=30000", "-p", "threadcount=1", "-s", "-p", "status.interval=1", "-p", "measurementtype=timeseries", "-p", "timeseries.granularity=100" -NoNewWindow -PassThru -RedirectStandardOutput "$PSScriptRoot\eager_stdout.log" -RedirectStandardError "$statusLogEager"

    Write-Host "Waiting 3 seconds before triggering SMO..." -ForegroundColor Gray
    Start-Sleep -Seconds 3

    Write-Host "Triggering Eager Migration (scanning & migrating all $nodeCount nodes)..." -ForegroundColor Magenta
    try {
        $bodyObj = @{identifying="Person"; oldPropertyKey="lastName"; newPropertyKey="familyName"}
        $bodyJson = $bodyObj | ConvertTo-Json
        $res = Invoke-RestMethod -Uri "http://localhost:3001/schema/smo/rename-property" -Method Post -Body $bodyJson -ContentType "application/json"
        Write-Host "SMO Result: $($res.message)" -ForegroundColor Green
    } catch {
        Write-Host "SMO Trigger Failed: $_" -ForegroundColor Red
    }

    $ycsbJob.WaitForExit()
    Clear-Port 3001
    Stop-ProcessSafely $rep1
    $rep1 = $null

    # Report results
    Write-Host "`n==========================================" -ForegroundColor Green
    Write-Host "            SMO RESULTS SUMMARY           " -ForegroundColor Green
    Write-Host "==========================================" -ForegroundColor Green

    Write-Host "`nREFRACT Throughput Timeline:" -ForegroundColor Cyan
    if (Test-Path $statusLogRefract) {
        $lines = Get-Content $statusLogRefract | Where-Object { $_ -match "current ops/sec" }
        foreach ($line in $lines) {
            if ($line -match "\s*([0-9]+)\s+sec:.*\s+([0-9.,]+)\s+current ops/sec") {
                $valStr = $Matches[2].Replace(",", ".")
                $opsVal = [double]::Parse($valStr, [System.Globalization.CultureInfo]::InvariantCulture)
                Write-Host "  Second $($Matches[1]): $opsVal ops/sec"
            }
        }
    }

    Write-Host "`nEager Migration Throughput Timeline:" -ForegroundColor Cyan
    if (Test-Path $statusLogEager) {
        $lines = Get-Content $statusLogEager | Where-Object { $_ -match "current ops/sec" }
        foreach ($line in $lines) {
            if ($line -match "\s*([0-9]+)\s+sec:.*\s+([0-9.,]+)\s+current ops/sec") {
                $valStr = $Matches[2].Replace(",", ".")
                $opsVal = [double]::Parse($valStr, [System.Globalization.CultureInfo]::InvariantCulture)
                Write-Host "  Second $($Matches[1]): $opsVal ops/sec"
            }
        }
    }

    # Automatically generate comparison plots
    Write-Host "`nGenerating SMO impact plots (Throughput & Latency)..." -ForegroundColor Yellow
    try {
        python "$PSScriptRoot\plot_smo_comparison.py"
    } catch {
        Write-Host "Failed to generate plots automatically: $_" -ForegroundColor Red
    }

} finally {
    Clear-Port 3001
    Clear-Port 3002
    Clear-Port 3003
    Clear-Port 3004
    Clear-Port 1234
    Stop-ProcessSafely $rep1
    Stop-ProcessSafely $rep2
    Stop-ProcessSafely $rep3
    Stop-ProcessSafely $rep4
    Stop-ProcessSafely $wsProcess
}
