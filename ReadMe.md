# Project Title
REFRACT: Coordination-Free Schema Evolution for Replicated Property Graphs


## Description
REFRACT is a coordination-free schema evolution approach for replicated property graphs. It enables schema evolution and data change without the need of coordination. 

## Getting Started
### Dependencies
* node v22.12.0
* npm v10.9.0
### Installing

* ```npm i --save-dev --legacy-peer-deps```

### Executing program

* **npm test** runs exsisting test cases, including example test cases for the figures in the paper. (Test/Lens_Engine)
* **Benchmarks commands:**
```
RQ1: $env:TS_NODE_COMPILER_OPTIONS='{"module":"commonjs"}'; $env:NODE_OPTIONS="--expose-gc --max-old-space-size=16384"; npx ts-node .\Benchmarks\RQ1_GroupedBars\run.ts

RQ2: $env:TS_NODE_COMPILER_OPTIONS='{"module":"commonjs"}'; $env:NODE_OPTIONS="--expose-gc --max-old-space-size=16384"; npx ts-node .\Benchmarks\RQ2_NodeScaling\run.ts

RQ3: $env:TS_NODE_COMPILER_OPTIONS='{"module":"commonjs"}'; $env:NODE_OPTIONS="--expose-gc --max-old-space-size=16384"; npx ts-node .\Benchmarks\RQ3_TranslationBoxPlots\run.ts

RQ4: $env:TS_NODE_COMPILER_OPTIONS='{"module":"commonjs"}'; $env:NODE_OPTIONS="--expose-gc --max-old-space-size=16384"; npx ts-node .\Benchmarks\RQ4_Tipping_Point\run.ts
```


* Benchmark plots can be generated with the following commands:

```
RQ1: python .\Benchmarks\RQ1_GroupedBars\plot.py

RQ2: python .\Benchmarks\RQ2_NodeScaling\plot.py

RQ3: python .\Benchmarks\RQ3_TranslationBoxPlots\plot.py

RQ4: python .\Benchmarks\RQ4_Tipping_Point\plot.py
```

* **npm start** currently not supported, only benchmakrs or tests can be executed

