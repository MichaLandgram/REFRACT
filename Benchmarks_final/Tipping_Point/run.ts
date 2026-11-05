import * as fs   from 'fs';
import * as path from 'path';
import * as Y    from 'yjs';
import {
    loadPersons, loadEdges,
    freshSimpleSchema as freshSchema,
    cutNodes as padPersons,
    cloneDoc, median, gcIfAvailable, randomSuffix, ns2ms,
    unpackMVR,
    SF3_DIR,
} from '../Helper/benchHelper';
import { readSnbPersonsAndKnows, filterKnowsEdges } from '../Helper/SnbDataReader';
import { measureREFRACT } from '../Downtime_ReadOverhead/helper';
import {
    eagerRenamePropertyKey,
    eagerSplit,
    eagerUnion,
    eagerAddProp,
    eagerDropProp,
    eagerLabelSet,
    eagerLabelDrop,
    eagerLabelRename,
    eagerEdgeLabelSet,
    eagerEdgeLabelDrop,
} from '../Helper/EagerMigrationFunctions';

import { PropertyGraph } from '../../src/GraphDB_CRDT/PropertyGraph';

type Edge = Record<string, any>;

export interface RQ3_FS_Result {
    smo:              string;
    factor:           1 | 2; // not used anymore
    N:                number;
    E:                number;
    rep:              number;
    smoMs:            number;
    lensGenMs:        number;
    lazyReadyMs:      number;
    eagerMigrationMs: number;
    RQueryMs:         number;
    eagerQueryMs:     number;
    tippingPoint:     number;
}



const N_FIXED  = 1000;
const REPS_F1  = 5;
const INT_REPS = 5;
const N_SEEDS  = 10;

function pickSeeds(persons: Record<string, any>[], edges: Edge[]): string[] {
    const srcSet = new Set(edges.map(e => String(e.Person1Id ?? e.src)));
    const seeds: string[] = [];
    for (const p of persons) {
        if (srcSet.has(String(p.id))) seeds.push(p._nodeId);
        if (seeds.length === N_SEEDS) break;
    }
    return seeds;
}

function computeTipping(eagerMigMs: number, lazyReadyMs: number, prismQMs: number, eagerQMs: number): number {
    const delta = prismQMs - eagerQMs;
    if (delta <= 0.00001) return (eagerMigMs >= lazyReadyMs) ? 0 : Infinity;
    return Math.max(0, (eagerMigMs - lazyReadyMs) / delta);
}

function measurePrismHop(lensE: ReturnType<typeof freshSchema>['le'], db: PropertyGraph, doc: Y.Doc, seedIds: string[]): number {
    db.getVisibleNodes(doc);
    db.getVisibleEdges(doc);

    const times: number[] = [];
    for (let i = 0; i < INT_REPS; i++) {
        gcIfAvailable();
        const t0 = process.hrtime.bigint();
        seedIds.forEach(seed => {
            const outEdgeIds = db.getOutgoingEdgeIds(doc, seed);
            for (let j = 0; j < outEdgeIds.length; j++) {
                const rawEdge = db.getRawEdgeById(doc, outEdgeIds[j]);
                if (!rawEdge) continue;
                const resolvedEdgeType = lensE.resolveActiveEdgeType(rawEdge.type, rawEdge.props);
                if (resolvedEdgeType !== 'KNOWS') continue;
                const rawNode = db.getRawNode(doc, rawEdge.targetId);
                if (!rawNode) continue;
                const resolvedType = lensE.resolveActiveType(rawNode.type, rawNode.props);
                const appProps = lensE.decodeAndFilterProperties(resolvedType, rawNode.props, 'NodeType');
                const _fName = appProps.firstName;
                const _lName = appProps.lastName;
            }
        });
        times.push(ns2ms(process.hrtime.bigint() - t0) / seedIds.length);
    }
    return median(times);
}

