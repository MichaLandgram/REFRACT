import * as fs from 'fs';
import * as path from 'path';
import { 
    freshSimpleSchema as freshSchema,
    median,
    cutNodes,
    gcIfAvailable,
    randomSuffix, 
    SF3_DIR} from '../../Helper/benchHelper';
import { readSnbPersonsAndKnows, filterKnowsEdges } from '../../Helper/SnbDataReader';
import { GENDER_MAP } from '../../Helper/EagerMigrationFunctions';
import {
    applyLensToDoc,
    renameProperty  as cambriaRenameOp,
    convertValue    as cambriaConvertOp,
    addProperty     as cambriaAddOp,
    removeProperty  as cambriaRemoveOp,
    LensSource,
    initLensGraph,
    registerLens,
    lensFromTo,
} from 'cambria';
import { PERSON_BASE_LENS, KNOWS_BASE_LENS, buildCambriaLens } from '../helper';

export interface RQ2_2_Result {
    smo:              string;
    rep:              number;
    N:                number;
    PerNodeUs:          number;
    cambriaPerNodeUs: number;
    eagerPerNodeUs:   number;
    RMs:          number;
    cambriaMs:        number;
    eagerMs:          number;
    correct:          boolean;
    note:             string;
}

export interface NormPerson {
    type:        string;
    firstName:   string;
    lastName:    string;
    gender:      string;
    birthday:    string;
    locationIP:  string;
    browserUsed: string;
}

function normalise(persons: Record<string, any>[]): NormPerson[] {
    return persons.map(p => ({
        type:        'Person',
        firstName:   String(p.firstName   ?? ''),
        lastName:    String(p.lastName    ?? ''),
        gender:      String(p.gender      ?? ''),
        birthday:    String(p.birthday    ?? ''),
        locationIP:  String(p.locationIP  ?? ''),
        browserUsed: String(p.browserUsed ?? ''),
    }));
}
function normaliseEdges(edges: Record<string, any>[]): Record<string, any>[] {
    return edges.map(e => ({
        type:            'KNOWS',
        creationDate:    String(e.creationDate ?? ''),
        since:           String(e.since ?? ''),
        sourceNodeLabel: String(e.sourceNodeLabel ?? 'person'),
        targetNodeLabel: String(e.targetNodeLabel ?? 'person'),
    }));
}


{
    const _w = { firstName: 'warmup', lastName: 'test', gender: 'male',
                 birthday: '1990-01-01', locationIP: '0.0.0.0', browserUsed: 'Chrome' };
    for (let _i = 0; _i < 5; _i++) applyLensToDoc([cambriaRenameOp('firstName', 'givenName')], _w);
}




const INTERNAL_REPS = 5;
function measureNs(fn: () => void): number {
    const times: number[] = [];
    for (let i = 0; i < INTERNAL_REPS; i++) {
        gcIfAvailable();
        const t0 = process.hrtime.bigint();
        fn();
        times.push(Number(process.hrtime.bigint() - t0));
    }
    return median(times);
}

function toUs(ns: number, N: number): number { return ns / 1000 / N; }

type BenchFn = (persons: NormPerson[], edges: Record<string, any>[]) => Omit<RQ2_2_Result, 'smo' | 'rep'>;

function benchCreateNT(persons: NormPerson[], edges: Record<string, any>[]): Omit<RQ2_2_Result, 'smo' | 'rep'> {
    const N = persons.length;
    const newType = `NT_${randomSuffix()}`;
    const { sc, le } = freshSchema();
    sc.SMO_addNodeType(newType, ['person'], { 
        score: 'number',
        joinedDate: 'string',
        isActive: 'boolean'
     });
    le.refreshCache();
    const cambriaOps: LensSource = buildCambriaLens([
        cambriaAddOp({ name: `__type_${newType}`, type: 'string', default: newType }),
        cambriaAddOp({ name: 'score', type: 'number', default: 0 }),
        cambriaAddOp({ name: 'joinedDate', type: 'string', default: '' }),
        cambriaAddOp({ name: 'isActive', type: 'boolean', default: false })
    ]);
    // nothing happend because only add
    const migrated = persons;

    const RMs        = measureNs(() => { for (const p of persons)  { const r = le.resolveActiveType('Person', p as any); le.decodeAndFilterProperties(r, p as any, 'NodeType'); } });
    const cambriaMs  = measureNs(() => { for (const p of persons)  applyLensToDoc(cambriaOps, p); });
    const eagerMs    = measureNs(() => { let _val; for (const p of migrated) { _val = (p as any).type; } });

    return { N, RMs, cambriaMs, eagerMs,
             PerNodeUs: toUs(RMs, N), cambriaPerNodeUs: toUs(cambriaMs, N), eagerPerNodeUs: toUs(eagerMs, N),
             correct: true, note: '' };
}

