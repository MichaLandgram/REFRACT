import * as fs from 'fs';
import * as path from 'path';
import * as Y from 'yjs';
import * as process from 'process';

import { PropertyGraph } from '../../src/GraphDB_CRDT/PropertyGraph';
import { LensedPropertyGraph } from '../../src/LensEngine/LensedPropertyGraph';
import { filterKnowsEdges, getPersonIds, readSnbPersonsAndKnows } from '../Helper/SnbDataReader';
import { loadPersons, loadEdges, freshSimpleSchema, cutNodes, cloneDoc, median, SF01_DIR, SF3_DIR } from '../Helper/benchHelper';

export interface FullWritePathOverheadResult {
    nodes: number;
    edges: number;
    schemaVersion: "trivialSchema" | "evolvedSchema";
    createN: number;
    createR: number;
    updateN: number;
    updateR: number;
    removeN: number;
    removeR: number;
    readN: number;
    readR: number;
}

/** Drain V8 heap before a timed section. Requires --expose-gc. */
function gcIfAvailable(): void {
    if (typeof (globalThis as any).gc === 'function') (globalThis as any).gc();
}

/** Convert hrtime bigint (nanoseconds) -> milliseconds. */
function ns2ms(ns: bigint): number {
    return Number(ns) / 1_000_000;
}

type SchemaVersion = "trivialSchema" | "evolvedSchema";

function initializeLensedPropertyGraph(baseDoc: Y.Doc, schemaVersion: SchemaVersion): { testLpg: LensedPropertyGraph } {
    const { sc, le } = freshSimpleSchema();
    if (schemaVersion === "evolvedSchema") {
        sc.SMO_renamePropertyKey({
            Idenifying: "Person",
            oldPropertyKey: "firstName",
            newPropertyKey: "givenName",
            whatType: "NodeType"
        });
        sc.SMO_ChangePropertyType({
            Idenifying: "Person",
            propertyKey: "creationDate",
            newPropertyType: "date",
            defaultVal: { default: new Date() },
            whatType: "NodeType"
        });
        le.refreshCache();
    }
    const testLpg = new LensedPropertyGraph({ doc: baseDoc, db: new PropertyGraph(baseDoc), lens: le });
    return { testLpg };
}

const snbPersonProps = {
    firstName: 'John',
    lastName: 'Doe',
    gender: 'male',
    birthday: '1990-01-15',
    creationDate: '2024-06-01T12:00:00.000Z',
    locationIP: '192.168.1.100',
    browserUsed: 'Chrome',
    email: 'john.doe@example.com',
    language: 'en',
    test: 'benchmarkTestValue',
};

const benchCreateN = ({nodes, edges, baseDoc, whatSchema = "trivialSchema"}: { nodes: Record<string, any>[], edges: Record<string, any>[], baseDoc: Y.Doc, whatSchema?: SchemaVersion }): number => {
    const times: number[] = [];
    for (let i = 0; i < 3; i++) {
        const testDoc = cloneDoc(baseDoc);
        testDoc.on('update', (update: Uint8Array) => {}); // Simulate WS sync encoding
        const { testLpg } = initializeLensedPropertyGraph(testDoc, whatSchema);
        const randomId = crypto.randomUUID();
        
        // Pre-warm the registry index cache outside the timed section
        testLpg.getGraphDatabase().getVisibleNodes(testDoc);
        
        gcIfAvailable();
        const start: bigint = process.hrtime.bigint();
        testLpg.addNode({ nodeId: randomId, type: 'Person', props: snbPersonProps });
        const end: bigint = process.hrtime.bigint();
        
        times.push(ns2ms(end - start));
    }
    return median(times);
}