function measureEagerHop(db: PropertyGraph, eagerDoc: Y.Doc, seedIds: string[]): number {
    db.getVisibleNodes(eagerDoc);
    db.getVisibleEdges(eagerDoc);

    const times: number[] = [];
    for (let i = 0; i < INT_REPS; i++) {
        gcIfAvailable();
        const t0 = process.hrtime.bigint();
        seedIds.forEach(seed => {
            const outEdgeIds = db.getOutgoingEdgeIds(eagerDoc, seed);
            for (let j = 0; j < outEdgeIds.length; j++) {
                const rawEdge = db.getRawEdgeById(eagerDoc, outEdgeIds[j]);
                if (rawEdge && rawEdge.type === 'KNOWS') {
                    const rawNode = db.getRawNode(eagerDoc, rawEdge.targetId);
                    if (rawNode) {
                        const props = rawNode.props;
                        const _fName = unpackMVR(props.firstName);
                        const _lName = unpackMVR(props.lastName);
                    }
                }
            }
        });
        times.push(ns2ms(process.hrtime.bigint() - t0) / seedIds.length);
    }
    return median(times);
}

type BenchFn = (
    persons: Record<string, any>[],
    edges:   Edge[],
    seedIds: string[],
) => Omit<RQ3_FS_Result, 'smo' | 'factor' | 'rep'>;

const benchCreateNT: BenchFn = (persons, edges, seedIds) => {
    const { sc, le } = freshSchema();
    const dataDoc = new Y.Doc();
    const db = new PropertyGraph(dataDoc);
    loadPersons(persons, dataDoc, db);
    loadEdges(persons, edges, dataDoc, db);
    const newType = `NT_${randomSuffix()}`;

    const { smoMs, lensGenMs, lazyReadyMs } = measureREFRACT(sc, le, () =>
        sc.SMO_addNodeType(newType, ['person'], { score: 'number' }));

    const RQueryMs      = measurePrismHop(le, db, dataDoc, seedIds);
    const eagerDoc      = cloneDoc(dataDoc);
    const eagerDb       = new PropertyGraph(eagerDoc);
    const eagerMigrationMs = 0;  // createNT: no data migration
    const eagerQueryMs  = measureEagerHop(eagerDb, eagerDoc, seedIds);

    const tp = computeTipping(eagerMigrationMs, lazyReadyMs, RQueryMs, eagerQueryMs);
    return { N: persons.length, E: edges.length, smoMs, lensGenMs, lazyReadyMs,
             eagerMigrationMs, RQueryMs, eagerQueryMs, tippingPoint: tp };
};

const benchDropL: BenchFn = (persons, edges, seedIds) => {
    const { sc, le } = freshSchema();
    const dataDoc = new Y.Doc();
    const db = new PropertyGraph(dataDoc);
    loadPersons(persons, dataDoc, db);
    loadEdges(persons, edges, dataDoc, db);
    const label = `Lbl_${randomSuffix()}`;

    sc.SMO_createLabel(label); sc.SMO_AddLabelToNodeType('Person', label);
    eagerLabelSet(persons, dataDoc, label, 'Person'); eagerEdgeLabelSet(edges, dataDoc, label);

    const { smoMs, lensGenMs, lazyReadyMs } = measureREFRACT(sc, le, () =>
        sc.SMO_dropLabel(label));

    const RQueryMs = measurePrismHop(le, db, dataDoc, seedIds);
    const eagerDoc = cloneDoc(dataDoc);
    const eagerDb  = new PropertyGraph(eagerDoc);
    gcIfAvailable();
    const em0 = process.hrtime.bigint();
    eagerLabelDrop(persons, eagerDoc, label, 'Person'); eagerEdgeLabelDrop(edges, eagerDoc, label);
    const eagerMigrationMs = ns2ms(process.hrtime.bigint() - em0);
    const eagerQueryMs = measureEagerHop(eagerDb, eagerDoc, seedIds);

    const tp = computeTipping(eagerMigrationMs, lazyReadyMs, RQueryMs, eagerQueryMs);
    return { N: persons.length, E: edges.length, smoMs, lensGenMs, lazyReadyMs,
             eagerMigrationMs, RQueryMs, eagerQueryMs, tippingPoint: tp };
};

