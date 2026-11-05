import * as fs from 'fs';
import * as path from 'path';
import * as Y from 'yjs';


import { 
    freshSimpleSchema as freshSchema,
    cutNodes,
    cloneDoc,
    loadPersons,
    loadEdges,
    SF3_DIR,
    ns2ms,
    gcIfAvailable,
    randomSuffix } from '../../Helper/benchHelper';
import { readSnbPersonsAndKnows, filterKnowsEdges } from '../../Helper/SnbDataReader';
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
    eagerSplitLabel,
    eagerUnionLabels,
} from '../../Helper/EagerMigrationFunctions';
import { PropertyGraph } from '../../../src/GraphDB_CRDT/PropertyGraph';
import {
    applyLensToDoc,
    renameProperty  as cambriaRenameOp,
    addProperty     as cambriaAddOp,
    removeProperty  as cambriaRemoveOp,
    convertValue    as cambriaConvertOp,
} from 'cambria';
import * as Automerge from 'automerge';
import { PERSON_BASE_LENS, KNOWS_BASE_LENS, cambriaSMO, measureREFRACT } from '../helper';

type Edge = Record<string, any>;


export interface Downtime_result {
    smo:              string;
    rep:              number;
    N:                number;
    E:                number;
    stub:             boolean;
    smoMs:            number;
    lensGenMs:        number;
    lazyReadyMs:      number;
    cambriaSmoMs:     number;
    cambriaReadyMs:   number;
    eagerMigrationMs: number;
}

const db = new PropertyGraph(new Y.Doc());

// Warmup: JIT + Automerge + Cambria
{
    const _d = Automerge.init<any>();
    for (let _i = 0; _i < 5; _i++)
        Automerge.change(_d, d => { d.lens = [{ op: 'warm' }]; });
    const _w = { firstName: 'warmup', lastName: 'test', gender: 'male',
                 birthday: '1990-01-01', locationIP: '0.0.0.0', browserUsed: 'Chrome' };
    for (let _i = 0; _i < 5; _i++) applyLensToDoc([cambriaRenameOp('firstName', 'givenName')], _w);
}

type BenchFn = (persons: Record<string, any>[], edges: Edge[]) => Omit<Downtime_result, 'smo' | 'rep'>;



function benchCreateNT(persons: Record<string, any>[], edges: Edge[]): Omit<Downtime_result, 'smo'|'rep'> {
    const { sc, le } = freshSchema();
    const newType = `NT_${randomSuffix()}`;

    const { smoMs, lensGenMs, lazyReadyMs } = measureREFRACT(sc, le, () =>
        sc.SMO_addNodeType(newType, ['person'], { score: 'number' }));

    const { cambriaSmoMs, cambriaReadyMs } = cambriaSMO([
        cambriaAddOp({ name: 'score', type: 'number', default: 0 }),
        cambriaAddOp({ name: '__type', type: 'string', default: newType })
    ]);
    return { N: persons.length, E: edges.length, stub: false,
             smoMs, lensGenMs, lazyReadyMs, cambriaSmoMs, cambriaReadyMs, eagerMigrationMs: 0 };
}

function benchCreateRT(persons: Record<string, any>[], edges: Edge[]): Omit<Downtime_result, 'smo'|'rep'> {
    const { sc, le } = freshSchema();
    const newEdge = `RT_${randomSuffix()}`;

    const { smoMs, lensGenMs, lazyReadyMs } = measureREFRACT(sc, le, () =>
        sc.SMO_addRelationshipType(newEdge, 'person', 'person', { since: 'string' }));
    const { cambriaSmoMs, cambriaReadyMs } = cambriaSMO([
        cambriaAddOp({ name: 'sourceNodeLabel', type: 'string', default: 'person' }),
        cambriaAddOp({ name: 'targetNodeLabel', type: 'string', default: 'person' }),
        cambriaAddOp({ name: 'since', type: 'string', default: '' }),
        cambriaAddOp({ name: '__edgeType', type: 'string', default: newEdge })
    ]);
    return { N: persons.length, E: edges.length, stub: false,
             smoMs, lensGenMs, lazyReadyMs, cambriaSmoMs, cambriaReadyMs, eagerMigrationMs: 0 };
}