function benchCreateRT(persons: NormPerson[], edges: Record<string, any>[]): Omit<RQ2_2_Result, 'smo' | 'rep'> {
    const N = edges.length;
    const newRT = `RT_${randomSuffix()}`;
    const { sc, le } = freshSchema();
    sc.SMO_addRelationshipType(newRT, 'person', 'person', { since: 'string' });
    le.refreshCache();
    const cambriaOps: LensSource = buildCambriaLens([
        cambriaAddOp({ name: `__edgeType_${newRT}`, type: 'string', default: newRT }),
        cambriaAddOp({ name: 'sourceNodeLabel', type: 'string', default: 'person' }),
        cambriaAddOp({ name: 'targetNodeLabel', type: 'string', default: 'person' }),
        cambriaAddOp({ name: 'since', type: 'string', default: '' })
    ]);

    const RMs    = measureNs(() => { for (const p of edges) { const r = le.resolveActiveEdgeType('KNOWS', p as any); le.decodeAndFilterProperties(r, p as any, 'NodeType'); } });
    const cambriaMs  = measureNs(() => { for (const p of edges) applyLensToDoc(cambriaOps, p); });
    const eagerMs    = measureNs(() => { let _val; for (const p of edges) { _val = p.type; } });

    return { N, RMs, cambriaMs, eagerMs,
             PerNodeUs: toUs(RMs, N), cambriaPerNodeUs: toUs(cambriaMs, N), eagerPerNodeUs: toUs(eagerMs, N),
             correct: true, note: 'RT-no-node-impact' };
}


function benchCreateL(persons: NormPerson[], edges: Record<string, any>[]): Omit<RQ2_2_Result, 'smo' | 'rep'> {
    const N = persons.length;
    const newLabel = `Lbl_${randomSuffix()}`;
    const { sc, le } = freshSchema();
    sc.SMO_createLabel(newLabel);
    le.refreshCache();
    const cambriaOps: LensSource = buildCambriaLens([cambriaAddOp({ name: newLabel, type: 'string', default: newLabel })]);

    const RMs    = measureNs(() => { for (const p of persons) { const r = le.resolveActiveType('Person', p as any); le.decodeAndFilterProperties(r, p as any, 'NodeType'); } });
    const cambriaMs  = measureNs(() => { for (const p of persons) applyLensToDoc(cambriaOps, p); });
    const eagerMs    = measureNs(() => { let _val; for (const p of persons) { _val = p.firstName; } });

    return { N, RMs, cambriaMs, eagerMs,
             PerNodeUs: toUs(RMs, N), cambriaPerNodeUs: toUs(cambriaMs, N), eagerPerNodeUs: toUs(eagerMs, N),
             correct: true, note: '' };
}

function benchDropNT(persons: NormPerson[], edges: Record<string, any>[]): Omit<RQ2_2_Result, 'smo' | 'rep'> {
    const N = persons.length;
    const { sc, le } = freshSchema();
    sc.SMO_dropNodeType('Person');
    le.refreshCache();
    const cambriaOps: LensSource = buildCambriaLens([
        cambriaRemoveOp({ name: 'firstName', type: 'string' }),
        cambriaRemoveOp({ name: 'lastName', type: 'string' }),
        cambriaRemoveOp({ name: 'gender', type: 'string' }),
        cambriaRemoveOp({ name: 'birthday', type: 'string' }),
        cambriaRemoveOp({ name: 'locationIP', type: 'string' }),
        cambriaRemoveOp({ name: 'browserUsed', type: 'string' }),
    ], PERSON_BASE_LENS);
    const migrated = persons.map(() => ({}));

    const RMs    = measureNs(() => { for (const p of persons)  { const r = le.resolveActiveType('KNOWS', p as any); le.decodeAndFilterProperties(r, p as any, 'NodeType'); } });
    const cambriaMs  = measureNs(() => { for (const p of persons)  applyLensToDoc(cambriaOps, p); });
    const eagerMs    = measureNs(() => { let _val; for (const p of migrated) { _val = (p as any).firstName; } });

    return { N, RMs, cambriaMs, eagerMs,
             PerNodeUs: toUs(RMs, N), cambriaPerNodeUs: toUs(cambriaMs, N), eagerPerNodeUs: toUs(eagerMs, N),
             correct: true, note: '' };
}