const benchRenameL: BenchFn = (persons, edges, seedIds) => {
    const { sc, le } = freshSchema();
    const dataDoc = new Y.Doc();
    const db = new PropertyGraph(dataDoc);
    loadPersons(persons, dataDoc, db);
    loadEdges(persons, edges, dataDoc, db);
    const oldLabel = `Lbl_${randomSuffix()}`, newLabel = `Lbl_${randomSuffix()}`;

    sc.SMO_createLabel(oldLabel); sc.SMO_AddLabelToNodeType('Person', oldLabel);
    eagerLabelSet(persons, dataDoc, oldLabel, 'Person'); eagerEdgeLabelSet(edges, dataDoc, oldLabel);

    const { smoMs, lensGenMs, lazyReadyMs } = measureREFRACT(sc, le, () =>
        sc.SMO_renameLabel(oldLabel, newLabel));

    const RQueryMs = measurePrismHop(le, db, dataDoc, seedIds);
    const eagerDoc = cloneDoc(dataDoc);
    const eagerDb  = new PropertyGraph(eagerDoc);
    gcIfAvailable();
    const em0 = process.hrtime.bigint();
    eagerLabelRename(persons, eagerDoc, oldLabel, newLabel, edges);
    const eagerMigrationMs = ns2ms(process.hrtime.bigint() - em0);
    const eagerQueryMs = measureEagerHop(eagerDb, eagerDoc, seedIds);

    const tp = computeTipping(eagerMigrationMs, lazyReadyMs, RQueryMs, eagerQueryMs);
    return { N: persons.length, E: edges.length, smoMs, lensGenMs, lazyReadyMs,
             eagerMigrationMs, RQueryMs, eagerQueryMs, tippingPoint: tp };
};

const benchRenamePk: BenchFn = (persons, edges, seedIds) => {
    const { sc, le } = freshSchema();
    const dataDoc = new Y.Doc();
    const db = new PropertyGraph(dataDoc);
    loadPersons(persons, dataDoc, db);
    loadEdges(persons, edges, dataDoc, db);
    const newKey = `prop_${randomSuffix()}`;

    const { smoMs, lensGenMs, lazyReadyMs } = measureREFRACT(sc, le, () =>
        sc.SMO_renamePropertyKey({ Idenifying: 'Person', oldPropertyKey: 'firstName', newPropertyKey: newKey, whatType: 'NodeType' }));

    const RQueryMs = measurePrismHop(le, db, dataDoc, seedIds);
    const eagerDoc = cloneDoc(dataDoc);
    const eagerDb  = new PropertyGraph(eagerDoc);
    gcIfAvailable();
    const em0 = process.hrtime.bigint(); eagerRenamePropertyKey(persons, eagerDoc, 'firstName', newKey, 'Person');
    const eagerMigrationMs = ns2ms(process.hrtime.bigint() - em0);
    const eagerQueryMs = measureEagerHop(eagerDb, eagerDoc, seedIds);

    const tp = computeTipping(eagerMigrationMs, lazyReadyMs, RQueryMs, eagerQueryMs);
    return { N: persons.length, E: edges.length, smoMs, lensGenMs, lazyReadyMs,
             eagerMigrationMs, RQueryMs, eagerQueryMs, tippingPoint: tp };
};

const benchAddLabelToNT: BenchFn = (persons, edges, seedIds) => {
    const { sc, le } = freshSchema();
    const dataDoc = new Y.Doc();
    const db = new PropertyGraph(dataDoc);
    loadPersons(persons, dataDoc, db);
    loadEdges(persons, edges, dataDoc, db);
    const label = `Lbl_${randomSuffix()}`;
    sc.SMO_createLabel(label);

    const { smoMs, lensGenMs, lazyReadyMs } = measureREFRACT(sc, le, () =>
        sc.SMO_AddLabelToNodeType('Person', label));

    const RQueryMs = measurePrismHop(le, db, dataDoc, seedIds);
    const eagerDoc = cloneDoc(dataDoc);
    const eagerDb  = new PropertyGraph(eagerDoc);
    gcIfAvailable();
    const em0 = process.hrtime.bigint(); eagerLabelSet(persons, eagerDoc, label, 'Person');
    const eagerMigrationMs = ns2ms(process.hrtime.bigint() - em0);
    const eagerQueryMs = measureEagerHop(eagerDb, eagerDoc, seedIds);

    const tp = computeTipping(eagerMigrationMs, lazyReadyMs, RQueryMs, eagerQueryMs);
    return { N: persons.length, E: edges.length, smoMs, lensGenMs, lazyReadyMs,
             eagerMigrationMs, RQueryMs, eagerQueryMs, tippingPoint: tp };
};