const benchCreateR = ({nodes, edges, baseDoc, whatSchema = "trivialSchema"}: { nodes: Record<string, any>[], edges: Record<string, any>[], baseDoc: Y.Doc, whatSchema?: SchemaVersion }): number => {
    if (nodes.length === 0) return 0;
    const times: number[] = [];
    for (let i = 0; i < 3; i++) {
        const testDoc = cloneDoc(baseDoc);
        testDoc.on('update', (update: Uint8Array) => {}); // Simulate WS sync encoding
        const { testLpg } = initializeLensedPropertyGraph(testDoc, whatSchema);
        const pickRandomNode1 = nodes[Math.floor(Math.random() * nodes.length)];
        const pickRandomNode2 = nodes[Math.floor(Math.random() * nodes.length)];
        
        // Pre-warm the registry index cache outside the timed section
        testLpg.getGraphDatabase().getVisibleEdges(testDoc);
        
        gcIfAvailable();
        const start: bigint = process.hrtime.bigint();
        testLpg.addEdge({ 
            sourceId: String(pickRandomNode1._nodeId), 
            targetId: String(pickRandomNode2._nodeId), 
            type: 'KNOWS', 
            props: { since: 2020 } 
        });
        const end: bigint = process.hrtime.bigint();
        
        times.push(ns2ms(end - start));
    }
    return median(times);
}

const benchUpdateN = ({nodes, edges, baseDoc, whatSchema = "trivialSchema"}: { nodes: Record<string, any>[], edges: Record<string, any>[], baseDoc: Y.Doc, whatSchema?: SchemaVersion }): number => {
    if (nodes.length === 0) return 0;
    const times: number[] = [];
    for (let i = 0; i < 3; i++) {
        const testDoc = cloneDoc(baseDoc);
        testDoc.on('update', (update: Uint8Array) => {}); // Simulate WS sync encoding
        const { testLpg } = initializeLensedPropertyGraph(testDoc, whatSchema);
        const pickRandomNode = nodes[Math.floor(Math.random() * nodes.length)];
        const nodeId = String(pickRandomNode._nodeId);
        
        // Pre-warm the registry index cache outside the timed section
        testLpg.getGraphDatabase().getVisibleNodes(testDoc);
        
        gcIfAvailable();
        const start: bigint = process.hrtime.bigint();
        testLpg.updateNode({ nodeId: nodeId, props: { name: 'Updated Name' } });
        const end: bigint = process.hrtime.bigint();
        
        times.push(ns2ms(end - start));
    }
    return median(times);
}

const benchUpdateR = ({nodes, edges, baseDoc, whatSchema = "trivialSchema"}: { nodes: Record<string, any>[], edges: Record<string, any>[], baseDoc: Y.Doc, whatSchema?: SchemaVersion }): number => {
    if (edges.length === 0) return 0;
    const times: number[] = [];
    for (let i = 0; i < 3; i++) {
        const testDoc = cloneDoc(baseDoc);
        testDoc.on('update', (update: Uint8Array) => {}); // Simulate WS sync encoding
        const { testLpg } = initializeLensedPropertyGraph(testDoc, whatSchema);
        const pickRandomEdge = edges[Math.floor(Math.random() * edges.length)];
        const edgeId = String(pickRandomEdge._edgeId);
        
        // Pre-warm the registry index cache outside the timed section
        testLpg.getGraphDatabase().getVisibleEdges(testDoc);
        
        gcIfAvailable();
        const start: bigint = process.hrtime.bigint();
        testLpg.updateEdge({ edgeId, props: { since: 2021 } });
        const end: bigint = process.hrtime.bigint();
        
        times.push(ns2ms(end - start));
    }
    return median(times);
}

const benchRemoveN = ({nodes, edges, baseDoc, whatSchema = "trivialSchema"}: { nodes: Record<string, any>[], edges: Record<string, any>[], baseDoc: Y.Doc, whatSchema?: SchemaVersion }): number => {
    if (nodes.length === 0) return 0;
    const times: number[] = [];
    for (let i = 0; i < 3; i++) {
        const testDoc = cloneDoc(baseDoc);
        testDoc.on('update', (update: Uint8Array) => {}); // Simulate WS sync encoding
        const { testLpg } = initializeLensedPropertyGraph(testDoc, whatSchema);
        const pickRandomNode = nodes[Math.floor(Math.random() * nodes.length)];
        
        // Pre-warm the registry index cache outside the timed section
        testLpg.getGraphDatabase().getVisibleNodes(testDoc);
        
        gcIfAvailable();
        const start: bigint = process.hrtime.bigint();
        testLpg.deleteNode({ nodeId: String(pickRandomNode._nodeId) });
        const end: bigint = process.hrtime.bigint();
        
        times.push(ns2ms(end - start));
    }
    return median(times);
}