function benchCreateL(persons: Record<string, any>[], edges: Edge[]): Omit<Downtime_result, 'smo'|'rep'> {
    const { sc, le } = freshSchema();
    const newLabel = `Lbl_${randomSuffix()}`;

    const { smoMs, lensGenMs, lazyReadyMs } = measureREFRACT(sc, le, () =>
        sc.SMO_createLabel(newLabel));
    const { cambriaSmoMs, cambriaReadyMs } = cambriaSMO([
        cambriaAddOp({ name: newLabel, type: 'string', default: newLabel })
    ]);
    return { N: persons.length, E: edges.length, stub: false,
             smoMs, lensGenMs, lazyReadyMs, cambriaSmoMs, cambriaReadyMs, eagerMigrationMs: 0 };
}

function benchDropNT(persons: Record<string, any>[], edges: Edge[]): Omit<Downtime_result, 'smo'|'rep'> {
    const { sc, le } = freshSchema();
    const dataDoc = new Y.Doc();
    loadPersons(persons, dataDoc, db);
    loadEdges(persons, edges, dataDoc, db);

    const { smoMs, lensGenMs, lazyReadyMs } = measureREFRACT(sc, le, () =>
        sc.SMO_dropNodeType('Person'));

    const { cambriaSmoMs, cambriaReadyMs } = cambriaSMO([
        cambriaRemoveOp({ name: 'firstName', type: 'string' }),
        cambriaRemoveOp({ name: 'lastName', type: 'string' }),
        cambriaRemoveOp({ name: 'gender', type: 'string' }),
        cambriaRemoveOp({ name: 'birthday', type: 'string' }),
        cambriaRemoveOp({ name: 'locationIP', type: 'string' }),
        cambriaRemoveOp({ name: 'browserUsed', type: 'string' }),
    ], PERSON_BASE_LENS);


    const eagerDoc = cloneDoc(dataDoc);
    gcIfAvailable();
    const em0 = process.hrtime.bigint();
    eagerDeleteNodes(persons, eagerDoc);
    const eagerMigrationMs = ns2ms(process.hrtime.bigint() - em0);

    return { N: persons.length, E: edges.length, stub: false,
             smoMs, lensGenMs, lazyReadyMs, cambriaSmoMs, cambriaReadyMs, eagerMigrationMs };
}

function benchDropRT(persons: Record<string, any>[], edges: Edge[]): Omit<Downtime_result, 'smo'|'rep'> {
    const { sc, le } = freshSchema();
    const dataDoc = new Y.Doc(); loadPersons(persons, dataDoc, db);
    loadEdges(persons, edges, dataDoc, db);

    const { smoMs, lensGenMs, lazyReadyMs } = measureREFRACT(sc, le, () =>
        sc.SMO_dropRelationshipType('KNOWS'));

    const { cambriaSmoMs, cambriaReadyMs } = cambriaSMO([
        cambriaRemoveOp({ name: 'creationDate', type: 'string' }),
        cambriaRemoveOp({ name: 'since', type: 'string' })
        // cambriaRemoveOp({ name: 'sourceNodeLabel', type: 'string' }),
        // cambriaRemoveOp({ name: 'targetNodeLabel', type: 'string' }),
    ], KNOWS_BASE_LENS);

    const eagerDoc = cloneDoc(dataDoc);
    gcIfAvailable();
    const em0 = process.hrtime.bigint();
    eagerDeleteEdges(edges, eagerDoc);
    const eagerMigrationMs = ns2ms(process.hrtime.bigint() - em0);

    return { N: persons.length, E: edges.length, stub: false,
             smoMs, lensGenMs, lazyReadyMs, cambriaSmoMs, cambriaReadyMs, eagerMigrationMs };
}
 
function benchDropL(persons: Record<string, any>[], edges: Edge[]): Omit<Downtime_result, 'smo'|'rep'> {
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

    const { cambriaSmoMs, cambriaReadyMs } = cambriaSMO(
        [cambriaRemoveOp({ name: label, type: 'string' })],
        [...PERSON_BASE_LENS, cambriaAddOp({ name: label, type: 'string', default: '' })]
    );

    const eagerDoc = cloneDoc(dataDoc);
    gcIfAvailable();
    const em0 = process.hrtime.bigint();
    eagerLabelDrop(persons, eagerDoc, label, 'Person');
    eagerEdgeLabelDrop(edges, eagerDoc, label);
    const eagerMigrationMs = ns2ms(process.hrtime.bigint() - em0);

    return { N: persons.length, E: edges.length, stub: false,
             smoMs, lensGenMs, lazyReadyMs, cambriaSmoMs, cambriaReadyMs, eagerMigrationMs };
}

