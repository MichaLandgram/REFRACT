import * as fs   from 'fs';
import * as path from 'path';
import * as Y    from 'yjs';
import { performance } from 'perf_hooks';
import { loadPersons } from '../Helper/NodeLoaders';
import { padPersons,
    freshSchema, cloneDoc, median,
} from '../Helper/helper';
import { RQ3_FS_Result, Edge } from '../Helper/resultInterfaces';
import { SF01_DIR, SF03_DIR, findCsvFile, parseLdbcCsv } from '../Helper/SnbDataReader';
import { loadEdges } from '../Helper/RelationshipLoaders';
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

const N_FIXED  = 1000;
const REPS_F1  = 10;
const INT_REPS = 7;
const N_SEEDS  = 10;

const db = new PropertyGraph();
function randomSuffix(): string { return Math.random().toString(36).slice(2, 8).toUpperCase(); }

function loadKnowsCsv(filePath: string, personIds: Set<string>): Edge[] {
    if (!fs.existsSync(filePath)) {
        console.warn('file not found:', filePath);
        return [];
    }
    const lines = fs.readFileSync(filePath, 'utf-8')
        .split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) return [];

    const headers = lines[0].split('|');
    let iSrc = headers.indexOf('Person1Id');
    let iTgt = headers.indexOf('Person2Id');
    let iDt  = headers.indexOf('creationDate');
    if (iSrc < 0 || iTgt < 0) {
        iSrc = headers.indexOf('Person.id');
        iTgt = headers.indexOf('Person.id.1');
    }
    if (iSrc < 0 || iTgt < 0) {
        iSrc = 1; iTgt = 2; iDt = 0;
    }

    const result: Edge[] = [];
    for (let i = 1; i < lines.length; i++) {
        const v = lines[i].split('|');
        const src = v[iSrc] ?? '', tgt = v[iTgt] ?? '';
        if (personIds.has(src) && personIds.has(tgt)) {
            result.push({
                src,
                tgt,
                creationDate: v[iDt] ?? '',
                _edgeId: `knows-${src}-${tgt}`
            });
        }
    }
    return result;
}

function pickSeeds(persons: Record<string, any>[], edges: Edge[]): string[] {
    const srcSet = new Set(edges.map(e => e.src));
    const seeds: string[] = [];
    for (const p of persons) {
        if (srcSet.has(String(p.id))) seeds.push(p._nodeId);
        if (seeds.length === N_SEEDS) break;
    }
    return seeds;
}

function computeTipping(eagerMigMs: number, lazyReadyMs: number, prismQMs: number, eagerQMs: number): number {
    const delta = prismQMs - eagerQMs;
    if (delta <= 0.00001) return eagerMigMs === 0 ? 0 : Infinity;
    return Math.max(0, (eagerMigMs - lazyReadyMs) / delta);
}

function measurePrismHop(lensE: ReturnType<typeof freshSchema>['le'], doc: Y.Doc, seedIds: string[] ): number {
    const times: number[] = [];
    for (let i = 0; i < INT_REPS; i++) {
        const t0 = performance.now();
        seedIds.forEach(seed => {
            const neighbors = lensE.oneHopRQ4(db, doc, seed, 'KNOWS');
            for (let j = 0; j < neighbors.length; j++) {
                const appProps = neighbors[j].appProps;
                const _fName = appProps.firstName;
                const _lName = appProps.lastName;
            }
        });
        times.push((performance.now() - t0) / seedIds.length);
    }
    return median(times);
}

