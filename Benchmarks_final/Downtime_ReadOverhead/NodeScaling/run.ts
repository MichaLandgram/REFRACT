import * as fs from 'fs';
import * as path from 'path';
import * as Y from 'yjs';
import { 
    cutNodes, 
    freshSimpleSchema,
    cloneDoc,
    SF3_DIR,
    loadPersons,
    loadEdges,
    SF01_DIR,
    gcIfAvailable,
    randomSuffix,
    ns2ms } from '../../Helper/benchHelper';
import { cambriaSMO, PERSON_BASE_LENS, measureREFRACT } from '../helper';
import { readSnbPersonsAndKnows } from '../../Helper/SnbDataReader';
import {
    eagerLabelSet,
    eagerLabelRename,
    eagerAddProp,
    eagerDropProp,
    eagerSplit,
    eagerEdgeLabelSet,
} from '../../Helper/EagerMigrationFunctions';
import { PropertyGraph } from '../../../src/GraphDB_CRDT/PropertyGraph';
import {
    renameProperty  as cambriaRenameOp,
    addProperty     as cambriaAddOp,
    removeProperty  as cambriaRemoveOp,
    LensSource,
} from 'cambria';
import { generateSchema } from '../../../src/Helper/Schema/SchemaGenerator';
import * as Automerge from 'automerge';


export interface RQ1Metrics {
    smo: 'renameL' | 'removePk' | 'splitNT';
    N:                number;
    smoMs:            number; 
    lensGenMs:        number;
    lazyReadyMs:      number;
    cambriaSmoMs:     number;
    cambriaReadyMs:   number;
    eagerMigrationMs: number;
}

{
    const _d = Automerge.init<any>();
    for (let _i = 0; _i < 5; _i++)
        Automerge.change(_d, d => { d.lens = [{ op: 'warm' }]; });
}


function benchRenameL(persons: Record<string, any>[], edges: Record<string, any>[], preloadedDoc: Y.Doc, schemaDef: any): RQ1Metrics {
    const N = persons.length;
    const dataDoc = cloneDoc(preloadedDoc);
    const { sc, le } = freshSimpleSchema(schemaDef);

    const oldLabel = `Lbl_${randomSuffix()}`;
    const newLabel = `Lbl_${randomSuffix()}`;

    sc.SMO_createLabel(oldLabel);
    const Updated_PERSON_BASE_LENS: LensSource = [
        ...PERSON_BASE_LENS,
        cambriaAddOp({ name: oldLabel, type: 'boolean', default: false })
    ];

    sc.SMO_AddLabelToNodeType('Person', oldLabel);
    eagerLabelSet(persons, dataDoc, oldLabel, 'Person');
    eagerEdgeLabelSet(edges, dataDoc, oldLabel);

    const { smoMs, lensGenMs } = measureREFRACT(sc, le, () =>
        sc.SMO_renameLabel(oldLabel, newLabel));

    const eagerDoc = cloneDoc(dataDoc);
    gcIfAvailable();
    const em0 = process.hrtime.bigint();
    eagerLabelRename(persons, eagerDoc, oldLabel, newLabel, edges);
    const eagerMigrationMs = ns2ms(process.hrtime.bigint() - em0);

    const { cambriaSmoMs, cambriaReadyMs } = cambriaSMO([
        cambriaRenameOp(oldLabel, newLabel)
    ], Updated_PERSON_BASE_LENS, schemaDef);

    return {
        smo: 'renameL', N,
        smoMs, lensGenMs, lazyReadyMs: smoMs + lensGenMs,
        cambriaSmoMs, cambriaReadyMs,
        eagerMigrationMs,
    };
}
function benchRemovePk(persons: Record<string, any>[], edges: Record<string, any>[], preloadedDoc: Y.Doc, schemaDef: any): RQ1Metrics {
    const N = persons.length;
    const dataDoc = cloneDoc(preloadedDoc);
    const { sc, le } = freshSimpleSchema(schemaDef);

    const prop = `prop_${randomSuffix()}`;

    sc.SMO_AddPropertyType({
        Idenifying: 'Person',
        newProperty: { key: prop, value: 'string' },
        defa: '',
        whatType: 'NodeType',
    });
    const Updated_PERSON_BASE_LENS: LensSource = [
        ...PERSON_BASE_LENS,
        cambriaAddOp({ name: prop, type: 'string', default: '' })
    ];
    eagerAddProp(persons, dataDoc, prop, '', 'Person');

    const { smoMs, lensGenMs } = measureREFRACT(sc, le, () =>
        sc.SMO_DropPropertyType({ Idenifying: 'Person', propertyKey: prop, whatType: 'NodeType' }));

    const eagerDoc = cloneDoc(dataDoc);
    gcIfAvailable();
    const em0 = process.hrtime.bigint();
    eagerDropProp(persons, eagerDoc, prop, 'Person');
    const eagerMigrationMs = ns2ms(process.hrtime.bigint() - em0);

    const { cambriaSmoMs, cambriaReadyMs } = cambriaSMO([
        cambriaRemoveOp({ name: prop, type: 'string' })
    ], Updated_PERSON_BASE_LENS, schemaDef);

    return {
        smo: 'removePk', N,
        smoMs, lensGenMs, lazyReadyMs: smoMs + lensGenMs,
        cambriaSmoMs, cambriaReadyMs,
        eagerMigrationMs,
    };
}
function benchSplitNT(persons: Record<string, any>[], edges: Record<string, any>[], preloadedDoc: Y.Doc, schemaDef: any): RQ1Metrics {
    const N = persons.length;
    const dataDoc = cloneDoc(preloadedDoc);
    const { sc, le } = freshSimpleSchema(schemaDef);

    const newType = `NT_${randomSuffix()}`;
    const { smoMs, lensGenMs } = measureREFRACT(sc, le, () =>
        sc.SMO_splitNodeType({
            legacyType: 'Person',
            splitProperty: 'gender',
            mapping: { male: newType, female: newType },
            defaultType: newType,
        }));

    const eagerDoc = cloneDoc(dataDoc);
    gcIfAvailable();
    const em0 = process.hrtime.bigint();
    eagerSplit(persons, eagerDoc, 'Person', { male: newType, female: newType }, 'gender', newType);
    const eagerMigrationMs = ns2ms(process.hrtime.bigint() - em0);

    const { cambriaSmoMs, cambriaReadyMs } = cambriaSMO([
        cambriaAddOp({ name: 'nodeType', type: 'string', default: newType })
    ], undefined, schemaDef);

    return {
        smo: 'splitNT', N,
        smoMs, lensGenMs, lazyReadyMs: smoMs + lensGenMs,
        cambriaSmoMs, cambriaReadyMs,
        eagerMigrationMs,
    };
}

