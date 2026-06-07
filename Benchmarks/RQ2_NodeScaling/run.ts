import * as fs from 'fs';
import * as path from 'path';
import * as Y from 'yjs';
import { padPersons, freshSchema, cloneDoc } from '../Helper/helper';
import { readSnbPersonsAndKnows, SF3_DIR } from '../Helper/SnbDataReader';
import { loadPersons } from '../Helper/NodeLoaders';
import { loadEdges } from '../Helper/RelationshipLoaders';
import { Edge, RQ1Metrics } from '../Helper/resultInterfaces';
import {
    eagerLabelSet,
    eagerLabelRename,
    eagerAddProp,
    eagerDropProp,
    eagerSplit,
    eagerEdgeLabelSet,
} from '../Helper/EagerMigrationFunctions';
import { PropertyGraph } from '../../src/GraphDB_CRDT/PropertyGraph';
import {
    renameProperty as cambriaRenameOp,
    removeProperty as cambriaRemoveOp,
    addProperty    as cambriaAddOp,
} from 'cambria';
import * as Automerge from 'automerge';

// TODO extract dublicate functions
{
    const _d = Automerge.init<any>();
    for (let _i = 0; _i < 5; _i++)
        Automerge.change(_d, d => { d.lens = [{ op: 'warm' }]; });
}

const db = new PropertyGraph();

function randomSuffix(): string {
    return Math.random().toString(36).slice(2, 8).toUpperCase();
}

/** Drain V8 heap before a timed section. Requires --expose-gc. */
function gcIfAvailable(): void {
    if (typeof (global as any).gc === 'function') (global as any).gc();
}

/** Convert hrtime bigint (nanoseconds) -> milliseconds (float). */
function ns2ms(ns: bigint): number { return Number(ns) / 1_000_000; }

function cambriaSMO(lensSpec: any[]): { cambriaSmoMs: number; cambriaReadyMs: number } {
    const base = Automerge.init<{ lens: any[] }>();
    gcIfAvailable();
    const sw0 = process.hrtime.bigint();
    const doc  = Automerge.change(base, 'smo', d => { d.lens = lensSpec; });
    const cambriaSmoMs = ns2ms(process.hrtime.bigint() - sw0);
    gcIfAvailable();
    const rb0 = process.hrtime.bigint();
    JSON.parse(JSON.stringify(doc.lens));
    const cambriaReadyMs = cambriaSmoMs + ns2ms(process.hrtime.bigint() - rb0);

    return { cambriaSmoMs, cambriaReadyMs };
}


function benchRenameL(persons: Record<string, any>[], edges: Edge[], preloadedDoc: Y.Doc): RQ1Metrics {
    const N = persons.length;
    const dataDoc = cloneDoc(preloadedDoc);
    const { sc, le } = freshSchema();

    const oldLabel = `Lbl_${randomSuffix()}`;
    const newLabel = `Lbl_${randomSuffix()}`;

    sc.SMO_createLabel(oldLabel);
    sc.SMO_AddLabelToNodeType('Person', oldLabel);
    eagerLabelSet(persons, dataDoc, oldLabel, 'Person');
    eagerEdgeLabelSet(edges, dataDoc, oldLabel);
    gcIfAvailable();
    const s0 = process.hrtime.bigint();
    sc.SMO_renameLabel(oldLabel, newLabel);
    const smoMs = ns2ms(process.hrtime.bigint() - s0);

    gcIfAvailable();
    const g0 = process.hrtime.bigint();
    le.refreshCache();
    const lensGenMs = ns2ms(process.hrtime.bigint() - g0);
    const eagerDoc = cloneDoc(dataDoc);
    gcIfAvailable();
    const em0 = process.hrtime.bigint();
    eagerLabelRename(persons, eagerDoc, oldLabel, newLabel, edges);
    const eagerMigrationMs = ns2ms(process.hrtime.bigint() - em0);
    const { cambriaSmoMs, cambriaReadyMs } = cambriaSMO([
        cambriaRenameOp(oldLabel, newLabel)
    ]);

    return {
        smo: 'renameL', N,
        smoMs, lensGenMs, lazyReadyMs: smoMs + lensGenMs,
        cambriaSmoMs, cambriaReadyMs,
        eagerMigrationMs,
    };
}


function benchRemovePk(persons: Record<string, any>[], edges: Edge[], preloadedDoc: Y.Doc): RQ1Metrics {
    const N = persons.length;
    const dataDoc = cloneDoc(preloadedDoc);
    const { sc, le } = freshSchema();

    const prop = `prop_${randomSuffix()}`;

    sc.SMO_AddPropertyType({
        Idenifying: 'Person',
        newProperty: { key: prop, value: 'string' },
        defa: '',
        whatType: 'NodeType',
    });
    eagerAddProp(persons, dataDoc, prop, '', 'Person');
    gcIfAvailable();
    const s0 = process.hrtime.bigint();
    sc.SMO_DropPropertyType({ Idenifying: 'Person', propertyKey: prop, whatType: 'NodeType' });
    const smoMs = ns2ms(process.hrtime.bigint() - s0);

    gcIfAvailable();
    const g0 = process.hrtime.bigint();
    le.refreshCache();
    const lensGenMs = ns2ms(process.hrtime.bigint() - g0);
    const eagerDoc = cloneDoc(dataDoc);
    gcIfAvailable();
    const em0 = process.hrtime.bigint();
    eagerDropProp(persons, eagerDoc, prop, 'Person');
    const eagerMigrationMs = ns2ms(process.hrtime.bigint() - em0);
    const { cambriaSmoMs, cambriaReadyMs } = cambriaSMO([
        cambriaRemoveOp({ name: prop, type: 'string' })
    ]);

    return {
        smo: 'removePk', N,
        smoMs, lensGenMs, lazyReadyMs: smoMs + lensGenMs,
        cambriaSmoMs, cambriaReadyMs,
        eagerMigrationMs,
    };
}