function measureEagerHop(eagerDoc: Y.Doc, seedIds: string[]): number {
    const times: number[] = [];
    for (let i = 0; i < INT_REPS; i++) {
        const t0 = performance.now();
        seedIds.forEach(seed => {
            const outEdgeIds = db.getOutgoingEdgeIds(eagerDoc, seed);
            for (let j = 0; j < outEdgeIds.length; j++) {
                const rawEdge = db.getRawEdgeById(eagerDoc, outEdgeIds[j]);
                if (rawEdge && rawEdge.type === 'KNOWS') {
                    const rawNode = db.getRawNode(eagerDoc, rawEdge.targetId);
                    if (rawNode) {
                        const props = rawNode.props;
                        const _fName = props.firstName;
                        const _lName = props.lastName;
                    }
                }
            }
        });
        times.push((performance.now() - t0) / seedIds.length);
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
    loadPersons(persons, dataDoc, db);
    loadEdges(persons, edges, dataDoc, db);
    const newType = `NT_${randomSuffix()}`;

    const s0 = performance.now(); sc.SMO_addNodeType(newType, ['person'], { score: 'number' }); const smoMs = performance.now() - s0;
    const g0 = performance.now(); le.refreshCache(); const lensGenMs = performance.now() - g0;
    const lazyReadyMs = smoMs + lensGenMs;

    const RQueryMs  = measurePrismHop(le, dataDoc, seedIds);
    const eagerDoc      = cloneDoc(dataDoc);
    const eagerMigrationMs = 0;  // createNT: no data migration
    const eagerQueryMs  = measureEagerHop(eagerDoc, seedIds);

    const tp = computeTipping(eagerMigrationMs, lazyReadyMs, RQueryMs, eagerQueryMs);
    return { N: persons.length, E: edges.length, smoMs, lensGenMs, lazyReadyMs,
             eagerMigrationMs, RQueryMs, eagerQueryMs, tippingPoint: tp };
};

const benchDropL: BenchFn = (persons, edges, seedIds) => {
    const { sc, le } = freshSchema();
    const dataDoc = new Y.Doc();
    loadPersons(persons, dataDoc, db);
    loadEdges(persons, edges, dataDoc, db);
    const label = `Lbl_${randomSuffix()}`;

    sc.SMO_createLabel(label); sc.SMO_AddLabelToNodeType('Person', label);
    eagerLabelSet(persons, dataDoc, label, 'Person'); eagerEdgeLabelSet(edges, dataDoc, label);

    const s0 = performance.now(); sc.SMO_dropLabel(label); const smoMs = performance.now() - s0;
    const g0 = performance.now(); le.refreshCache(); const lensGenMs = performance.now() - g0;
    const lazyReadyMs = smoMs + lensGenMs;

    const RQueryMs = measurePrismHop(le, dataDoc, seedIds);
    const eagerDoc = cloneDoc(dataDoc);
    const em0 = performance.now();
    eagerLabelDrop(persons, eagerDoc, label, 'Person'); eagerEdgeLabelDrop(edges, eagerDoc, label);
    const eagerMigrationMs = performance.now() - em0;
    const eagerQueryMs = measureEagerHop(eagerDoc, seedIds);

    const tp = computeTipping(eagerMigrationMs, lazyReadyMs, RQueryMs, eagerQueryMs);
    return { N: persons.length, E: edges.length, smoMs, lensGenMs, lazyReadyMs,
             eagerMigrationMs, RQueryMs, eagerQueryMs, tippingPoint: tp };
};

const benchRenameL: BenchFn = (persons, edges, seedIds) => {
    const { sc, le } = freshSchema();
    const dataDoc = new Y.Doc();
    loadPersons(persons, dataDoc, db);
    loadEdges(persons, edges, dataDoc, db);
    const oldLabel = `Lbl_${randomSuffix()}`, newLabel = `Lbl_${randomSuffix()}`;

    sc.SMO_createLabel(oldLabel); sc.SMO_AddLabelToNodeType('Person', oldLabel);
    eagerLabelSet(persons, dataDoc, oldLabel, 'Person'); eagerEdgeLabelSet(edges, dataDoc, oldLabel);

    const s0 = performance.now(); sc.SMO_renameLabel(oldLabel, newLabel); const smoMs = performance.now() - s0;
    const g0 = performance.now(); le.refreshCache(); const lensGenMs = performance.now() - g0;
    const lazyReadyMs = smoMs + lensGenMs;

    const RQueryMs = measurePrismHop(le, dataDoc, seedIds);
    const eagerDoc = cloneDoc(dataDoc);
    const em0 = performance.now();
    eagerLabelRename(persons, eagerDoc, oldLabel, newLabel, edges);
    const eagerMigrationMs = performance.now() - em0;
    const eagerQueryMs = measureEagerHop(eagerDoc, seedIds);

    const tp = computeTipping(eagerMigrationMs, lazyReadyMs, RQueryMs, eagerQueryMs);
    return { N: persons.length, E: edges.length, smoMs, lensGenMs, lazyReadyMs,
             eagerMigrationMs, RQueryMs, eagerQueryMs, tippingPoint: tp };
};

const benchRenamePk: BenchFn = (persons, edges, seedIds) => {
    const { sc, le } = freshSchema();
    const dataDoc = new Y.Doc();
    loadPersons(persons, dataDoc, db);
    loadEdges(persons, edges, dataDoc, db);
    const newKey = `prop_${randomSuffix()}`;

    const s0 = performance.now();
    sc.SMO_renamePropertyKey({ Idenifying: 'Person', oldPropertyKey: 'firstName', newPropertyKey: newKey, whatType: 'NodeType' });
    const smoMs = performance.now() - s0;
    const g0 = performance.now(); le.refreshCache(); const lensGenMs = performance.now() - g0;
    const lazyReadyMs = smoMs + lensGenMs;

    const RQueryMs = measurePrismHop(le, dataDoc, seedIds);
    const eagerDoc = cloneDoc(dataDoc);
    const em0 = performance.now(); eagerRenamePropertyKey(persons, eagerDoc, 'firstName', newKey, 'Person');
    const eagerMigrationMs = performance.now() - em0;
    const eagerQueryMs = measureEagerHop(eagerDoc, seedIds);

    const tp = computeTipping(eagerMigrationMs, lazyReadyMs, RQueryMs, eagerQueryMs);
    return { N: persons.length, E: edges.length, smoMs, lensGenMs, lazyReadyMs,
             eagerMigrationMs, RQueryMs, eagerQueryMs, tippingPoint: tp };
};

const benchAddLabelToNT: BenchFn = (persons, edges, seedIds) => {
    const { sc, le } = freshSchema();
    const dataDoc = new Y.Doc();
    loadPersons(persons, dataDoc, db);
    loadEdges(persons, edges, dataDoc, db);
    const label = `Lbl_${randomSuffix()}`;
    sc.SMO_createLabel(label);

    const s0 = performance.now(); sc.SMO_AddLabelToNodeType('Person', label); const smoMs = performance.now() - s0;
    const g0 = performance.now(); le.refreshCache(); const lensGenMs = performance.now() - g0;
    const lazyReadyMs = smoMs + lensGenMs;

    const RQueryMs = measurePrismHop(le, dataDoc, seedIds);
    const eagerDoc = cloneDoc(dataDoc);
    const em0 = performance.now(); eagerLabelSet(persons, eagerDoc, label, 'Person');
    const eagerMigrationMs = performance.now() - em0;
    const eagerQueryMs = measureEagerHop(eagerDoc, seedIds);

    const tp = computeTipping(eagerMigrationMs, lazyReadyMs, RQueryMs, eagerQueryMs);
    return { N: persons.length, E: edges.length, smoMs, lensGenMs, lazyReadyMs,
             eagerMigrationMs, RQueryMs, eagerQueryMs, tippingPoint: tp };
};

const benchRemoveProperty: BenchFn = (persons, edges, seedIds) => {
    const { sc, le } = freshSchema();
    const dataDoc = new Y.Doc();
    loadPersons(persons, dataDoc, db);
    loadEdges(persons, edges, dataDoc, db);
    const prop = `prop_${randomSuffix()}`;

    sc.SMO_AddPropertyType({ Idenifying: 'Person', newProperty: { key: prop, value: 'string' }, defa: '', whatType: 'NodeType' });
    eagerAddProp(persons, dataDoc, prop, 'default_val', 'Person');

    const s0 = performance.now();
    sc.SMO_DropPropertyType({ Idenifying: 'Person', propertyKey: prop, whatType: 'NodeType' });
    const smoMs = performance.now() - s0;
    const g0 = performance.now(); le.refreshCache(); const lensGenMs = performance.now() - g0;
    const lazyReadyMs = smoMs + lensGenMs;

    const RQueryMs = measurePrismHop(le, dataDoc, seedIds);
    const eagerDoc = cloneDoc(dataDoc);
    const em0 = performance.now(); eagerDropProp(persons, eagerDoc, prop, 'Person');
    const eagerMigrationMs = performance.now() - em0;
    const eagerQueryMs = measureEagerHop(eagerDoc, seedIds);

    const tp = computeTipping(eagerMigrationMs, lazyReadyMs, RQueryMs, eagerQueryMs);
    return { N: persons.length, E: edges.length, smoMs, lensGenMs, lazyReadyMs,
             eagerMigrationMs, RQueryMs, eagerQueryMs, tippingPoint: tp };
};

const benchSplitNT: BenchFn = (persons, edges, seedIds) => {
    const { sc, le } = freshSchema();
    const dataDoc = new Y.Doc();
    loadPersons(persons, dataDoc, db);
    loadEdges(persons, edges, dataDoc, db);
    const newType = `NT_${randomSuffix()}`;

    const s0 = performance.now();
    sc.SMO_splitNodeType({ legacyType: 'Person', splitProperty: 'gender',
                           mapping: { male: newType, female: newType }, defaultType: newType });
    const smoMs = performance.now() - s0;
    const g0 = performance.now(); le.refreshCache(); const lensGenMs = performance.now() - g0;
    const lazyReadyMs = smoMs + lensGenMs;

    const RQueryMs = measurePrismHop(le, dataDoc, seedIds);
    const eagerDoc = cloneDoc(dataDoc);
    const em0 = performance.now(); eagerSplit(persons, eagerDoc, 'Person', { male: newType, female: newType }, 'gender', newType);
    const eagerMigrationMs = performance.now() - em0;
    const eagerQueryMs = measureEagerHop(eagerDoc, seedIds);

    const tp = computeTipping(eagerMigrationMs, lazyReadyMs, RQueryMs, eagerQueryMs);
    return { N: persons.length, E: edges.length, smoMs, lensGenMs, lazyReadyMs,
             eagerMigrationMs, RQueryMs, eagerQueryMs, tippingPoint: tp };
};

const benchUnionNT: BenchFn = (persons, edges, seedIds) => {
    const { sc, le } = freshSchema();
    const dataDoc = new Y.Doc();
    loadPersons(persons, dataDoc, db);
    loadEdges(persons, edges, dataDoc, db);
    const secondType = `NT_${randomSuffix()}`, unionType = `NT_${randomSuffix()}`;
    sc.SMO_addNodeType(secondType, ['person'], { name: 'string' });

    const s0 = performance.now();
    sc.SMO_unionNodeTypes({ newType: unionType, legacyTypes: ['Person', secondType], writeDefault: secondType });
    const smoMs = performance.now() - s0;
    const g0 = performance.now(); le.refreshCache(); const lensGenMs = performance.now() - g0;
    const lazyReadyMs = smoMs + lensGenMs;

    const RQueryMs = measurePrismHop(le, dataDoc, seedIds);
    const eagerDoc = cloneDoc(dataDoc);
    const em0 = performance.now(); eagerUnion(persons, eagerDoc, ['Person', secondType], unionType);
    const eagerMigrationMs = performance.now() - em0;
    const eagerQueryMs = measureEagerHop(eagerDoc, seedIds);

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

    const sfDir = path.resolve(process.cwd(), SF01_DIR);

    const personFile = findCsvFile(path.join(sfDir, 'dynamic/Person'));
    if (!personFile) throw new Error(`LDBC Person CSV not found at: ${sfDir}`);

    const allPersons = parseLdbcCsv(personFile);
    const persons1000 = padPersons(allPersons, N_FIXED);
    const personIds   = new Set(persons1000.map(p => String(p.id)));

    const edgeDir  = path.join(sfDir, 'dynamic/Person_knows_Person');
    const edgeFile = fs.readdirSync(edgeDir).filter(f => f.endsWith('.csv'))[0] ?? '';
    const edges    = loadKnowsCsv(path.join(edgeDir, edgeFile), personIds);

    { const tmp = new Y.Doc(); loadPersons(persons1000, tmp, db); }
    const seeds = pickSeeds(persons1000, edges);

    console.log(`Loaded ${persons1000.length} persons, ${edges.length} KNOWS edges`);
    console.log(`Seeds: ${seeds.length} nodes with outgoing KNOWS edges\n`);
    
    const warmP   = padPersons(allPersons, 50);
    const warmIds = new Set(warmP.map(p => String(p.id)));
    const warmE   = loadKnowsCsv(path.join(edgeDir, edgeFile), warmIds);
    const warmS   = pickSeeds(warmP, warmE);
    if (warmS.length > 0) {
        for (const fn of Object.values(SMO_BENCH)) fn(warmP, warmE, warmS);
    }

    const results: RQ3_FS_Result[] = [];

    console.log(`N=${N_FIXED}, E=${edges.length}, seeds=${seeds.length}`);
    for (const [smo, bench] of Object.entries(SMO_BENCH)) {
        const qStars: number[] = [];
        for (let rep = 0; rep < REPS_F1; rep++) {
            const r = bench(persons1000, edges, seeds);
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