export function runNodeScaling(): RQ1Metrics[] {
    console.log('Scale Downtime - related to node count up to 10.000');
    const scales = [100, 500,1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500, 5000, 7500, 10000];
    const REPS = 5; 
    const results: RQ1Metrics[] = [];

    const data = readSnbPersonsAndKnows(path.resolve(process.cwd(), SF3_DIR));
    const allPersons = data.persons;
    const allKnows   = data.knows;
    console.log(`Loaded ${allPersons.length} persons, ${allKnows.length} knows edges from SF3\n`);

    const warmPersons = cutNodes(allPersons, 50);
    const warmIds = new Set(warmPersons.map(p => String(p.id)));
    const warmEdges = allKnows.filter(e => warmIds.has(String(e.Person1Id)) && warmIds.has(String(e.Person2Id)));
    const warmDoc = new Y.Doc();
    const db = new PropertyGraph(warmDoc);
    loadPersons(warmPersons, warmDoc, db);
    loadEdges(warmPersons, warmEdges, warmDoc, db);
    for (let w = 0; w < 3; w++)
        for (const bench of [benchRenameL, benchRemovePk, benchSplitNT])
            bench(warmPersons, warmEdges, warmDoc, undefined);


    for (const N of scales) {
        const persons = cutNodes(allPersons, N);
        const personIds = new Set(persons.map(p => String(p.id)));
        const edges = allKnows.filter(e => personIds.has(String(e.Person1Id)) && personIds.has(String(e.Person2Id)));
        console.log(`N=${N}, persons=${persons.length}, E=${edges.length}, Reps=${REPS}`);

        const baseDataDoc = new Y.Doc();
        loadPersons(persons, baseDataDoc, db);
        loadEdges(persons, edges, baseDataDoc, db);

        for (const bench of [benchRenameL, benchRemovePk, benchSplitNT]) {
            const raws: RQ1Metrics[] = [];
            for (let i = 0; i < REPS; i++) raws.push(bench(persons, edges, baseDataDoc, undefined));

            const mean = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;

            const r: RQ1Metrics = {
                smo:              raws[0].smo,
                N:                raws[0].N,
                smoMs:            mean(raws.map(x => x.smoMs)),
                lensGenMs:        mean(raws.map(x => x.lensGenMs)),
                lazyReadyMs:      mean(raws.map(x => x.lazyReadyMs)),
                cambriaSmoMs:     mean(raws.map(x => x.cambriaSmoMs)),
                cambriaReadyMs:   mean(raws.map(x => x.cambriaReadyMs)),
                eagerMigrationMs: mean(raws.map(x => x.eagerMigrationMs)),
            };
            results.push(r);
            console.log(
                `  ${r.smo.padEnd(10)}` +
                `  cambria_rdy=${r.cambriaReadyMs.toFixed(4).padStart(9)} ms` +
                `  REFRACT_rdy=${r.lazyReadyMs.toFixed(4).padStart(9)} ms` +
                `  eager=${r.eagerMigrationMs.toFixed(2).padStart(9)} ms` +
                `  speedup=${(r.eagerMigrationMs / Math.max(r.lazyReadyMs, 0.0001)).toFixed(0).padStart(5)}×`
            );
        }
        const outputPath = path.join(__dirname, 'result/node_scaling_results.json');
        fs.writeFileSync(outputPath, JSON.stringify({ results }, null, 2));
        console.log(`Saved progress up to N=${N} to ${outputPath}\n`);
     }

    return results;
}