const benchRemoveR = ({nodes, edges, baseDoc, whatSchema = "trivialSchema"}: { nodes: Record<string, any>[], edges: Record<string, any>[], baseDoc: Y.Doc, whatSchema?: SchemaVersion }): number => {
    if (edges.length === 0) return 0;
    const times: number[] = [];
    for (let i = 0; i < 3; i++) {
        const testDoc = cloneDoc(baseDoc);
        testDoc.on('update', (update: Uint8Array) => {}); // Simulate WS sync encoding
        const { testLpg } = initializeLensedPropertyGraph(testDoc, whatSchema);
        const pickRandomEdge = edges[Math.floor(Math.random() * edges.length)];
        const edgeId = String(pickRandomEdge._edgeId);
        
        // Pre-warm the registry index cache outside the timed section
        testLpg.getGraphDatabase().getVisibleEdges(testDoc);
        
        gcIfAvailable();
        const start: bigint = process.hrtime.bigint();
        testLpg.deleteEdge({ edgeId });
        const end: bigint = process.hrtime.bigint();
        
        times.push(ns2ms(end - start));
    }
    return median(times);
}

const benchReadN = ({nodes, edges, baseDoc, whatSchema = "trivialSchema"}: { nodes: Record<string, any>[], edges: Record<string, any>[], baseDoc: Y.Doc, whatSchema?: SchemaVersion }): number => {
    if (nodes.length === 0) return 0;
    const times: number[] = [];
    for (let i = 0; i < 3; i++) {
        const testDoc = cloneDoc(baseDoc);
        testDoc.on('update', (update: Uint8Array) => {}); // Simulate WS sync encoding
        const { testLpg } = initializeLensedPropertyGraph(testDoc, whatSchema);
        const pickRandomNode = nodes[Math.floor(Math.random() * nodes.length)];

        // Pre-warm the registry index cache outside the timed section
        testLpg.getGraphDatabase().getVisibleNodes(testDoc);
        
        gcIfAvailable();
        const start: bigint = process.hrtime.bigint();
        const lensedNode = testLpg.getLensedNode(String(pickRandomNode._nodeId));
        const end: bigint = process.hrtime.bigint();

        times.push(ns2ms(end - start));
    }
    return median(times);
}

const benchReadR = ({nodes, edges, baseDoc, whatSchema = "trivialSchema"}: { nodes: Record<string, any>[], edges: Record<string, any>[], baseDoc: Y.Doc, whatSchema?: SchemaVersion }): number => {
    if (edges.length === 0) return 0;
    const times: number[] = [];
    for (let i = 0; i < 3; i++) {
        const testDoc = cloneDoc(baseDoc);
        testDoc.on('update', (update: Uint8Array) => {}); // Simulate WS sync encoding
        const { testLpg } = initializeLensedPropertyGraph(testDoc, whatSchema);
        const pickRandomEdge = edges[Math.floor(Math.random() * edges.length)];

        // Pre-warm the registry index cache outside the timed section
        testLpg.getGraphDatabase().getVisibleEdges(testDoc);
        
        gcIfAvailable();
        const start: bigint = process.hrtime.bigint();
        const lensedEdge = testLpg.getLensedEdge(String(pickRandomEdge._edgeId));
        const end: bigint = process.hrtime.bigint();

        times.push(ns2ms(end - start));
    }
    return median(times);
}