const benchRemoveProperty: BenchFn = (persons, edges, seedIds) => {
    const { sc, le } = freshSchema();
    const dataDoc = new Y.Doc();
    const db = new PropertyGraph(dataDoc);
    loadPersons(persons, dataDoc, db);
    loadEdges(persons, edges, dataDoc, db);
    const prop = `prop_${randomSuffix()}`;

    sc.SMO_AddPropertyType({ Idenifying: 'Person', newProperty: { key: prop, value: 'string' }, defa: '', whatType: 'NodeType' });
    eagerAddProp(persons, dataDoc, prop, 'default_val', 'Person');

    const { smoMs, lensGenMs, lazyReadyMs } = measureREFRACT(sc, le, () =>
        sc.SMO_DropPropertyType({ Idenifying: 'Person', propertyKey: prop, whatType: 'NodeType' }));

    const RQueryMs = measurePrismHop(le, db, dataDoc, seedIds);
    const eagerDoc = cloneDoc(dataDoc);
    const eagerDb  = new PropertyGraph(eagerDoc);
    gcIfAvailable();
    const em0 = process.hrtime.bigint(); eagerDropProp(persons, eagerDoc, prop, 'Person');
    const eagerMigrationMs = ns2ms(process.hrtime.bigint() - em0);
    const eagerQueryMs = measureEagerHop(eagerDb, eagerDoc, seedIds);

    const tp = computeTipping(eagerMigrationMs, lazyReadyMs, RQueryMs, eagerQueryMs);
    return { N: persons.length, E: edges.length, smoMs, lensGenMs, lazyReadyMs,
             eagerMigrationMs, RQueryMs, eagerQueryMs, tippingPoint: tp };
};

const benchSplitNT: BenchFn = (persons, edges, seedIds) => {
    const { sc, le } = freshSchema();
    const dataDoc = new Y.Doc();
    const db = new PropertyGraph(dataDoc);
    loadPersons(persons, dataDoc, db);
    loadEdges(persons, edges, dataDoc, db);
    const newType = `NT_${randomSuffix()}`;

    const { smoMs, lensGenMs, lazyReadyMs } = measureREFRACT(sc, le, () =>
        sc.SMO_splitNodeType({ legacyType: 'Person', splitProperty: 'gender',
                               mapping: { male: newType, female: newType }, defaultType: newType }));

    const RQueryMs = measurePrismHop(le, db, dataDoc, seedIds);
    const eagerDoc = cloneDoc(dataDoc);
    const eagerDb  = new PropertyGraph(eagerDoc);
    gcIfAvailable();
    const em0 = process.hrtime.bigint(); eagerSplit(persons, eagerDoc, 'Person', { male: newType, female: newType }, 'gender', newType);
    const eagerMigrationMs = ns2ms(process.hrtime.bigint() - em0);
    const eagerQueryMs = measureEagerHop(eagerDb, eagerDoc, seedIds);

    const tp = computeTipping(eagerMigrationMs, lazyReadyMs, RQueryMs, eagerQueryMs);
    return { N: persons.length, E: edges.length, smoMs, lensGenMs, lazyReadyMs,
             eagerMigrationMs, RQueryMs, eagerQueryMs, tippingPoint: tp };
};