function benchSplitNT(persons: Record<string, any>[], edges: Edge[], preloadedDoc: Y.Doc): RQ1Metrics {
    const N = persons.length;
    const dataDoc = cloneDoc(preloadedDoc);
    const { sc, le } = freshSchema();

    const newType = `NT_${randomSuffix()}`;
    gcIfAvailable();
    const s0 = process.hrtime.bigint();
    sc.SMO_splitNodeType({
        legacyType: 'Person',
        splitProperty: 'gender',
        mapping: { male: newType, female: newType },
        defaultType: newType,
    });
    const smoMs = ns2ms(process.hrtime.bigint() - s0);

    gcIfAvailable();
    const g0 = process.hrtime.bigint();
    le.refreshCache();
    const lensGenMs = ns2ms(process.hrtime.bigint() - g0);

    const eagerDoc = cloneDoc(dataDoc);
    gcIfAvailable();
    const em0 = process.hrtime.bigint();
    eagerSplit(persons, eagerDoc, 'Person', { male: newType, female: newType }, 'gender', newType);
    const eagerMigrationMs = ns2ms(process.hrtime.bigint() - em0);

    const { cambriaSmoMs, cambriaReadyMs } = cambriaSMO([
        cambriaAddOp({ name: 'nodeType', type: 'string', default: newType })
    ]);

    return {
        smo: 'splitNT', N,
        smoMs, lensGenMs, lazyReadyMs: smoMs + lensGenMs,
        cambriaSmoMs, cambriaReadyMs,
        eagerMigrationMs,
    };
}


export function runRQ1(): RQ1Metrics[] {
    const sfDir      = path.resolve(process.cwd(), SF3_DIR);
    const data       = readSnbPersonsAndKnows(sfDir);
    const allPersons = data.persons;
    const allKnows   = data.knows;
    console.log(`Loaded ${allPersons.length} persons, ${allKnows.length} knows edges from SF3\n`);

    const warmPersons = padPersons(allPersons, 50);
    const warmIds = new Set(warmPersons.map(p => String(p.id)));
    const warmEdges = allKnows
        .filter(e => warmIds.has(String(e.Person1Id)) && warmIds.has(String(e.Person2Id)))
        .map(e => ({
            src: String(e.Person1Id),
            tgt: String(e.Person2Id),
            creationDate: String(e.creationDate),
            _edgeId: `knows-${e.Person1Id}-${e.Person2Id}`
        }));
    const warmDoc = new Y.Doc();
    loadPersons(warmPersons, warmDoc, db);
    loadEdges(warmPersons, warmEdges, warmDoc, db);
    for (let w = 0; w < 3; w++)
        for (const bench of [benchRenameL, benchRemovePk, benchSplitNT])
            bench(warmPersons, warmEdges, warmDoc);

    const scales = [100, 250, 500, 750, 1000, 1500, 2000, 3000, 5000, 7500, 10000];

    const REPS = 1; // TODO CHANGE

    const results: RQ1Metrics[] = [];

    for (const N of scales) {
        const persons = padPersons(allPersons, N);
        const personIds = new Set(persons.map(p => String(p.id)));
        const allEdges = allKnows
            .filter(e => personIds.has(String(e.Person1Id)) && personIds.has(String(e.Person2Id)))
            .map(e => ({
                src: String(e.Person1Id),
                tgt: String(e.Person2Id),
                creationDate: String(e.creationDate),
                _edgeId: `knows-${e.Person1Id}-${e.Person2Id}`
            }));
        const edges = allEdges;
        const tag = N > allPersons.length ? ' (padded)' : '';
        console.log(`--- N=${N}${tag}, E=${edges.length} ---`);


        const baseDataDoc = new Y.Doc();
        loadPersons(persons, baseDataDoc, db);
        loadEdges(persons, edges, baseDataDoc, db);

        for (const bench of [benchRenameL, benchRemovePk, benchSplitNT]) {
            const raws: RQ1Metrics[] = [];
            for (let i = 0; i < REPS; i++) raws.push(bench(persons, edges, baseDataDoc));

            const min  = (arr: number[]) => Math.min(...arr);
            const mean = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;

            const r: RQ1Metrics = {
                smo:              raws[0].smo,
                N:                raws[0].N,
                smoMs:            min(raws.map(x => x.smoMs)),
                lensGenMs:        min(raws.map(x => x.lensGenMs)),
                lazyReadyMs:      min(raws.map(x => x.lazyReadyMs)),
                cambriaSmoMs:     min(raws.map(x => x.cambriaSmoMs)),
                cambriaReadyMs:   min(raws.map(x => x.cambriaReadyMs)),
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
        const outputPath = path.join(__dirname, 'rq1_results.json');
        fs.writeFileSync(outputPath, JSON.stringify({ results }, null, 2));
        console.log(`Saved progress up to N=${N} to ${outputPath}\n`);
     }

    return results;
}

if (require.main === module) {
    runRQ1();
}
