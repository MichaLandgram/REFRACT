import * as fs from 'fs';
import * as path from 'path';
import * as Y from 'yjs';
import { performance } from 'perf_hooks';

import { loadPersons } from '../Helper/NodeLoaders';
import { loadEdges } from '../Helper/RelationshipLoaders';
import { Edge, RQ1_2_Result } from '../Helper/resultInterfaces';
import { padPersons, freshSchema, cloneDoc } from '../Helper/helper';
import { readSnbData, readSnbPersonsAndKnows, SF03_DIR } from '../Helper/SnbDataReader';
import {
    eagerRenamePropertyKey,
    eagerSplit,
    eagerUnion,
    eagerAddProp,
    eagerDropProp,
    eagerLabelSet,
    eagerLabelDrop,
    eagerLabelRename,
    eagerRetype,
    GENDER_MAP,
    eagerDeleteNodes,
    eagerDeleteEdges,
    eagerEdgeLabelSet,
    eagerSplitEdges,
    eagerUnionEdges,
    eagerEdgeLabelDrop,
} from '../Helper/EagerMigrationFunctions';
import { PropertyGraph } from '../../src/GraphDB_CRDT/PropertyGraph';
import {
    renameProperty  as cambriaRenameOp,
    addProperty     as cambriaAddOp,
    removeProperty  as cambriaRemoveOp,
    convertValue    as cambriaConvertOp,
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

/** Write a lens spec to a fresh Automerge doc Cambria CRDT write cost.
 * Conpared to REFRACT's Yjs-based SMO write cost */
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

type BenchFn = (persons: Record<string, any>[], edges: Edge[]) => Omit<RQ1_2_Result, 'smo' | 'rep'>;

function measureREFRACT(sc: any, le: any, smoFn: () => void)
    : { smoMs: number; lensGenMs: number; lazyReadyMs: number } {
    const s0 = performance.now(); smoFn(); const smoMs = performance.now() - s0;
    const g0 = performance.now(); le.refreshCache(); const lensGenMs = performance.now() - g0;
    return { smoMs, lensGenMs, lazyReadyMs: smoMs + lensGenMs };
}

function benchCreateNT(persons: Record<string, any>[], edges: Edge[]): Omit<RQ1_2_Result, 'smo'|'rep'> {
    const { sc, le } = freshSchema();
    const newType = `NT_${randomSuffix()}`;

    const { smoMs, lensGenMs, lazyReadyMs } = measureREFRACT(sc, le, () =>
        sc.SMO_addNodeType(newType, ['person'], { name: 'string' }));

    const { cambriaSmoMs, cambriaReadyMs } = cambriaSMO([
        cambriaAddOp({ name: `__type_${newType}`, type: 'string', default: newType })
    ]);
    return { N: persons.length, E: 0, stub: false,
             smoMs, lensGenMs, lazyReadyMs, cambriaSmoMs, cambriaReadyMs, eagerMigrationMs: 0 };
}

function benchCreateRT(persons: Record<string, any>[], edges: Edge[]): Omit<RQ1_2_Result, 'smo'|'rep'> {
    const { sc, le } = freshSchema();
    const newEdge = `RT_${randomSuffix()}`;

    const { smoMs, lensGenMs, lazyReadyMs } = measureREFRACT(sc, le, () =>
        sc.SMO_addRelationshipType(newEdge, 'person', 'person', { since: 'string' }));
    const { cambriaSmoMs, cambriaReadyMs } = cambriaSMO([
        cambriaAddOp({ name: `__edgeType_${newEdge}`, type: 'string', default: newEdge })
    ]);
    return { N: persons.length, E: 0, stub: false,
             smoMs, lensGenMs, lazyReadyMs, cambriaSmoMs, cambriaReadyMs, eagerMigrationMs: 0 };
}

function benchCreateL(persons: Record<string, any>[], edges: Edge[]): Omit<RQ1_2_Result, 'smo'|'rep'> {
    const { sc, le } = freshSchema();
    const newLabel = `Lbl_${randomSuffix()}`;

    const { smoMs, lensGenMs, lazyReadyMs } = measureREFRACT(sc, le, () =>
        sc.SMO_createLabel(newLabel));
    const { cambriaSmoMs, cambriaReadyMs } = cambriaSMO([
        cambriaAddOp({ name: newLabel, type: 'string', default: newLabel })
    ]);
    return { N: persons.length, E: 0, stub: false,
             smoMs, lensGenMs, lazyReadyMs, cambriaSmoMs, cambriaReadyMs, eagerMigrationMs: 0 };
}

function benchDropNT(persons: Record<string, any>[], edges: Edge[]): Omit<RQ1_2_Result, 'smo'|'rep'> {
    const { sc, le } = freshSchema();
    const dataDoc = new Y.Doc();
    loadPersons(persons, dataDoc, db);
    loadEdges(persons, edges, dataDoc, db);

    const { smoMs, lensGenMs, lazyReadyMs } = measureREFRACT(sc, le, () =>
        sc.SMO_dropNodeType('Person'));

    const { cambriaSmoMs, cambriaReadyMs } = cambriaSMO([cambriaRemoveOp({ name: 'Person', type: 'string' })]);

    const eagerDoc = cloneDoc(dataDoc);
    const em0 = performance.now();
    eagerDeleteNodes(persons, eagerDoc);
    const eagerMigrationMs = performance.now() - em0;

    return { N: persons.length, E: edges.length, stub: false,
             smoMs, lensGenMs, lazyReadyMs, cambriaSmoMs, cambriaReadyMs, eagerMigrationMs };
}

function benchDropRT(persons: Record<string, any>[], edges: Edge[]): Omit<RQ1_2_Result, 'smo'|'rep'> {
    const { sc, le } = freshSchema();
    const dataDoc = new Y.Doc(); loadPersons(persons, dataDoc, db);
    loadEdges(persons, edges, dataDoc, db);

    const { smoMs, lensGenMs, lazyReadyMs } = measureREFRACT(sc, le, () =>
        sc.SMO_dropRelationshipType('KNOWS'));

    const { cambriaSmoMs, cambriaReadyMs } = cambriaSMO([cambriaRemoveOp({ name: 'KNOWS', type: 'string' })]);

    const eagerDoc = cloneDoc(dataDoc);
    const em0 = performance.now();
    eagerDeleteEdges(edges, eagerDoc);
    const eagerMigrationMs = performance.now() - em0;

    return { N: persons.length, E: edges.length, stub: false,
             smoMs, lensGenMs, lazyReadyMs, cambriaSmoMs, cambriaReadyMs, eagerMigrationMs };
}
 
function benchDropL(persons: Record<string, any>[], edges: Edge[]): Omit<RQ1_2_Result, 'smo'|'rep'> {
    const { sc, le } = freshSchema();
    const dataDoc = new Y.Doc(); loadPersons(persons, dataDoc, db);
    loadEdges(persons, edges, dataDoc, db);
    const label = `Lbl_${randomSuffix()}`;

    sc.SMO_createLabel(label);
    sc.SMO_AddLabelToNodeType('Person', label);
    eagerLabelSet(persons, dataDoc, label, 'Person');
    eagerEdgeLabelSet(edges, dataDoc, label);

    const { smoMs, lensGenMs, lazyReadyMs } = measureREFRACT(sc, le, () =>
        sc.SMO_dropLabel(label));

    const { cambriaSmoMs, cambriaReadyMs } = cambriaSMO([cambriaRemoveOp({ name: label, type: 'string' })]);

    const eagerDoc = cloneDoc(dataDoc);
    const em0 = performance.now();
    eagerLabelDrop(persons, eagerDoc, label, 'Person');
    eagerEdgeLabelDrop(edges, eagerDoc, label);
    const eagerMigrationMs = performance.now() - em0;

    return { N: persons.length, E: edges.length, stub: false,
             smoMs, lensGenMs, lazyReadyMs, cambriaSmoMs, cambriaReadyMs, eagerMigrationMs };
}

function benchRenameL(persons: Record<string, any>[], edges: Edge[]): Omit<RQ1_2_Result, 'smo'|'rep'> {
    const { sc, le } = freshSchema();
    const dataDoc = new Y.Doc(); loadPersons(persons, dataDoc, db);
    loadEdges(persons, edges, dataDoc, db);
    const oldLabel = `Lbl_${randomSuffix()}`, newLabel = `Lbl_${randomSuffix()}`;

    sc.SMO_createLabel(oldLabel);
    sc.SMO_AddLabelToNodeType('Person', oldLabel);
    eagerLabelSet(persons, dataDoc, oldLabel, 'Person');
    eagerEdgeLabelSet(edges, dataDoc, oldLabel);

    const { smoMs, lensGenMs, lazyReadyMs } = measureREFRACT(sc, le, () =>
        sc.SMO_renameLabel(oldLabel, newLabel));

    const { cambriaSmoMs, cambriaReadyMs } = cambriaSMO([cambriaRenameOp(oldLabel, newLabel)]);

    const eagerDoc = cloneDoc(dataDoc);
    const em0 = performance.now();
    eagerLabelRename(persons, eagerDoc, oldLabel, newLabel, edges);
    const eagerMigrationMs = performance.now() - em0;

    return { N: persons.length, E: edges.length, stub: false,
             smoMs, lensGenMs, lazyReadyMs, cambriaSmoMs, cambriaReadyMs, eagerMigrationMs };
}

function benchRenamePk(persons: Record<string, any>[], edges: Edge[]): Omit<RQ1_2_Result, 'smo'|'rep'> {
    const { sc, le } = freshSchema();
    const dataDoc = new Y.Doc(); loadPersons(persons, dataDoc, db);
    const newKey = `prop_${randomSuffix()}`;

    const { smoMs, lensGenMs, lazyReadyMs } = measureREFRACT(sc, le, () =>
        sc.SMO_renamePropertyKey({ Idenifying: 'Person', oldPropertyKey: 'firstName',
                                   newPropertyKey: newKey, whatType: 'NodeType' }));

    const { cambriaSmoMs, cambriaReadyMs } = cambriaSMO([cambriaRenameOp('firstName', newKey)]);

    const eagerDoc = cloneDoc(dataDoc);
    const em0 = performance.now(); eagerRenamePropertyKey(persons, eagerDoc, 'firstName', newKey, 'Person');
    const eagerMigrationMs = performance.now() - em0;

    return { N: persons.length, E: 0, stub: false,
             smoMs, lensGenMs, lazyReadyMs, cambriaSmoMs, cambriaReadyMs, eagerMigrationMs };
}

function benchAddLabelToNT(persons: Record<string, any>[], edges: Edge[]): Omit<RQ1_2_Result, 'smo'|'rep'> {
    const { sc, le } = freshSchema();
    const dataDoc = new Y.Doc(); loadPersons(persons, dataDoc, db);
    const label = `Lbl_${randomSuffix()}`;
    sc.SMO_createLabel(label);

    const { smoMs, lensGenMs, lazyReadyMs } = measureREFRACT(sc, le, () =>
        sc.SMO_AddLabelToNodeType('Person', label));

    const { cambriaSmoMs, cambriaReadyMs } = cambriaSMO([
        cambriaAddOp({ name: `__label_${label}`, type: 'string', default: label })
    ]);

    const eagerDoc = cloneDoc(dataDoc);
    const em0 = performance.now(); eagerLabelSet(persons, eagerDoc, label, 'Person');
    const eagerMigrationMs = performance.now() - em0;

    return { N: persons.length, E: 0, stub: false,
             smoMs, lensGenMs, lazyReadyMs, cambriaSmoMs, cambriaReadyMs, eagerMigrationMs };
}

function benchAddProperty(persons: Record<string, any>[], edges: Edge[]): Omit<RQ1_2_Result, 'smo'|'rep'> {
    const { sc, le } = freshSchema();
    const dataDoc = new Y.Doc(); loadPersons(persons, dataDoc, db);
    const prop = `prop_${randomSuffix()}`;

    const { smoMs, lensGenMs, lazyReadyMs } = measureREFRACT(sc, le, () =>
        sc.SMO_AddPropertyType({ Idenifying: 'Person', newProperty: { key: prop, value: 'string' },
                                  defa: '', whatType: 'NodeType' }));

    const { cambriaSmoMs, cambriaReadyMs } = cambriaSMO([
        cambriaAddOp({ name: prop, type: 'string', default: '' })
    ]);

    const eagerDoc = cloneDoc(dataDoc);
    const em0 = performance.now(); eagerAddProp(persons, eagerDoc, prop, '', 'Person');
    const eagerMigrationMs = performance.now() - em0;

    return { N: persons.length, E: 0, stub: false,
             smoMs, lensGenMs, lazyReadyMs, cambriaSmoMs, cambriaReadyMs, eagerMigrationMs };
}

function benchRemoveLabel(persons: Record<string, any>[], edges: Edge[]): Omit<RQ1_2_Result, 'smo'|'rep'> {
    const { sc, le } = freshSchema();
    const dataDoc = new Y.Doc(); loadPersons(persons, dataDoc, db);
    const label = `Lbl_${randomSuffix()}`;
    sc.SMO_createLabel(label);
    sc.SMO_AddLabelToNodeType('Person', label);
    eagerLabelSet(persons, dataDoc, label, 'Person');

    const { smoMs, lensGenMs, lazyReadyMs } = measureREFRACT(sc, le, () =>
        sc.SMO_RemoveLabelFromNodeType('Person', label));

    const { cambriaSmoMs, cambriaReadyMs } = cambriaSMO([cambriaRemoveOp({ name: label, type: 'string' })]);

    const eagerDoc = cloneDoc(dataDoc);
    const em0 = performance.now();
    eagerLabelDrop(persons, eagerDoc, label, 'Person');
    const eagerMigrationMs = performance.now() - em0;

    return { N: persons.length, E: 0, stub: false,
             smoMs, lensGenMs, lazyReadyMs,
             cambriaSmoMs, cambriaReadyMs, eagerMigrationMs };
}

function benchRemoveProperty(persons: Record<string, any>[], edges: Edge[]): Omit<RQ1_2_Result, 'smo'|'rep'> {
    const { sc, le } = freshSchema();
    const dataDoc = new Y.Doc(); loadPersons(persons, dataDoc, db);
    const prop = `prop_${randomSuffix()}`;
    sc.SMO_AddPropertyType({ Idenifying: 'Person', newProperty: { key: prop, value: 'string' },
                              defa: '', whatType: 'NodeType' });
    eagerAddProp(persons, dataDoc, prop, '', 'Person');

    const { smoMs, lensGenMs, lazyReadyMs } = measureREFRACT(sc, le, () =>
        sc.SMO_DropPropertyType({ Idenifying: 'Person', propertyKey: prop, whatType: 'NodeType' }));

    const { cambriaSmoMs, cambriaReadyMs } = cambriaSMO([cambriaRemoveOp({ name: prop, type: 'string' })]);

    const eagerDoc = cloneDoc(dataDoc);
    const em0 = performance.now(); eagerDropProp(persons, eagerDoc, prop, 'Person');
    const eagerMigrationMs = performance.now() - em0;

    return { N: persons.length, E: 0, stub: false,
             smoMs, lensGenMs, lazyReadyMs, cambriaSmoMs, cambriaReadyMs, eagerMigrationMs };
}

function benchRetypeProperty(persons: Record<string, any>[], edges: Edge[]): Omit<RQ1_2_Result, 'smo'|'rep'> {
    const { sc, le } = freshSchema();
    const dataDoc = new Y.Doc(); loadPersons(persons, dataDoc, db);
    const tags = [sc.yjsDoc.clientID.toString()];

    const { smoMs, lensGenMs, lazyReadyMs } = measureREFRACT(sc, le, () =>
        sc.SMO_ChangePropertyType({ Idenifying: 'Person', propertyKey: 'gender',
            oldTags: tags, newPropertyType: 'number',
            defaultVal: { default: 0, transformerMap: { male: '1', female: '2', default: '0' } },
            whatType: 'NodeType' }));

    const { cambriaSmoMs, cambriaReadyMs } = cambriaSMO([
        cambriaConvertOp('gender', [{ female: 2, male: 1 }], 'string', 'number')
    ]);

    const eagerDoc = cloneDoc(dataDoc);
    const em0 = performance.now();
    eagerRetype(persons, eagerDoc, 'gender', (s: string) => GENDER_MAP[s] ?? 0, 'Person');
    const eagerMigrationMs = performance.now() - em0;

    return { N: persons.length, E: 0, stub: false,
             smoMs, lensGenMs, lazyReadyMs, cambriaSmoMs, cambriaReadyMs, eagerMigrationMs };
}

function benchSplitNT(persons: Record<string, any>[], edges: Edge[]): Omit<RQ1_2_Result, 'smo'|'rep'> {
    const { sc, le } = freshSchema();
    const dataDoc = new Y.Doc(); loadPersons(persons, dataDoc, db);
    const newType = `NT_${randomSuffix()}`;

    const { smoMs, lensGenMs, lazyReadyMs } = measureREFRACT(sc, le, () =>
        sc.SMO_splitNodeType({ legacyType: 'Person', splitProperty: 'gender',
                               mapping: { male: newType, female: newType }, defaultType: newType }));

    const { cambriaSmoMs, cambriaReadyMs } = cambriaSMO([
        cambriaAddOp({ name: 'nodeType', type: 'string', default: newType })
    ]);

    const eagerDoc = cloneDoc(dataDoc);
    const em0 = performance.now();
    eagerSplit(persons, eagerDoc, 'Person', { male: newType, female: newType }, 'gender', newType);
    const eagerMigrationMs = performance.now() - em0;

    return { N: persons.length, E: 0, stub: false,
             smoMs, lensGenMs, lazyReadyMs, cambriaSmoMs, cambriaReadyMs, eagerMigrationMs };
}

function benchSplitRT(persons: Record<string, any>[], edges: Edge[]): Omit<RQ1_2_Result, 'smo'|'rep'> {
    const { sc, le } = freshSchema();
    const dataDoc = new Y.Doc(); loadPersons(persons, dataDoc, db);
    loadEdges(persons, edges, dataDoc, db);
    const newType1 = `RT_${randomSuffix()}`, newType2 = `RT_${randomSuffix()}`;

    const { smoMs, lensGenMs, lazyReadyMs } = measureREFRACT(sc, le, () =>
        sc.SMO_splitRelationshipType({ oldName: 'KNOWS', newName1: newType1, newName2: newType2 }));

    const { cambriaSmoMs, cambriaReadyMs } = cambriaSMO([
        cambriaAddOp({ name: 'edgeType', type: 'string', default: newType1 })
    ]);

    const eagerDoc = cloneDoc(dataDoc);
    const em0 = performance.now(); eagerSplitEdges(edges, eagerDoc, 'KNOWS', newType1);
    const eagerMigrationMs = performance.now() - em0;

    return { N: persons.length, E: edges.length, stub: false,
             smoMs, lensGenMs, lazyReadyMs, cambriaSmoMs, cambriaReadyMs, eagerMigrationMs };
}

function benchUnionNT(persons: Record<string, any>[], edges: Edge[]): Omit<RQ1_2_Result, 'smo'|'rep'> {
    const { sc, le } = freshSchema();
    const dataDoc = new Y.Doc(); loadPersons(persons, dataDoc, db);
    const secondType = `NT_${randomSuffix()}`, unionType = `NT_${randomSuffix()}`;
    sc.SMO_addNodeType(secondType, ['person'], { name: 'string' });

    const { smoMs, lensGenMs, lazyReadyMs } = measureREFRACT(sc, le, () =>
        sc.SMO_unionNodeTypes({ newType: unionType, legacyTypes: ['Person', secondType],
                                writeDefault: secondType }));

    const { cambriaSmoMs, cambriaReadyMs } = cambriaSMO([
        cambriaAddOp({ name: '__unionType', type: 'string', default: unionType })
    ]);

    const eagerDoc = cloneDoc(dataDoc);
    const em0 = performance.now(); eagerUnion(persons, eagerDoc, ['Person', secondType], unionType);
    const eagerMigrationMs = performance.now() - em0;

    return { N: persons.length, E: 0, stub: false,
             smoMs, lensGenMs, lazyReadyMs, cambriaSmoMs, cambriaReadyMs, eagerMigrationMs };
}

function benchUnionRT(persons: Record<string, any>[], edges: Edge[]): Omit<RQ1_2_Result, 'smo'|'rep'> {
    const { sc, le } = freshSchema();
    const dataDoc = new Y.Doc(); loadPersons(persons, dataDoc, db);
    loadEdges(persons, edges, dataDoc, db);
    const secondRT = `RT_${randomSuffix()}`, newRT = `RT_${randomSuffix()}`;
    sc.SMO_addRelationshipType(secondRT, 'person', 'person', {});

    const { smoMs, lensGenMs, lazyReadyMs } = measureREFRACT(sc, le, () =>
        sc.SMO_unionRelationshipTypes({ oldLabel1: 'KNOWS', oldLabel2: secondRT, newLabel: newRT }));

    const { cambriaSmoMs, cambriaReadyMs } = cambriaSMO([
        cambriaAddOp({ name: '__edgeUnionType', type: 'string', default: newRT })
    ]);

    const eagerDoc = cloneDoc(dataDoc);
    const em0 = performance.now(); eagerUnionEdges(edges, eagerDoc, ['KNOWS', secondRT], newRT);
    const eagerMigrationMs = performance.now() - em0;

    return { N: persons.length, E: edges.length, stub: false,
             smoMs, lensGenMs, lazyReadyMs, cambriaSmoMs, cambriaReadyMs, eagerMigrationMs };
}

const SMO_BENCH: Record<string, BenchFn> = {
    createNT:       benchCreateNT,
    createRT:       benchCreateRT,
    createL:        benchCreateL,
    dropNT:         benchDropNT,
    dropRT:         benchDropRT,
    dropL:          benchDropL,
    renameL:        benchRenameL,
    renamePk:       benchRenamePk,
    addLabelToNT:   benchAddLabelToNT,
    addProperty:    benchAddProperty,
    removeLabel:    benchRemoveLabel,
    removeProperty: benchRemoveProperty,
    retypeProperty: benchRetypeProperty,
    splitNT:        benchSplitNT,
    splitRT:        benchSplitRT,
    unionNT:        benchUnionNT,
    unionRT:        benchUnionRT,
};


export function runRQ1_2(): RQ1_2_Result[] {
    const sfDir     = path.resolve(process.cwd(), SF03_DIR);
    const data       = readSnbPersonsAndKnows(sfDir);
    const allPersons = data.persons;
    const persons    = padPersons(allPersons, 1000);
    const personIds  = new Set(persons.map(p => String(p.id)));
    const edges: Edge[] = (() => {
        const edgeDir = path.join(sfDir, 'dynamic', 'Person_knows_Person');
        if (!fs.existsSync(edgeDir)) {
            console.warn('knows directory not found:', edgeDir);
            return [];
        }
        const f = fs.readdirSync(edgeDir).find(f => f.endsWith('.csv'));
        if (!f) { console.warn('knows no CSV in', edgeDir); return []; }

        const filePath = path.join(edgeDir, f);
        const lines = fs.readFileSync(filePath, 'utf-8')
            .split('\n').map(l => l.trim()).filter(Boolean);
        if (lines.length < 2) { console.warn('knows empty file', filePath); return []; }

        const headers = lines[0].split('|');

        let iSrc = headers.indexOf('Person1Id');
        let iTgt = headers.indexOf('Person2Id');
        let iDt  = headers.indexOf('creationDate');
        if (iSrc < 0 || iTgt < 0) {
            iSrc = headers.indexOf('Person.id');
            iTgt = headers.indexOf('Person.id.1');
        }
        if (iSrc < 0 || iTgt < 0) {
            console.warn(`knows unrecognised headers ${JSON.stringify(headers)} — using positional fallback [1,2]`);
            iSrc = 1; iTgt = 2; iDt = 0;
        }

        const result: Edge[] = [];
        for (let i = 1; i < lines.length; i++) {
            const v = lines[i].split('|');
            const src = v[iSrc] ?? '', tgt = v[iTgt] ?? '';
            if (personIds.has(src) && personIds.has(tgt))
                result.push({ src, tgt, creationDate: v[iDt] ?? '', _edgeId: `knows-${src}-${tgt}` });
        }

        if (result.length === 0 && lines.length > 1) {
            const sample = lines[1].split('|');
            console.warn('knows 0 edges matched. First row:', sample, '| personIds sample:', Array.from(personIds).slice(0, 5));
        }
        return result;
    })();

    const warmP   = padPersons(allPersons, 50);
    const warmIds = new Set(warmP.map(p => String(p.id)));
    const warmE   = edges.filter(e => warmIds.has(e.src) && warmIds.has(e.tgt));
    for (const fn of Object.values(SMO_BENCH)) fn(warmP, warmE);

    const REPS    = 10;
    const results: RQ1_2_Result[] = [];

    for (const [smo, bench] of Object.entries(SMO_BENCH)) {
        const REFRACTMs:   number[] = [];
        const cambriaMs: number[] = [];
        const eagerMs:   number[] = [];

        for (let rep = 0; rep < REPS; rep++) {
            const r = bench(persons, edges);
            results.push({ smo, rep, ...r });
            REFRACTMs.push(r.lazyReadyMs);
            cambriaMs.push(r.cambriaReadyMs);
            eagerMs.push(r.eagerMigrationMs);
        }

        const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
        const pAvg = avg(REFRACTMs);
        const cAvg = avg(cambriaMs);
        const eAvg = avg(eagerMs);

        const speedupVsCambria = cAvg > 0
            ? (cAvg / Math.max(pAvg, 0.0001)).toFixed(1) + 'x'
            : 'n/a';
        const speedupVsEager = eAvg > 0
            ? (eAvg / Math.max(pAvg, 0.0001)).toFixed(0) + 'x'
            : 'n/a (no eager)';

        const firstResult = results.find(r => r.smo === smo)!;
        const tag = firstResult.stub ? ' *' : '';

        console.log(
            `  ${(smo + tag).padEnd(16)}` +
            `  REFRACT=${pAvg.toFixed(3).padStart(7)} ms` +
            `  cambria=${cAvg.toFixed(3).padStart(7)} ms` +
            `  eager=${eAvg.toFixed(2).padStart(8)} ms` +
            `  vs_cambria=${speedupVsCambria.padStart(6)}` +
            `  vs_eager=${speedupVsEager.padStart(10)}`
        );
    }

    const out = path.join(__dirname, 'rq1_2_results.json');
    fs.writeFileSync(out, JSON.stringify({ results }, null, 2));
    return results;
}

if (require.main === module) { runRQ1_2(); }