function benchRenameL(persons: Record<string, any>[], edges: Edge[]): Omit<Downtime_result, 'smo'|'rep'> {
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

    const { cambriaSmoMs, cambriaReadyMs } = cambriaSMO(
        [cambriaRenameOp(oldLabel, newLabel)],
        [...PERSON_BASE_LENS, cambriaAddOp({ name: oldLabel, type: 'string', default: '' })]
    );

    const eagerDoc = cloneDoc(dataDoc);
    gcIfAvailable();
    const em0 = process.hrtime.bigint();
    eagerLabelRename(persons, eagerDoc, oldLabel, newLabel, edges);
    const eagerMigrationMs = ns2ms(process.hrtime.bigint() - em0);

    return { N: persons.length, E: edges.length, stub: false,
             smoMs, lensGenMs, lazyReadyMs, cambriaSmoMs, cambriaReadyMs, eagerMigrationMs };
}

function benchRenamePk(persons: Record<string, any>[], edges: Edge[]): Omit<Downtime_result, 'smo'|'rep'> {
    const { sc, le } = freshSchema();
    const dataDoc = new Y.Doc(); loadPersons(persons, dataDoc, db);
    const newKey = `prop_${randomSuffix()}`;

    const { smoMs, lensGenMs, lazyReadyMs } = measureREFRACT(sc, le, () =>
        sc.SMO_renamePropertyKey({ Idenifying: 'Person', oldPropertyKey: 'firstName',
                                   newPropertyKey: newKey, whatType: 'NodeType' }));

    const { cambriaSmoMs, cambriaReadyMs } = cambriaSMO(
        [cambriaRenameOp('firstName', newKey)],
        PERSON_BASE_LENS
    );
    const eagerDoc = cloneDoc(dataDoc);
    gcIfAvailable();
    const em0 = process.hrtime.bigint(); eagerRenamePropertyKey(persons, eagerDoc, 'firstName', newKey, 'Person');
    const eagerMigrationMs = ns2ms(process.hrtime.bigint() - em0);

    return { N: persons.length, E: edges.length, stub: false,
             smoMs, lensGenMs, lazyReadyMs, cambriaSmoMs, cambriaReadyMs, eagerMigrationMs };
}

function benchAddLabelToNT(persons: Record<string, any>[], edges: Edge[]): Omit<Downtime_result, 'smo'|'rep'> {
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
    gcIfAvailable();
    const em0 = process.hrtime.bigint(); eagerLabelSet(persons, eagerDoc, label, 'Person');
    const eagerMigrationMs = ns2ms(process.hrtime.bigint() - em0);

    return { N: persons.length, E: edges.length, stub: false,
             smoMs, lensGenMs, lazyReadyMs, cambriaSmoMs, cambriaReadyMs, eagerMigrationMs };
}

function benchAddProperty(persons: Record<string, any>[], edges: Edge[]): Omit<Downtime_result, 'smo'|'rep'> {
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
    gcIfAvailable();
    const em0 = process.hrtime.bigint(); eagerAddProp(persons, eagerDoc, prop, '', 'Person');
    const eagerMigrationMs = ns2ms(process.hrtime.bigint() - em0);

    return { N: persons.length, E: edges.length, stub: false,
             smoMs, lensGenMs, lazyReadyMs, cambriaSmoMs, cambriaReadyMs, eagerMigrationMs };
}

function benchRemoveLabel(persons: Record<string, any>[], edges: Edge[]): Omit<Downtime_result, 'smo'|'rep'> {
    const { sc, le } = freshSchema();
    const dataDoc = new Y.Doc(); loadPersons(persons, dataDoc, db);
    const label = `Lbl_${randomSuffix()}`;
    sc.SMO_createLabel(label);
    sc.SMO_AddLabelToNodeType('Person', label);
    eagerLabelSet(persons, dataDoc, label, 'Person');

    const { smoMs, lensGenMs, lazyReadyMs } = measureREFRACT(sc, le, () =>
        sc.SMO_RemoveLabelFromNodeType('Person', label));

    const { cambriaSmoMs, cambriaReadyMs } = cambriaSMO(
        [cambriaRemoveOp({ name: label, type: 'string' })],
        [...PERSON_BASE_LENS, cambriaAddOp({ name: label, type: 'string', default: '' })]
    );
    const eagerDoc = cloneDoc(dataDoc);
    gcIfAvailable();
    const em0 = process.hrtime.bigint();
    eagerLabelDrop(persons, eagerDoc, label, 'Person');
    const eagerMigrationMs = ns2ms(process.hrtime.bigint() - em0);

    return { N: persons.length, E: edges.length, stub: false,
             smoMs, lensGenMs, lazyReadyMs,
             cambriaSmoMs, cambriaReadyMs, eagerMigrationMs };
}