function benchDropRT(persons: NormPerson[], edges: Record<string, any>[]): Omit<RQ2_2_Result, 'smo' | 'rep'> {
    const N = edges.length;
    const { sc, le } = freshSchema();
    sc.SMO_dropRelationshipType('KNOWS');
    le.refreshCache();
    const cambriaOps: LensSource = buildCambriaLens([
        cambriaRemoveOp({ name: 'creationDate', type: 'string' }),
        cambriaRemoveOp({ name: 'since', type: 'string' }),
        cambriaRemoveOp({ name: 'sourceNodeLabel', type: 'string' }),
        cambriaRemoveOp({ name: 'targetNodeLabel', type: 'string' })
    ], KNOWS_BASE_LENS);
    const migrated = edges.map(() => ({}));

    const RMs    = measureNs(() => { for (const e of edges) { const r = le.resolveActiveEdgeType('KNOWS', e as any); le.decodeAndFilterProperties(r, e as any, 'RelationshipType'); } });
    const cambriaMs  = measureNs(() => { for (const e of edges) applyLensToDoc(cambriaOps, e); });
    const eagerMs    = measureNs(() => { let _val; for (const e of migrated) { _val = (e as any).creationDate; } });

    return { N, RMs, cambriaMs, eagerMs,
             PerNodeUs: toUs(RMs, N), cambriaPerNodeUs: toUs(cambriaMs, N), eagerPerNodeUs: toUs(eagerMs, N),
             correct: true, note: '' };
}

function benchDropL(persons: NormPerson[], edges: Record<string, any>[]): Omit<RQ2_2_Result, 'smo' | 'rep'> {
    const N = persons.length;
    const label = `Lbl_${randomSuffix()}`;
    const { sc, le } = freshSchema();
    sc.SMO_createLabel(label);
    sc.SMO_AddLabelToNodeType('Person', label);
    sc.SMO_dropLabel(label);
    le.refreshCache();

    const seeded = persons.map(p => ({ ...p, [label]: true })) as any[];
    const cambriaOps: LensSource = buildCambriaLens(
        [cambriaRemoveOp({ name: label, type: 'boolean' })],
        [...PERSON_BASE_LENS, cambriaAddOp({ name: label, type: 'boolean', default: false })]
    );
    const migrated = seeded.map(({ [label]: _, ...rest }: any) => rest);

    const RMs    = measureNs(() => { for (const p of seeded)   { const r = le.resolveActiveType('Person', p); le.decodeAndFilterProperties(r, p, 'NodeType'); } });
    const cambriaMs  = measureNs(() => { for (const p of seeded)   applyLensToDoc(cambriaOps, p); });
    const eagerMs    = measureNs(() => { let _val; for (const p of migrated) { _val = (p as any).firstName; } });

    return { N, RMs, cambriaMs, eagerMs,
             PerNodeUs: toUs(RMs, N), cambriaPerNodeUs: toUs(cambriaMs, N), eagerPerNodeUs: toUs(eagerMs, N),
             correct: true, note: '' };
}

function benchRenameL(persons: NormPerson[], edges: Record<string, any>[]): Omit<RQ2_2_Result, 'smo' | 'rep'> {
    const N = persons.length;
    const oldLabel = `Lbl_${randomSuffix()}`, newLabel = `Lbl_${randomSuffix()}`;
    const { sc, le } = freshSchema();
    sc.SMO_createLabel(oldLabel);
    sc.SMO_AddLabelToNodeType('Person', oldLabel);
    sc.SMO_renameLabel(oldLabel, newLabel);
    le.refreshCache();
    const seeded  = persons.map(p => ({ ...p, [oldLabel]: true })) as any[];
    const cambriaOps: LensSource = buildCambriaLens(
        [cambriaRenameOp(oldLabel, newLabel)],
        [...PERSON_BASE_LENS, cambriaAddOp({ name: oldLabel, type: 'boolean', default: false })]
    );
    const migrated = seeded.map((p: any) => { const { [oldLabel]: v, ...rest } = p; return { ...rest, [newLabel]: v }; });

    const RMs    = measureNs(() => { for (const p of seeded)   { const r = le.resolveActiveType('Person', p); le.decodeAndFilterProperties(r, p, 'NodeType'); } });
    const cambriaMs  = measureNs(() => { for (const p of seeded)   applyLensToDoc(cambriaOps, p); });
    const eagerMs    = measureNs(() => { let _val; for (const p of migrated) { _val = (p as any)[newLabel]; } });

    return { N, RMs, cambriaMs, eagerMs,
             PerNodeUs: toUs(RMs, N), cambriaPerNodeUs: toUs(cambriaMs, N), eagerPerNodeUs: toUs(eagerMs, N),
             correct: true, note: '' };
}

