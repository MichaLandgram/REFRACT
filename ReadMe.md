REFRACT: Coordination-Free Schema Evolution for Replicated Property Graphs

Install: npm install npm i --save-dev --legacy-peer-deps

If you want to run tests, you can use the following command: **npm test**

Running the Benchmarks:
 
RQ1: 

**run**: $env:TS_NODE_COMPILER_OPTIONS='{"module":"commonjs"}'; $env:NODE_OPTIONS="--expose-gc --max-old-space-size=16384"; npx ts-node .\Benchmarks\RQ1_GroupedBars\run.ts  
**plot**: python .\Benchmarks\RQ1_GroupedBars\plot.py

RQ2:

**run**: $env:TS_NODE_COMPILER_OPTIONS='{"module":"commonjs"}'; $env:NODE_OPTIONS="--expose-gc --max-old-space-size=16384"; npx ts-node .\Benchmarks\RQ2_NodeScaling\run.ts
**plot**: python .\Benchmarks\RQ2_NodeScaling\plot.py

RQ3:

**run**: $env:TS_NODE_COMPILER_OPTIONS='{"module":"commonjs"}'; $env:NODE_OPTIONS="--expose-gc --max-old-space-size=16384"; npx ts-node .\Benchmarks\RQ3_TranslationBoxPlots\run.ts  
**plot**: python .\Benchmarks\RQ3_TranslationBoxPlots\plot.py

RQ4:

**run**: $env:TS_NODE_COMPILER_OPTIONS='{"module":"commonjs"}'; $env:NODE_OPTIONS="--expose-gc --max-old-space-size=16384"; npx ts-node .\Benchmarks\RQ4_Tipping_Point\run.ts  
**plot**: python .\Benchmarks\RQ4_Tipping_Point\plot.py