function benchRemoveProperty(persons: Record<string, any>[], edges: Edge[]): Omit<Downtime_result, 'smo'|'rep'> {
    const { sc, le } = freshSchema();
    const dataDoc = new Y.Doc(); loadPersons(persons, dataDoc, db);
    const prop = `prop_${randomSuffix()}`;
    sc.SMO_AddPropertyType({ Idenifying: 'Person', newProperty: { key: prop, value: 'string' },
                              defa: '', whatType: 'NodeType' });
    eagerAddProp(persons, dataDoc, prop, '', 'Person');

    const { smoMs, lensGenMs, lazyReadyMs } = measureREFRACT(sc, le, () =>
        sc.SMO_DropPropertyType({ Idenifying: 'Person', propertyKey: prop, whatType: 'NodeType' }));

    const { cambriaSmoMs, cambriaReadyMs } = cambriaSMO(
        [cambriaRemoveOp({ name: prop, type: 'string' })],
        [...PERSON_BASE_LENS, cambriaAddOp({ name: prop, type: 'string', default: '' })]
    );
    const eagerDoc = cloneDoc(dataDoc);
    gcIfAvailable();
    const em0 = process.hrtime.bigint(); eagerDropProp(persons, eagerDoc, prop, 'Person');
    const eagerMigrationMs = ns2ms(process.hrtime.bigint() - em0);

    return { N: persons.length, E: edges.length, stub: false,
             smoMs, lensGenMs, lazyReadyMs, cambriaSmoMs, cambriaReadyMs, eagerMigrationMs };
}

function benchRetypeProperty(persons: Record<string, any>[], edges: Edge[]): Omit<Downtime_result, 'smo'|'rep'> {
    const { sc, le } = freshSchema();
    const dataDoc = new Y.Doc(); loadPersons(persons, dataDoc, db);
    const tags = [sc.yjsDoc.clientID.toString()];

    const { smoMs, lensGenMs, lazyReadyMs } = measureREFRACT(sc, le, () =>
        sc.SMO_ChangePropertyType({ Idenifying: 'Person', propertyKey: 'gender',
            oldTags: tags, newPropertyType: 'number',
            defaultVal: { default: 0, transformerMap: { male: '1', female: '2', default: '0' } },
            whatType: 'NodeType' }));

    const { cambriaSmoMs, cambriaReadyMs } = cambriaSMO(
        [cambriaConvertOp('gender', [{ female: 2, male: 1 }], 'string', 'number')],
        PERSON_BASE_LENS
    );
    const eagerDoc = cloneDoc(dataDoc);
    gcIfAvailable();
    const em0 = process.hrtime.bigint();
    eagerRetype(persons, eagerDoc, 'gender', (s: string) => GENDER_MAP[s] ?? 0, 'Person');
    const eagerMigrationMs = ns2ms(process.hrtime.bigint() - em0);

    return { N: persons.length, E: edges.length, stub: false,
             smoMs, lensGenMs, lazyReadyMs, cambriaSmoMs, cambriaReadyMs, eagerMigrationMs };
}

function benchSplitNT(persons: Record<string, any>[], edges: Edge[]): Omit<Downtime_result, 'smo'|'rep'> {
    const { sc, le } = freshSchema();
    const dataDoc = new Y.Doc(); loadPersons(persons, dataDoc, db);
    const newType = `NT_${randomSuffix()}`;

    const { smoMs, lensGenMs, lazyReadyMs } = measureREFRACT(sc, le, () =>
        sc.SMO_splitNodeType({ legacyType: 'Person', splitProperty: 'gender',
                               mapping: { male: newType, female: newType }, defaultType: newType }));

    const { cambriaSmoMs, cambriaReadyMs } = cambriaSMO([
        cambriaAddOp({ name: 'nodeType', type: 'string', default: newType }),
        cambriaRenameOp('type', 'nodeType')
    ], PERSON_BASE_LENS);
    const eagerDoc = cloneDoc(dataDoc);
    gcIfAvailable();
    const em0 = process.hrtime.bigint();
    eagerSplit(persons, eagerDoc, 'Person', { male: newType, female: newType }, 'gender', newType);
    const eagerMigrationMs = ns2ms(process.hrtime.bigint() - em0);

    return { N: persons.length, E: edges.length, stub: false,
             smoMs, lensGenMs, lazyReadyMs, cambriaSmoMs, cambriaReadyMs, eagerMigrationMs };
}