function benchRenamePk(persons: NormPerson[], edges: Record<string, any>[]): Omit<RQ2_2_Result, 'smo' | 'rep'> {
    const N = persons.length;
    const newKey = `prop_${randomSuffix()}`;
    const { sc, le } = freshSchema();
    sc.SMO_renamePropertyKey({ Idenifying: 'Person', oldPropertyKey: 'firstName', newPropertyKey: newKey, whatType: 'NodeType' });
    le.refreshCache();
    const cambriaOps: LensSource = buildCambriaLens(
        [cambriaRenameOp('firstName', newKey)],
        PERSON_BASE_LENS
    );
    const migrated = persons.map(({ firstName, ...rest }) => ({ ...rest, [newKey]: firstName }));

    const RMs    = measureNs(() => { for (const p of persons)  { const r = le.resolveActiveType('Person', p as any); le.decodeAndFilterProperties(r, p as any, 'NodeType'); } });
    const cambriaMs  = measureNs(() => { for (const p of persons)  applyLensToDoc(cambriaOps, p); });
    const eagerMs    = measureNs(() => { let _val; for (const p of migrated) { _val = (p as any)[newKey]; } });

    const cambriaCount = (() => { let n = 0; for (const p of persons) { const t = applyLensToDoc(cambriaOps, p) as any; if (t[newKey] !== undefined) n++; } return n; })();
    const prismCount   = (() => { let n = 0; for (const p of persons) { const r = le.resolveActiveType('Person', p as any); const t = le.decodeAndFilterProperties(r, p as any, 'NodeType'); if (t[newKey] !== undefined) n++; } return n; })();

    return { N, RMs, cambriaMs, eagerMs,
             PerNodeUs: toUs(RMs, N), cambriaPerNodeUs: toUs(cambriaMs, N), eagerPerNodeUs: toUs(eagerMs, N),
             correct: prismCount === N && cambriaCount === N, note: '' };
}

function benchAddLabelToNT(persons: NormPerson[], edges: Record<string, any>[]): Omit<RQ2_2_Result, 'smo' | 'rep'> {
    const N = persons.length;
    const label = `Lbl_${randomSuffix()}`;
    const { sc, le } = freshSchema();
    sc.SMO_createLabel(label);
    sc.SMO_AddLabelToNodeType('Person', label);
    le.refreshCache();
    const cambriaOps: LensSource = buildCambriaLens([cambriaAddOp({ name: `__label_${label}`, type: 'string', default: label })]);
    const migrated = persons.map(p => ({ ...p, [`__label_${label}`]: label }));

    const RMs    = measureNs(() => { for (const p of persons)  { const r = le.resolveActiveType('Person', p as any); le.decodeAndFilterProperties(r, p as any, 'NodeType'); } });
    const cambriaMs  = measureNs(() => { for (const p of persons)  applyLensToDoc(cambriaOps, p); });
    const eagerMs    = measureNs(() => { let _val; for (const p of migrated) { _val = (p as any)[`__label_${label}`]; } });

    return { N, RMs, cambriaMs, eagerMs,
             PerNodeUs: toUs(RMs, N), cambriaPerNodeUs: toUs(cambriaMs, N), eagerPerNodeUs: toUs(eagerMs, N),
             correct: true, note: '' };
}