const benchUnionNT: BenchFn = (persons, edges, seedIds) => {
    const { sc, le } = freshSchema();
    const dataDoc = new Y.Doc();
    const db = new PropertyGraph(dataDoc);
    loadPersons(persons, dataDoc, db);
    loadEdges(persons, edges, dataDoc, db);
    const secondType = `NT_${randomSuffix()}`, unionType = `NT_${randomSuffix()}`;
    sc.SMO_addNodeType(secondType, ['person'], { name: 'string' });

    const { smoMs, lensGenMs, lazyReadyMs } = measureREFRACT(sc, le, () =>
        sc.SMO_unionNodeTypes({ newType: unionType, legacyTypes: ['Person', secondType], writeDefault: secondType }));

    const RQueryMs = measurePrismHop(le, db, dataDoc, seedIds);
    const eagerDoc = cloneDoc(dataDoc);
    const eagerDb  = new PropertyGraph(eagerDoc);
    gcIfAvailable();
    const em0 = process.hrtime.bigint(); eagerUnion(persons, eagerDoc, ['Person', secondType], unionType);
    const eagerMigrationMs = ns2ms(process.hrtime.bigint() - em0);
    const eagerQueryMs = measureEagerHop(eagerDb, eagerDoc, seedIds);

    const tp = computeTipping(eagerMigrationMs, lazyReadyMs, RQueryMs, eagerQueryMs);
    return { N: persons.length, E: edges.length, smoMs, lensGenMs, lazyReadyMs,
             eagerMigrationMs, RQueryMs, eagerQueryMs, tippingPoint: tp };
};

const SMO_BENCH: Record<string, BenchFn> = {
    createNT:       benchCreateNT,
    dropL:          benchDropL,
    renameL:        benchRenameL,
    renamePk:       benchRenamePk,
    addLabelToNT:   benchAddLabelToNT,
    removeProperty: benchRemoveProperty,
    splitNT:        benchSplitNT,
    unionNT:        benchUnionNT,
};

export function runRQ4(): RQ3_FS_Result[] {

    const sfDir = path.resolve(process.cwd(), SF3_DIR);
    const data  = readSnbPersonsAndKnows(sfDir);
    console.log(`Full data persons:`, data.persons.length, 'knows edges:', data.knows.length);

    const persons   = padPersons(data.persons, N_FIXED);
    const personIds = new Set(persons.map(p => String(p.id)));
    const edges: any = filterKnowsEdges(data.knows, personIds);

    { const tmp = new Y.Doc(); const tmpDb = new PropertyGraph(tmp); loadPersons(persons, tmp, tmpDb); }
    const seeds = pickSeeds(persons, edges);

    console.log(`Loaded ${persons.length} persons, ${edges.length} KNOWS edges`);
    console.log(`Seeds: ${seeds.length} nodes with outgoing KNOWS edges\n`);

    // Small warmup for JIT
    const warmP   = padPersons(data.persons, 50);
    const warmIds = new Set(warmP.map(p => String(p.id)));
    const warmE: any = filterKnowsEdges(data.knows, warmIds);
    const warmS   = pickSeeds(warmP, warmE);
    if (warmS.length > 0) {
        for (const fn of Object.values(SMO_BENCH)) fn(warmP, warmE, warmS);
    }

    const results: RQ3_FS_Result[] = [];

    console.log(`N=${N_FIXED}, E=${edges.length}, seeds=${seeds.length}`);
    for (const [smo, bench] of Object.entries(SMO_BENCH)) {
        const qStars: number[] = [];
        for (let rep = 0; rep < REPS_F1; rep++) {
            const r = bench(persons, edges, seeds);
            results.push({ smo, factor: 1, rep, ...r });
            qStars.push(isFinite(r.tippingPoint) ? r.tippingPoint : 9999);
        }
        const q50    = median(qStars);
        console.log(
            `  ${smo.padEnd(16)}  q*=${q50.toFixed(0).padStart(7)}` 
        );
    }

    const out = path.join(__dirname, 'rq4_results.json');
    fs.writeFileSync(out, JSON.stringify({results, config: { N_FIXED, REPS_F1, N_SEEDS }}, null, 2));
    return results;
}

if (require.main === module) { runRQ4(); }