function benchSplitRT(persons: Record<string, any>[], edges: Edge[]): Omit<Downtime_result, 'smo'|'rep'> {
    const { sc, le } = freshSchema();
    const dataDoc = new Y.Doc(); loadPersons(persons, dataDoc, db);
    loadEdges(persons, edges, dataDoc, db);
    const newType1 = `RT_${randomSuffix()}`, newType2 = `RT_${randomSuffix()}`;

    const { smoMs, lensGenMs, lazyReadyMs } = measureREFRACT(sc, le, () =>
        sc.SMO_splitRelationshipType({ legacyType: 'KNOWS', newType1: newType1, newType2: newType2 }));

    const { cambriaSmoMs, cambriaReadyMs } = cambriaSMO([
        cambriaAddOp({ name: 'edgeType', type: 'string', default: newType1 }),
        cambriaRenameOp('type', 'edgeType')
    ], KNOWS_BASE_LENS);
    const eagerDoc = cloneDoc(dataDoc);
    gcIfAvailable();
    const em0 = process.hrtime.bigint(); eagerSplitEdges(edges, eagerDoc, 'KNOWS', newType1);
    const eagerMigrationMs = ns2ms(process.hrtime.bigint() - em0);

    return { N: persons.length, E: edges.length, stub: false,
             smoMs, lensGenMs, lazyReadyMs, cambriaSmoMs, cambriaReadyMs, eagerMigrationMs };
}

function benchUnionNT(persons: Record<string, any>[], edges: Edge[]): Omit<Downtime_result, 'smo'|'rep'> {
    const { sc, le } = freshSchema();
    const dataDoc = new Y.Doc(); loadPersons(persons, dataDoc, db);
    const secondType = `NT_${randomSuffix()}`, unionType = `NT_${randomSuffix()}`;
    sc.SMO_addNodeType(secondType, ['person'], { name: 'string' });

    const { smoMs, lensGenMs, lazyReadyMs } = measureREFRACT(sc, le, () =>
        sc.SMO_unionNodeTypes({ newType: unionType, legacyTypes: ['Person', secondType],
                                writeDefault: secondType }));

    const { cambriaSmoMs, cambriaReadyMs } = cambriaSMO([
        cambriaAddOp({ name: '__unionType', type: 'string', default: unionType }),
        cambriaRenameOp('type', '__unionType')
    ], PERSON_BASE_LENS);
    const eagerDoc = cloneDoc(dataDoc);
    gcIfAvailable();
    const em0 = process.hrtime.bigint(); eagerUnion(persons, eagerDoc, ['Person', secondType], unionType);
    const eagerMigrationMs = ns2ms(process.hrtime.bigint() - em0);

    return { N: persons.length, E: edges.length, stub: false,
             smoMs, lensGenMs, lazyReadyMs, cambriaSmoMs, cambriaReadyMs, eagerMigrationMs };
}

function benchUnionRT(persons: Record<string, any>[], edges: Edge[]): Omit<Downtime_result, 'smo'|'rep'> {
    const { sc, le } = freshSchema();
    const dataDoc = new Y.Doc(); loadPersons(persons, dataDoc, db);
    loadEdges(persons, edges, dataDoc, db);
    const secondRT = `RT_${randomSuffix()}`, newRT = `RT_${randomSuffix()}`;
    sc.SMO_addRelationshipType(secondRT, 'person', 'person', {});

    const { smoMs, lensGenMs, lazyReadyMs } = measureREFRACT(sc, le, () =>
        sc.SMO_unionRelationshipTypes({ newType: newRT, legacyTypes: ['KNOWS', secondRT], writeDefault: secondRT }));

    const { cambriaSmoMs, cambriaReadyMs } = cambriaSMO([
        cambriaAddOp({ name: '__edgeUnionType', type: 'string', default: newRT }),
        cambriaRenameOp('type', '__edgeUnionType')
    ], KNOWS_BASE_LENS);
    const eagerDoc = cloneDoc(dataDoc);
    gcIfAvailable();
    const em0 = process.hrtime.bigint(); eagerUnionEdges(edges, eagerDoc, ['KNOWS', secondRT], newRT);
    const eagerMigrationMs = ns2ms(process.hrtime.bigint() - em0);

    return { N: persons.length, E: edges.length, stub: false,
             smoMs, lensGenMs, lazyReadyMs, cambriaSmoMs, cambriaReadyMs, eagerMigrationMs };
}