function benchAddProperty(persons: NormPerson[], edges: Record<string, any>[]): Omit<RQ2_2_Result, 'smo' | 'rep'> {
    const N = persons.length;
    const prop = `prop_${randomSuffix()}`;
    const { sc, le } = freshSchema();
    sc.SMO_AddPropertyType({ Idenifying: 'Person', newProperty: { key: prop, value: 'string' }, defa: 'default_val', whatType: 'NodeType' });
    le.refreshCache();
    const cambriaOps: LensSource = buildCambriaLens([cambriaAddOp({ name: prop, type: 'string', default: 'default_val' })]);
    const migrated = persons.map(p => ({ ...p, [prop]: 'default_val' }));

    const RMs    = measureNs(() => { for (const p of persons)  { const r = le.resolveActiveType('Person', p as any); le.decodeAndFilterProperties(r, p as any, 'NodeType'); } });
    const cambriaMs  = measureNs(() => { for (const p of persons)  applyLensToDoc(cambriaOps, p); });
    const eagerMs    = measureNs(() => { let _val; for (const p of migrated) { _val = (p as any)[prop]; } });

    return { N, RMs, cambriaMs, eagerMs,
             PerNodeUs: toUs(RMs, N), cambriaPerNodeUs: toUs(cambriaMs, N), eagerPerNodeUs: toUs(eagerMs, N),
             correct: true, note: '' };
}

function benchRemoveLabel(persons: NormPerson[], edges: Record<string, any>[]): Omit<RQ2_2_Result, 'smo' | 'rep'> {
    const N = persons.length;
    const label = `Lbl_${randomSuffix()}`;
    const { sc, le } = freshSchema();
    sc.SMO_createLabel(label);
    sc.SMO_AddLabelToNodeType('Person', label);
    sc.SMO_RemoveLabelFromNodeType('Person', label);
    le.refreshCache();
    const cambriaOps: LensSource = buildCambriaLens([]);
    const migrated = persons.map(p => { const r = { ...p } as any; return r; });

    const RMs    = measureNs(() => { for (const p of persons)  { const r = le.resolveActiveType('Person', p as any); le.decodeAndFilterProperties(r, p as any, 'NodeType'); } });
    const cambriaMs  = measureNs(() => { for (const p of persons)  applyLensToDoc(cambriaOps, p); });
    const eagerMs    = measureNs(() => { let _val; for (const p of migrated) { _val = p.firstName; } });

    return { N, RMs, cambriaMs, eagerMs,
             PerNodeUs: toUs(RMs, N), cambriaPerNodeUs: toUs(cambriaMs, N), eagerPerNodeUs: toUs(eagerMs, N),
             correct: true, note: '' };
}


function benchRemoveProperty(persons: NormPerson[], edges: Record<string, any>[]): Omit<RQ2_2_Result, 'smo' | 'rep'> {
    const N = persons.length;
    const prop = `prop_${randomSuffix()}`;
    const { sc, le } = freshSchema();
    sc.SMO_AddPropertyType({ Idenifying: 'Person', newProperty: { key: prop, value: 'string' }, defa: '', whatType: 'NodeType' });
    sc.SMO_DropPropertyType({ Idenifying: 'Person', propertyKey: prop, whatType: 'NodeType' });
    le.refreshCache();

    const seeded = persons.map(p => ({ ...p, [prop]: 'value_x' })) as any[];
    const cambriaOps: LensSource = buildCambriaLens(
        [cambriaRemoveOp({ name: prop, type: 'string' })],
        [...PERSON_BASE_LENS, cambriaAddOp({ name: prop, type: 'string', default: '' })]
    );
    const migrated = seeded.map(({ [prop]: _, ...rest }: any) => rest);

    const RMs    = measureNs(() => { for (const p of seeded)   { const r = le.resolveActiveType('Person', p); le.decodeAndFilterProperties(r, p, 'NodeType'); } });
    const cambriaMs  = measureNs(() => { for (const p of seeded)   applyLensToDoc(cambriaOps, p); });
    const eagerMs = measureNs(() => { for (const p of migrated) { void (p as any).firstName; } });

    return { N, RMs, cambriaMs, eagerMs,
             PerNodeUs: toUs(RMs, N), cambriaPerNodeUs: toUs(cambriaMs, N), eagerPerNodeUs: toUs(eagerMs, N),
             correct: true, note: '' };
}