export function runSchemaScaling(): RQ1Metrics[] {
    const scales = [100, 500,1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500, 5000, 7500, 10000];
    const nodeCount = 1000;
    const REPS = 5;
    const results: RQ1Metrics[] = [];

    const data = readSnbPersonsAndKnows(path.resolve(process.cwd(), SF3_DIR));
    const allPersons = data.persons;
    const allKnows   = data.knows;
    console.log(`Loaded ${allPersons.length} persons, ${allKnows.length} knows edges from SF3\n`);

    const warmPersons = cutNodes(allPersons, 50);
    const warmIds = new Set(warmPersons.map(p => String(p.id)));
    const warmEdges = allKnows.filter(e => warmIds.has(String(e.Person1Id)) && warmIds.has(String(e.Person2Id)));
    const warmDoc = new Y.Doc();
    const db = new PropertyGraph(warmDoc);
    loadPersons(warmPersons, warmDoc, db);
    loadEdges(warmPersons, warmEdges, warmDoc, db);
    for (let w = 0; w < 3; w++)
        for (const bench of [benchRenameL, benchRemovePk, benchSplitNT])
            bench(warmPersons, warmEdges, warmDoc, undefined);


    for (const N of scales) {
        const schemaDef = generateSchema(N);
        const persons = cutNodes(allPersons, nodeCount);
        const personIds = new Set(persons.map(p => String(p.id)));
        const edges = allKnows.filter(e => personIds.has(String(e.Person1Id)) && personIds.has(String(e.Person2Id)));
        console.log(`Schema Size: ${N}`);

        const baseDataDoc = new Y.Doc();
        loadPersons(persons, baseDataDoc, db);
        loadEdges(persons, edges, baseDataDoc, db);

        for (const bench of [benchRenameL, benchRemovePk, benchSplitNT]) {
            const raws: RQ1Metrics[] = [];
            for (let i = 0; i < REPS; i++) raws.push(bench(persons, edges, baseDataDoc, schemaDef));

            const mean = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;

            const r: RQ1Metrics = {
                smo:              raws[0].smo,
                N:                N,
                smoMs:            mean(raws.map(x => x.smoMs)),
                lensGenMs:        mean(raws.map(x => x.lensGenMs)),
                lazyReadyMs:      mean(raws.map(x => x.lazyReadyMs)),
                cambriaSmoMs:     mean(raws.map(x => x.cambriaSmoMs)),
                cambriaReadyMs:   mean(raws.map(x => x.cambriaReadyMs)),
                eagerMigrationMs: mean(raws.map(x => x.eagerMigrationMs)),
            };
            results.push(r);
            console.log(
                `  ${r.smo.padEnd(10)}` +
                `  cambria_rdy=${r.cambriaReadyMs.toFixed(4).padStart(9)} ms` +
                `  REFRACT_rdy=${r.lazyReadyMs.toFixed(4).padStart(9)} ms` +
                `  eager=${r.eagerMigrationMs.toFixed(2).padStart(9)} ms` +
                `  speedup=${(r.eagerMigrationMs / Math.max(r.lazyReadyMs, 0.0001)).toFixed(0).padStart(5)}×`
            );
        }
        const outputPath = path.join(__dirname, 'result/schema_scaling_results.json');
        fs.writeFileSync(outputPath, JSON.stringify({ results }, null, 2));
        console.log(`Saved progress up to N=${N} to ${outputPath}\n`);
     }

    return results;

}

if (require.main === module) {
    runNodeScaling();
    runSchemaScaling();
}