function benchSplitL(persons: Record<string, any>[], edges: Edge[]): Omit<Downtime_result, 'smo'|'rep'> {
    const { sc, le } = freshSchema();
    const dataDoc = new Y.Doc(); loadPersons(persons, dataDoc, db);
    const oldLabel = `Lbl_${randomSuffix()}`;
    const newLabel1 = `Lbl1_${randomSuffix()}`, newLabel2 = `Lbl2_${randomSuffix()}`;
    sc.SMO_createLabel(oldLabel);
    eagerLabelSet(persons, dataDoc, oldLabel, 'Person');

    const { smoMs, lensGenMs, lazyReadyMs } = measureREFRACT(sc, le, () =>
        sc.SMO_splitLabel({ oldName: oldLabel, newName1: newLabel1, newName2: newLabel2 }));

    const { cambriaSmoMs, cambriaReadyMs } = cambriaSMO([
        cambriaAddOp({ name: 'labelSplit', type: 'string', default: newLabel1 })
    ]);
    const eagerDoc = cloneDoc(dataDoc);
    gcIfAvailable();
    const em0 = process.hrtime.bigint();
    eagerSplitLabel(persons, eagerDoc, oldLabel, newLabel1, newLabel2, edges);
    const eagerMigrationMs = ns2ms(process.hrtime.bigint() - em0);

    return { N: persons.length, E: edges.length, stub: false,
             smoMs, lensGenMs, lazyReadyMs, cambriaSmoMs, cambriaReadyMs, eagerMigrationMs };
}

function benchUnionL(persons: Record<string, any>[], edges: Edge[]): Omit<Downtime_result, 'smo'|'rep'> {
    const { sc, le } = freshSchema();
    const dataDoc = new Y.Doc(); loadPersons(persons, dataDoc, db);
    const oldLabel1 = `Lbl1_${randomSuffix()}`, oldLabel2 = `Lbl2_${randomSuffix()}`;
    const newLabel = `LblU_${randomSuffix()}`;
    sc.SMO_createLabel(oldLabel1);
    sc.SMO_createLabel(oldLabel2);
    eagerLabelSet(persons, dataDoc, oldLabel1, 'Person');

    const { smoMs, lensGenMs, lazyReadyMs } = measureREFRACT(sc, le, () =>
        sc.SMO_unionLabels({ oldLabel1, oldLabel2, newLabel }));

    const { cambriaSmoMs, cambriaReadyMs } = cambriaSMO([
        cambriaAddOp({ name: 'labelUnion', type: 'string', default: newLabel })
    ]);
    const eagerDoc = cloneDoc(dataDoc);
    gcIfAvailable();
    const em0 = process.hrtime.bigint();
    eagerUnionLabels(persons, eagerDoc, oldLabel1, oldLabel2, newLabel, edges);
    const eagerMigrationMs = ns2ms(process.hrtime.bigint() - em0);

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
    splitL:         benchSplitL,
    unionNT:        benchUnionNT,
    unionRT:        benchUnionRT,
    unionL:         benchUnionL,
};


export function runRQ1_2(): Downtime_result[] {
    const REPS    = 5;
    const NodeCount = 1000;
    const results: Downtime_result[] = [];
    const data = readSnbPersonsAndKnows(path.resolve(process.cwd(), SF3_DIR));
    console.log(`Full data persons:`, data.persons.length, 'knows edges:', data.knows.length);
    const persons = cutNodes(data.persons, NodeCount);
    const personIds = new Set(persons.map(p => String(p.id)));
    const edges: Edge[] = filterKnowsEdges(data.knows, personIds);


    // Small warmup for JIT
    const warmP = cutNodes(data.persons, 50);
    const warmIds = new Set(warmP.map(p => String(p.id)));
    const warmE: Edge[] = filterKnowsEdges(data.knows, warmIds);
    for (const fn of Object.values(SMO_BENCH)) fn(warmP, warmE);

    console.log(`DOWNTIME Bench: N=${persons.length} persons + ${edges.length} edges\n`);
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

        const mean = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
        const pAvg = mean(REFRACTMs);
        const cAvg = mean(cambriaMs);
        const eAvg = mean(eagerMs);

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

    const out = path.join(__dirname, 'result/Downtime_results.json');
    fs.writeFileSync(out, JSON.stringify({ results }, null, 2));
    return results;
}

if (require.main === module) { runRQ1_2(); }