function benchRetypeProperty(persons: NormPerson[], edges: Record<string, any>[]): Omit<RQ2_2_Result, 'smo' | 'rep'> {
    const N = persons.length;
    const { sc, le } = freshSchema();
    sc.SMO_ChangePropertyType({
        Idenifying: 'Person', propertyKey: 'gender',
        oldTags: [sc.yjsDoc.clientID.toString()], newPropertyType: 'number',
        defaultVal: { default: 0, transformerMap: { male: '1', female: '2', default: '0' } },
        whatType: 'NodeType'
    });
    le.refreshCache();
    const cambriaOps: LensSource = buildCambriaLens(
        [cambriaConvertOp('gender', [{ female: 2, male: 1 }], 'string', 'number')],
        PERSON_BASE_LENS
    );
    const migrated = persons.map(p => ({ ...p, gender: GENDER_MAP[p.gender] ?? 0 }));

    const RMs    = measureNs(() => { for (const p of persons)  { const r = le.resolveActiveType('Person', p as any); le.decodeAndFilterProperties(r, p as any, 'NodeType'); } });
    const cambriaMs  = measureNs(() => { for (const p of persons)  applyLensToDoc(cambriaOps, p); });
    const eagerMs    = measureNs(() => { let _val; for (const p of migrated) { _val = (p as any).gender === 1; } });

    const prismCount   = (() => { let n = 0; for (const p of persons) { const r = le.resolveActiveType('Person', p as any); const t = le.decodeAndFilterProperties(r, p as any, 'NodeType'); if (t.gender === 1 || t.gender === '1') n++; } return n; })();
    const cambriaCount = (() => { let n = 0; for (const p of persons) { const t = applyLensToDoc(cambriaOps, p) as any; if (t.gender === 1) n++; } return n; })();
    const eagerCount   = migrated.filter(p => (p as any).gender === 1).length;

    return { N, RMs, cambriaMs, eagerMs,
             PerNodeUs: toUs(RMs, N), cambriaPerNodeUs: toUs(cambriaMs, N), eagerPerNodeUs: toUs(eagerMs, N),
             correct: prismCount === eagerCount && cambriaCount === eagerCount, note: '' };
}

function benchSplitNT(persons: NormPerson[], edges: Record<string, any>[]): Omit<RQ2_2_Result, 'smo' | 'rep'> {
    const N = persons.length;
    const newType = `NT_${randomSuffix()}`;
    const { sc, le } = freshSchema();
    sc.SMO_splitNodeType({ legacyType: 'Person', splitProperty: 'gender', mapping: { male: newType, female: newType }, defaultType: newType });
    le.refreshCache();
    const cambriaOps: LensSource = buildCambriaLens([
        cambriaAddOp({ name: 'nodeType', type: 'string', default: newType }),
        cambriaRenameOp('type', 'nodeType')
    ], PERSON_BASE_LENS);
    const migrated = persons.map(p => ({ ...p, nodeType: newType }));

    const RMs    = measureNs(() => { for (const p of persons)  { const r = le.resolveActiveType('Person', p as any); le.decodeAndFilterProperties(r, p as any, 'NodeType'); } });
    const cambriaMs  = measureNs(() => { for (const p of persons)  applyLensToDoc(cambriaOps, p); });
    const eagerMs    = measureNs(() => { let _val; for (const p of migrated) { _val = (p as any).nodeType === newType; } });

    const prismCount = (() => { let n = 0; for (const p of persons) { if (le.resolveActiveType('Person', p as any) === newType) n++; } return n; })();

    return { N, RMs, cambriaMs, eagerMs,
             PerNodeUs: toUs(RMs, N), cambriaPerNodeUs: toUs(cambriaMs, N), eagerPerNodeUs: toUs(eagerMs, N),
             correct: prismCount === N, note: '' };
}

function benchSplitRT(persons: NormPerson[], edges: Record<string, any>[]): Omit<RQ2_2_Result, 'smo' | 'rep'> {
    const N = edges.length;
    const nt1 = `RT_${randomSuffix()}`, nt2 = `RT_${randomSuffix()}`;
    const { sc, le } = freshSchema();
    sc.SMO_splitRelationshipType({ legacyType: 'KNOWS', newType1: nt1, newType2: nt2 });
    le.refreshCache();
    const cambriaOps: LensSource = buildCambriaLens([cambriaAddOp({ name: 'edgeType', type: 'string', default: nt1 })]);
    const migrated = edges.map(e => ({ ...e, edgeType: nt1 }));

    const RMs    = measureNs(() => { for (const e of edges) { const r = le.resolveActiveEdgeType('KNOWS', e as any); le.decodeAndFilterProperties(r, e as any, 'RelationshipType'); } });
    const cambriaMs  = measureNs(() => { for (const e of edges) applyLensToDoc(cambriaOps, e); });
    const eagerMs    = measureNs(() => { let _val; for (const e of migrated) { _val = (e as any).edgeType; } });

    return { N, RMs, cambriaMs, eagerMs,
             PerNodeUs: toUs(RMs, N), cambriaPerNodeUs: toUs(cambriaMs, N), eagerPerNodeUs: toUs(eagerMs, N),
             correct: true, note: '' };
}

