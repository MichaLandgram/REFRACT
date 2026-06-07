import * as fs from 'fs';
import * as path from 'path';
import { freshSchema, median, padPersons } from '../Helper/helper';
import { findCsvFile, parseLdbcCsv } from '../Helper/SnbDataReader';
import { GENDER_MAP } from '../Helper/EagerMigrationFunctions';
import { performance } from 'perf_hooks';
import { NormPerson, RQ2_2_Result } from '../Helper/resultInterfaces';
import {
    applyLensToDoc,
    renameProperty  as cambriaRenameOp,
    convertValue    as cambriaConvertOp,
    addProperty     as cambriaAddOp,
    removeProperty  as cambriaRemoveOp,
    LensSource,
} from 'cambria';

{
    const _w = { firstName: 'warmup', lastName: 'test', gender: 'male',
                 birthday: '1990-01-01', locationIP: '0.0.0.0', browserUsed: 'Chrome' };
    for (let _i = 0; _i < 5; _i++) applyLensToDoc([cambriaRenameOp('firstName', 'givenName')], _w);
}

function randomSuffix(): string {
    return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function normalise(persons: Record<string, any>[]): NormPerson[] {
    return persons.map(p => ({
        firstName:   String(p.firstName   ?? ''),
        lastName:    String(p.lastName    ?? ''),
        gender:      String(p.gender      ?? ''),
        birthday:    String(p.birthday    ?? ''),
        locationIP:  String(p.locationIP  ?? ''),
        browserUsed: String(p.browserUsed ?? ''),
    }));
}

const INTERNAL_REPS = 5;
function measureMs(fn: () => void): number {
    const times: number[] = [];
    for (let i = 0; i < INTERNAL_REPS; i++) {
        const t0 = performance.now();
        fn();
        times.push(performance.now() - t0);
    }
    return median(times);
}

function toUs(ms: number, N: number): number { return (ms * 1000) / N; }

type BenchFn = (persons: NormPerson[]) => Omit<RQ2_2_Result, 'smo' | 'rep'>;

function benchCreateNT(persons: NormPerson[]): Omit<RQ2_2_Result, 'smo' | 'rep'> {
    const N = persons.length;
    const newType = `NT_${randomSuffix()}`;
    const { sc, le } = freshSchema();
    sc.SMO_addNodeType(newType, ['person'], { score: 'number' });
    le.refreshCache();
    const cambriaOps: LensSource = [cambriaAddOp({ name: `__type_${newType}`, type: 'string', default: newType })];
    const migrated = persons.map(p => ({ ...p, nodeType: newType }));

    const RMs    = measureMs(() => { for (const p of persons)  { const r = le.resolveActiveType('Person', p as any); le.decodeAndFilterPropertiesLazy(r, p as any, 'NodeType'); } });
    const cambriaMs  = measureMs(() => { for (const p of persons)  applyLensToDoc(cambriaOps, p); });
    const eagerMs    = measureMs(() => { let _val; for (const p of migrated) { _val = (p as any).nodeType; } });

    return { N, RMs, cambriaMs, eagerMs,
             PerNodeUs: toUs(RMs, N), cambriaPerNodeUs: toUs(cambriaMs, N), eagerPerNodeUs: toUs(eagerMs, N),
             correct: true, note: '' };
}

function benchCreateRT(persons: NormPerson[]): Omit<RQ2_2_Result, 'smo' | 'rep'> {
    const N = persons.length;
    const newRT = `RT_${randomSuffix()}`;
    const { sc, le } = freshSchema();
    sc.SMO_addRelationshipType(newRT, 'person', 'person', { since: 'string' });
    le.refreshCache();
    const cambriaOps: LensSource = [cambriaAddOp({ name: `__edgeType_${newRT}`, type: 'string', default: newRT })];

    const RMs    = measureMs(() => { for (const p of persons) { const r = le.resolveActiveType('Person', p as any); le.decodeAndFilterPropertiesLazy(r, p as any, 'NodeType'); } });
    const cambriaMs  = measureMs(() => { for (const p of persons) applyLensToDoc(cambriaOps, p); });
    const eagerMs    = measureMs(() => { let _val; for (const p of persons) { _val = p.firstName; } });

    return { N, RMs, cambriaMs, eagerMs,
             PerNodeUs: toUs(RMs, N), cambriaPerNodeUs: toUs(cambriaMs, N), eagerPerNodeUs: toUs(eagerMs, N),
             correct: true, note: 'RT-no-node-impact' };
}


function benchCreateL(persons: NormPerson[]): Omit<RQ2_2_Result, 'smo' | 'rep'> {
    const N = persons.length;
    const newLabel = `Lbl_${randomSuffix()}`;
    const { sc, le } = freshSchema();
    sc.SMO_createLabel(newLabel);
    le.refreshCache();
    const cambriaOps: LensSource = [cambriaAddOp({ name: newLabel, type: 'string', default: newLabel })];

    const RMs    = measureMs(() => { for (const p of persons) { const r = le.resolveActiveType('Person', p as any); le.decodeAndFilterPropertiesLazy(r, p as any, 'NodeType'); } });
    const cambriaMs  = measureMs(() => { for (const p of persons) applyLensToDoc(cambriaOps, p); });
    const eagerMs    = measureMs(() => { let _val; for (const p of persons) { _val = p.firstName; } });

    return { N, RMs, cambriaMs, eagerMs,
             PerNodeUs: toUs(RMs, N), cambriaPerNodeUs: toUs(cambriaMs, N), eagerPerNodeUs: toUs(eagerMs, N),
             correct: true, note: '' };
}

function benchDropNT(persons: NormPerson[]): Omit<RQ2_2_Result, 'smo' | 'rep'> {
    const N = persons.length;
    const { sc, le } = freshSchema();
    sc.SMO_dropNodeType('Person');
    le.refreshCache();
    const cambriaOps: LensSource = [];
    const migrated = persons.map(() => ({}));

    const RMs    = measureMs(() => { for (const p of persons) { const r = le.resolveActiveType('Person', p as any); le.decodeAndFilterPropertiesLazy(r, p as any, 'NodeType'); } });
    const cambriaMs  = measureMs(() => { for (const p of persons) applyLensToDoc(cambriaOps, p); });
    const eagerMs    = measureMs(() => { let _val; for (const p of migrated) { _val = Object.keys(p).length; } });

    return { N, RMs, cambriaMs, eagerMs,
             PerNodeUs: toUs(RMs, N), cambriaPerNodeUs: toUs(cambriaMs, N), eagerPerNodeUs: toUs(eagerMs, N),
             correct: true, note: '' };
}

function benchDropRT(persons: NormPerson[]): Omit<RQ2_2_Result, 'smo' | 'rep'> {
    const N = persons.length;
    const { sc, le } = freshSchema();
    sc.SMO_dropRelationshipType('KNOWS');
    le.refreshCache();
    const cambriaOps: LensSource = [];

    const RMs    = measureMs(() => { for (const p of persons) { const r = le.resolveActiveType('Person', p as any); le.decodeAndFilterPropertiesLazy(r, p as any, 'NodeType'); } });
    const cambriaMs  = measureMs(() => { for (const p of persons) applyLensToDoc(cambriaOps, p); });
    const eagerMs    = measureMs(() => { let _val; for (const p of persons) { _val = p.firstName; } });

    return { N, RMs, cambriaMs, eagerMs,
             PerNodeUs: toUs(RMs, N), cambriaPerNodeUs: toUs(cambriaMs, N), eagerPerNodeUs: toUs(eagerMs, N),
             correct: true, note: 'RT-no-node-impact' };
}

function benchDropL(persons: NormPerson[]): Omit<RQ2_2_Result, 'smo' | 'rep'> {
    const N = persons.length;
    const label = `Lbl_${randomSuffix()}`;
    const { sc, le } = freshSchema();
    sc.SMO_createLabel(label);
    sc.SMO_AddLabelToNodeType('Person', label);
    sc.SMO_dropLabel(label);
    le.refreshCache();

    const seeded = persons.map(p => ({ ...p, [label]: true })) as any[];
    const cambriaOps: LensSource = [cambriaRemoveOp({ name: label, type: 'boolean' })];
    const migrated = seeded.map(({ [label]: _, ...rest }: any) => rest);

    const RMs    = measureMs(() => { for (const p of seeded)   { const r = le.resolveActiveType('Person', p); le.decodeAndFilterPropertiesLazy(r, p, 'NodeType'); } });
    const cambriaMs  = measureMs(() => { for (const p of seeded)   applyLensToDoc(cambriaOps, p); });
    const eagerMs    = measureMs(() => { let _val; for (const p of migrated) { _val = (p as any).firstName; } });

    return { N, RMs, cambriaMs, eagerMs,
             PerNodeUs: toUs(RMs, N), cambriaPerNodeUs: toUs(cambriaMs, N), eagerPerNodeUs: toUs(eagerMs, N),
             correct: true, note: '' };
}

function benchRenameL(persons: NormPerson[]): Omit<RQ2_2_Result, 'smo' | 'rep'> {
    const N = persons.length;
    const oldLabel = `Lbl_${randomSuffix()}`, newLabel = `Lbl_${randomSuffix()}`;
    const { sc, le } = freshSchema();
    sc.SMO_createLabel(oldLabel);
    sc.SMO_AddLabelToNodeType('Person', oldLabel);
    sc.SMO_renameLabel(oldLabel, newLabel);
    le.refreshCache();
    const seeded  = persons.map(p => ({ ...p, [oldLabel]: true })) as any[];
    const cambriaOps: LensSource = [cambriaRenameOp(oldLabel, newLabel)];
    const migrated = seeded.map((p: any) => { const { [oldLabel]: v, ...rest } = p; return { ...rest, [newLabel]: v }; });

    const RMs    = measureMs(() => { for (const p of seeded)   { const r = le.resolveActiveType('Person', p); le.decodeAndFilterPropertiesLazy(r, p, 'NodeType'); } });
    const cambriaMs  = measureMs(() => { for (const p of seeded)   applyLensToDoc(cambriaOps, p); });
    const eagerMs    = measureMs(() => { let _val; for (const p of migrated) { _val = (p as any)[newLabel]; } });

    return { N, RMs, cambriaMs, eagerMs,
             PerNodeUs: toUs(RMs, N), cambriaPerNodeUs: toUs(cambriaMs, N), eagerPerNodeUs: toUs(eagerMs, N),
             correct: true, note: '' };
}

function benchRenamePk(persons: NormPerson[]): Omit<RQ2_2_Result, 'smo' | 'rep'> {
    const N = persons.length;
    const newKey = `prop_${randomSuffix()}`;
    const { sc, le } = freshSchema();
    sc.SMO_renamePropertyKey({ Idenifying: 'Person', oldPropertyKey: 'firstName', newPropertyKey: newKey, whatType: 'NodeType' });
    le.refreshCache();
    const cambriaOps: LensSource = [cambriaRenameOp('firstName', newKey)];
    const migrated = persons.map(({ firstName, ...rest }) => ({ ...rest, [newKey]: firstName }));

    const RMs    = measureMs(() => { for (const p of persons)  { const r = le.resolveActiveType('Person', p as any); le.decodeAndFilterPropertiesLazy(r, p as any, 'NodeType'); } });
    const cambriaMs  = measureMs(() => { for (const p of persons)  applyLensToDoc(cambriaOps, p); });
    const eagerMs    = measureMs(() => { let _val; for (const p of migrated) { _val = (p as any)[newKey]; } });

    const cambriaCount = (() => { let n = 0; for (const p of persons) { const t = applyLensToDoc(cambriaOps, p) as any; if (t[newKey] !== undefined) n++; } return n; })();
    const prismCount   = (() => { let n = 0; for (const p of persons) { const r = le.resolveActiveType('Person', p as any); const t = le.decodeAndFilterPropertiesLazy(r, p as any, 'NodeType'); if (t[newKey] !== undefined) n++; } return n; })();

    return { N, RMs, cambriaMs, eagerMs,
             PerNodeUs: toUs(RMs, N), cambriaPerNodeUs: toUs(cambriaMs, N), eagerPerNodeUs: toUs(eagerMs, N),
             correct: prismCount === N && cambriaCount === N, note: '' };
}

function benchAddLabelToNT(persons: NormPerson[]): Omit<RQ2_2_Result, 'smo' | 'rep'> {
    const N = persons.length;
    const label = `Lbl_${randomSuffix()}`;
    const { sc, le } = freshSchema();
    sc.SMO_createLabel(label);
    sc.SMO_AddLabelToNodeType('Person', label);
    le.refreshCache();
    const cambriaOps: LensSource = [cambriaAddOp({ name: `__label_${label}`, type: 'string', default: label })];
    const migrated = persons.map(p => ({ ...p, [`__label_${label}`]: label }));

    const RMs    = measureMs(() => { for (const p of persons)  { const r = le.resolveActiveType('Person', p as any); le.decodeAndFilterPropertiesLazy(r, p as any, 'NodeType'); } });
    const cambriaMs  = measureMs(() => { for (const p of persons)  applyLensToDoc(cambriaOps, p); });
    const eagerMs    = measureMs(() => { let _val; for (const p of migrated) { _val = (p as any)[`__label_${label}`]; } });

    return { N, RMs, cambriaMs, eagerMs,
             PerNodeUs: toUs(RMs, N), cambriaPerNodeUs: toUs(cambriaMs, N), eagerPerNodeUs: toUs(eagerMs, N),
             correct: true, note: '' };
}

function benchAddProperty(persons: NormPerson[]): Omit<RQ2_2_Result, 'smo' | 'rep'> {
    const N = persons.length;
    const prop = `prop_${randomSuffix()}`;
    const { sc, le } = freshSchema();
    sc.SMO_AddPropertyType({ Idenifying: 'Person', newProperty: { key: prop, value: 'string' }, defa: 'default_val', whatType: 'NodeType' });
    le.refreshCache();
    const cambriaOps: LensSource = [cambriaAddOp({ name: prop, type: 'string', default: 'default_val' })];
    const migrated = persons.map(p => ({ ...p, [prop]: 'default_val' }));

    const RMs    = measureMs(() => { for (const p of persons)  { const r = le.resolveActiveType('Person', p as any); le.decodeAndFilterPropertiesLazy(r, p as any, 'NodeType'); } });
    const cambriaMs  = measureMs(() => { for (const p of persons)  applyLensToDoc(cambriaOps, p); });
    const eagerMs    = measureMs(() => { let _val; for (const p of migrated) { _val = (p as any)[prop]; } });

    return { N, RMs, cambriaMs, eagerMs,
             PerNodeUs: toUs(RMs, N), cambriaPerNodeUs: toUs(cambriaMs, N), eagerPerNodeUs: toUs(eagerMs, N),
             correct: true, note: '' };
}

function benchRemoveLabel(persons: NormPerson[]): Omit<RQ2_2_Result, 'smo' | 'rep'> {
    const N = persons.length;
    const label = `Lbl_${randomSuffix()}`;
    const { sc, le } = freshSchema();
    sc.SMO_createLabel(label);
    sc.SMO_AddLabelToNodeType('Person', label);
    sc.SMO_RemoveLabelFromNodeType('Person', label);
    le.refreshCache();
    const cambriaOps: LensSource = [];
    const migrated = persons.map(p => { const r = { ...p } as any; return r; });

    const RMs    = measureMs(() => { for (const p of persons)  { const r = le.resolveActiveType('Person', p as any); le.decodeAndFilterPropertiesLazy(r, p as any, 'NodeType'); } });
    const cambriaMs  = measureMs(() => { for (const p of persons)  applyLensToDoc(cambriaOps, p); });
    const eagerMs    = measureMs(() => { let _val; for (const p of migrated) { _val = p.firstName; } });

    return { N, RMs, cambriaMs, eagerMs,
             PerNodeUs: toUs(RMs, N), cambriaPerNodeUs: toUs(cambriaMs, N), eagerPerNodeUs: toUs(eagerMs, N),
             correct: true, note: '' };
}


function benchRemoveProperty(persons: NormPerson[]): Omit<RQ2_2_Result, 'smo' | 'rep'> {
    const N = persons.length;
    const prop = `prop_${randomSuffix()}`;
    const { sc, le } = freshSchema();
    sc.SMO_AddPropertyType({ Idenifying: 'Person', newProperty: { key: prop, value: 'string' }, defa: '', whatType: 'NodeType' });
    sc.SMO_DropPropertyType({ Idenifying: 'Person', propertyKey: prop, whatType: 'NodeType' });
    le.refreshCache();

    const seeded = persons.map(p => ({ ...p, [prop]: 'value_x' })) as any[];
    const cambriaOps: LensSource = [cambriaRemoveOp({ name: prop, type: 'string' })];
    const migrated = seeded.map(({ [prop]: _, ...rest }: any) => rest);

    const RMs    = measureMs(() => { for (const p of seeded)   { const r = le.resolveActiveType('Person', p); le.decodeAndFilterPropertiesLazy(r, p, 'NodeType'); } });
    const cambriaMs  = measureMs(() => { for (const p of seeded)   applyLensToDoc(cambriaOps, p); });
    const eagerMs = measureMs(() => { for (const p of migrated) { void (p as any).firstName; } });

    return { N, RMs, cambriaMs, eagerMs,
             PerNodeUs: toUs(RMs, N), cambriaPerNodeUs: toUs(cambriaMs, N), eagerPerNodeUs: toUs(eagerMs, N),
             correct: true, note: '' };
}

function benchRetypeProperty(persons: NormPerson[]): Omit<RQ2_2_Result, 'smo' | 'rep'> {
    const N = persons.length;
    const { sc, le } = freshSchema();
    sc.SMO_ChangePropertyType({
        Idenifying: 'Person', propertyKey: 'gender',
        oldTags: [sc.yjsDoc.clientID.toString()], newPropertyType: 'number',
        defaultVal: { default: 0, transformerMap: { male: '1', female: '2', default: '0' } },
        whatType: 'NodeType'
    });
    le.refreshCache();
    const cambriaOps: LensSource = [cambriaConvertOp('gender', [{ female: 2, male: 1 }], 'string', 'number')];
    const migrated = persons.map(p => ({ ...p, gender: GENDER_MAP[p.gender] ?? 0 }));

    const RMs    = measureMs(() => { for (const p of persons)  { const r = le.resolveActiveType('Person', p as any); le.decodeAndFilterPropertiesLazy(r, p as any, 'NodeType'); } });
    const cambriaMs  = measureMs(() => { for (const p of persons)  applyLensToDoc(cambriaOps, p); });
    const eagerMs    = measureMs(() => { let _val; for (const p of migrated) { _val = (p as any).gender === 1; } });

    const prismCount   = (() => { let n = 0; for (const p of persons) { const r = le.resolveActiveType('Person', p as any); const t = le.decodeAndFilterPropertiesLazy(r, p as any, 'NodeType'); if (t.gender === 1 || t.gender === '1') n++; } return n; })();
    const cambriaCount = (() => { let n = 0; for (const p of persons) { const t = applyLensToDoc(cambriaOps, p) as any; if (t.gender === 1) n++; } return n; })();
    const eagerCount   = migrated.filter(p => (p as any).gender === 1).length;

    return { N, RMs, cambriaMs, eagerMs,
             PerNodeUs: toUs(RMs, N), cambriaPerNodeUs: toUs(cambriaMs, N), eagerPerNodeUs: toUs(eagerMs, N),
             correct: prismCount === eagerCount && cambriaCount === eagerCount, note: '' };
}

function benchSplitNT(persons: NormPerson[]): Omit<RQ2_2_Result, 'smo' | 'rep'> {
    const N = persons.length;
    const newType = `NT_${randomSuffix()}`;
    const { sc, le } = freshSchema();
    sc.SMO_splitNodeType({ legacyType: 'Person', splitProperty: 'gender', mapping: { male: newType, female: newType }, defaultType: newType });
    le.refreshCache();
    const cambriaOps: LensSource = [cambriaAddOp({ name: 'nodeType', type: 'string', default: newType })];
    const migrated = persons.map(p => ({ ...p, nodeType: newType }));

    const RMs    = measureMs(() => { for (const p of persons)  { const r = le.resolveActiveType('Person', p as any); le.decodeAndFilterPropertiesLazy(r, p as any, 'NodeType'); } });
    const cambriaMs  = measureMs(() => { for (const p of persons)  applyLensToDoc(cambriaOps, p); });
    const eagerMs    = measureMs(() => { let _val; for (const p of migrated) { _val = (p as any).nodeType === newType; } });

    const prismCount = (() => { let n = 0; for (const p of persons) { if (le.resolveActiveType('Person', p as any) === newType) n++; } return n; })();

    return { N, RMs, cambriaMs, eagerMs,
             PerNodeUs: toUs(RMs, N), cambriaPerNodeUs: toUs(cambriaMs, N), eagerPerNodeUs: toUs(eagerMs, N),
             correct: prismCount === N, note: '' };
}

function benchSplitRT(persons: NormPerson[]): Omit<RQ2_2_Result, 'smo' | 'rep'> {
    const N = persons.length;
    const nt1 = `RT_${randomSuffix()}`, nt2 = `RT_${randomSuffix()}`;
    const { sc, le } = freshSchema();
    sc.SMO_splitRelationshipType({ oldName: 'KNOWS', newName1: nt1, newName2: nt2 });
    le.refreshCache();
    const cambriaOps: LensSource = [cambriaAddOp({ name: 'edgeType', type: 'string', default: nt1 })];

    const RMs    = measureMs(() => { for (const p of persons) { const r = le.resolveActiveType('Person', p as any); le.decodeAndFilterPropertiesLazy(r, p as any, 'NodeType'); } });
    const cambriaMs  = measureMs(() => { for (const p of persons) applyLensToDoc(cambriaOps, p); });
    const eagerMs    = measureMs(() => { let _val; for (const p of persons) { _val = p.firstName; } });

    return { N, RMs, cambriaMs, eagerMs,
             PerNodeUs: toUs(RMs, N), cambriaPerNodeUs: toUs(cambriaMs, N), eagerPerNodeUs: toUs(eagerMs, N),
             correct: true, note: 'RT-no-node-impact' };
}

function benchUnionNT(persons: NormPerson[]): Omit<RQ2_2_Result, 'smo' | 'rep'> {
    const N = persons.length;
    const secondType = `NT_${randomSuffix()}`, unionType = `NT_${randomSuffix()}`;
    const { sc, le } = freshSchema();
    sc.SMO_addNodeType(secondType, ['person'], { name: 'string' });
    sc.SMO_unionNodeTypes({ newType: unionType, legacyTypes: ['Person', secondType], writeDefault: secondType });
    le.refreshCache();
    const cambriaOps: LensSource = [cambriaAddOp({ name: '__unionType', type: 'string', default: unionType })];
    const migrated = persons.map(p => ({ ...p, __unionType: unionType }));

    const RMs    = measureMs(() => { for (const p of persons)  { const r = le.resolveActiveType('Person', p as any); le.decodeAndFilterPropertiesLazy(r, p as any, 'NodeType'); } });
    const cambriaMs  = measureMs(() => { for (const p of persons)  applyLensToDoc(cambriaOps, p); });
    const eagerMs    = measureMs(() => { let _val; for (const p of migrated) { _val = (p as any).__unionType; } });

    return { N, RMs, cambriaMs, eagerMs,
             PerNodeUs: toUs(RMs, N), cambriaPerNodeUs: toUs(cambriaMs, N), eagerPerNodeUs: toUs(eagerMs, N),
             correct: true, note: '' };
}

function benchUnionRT(persons: NormPerson[]): Omit<RQ2_2_Result, 'smo' | 'rep'> {
    const N = persons.length;
    const secondRT = `RT_${randomSuffix()}`, newRT = `RT_${randomSuffix()}`;
    const { sc, le } = freshSchema();
    sc.SMO_addRelationshipType(secondRT, 'person', 'person', {});
    sc.SMO_unionRelationshipTypes({ oldLabel1: 'KNOWS', oldLabel2: secondRT, newLabel: newRT });
    le.refreshCache();
    const cambriaOps: LensSource = [cambriaAddOp({ name: '__edgeUnionType', type: 'string', default: newRT })];

    const RMs    = measureMs(() => { for (const p of persons) { const r = le.resolveActiveType('Person', p as any); le.decodeAndFilterPropertiesLazy(r, p as any, 'NodeType'); } });
    const cambriaMs  = measureMs(() => { for (const p of persons) applyLensToDoc(cambriaOps, p); });
    const eagerMs    = measureMs(() => { let _val; for (const p of persons) { _val = p.firstName; } });

    return { N, RMs, cambriaMs, eagerMs,
             PerNodeUs: toUs(RMs, N), cambriaPerNodeUs: toUs(cambriaMs, N), eagerPerNodeUs: toUs(eagerMs, N),
             correct: true, note: 'RT-no-node-impact' };
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

export function runRQ2_2(): RQ2_2_Result[] {
    const sfDir = path.resolve(process.cwd(),
        'snb-output-sf0.1/graphs/csv/bi/composite-merged-fk/initial_snapshot');
    const personFile = findCsvFile(path.join(sfDir, 'dynamic/Person'));
    if (!personFile) throw new Error('LDBC SF0.1 Person CSV not found.');

    const allPersons = normalise(parseLdbcCsv(personFile));
    const persons    = normalise(padPersons(allPersons as any, 1000) as any);
    console.log(`N=${persons.length} persons\n`);

    const warmPersons = normalise(padPersons(allPersons as any, 50) as any);
    for (const fn of Object.values(SMO_BENCH)) fn(warmPersons);

    const REPS = 10;
    const results: RQ2_2_Result[] = [];

    for (const [smo, bench] of Object.entries(SMO_BENCH)) {
        const prismUs: number[] = [], cambriaUs: number[] = [], eagerUs: number[] = [];
        for (let rep = 0; rep < REPS; rep++) {
            const r = bench(persons);
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