export function run(whatSchema: SchemaVersion): FullWritePathOverheadResult[] {   
    const limit = 2000;
    const step = 10;
    const benchResults: FullWritePathOverheadResult[] = [];

    const data = readSnbPersonsAndKnows(path.resolve(process.cwd(), SF3_DIR));
    console.log(`[${whatSchema}] Full data persons:`, data.persons.length, "knows edges:", data.knows.length);
    
    const persons = cutNodes(data.persons, limit);
    const knowsEdges = data.knows; // All knows edges, we will filter incrementally

    
    // Pre-index knows edges by Person ID
    const edgesByPerson = new Map<string, any[]>();
    for (const e of knowsEdges) {
        const p1 = String(e.Person1Id);
        const p2 = String(e.Person2Id);
        if (!edgesByPerson.has(p1)) edgesByPerson.set(p1, []);
        if (!edgesByPerson.has(p2)) edgesByPerson.set(p2, []);
        edgesByPerson.get(p1)!.push(e);
        edgesByPerson.get(p2)!.push(e);
    }
    const loadedEdgeKeys = new Set<string>();

    const dbDoc = new Y.Doc();
    const db = new PropertyGraph(dbDoc);

    const loadedPersons: Record<string, any>[] = [];
    const loadedEdges: Record<string, any>[] = [];
    const personIdsLoaded = new Set<string>();

    console.log(`[${whatSchema}] 1 to ${limit} nodes`);

    for (let i = 0; i < limit; i++) {
        const p = persons[i];
        
        const addedNodes = loadPersons([p], dbDoc, db);
        if (addedNodes.length > 0) {
            loadedPersons.push(addedNodes[0]);
            personIdsLoaded.add(String(p.id));
        }

        const personIdStr = String(p.id);
        const candidates = edgesByPerson.get(personIdStr) || [];
        const newEdges = [];
        for (const e of candidates) {
            const other = String(e.Person1Id) === personIdStr ? String(e.Person2Id) : String(e.Person1Id);
            if (personIdsLoaded.has(other)) {
                const edgeKey = `${e.Person1Id}-${e.Person2Id}`;
                if (!loadedEdgeKeys.has(edgeKey)) {
                    loadedEdgeKeys.add(edgeKey);
                    newEdges.push(e);
                }
            }
        }

        if (newEdges.length > 0) {
            const addedEdges = loadEdges(loadedPersons, newEdges, dbDoc, db);
            loadedEdges.push(...addedEdges);
        }

        if ((i + 1) % 50 === 0) {
            console.log(`[${whatSchema}] Progress: ${i + 1}/${limit} nodes loaded, ${loadedEdges.length} edges loaded.`);
        }
  
        if ((i + 1) % step === 0 || i === limit - 1) {
            const tCreateN = benchCreateN({ nodes: loadedPersons, edges: loadedEdges, baseDoc: dbDoc, whatSchema });
            const tCreateR = benchCreateR({ nodes: loadedPersons, edges: loadedEdges, baseDoc: dbDoc, whatSchema });
            const tUpdateN = benchUpdateN({ nodes: loadedPersons, edges: loadedEdges, baseDoc: dbDoc, whatSchema });
            const tUpdateR = benchUpdateR({ nodes: loadedPersons, edges: loadedEdges, baseDoc: dbDoc, whatSchema });
            const tRemoveN = benchRemoveN({ nodes: loadedPersons, edges: loadedEdges, baseDoc: dbDoc, whatSchema });
            const tRemoveR = benchRemoveR({ nodes: loadedPersons, edges: loadedEdges, baseDoc: dbDoc, whatSchema });
            const tReadR = benchReadR({ nodes: loadedPersons, edges: loadedEdges, baseDoc: dbDoc, whatSchema });
            const tReadN = benchReadN({ nodes: loadedPersons, edges: loadedEdges, baseDoc: dbDoc, whatSchema });
            benchResults.push({
                nodes: loadedPersons.length,
                edges: loadedEdges.length,
                schemaVersion: whatSchema,
                createN: tCreateN,
                createR: tCreateR,
                updateN: tUpdateN,
                updateR: tUpdateR,
                removeN: tRemoveN,
                removeR: tRemoveR,
                readN: tReadN,
                readR: tReadR
            });
        }
    }

    return benchResults;
}

if (require.main === module) {
    // 1. Run Trivial Schema
    const v0Results = run("trivialSchema");
    const v0Path = path.join(__dirname, 'results_Fulldensity_v0.json');
    fs.writeFileSync(v0Path, JSON.stringify({ results: v0Results }, null, 2), 'utf-8');
    console.log(`Saved trivial schema results to ${v0Path}`);
    // ONLY RUN 1. OTHER did not really change much
    // // 2. Run Evolved Schema
    // const vnResults = run("evolvedSchema");
    // const vnPath = path.join(__dirname, 'results_Fulldensity_vn.json');
    // fs.writeFileSync(vnPath, JSON.stringify({ results: vnResults }, null, 2), 'utf-8');
    // console.log(`Saved evolved schema results to ${vnPath}`);
}