function benchUnionNT(persons: NormPerson[], edges: Record<string, any>[]): Omit<RQ2_2_Result, 'smo' | 'rep'> {
    const N = persons.length;
    const secondType = `NT_${randomSuffix()}`, unionType = `NT_${randomSuffix()}`;
    const { sc, le } = freshSchema();
    sc.SMO_addNodeType(secondType, ['person'], { name: 'string' });
    sc.SMO_unionNodeTypes({ newType: unionType, legacyTypes: ['Person', secondType], writeDefault: secondType });
    le.refreshCache();
    const cambriaOps: LensSource = buildCambriaLens([
        cambriaAddOp({ name: '__unionType', type: 'string', default: unionType }),
        cambriaRenameOp('type', '__unionType')
    ], PERSON_BASE_LENS);
    const migrated = persons.map(p => ({ ...p, __unionType: unionType }));

    const RMs    = measureNs(() => { for (const p of persons)  { const r = le.resolveActiveType('Person', p as any); le.decodeAndFilterProperties(r, p as any, 'NodeType'); } });
    const cambriaMs  = measureNs(() => { for (const p of persons)  applyLensToDoc(cambriaOps, p); });
    const eagerMs    = measureNs(() => { let _val; for (const p of migrated) { _val = (p as any).__unionType; } });

    return { N, RMs, cambriaMs, eagerMs,
             PerNodeUs: toUs(RMs, N), cambriaPerNodeUs: toUs(cambriaMs, N), eagerPerNodeUs: toUs(eagerMs, N),
             correct: true, note: '' };
}

function benchUnionRT(persons: NormPerson[], edges: Record<string, any>[]): Omit<RQ2_2_Result, 'smo' | 'rep'> {
    const N = edges.length;
    const secondRT = `RT_${randomSuffix()}`, newRT = `RT_${randomSuffix()}`;
    const { sc, le } = freshSchema();
    sc.SMO_addRelationshipType(secondRT, 'person', 'person', {});
    sc.SMO_unionRelationshipTypes({ newType: 'KNOWS', legacyTypes: [secondRT, newRT], writeDefault: secondRT });
    le.refreshCache();
    const cambriaOps: LensSource = buildCambriaLens([cambriaAddOp({ name: '__edgeUnionType', type: 'string', default: newRT })]);
    const migrated = edges.map(e => ({ ...e, __edgeUnionType: newRT }));

    const RMs    = measureNs(() => { for (const e of edges) { const r = le.resolveActiveEdgeType('KNOWS', e as any); le.decodeAndFilterProperties(r, e as any, 'RelationshipType'); } });
    const cambriaMs  = measureNs(() => { for (const e of edges) applyLensToDoc(cambriaOps, e); });
    const eagerMs    = measureNs(() => { let _val; for (const e of migrated) { _val = (e as any).__edgeUnionType; } });

    return { N, RMs, cambriaMs, eagerMs,
             PerNodeUs: toUs(RMs, N), cambriaPerNodeUs: toUs(cambriaMs, N), eagerPerNodeUs: toUs(eagerMs, N),
             correct: true, note: '' };
}

function benchSplitL(persons: NormPerson[], edges: Record<string, any>[]): Omit<RQ2_2_Result, 'smo' | 'rep'> {
    const N = persons.length;
    const oldLabel = `Lbl_${randomSuffix()}`;
    const newLabel1 = `Lbl1_${randomSuffix()}`, newLabel2 = `Lbl2_${randomSuffix()}`;
    const { sc, le } = freshSchema();
    sc.SMO_createLabel(oldLabel);
    sc.SMO_splitLabel({ oldName: oldLabel, newName1: newLabel1, newName2: newLabel2 });
    le.refreshCache();
    const cambriaOps: LensSource = buildCambriaLens([cambriaAddOp({ name: 'labelSplit', type: 'string', default: newLabel1 })]);

    const RMs    = measureNs(() => { for (const p of persons) { const r = le.resolveActiveType('Person', p as any); le.decodeAndFilterProperties(r, p as any, 'NodeType'); } });
    const cambriaMs  = measureNs(() => { for (const p of persons) applyLensToDoc(cambriaOps, p); });
    const eagerMs    = measureNs(() => { let _val; for (const p of persons) { _val = p.firstName; } });

    return { N, RMs, cambriaMs, eagerMs,
             PerNodeUs: toUs(RMs, N), cambriaPerNodeUs: toUs(cambriaMs, N), eagerPerNodeUs: toUs(eagerMs, N),
             correct: true, note: 'L-split' };
}

function benchUnionL(persons: NormPerson[], edges: Record<string, any>[]): Omit<RQ2_2_Result, 'smo' | 'rep'> {
    const N = persons.length;
    const oldLabel1 = `Lbl1_${randomSuffix()}`, oldLabel2 = `Lbl2_${randomSuffix()}`;
    const newLabel = `LblU_${randomSuffix()}`;
    const { sc, le } = freshSchema();
    sc.SMO_createLabel(oldLabel1);
    sc.SMO_createLabel(oldLabel2);
    sc.SMO_unionLabels({ oldLabel1, oldLabel2, newLabel });
    le.refreshCache();
    const cambriaOps: LensSource = buildCambriaLens([cambriaAddOp({ name: 'labelUnion', type: 'string', default: newLabel })]);

    const RMs    = measureNs(() => { for (const p of persons) { const r = le.resolveActiveType('Person', p as any); le.decodeAndFilterProperties(r, p as any, 'NodeType'); } });
    const cambriaMs  = measureNs(() => { for (const p of persons) applyLensToDoc(cambriaOps, p); });
    const eagerMs    = measureNs(() => { let _val; for (const p of persons) { _val = p.firstName; } });

    return { N, RMs, cambriaMs, eagerMs,
             PerNodeUs: toUs(RMs, N), cambriaPerNodeUs: toUs(cambriaMs, N), eagerPerNodeUs: toUs(eagerMs, N),
             correct: true, note: 'L-union' };
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
    splitL:         benchSplitL,
    unionNT:        benchUnionNT,
    unionRT:        benchUnionRT,
    unionL:         benchUnionL,
};

export function runRQ2_2(): RQ2_2_Result[] {
    const data = readSnbPersonsAndKnows(path.resolve(process.cwd(), SF3_DIR));
    console.log(`Full data persons:`, data.persons.length, "knows edges:", data.knows.length);
    const cutPersons = cutNodes(data.persons, 1000);
    const personIds = new Set(cutPersons.map(p => String(p.id)));
    const edges = filterKnowsEdges(data.knows, personIds);
    const normEdges = normaliseEdges(edges);
    console.log(`N=${cutPersons.length} persons + ${edges.length} edges\n`);
    // small warm up for JIT
    const warmPersons = normalise(cutNodes(data.persons as any, 50) as any);
    for (const fn of Object.values(SMO_BENCH)) fn(warmPersons, normEdges);

    const REPS = 5;
    const results: RQ2_2_Result[] = [];
    const persons = normalise(cutPersons);
    for (const [smo, bench] of Object.entries(SMO_BENCH)) {
        const prismUs: number[] = [], cambriaUs: number[] = [], eagerUs: number[] = [];
        for (let rep = 0; rep < REPS; rep++) {
            const r = bench(persons, normEdges);
            results.push({ smo, rep, ...r });
            prismUs.push(r.PerNodeUs);
            cambriaUs.push(r.cambriaPerNodeUs);
            eagerUs.push(r.eagerPerNodeUs);
        }
        const avgP = prismUs.reduce((a, b) => a + b, 0) / REPS;
        const avgC = cambriaUs.reduce((a, b) => a + b, 0) / REPS;
        const avgE = eagerUs.reduce((a, b) => a + b, 0) / REPS;
        const note = results.find(r => r.smo === smo)?.note ?? '';
        const tag  = note ? ` [${note}]` : '';
        console.log(`Nodecount: ${persons.length} - ${smo}:`);
        console.log(
            `  ${smo.padEnd(16)}  prism=${avgP.toFixed(3).padStart(7)} µs/node` +
            `  cambria=${avgC.toFixed(3).padStart(7)} µs/node` +
            `  eager=${avgE.toFixed(4).padStart(8)} µs/node${tag}`
        );
    }

    const out = path.join(__dirname, 'rq2_2_results.json');
    fs.writeFileSync(out, JSON.stringify({ results }, null, 2));
    return results;
}

if (require.main === module) { runRQ2_2(); }
