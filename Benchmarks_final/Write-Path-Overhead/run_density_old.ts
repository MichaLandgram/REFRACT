import * as fs from 'fs';
import * as path from 'path';
import * as Y from 'yjs';
import * as process from 'process';
import { performance } from 'perf_hooks';

import { loadEdges, SF3_DIR } from '../Helper/benchHelper';
import { cutNodes as padPersons, cloneDoc, median, SF01_DIR } from '../Helper/benchHelper';
import { readSnbPersonsAndKnows } from '../Helper/SnbDataReader';
import { PropertyGraph } from '../../src/GraphDB_CRDT/Old_Problametic_Idea/PropertyGraph_problematic_idea';
import { loadPersons } from '../Helper/benchHelper';

export interface WritePathOverheadResult {
    nodes: number;
    edges: number;
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
const REPS = 3;
const snbPersonProps = {
    firstName: 'Max',
    lastName: 'Mustermann',
    gender: 'male',
    birthday: '4711-08-15',
    creationDate: '2024-06-01T12:00:00.000Z',
    locationIP: '192.168.1.100',
    browserUsed: 'Brave',
    email: 'max.mustermann@example.com',
    language: 'en',
    test: 'benchmarkTestValue',
};

const benchCreateN = (nodes: Record<string, any>[], edges: any[], baseDoc: Y.Doc): number => {
    const times: number[] = [];
    for (let i = 0; i < REPS; i++) {
        const testDoc = cloneDoc(baseDoc);
        testDoc.on('update', (update: Uint8Array) => {}); // Simulate WS sync encoding
        const testPg = new PropertyGraph(testDoc);
        const randomId = crypto.randomUUID();
        
        // Pre-warm the registry index cache outside the timed section
        testPg.getVisibleNodes(testDoc);
        
        gcIfAvailable();
        const start = process.hrtime.bigint();
        testPg.addNode({ doc: testDoc, nodeId: randomId, type: 'Person', props: snbPersonProps });
        const end = process.hrtime.bigint();
        
        times.push(ns2ms(end - start));
    }
    return median(times);
}

const benchCreateR = (nodes: any[], edges: any[], baseDoc: Y.Doc): number => {
    if (nodes.length === 0) return 0;
    const times: number[] = [];
    for (let i = 0; i < REPS; i++) {
        const testDoc = cloneDoc(baseDoc);
        testDoc.on('update', (update: Uint8Array) => {}); // Simulate WS sync encoding
        const testPg = new PropertyGraph(testDoc);
        const pickRandomNode1 = nodes[Math.floor(Math.random() * nodes.length)];
        const pickRandomNode2 = nodes[Math.floor(Math.random() * nodes.length)];
        
        // Pre-warm the registry index cache outside the timed section
        testPg.getVisibleEdges(testDoc);
        
        gcIfAvailable();
        const start = process.hrtime.bigint();
        testPg.addEdge({ 
            doc: testDoc, 
            sourceId: String(pickRandomNode1._nodeId), 
            targetId: String(pickRandomNode2._nodeId), 
            type: 'knows', 
            props: { since: 2020 } 
        });
        const end = process.hrtime.bigint();
        
        times.push(ns2ms(end - start));
    }
    return median(times);
}

const benchUpdateN = (nodes: any[], edges: any[], baseDoc: Y.Doc): number => {
    if (nodes.length === 0) return 0;
    const times: number[] = [];
    for (let i = 0; i < REPS; i++) {
        const testDoc = cloneDoc(baseDoc);
        testDoc.on('update', (update: Uint8Array) => {}); // Simulate WS sync encoding
        const testPg = new PropertyGraph(testDoc);
        const pickRandomNode = nodes[Math.floor(Math.random() * nodes.length)];
        
        // Pre-warm the registry index cache outside the timed section
        testPg.getVisibleNodes(testDoc);
        
        gcIfAvailable();
        const start = process.hrtime.bigint();
        testPg.updateNode({ doc: testDoc, nodeId: String(pickRandomNode._nodeId), props: { name: 'Updated Name' } });
        const end = process.hrtime.bigint();
        
        times.push(ns2ms(end - start));
    }
    return median(times);
}

const benchUpdateR = (nodes: any[], edges: any[], baseDoc: Y.Doc): number => {
    if (edges.length === 0) return 0;
    const times: number[] = [];
    for (let i = 0; i < REPS; i++) {
        const testDoc = cloneDoc(baseDoc);
        testDoc.on('update', (update: Uint8Array) => {}); // Simulate WS sync encoding
        const testPg = new PropertyGraph(testDoc);
        const pickRandomEdge = edges[Math.floor(Math.random() * edges.length)];
        const edgeId = String(pickRandomEdge._edgeId);
        
        // Pre-warm the registry index cache outside the timed section
        testPg.getVisibleEdges(testDoc);
        
        gcIfAvailable();
        const start = process.hrtime.bigint();
        testPg.updateEdge({ doc: testDoc, edgeId, props: { since: 2021 } });
        const end = process.hrtime.bigint();
        
        times.push(ns2ms(end - start));
    }
    return median(times);
}

const benchRemoveN = (nodes: any[], edges: any[], baseDoc: Y.Doc): number => {
    if (nodes.length === 0) return 0;
    const times: number[] = [];
    for (let i = 0; i < REPS; i++) {
        const testDoc = cloneDoc(baseDoc);
        testDoc.on('update', (update: Uint8Array) => {}); // Simulate WS sync encoding
        const testPg = new PropertyGraph(testDoc);
        const pickRandomNode = nodes[Math.floor(Math.random() * nodes.length)];
        
        // Pre-warm the registry index cache outside the timed section
        testPg.getVisibleNodes(testDoc);
        
        gcIfAvailable();
        const start = process.hrtime.bigint();
        testPg.deleteNode({ doc: testDoc, nodeId: String(pickRandomNode._nodeId) });
        const end = process.hrtime.bigint();
        
        times.push(ns2ms(end - start));
    }
    return median(times);
}

const benchRemoveR = (nodes: any[], edges: any[], baseDoc: Y.Doc): number => {
    if (edges.length === 0) return 0;
    const times: number[] = [];
    for (let i = 0; i < REPS; i++) {
        const testDoc = cloneDoc(baseDoc);
        testDoc.on('update', (update: Uint8Array) => {}); // Simulate WS sync encoding
        const testPg = new PropertyGraph(testDoc);
        const pickRandomEdge = edges[Math.floor(Math.random() * edges.length)];
        const edgeId = String(pickRandomEdge._edgeId);
        
        // Pre-warm the registry index cache outside the timed section
        testPg.getVisibleEdges(testDoc);
        
        gcIfAvailable();
        const start = process.hrtime.bigint();
        testPg.deleteEdge({ doc: testDoc, edgeId });
        const end = process.hrtime.bigint();
        
        times.push(ns2ms(end - start));
    }
    return median(times);
}

const benchReadN = (nodes: any[], edges: any[], baseDoc: Y.Doc): number => {
    if (nodes.length === 0) return 0;
    const times: number[] = [];
    for (let i = 0; i < REPS; i++) {
        const testDoc = cloneDoc(baseDoc);
        testDoc.on('update', (update: Uint8Array) => {}); // Simulate WS sync encoding
        const testPg = new PropertyGraph(testDoc);
        const pickRandomNode = nodes[Math.floor(Math.random() * nodes.length)];
        
        // Pre-warm the registry index cache outside the timed section
        testPg.getVisibleNodes(testDoc);
        
        gcIfAvailable();
        const start = process.hrtime.bigint();
        testPg.getRawNode(testDoc, String(pickRandomNode._nodeId));
        const end = process.hrtime.bigint();
        
        times.push(ns2ms(end - start));
    }
    return median(times);
}

const benchReadR = (nodes: any[], edges: any[], baseDoc: Y.Doc): number => {
    if (edges.length === 0) return 0;
    const times: number[] = [];
    for (let i = 0; i < REPS; i++) {
        const testDoc = cloneDoc(baseDoc);
        testDoc.on('update', (update: Uint8Array) => {}); // Simulate WS sync encoding
        const testPg = new PropertyGraph(testDoc);
        const pickRandomEdge = edges[Math.floor(Math.random() * edges.length)];
        const edgeId = String(pickRandomEdge._edgeId);
        
        // Pre-warm the registry index cache outside the timed section
        testPg.getVisibleEdges(testDoc);
        
        gcIfAvailable();
        const start = process.hrtime.bigint();
        testPg.getRawEdgeById(testDoc, edgeId);
        const end = process.hrtime.bigint();
        
        times.push(ns2ms(end - start));
    }
    return median(times);
}

export function run(): WritePathOverheadResult[] {   
    const limit = 1000;
    const step = 10;
    const benchResults: WritePathOverheadResult[] = [];

    const data = readSnbPersonsAndKnows(path.resolve(process.cwd(), SF3_DIR));
    console.log("Full data persons:", data.persons.length, "knows edges:", data.knows.length);
    
    const persons = padPersons(data.persons, limit);
    const knowsEdges = data.knows;

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

    // load 3 nodes first to have some edges to work with :D => Graph looks better
    for (let i = 0; i < 3; i++) {
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
    }
    for (let i = 3; i < limit; i++) {
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
            console.log(`Progress: ${i + 1}/${limit} nodes loaded, ${loadedEdges.length} edges loaded.`);
        }

        if ((i + 1) % step === 0 || i === limit - 1) {
            const tCreateN = benchCreateN(loadedPersons, loadedEdges, dbDoc);
            const tCreateR = benchCreateR(loadedPersons, loadedEdges, dbDoc);
            const tUpdateN = benchUpdateN(loadedPersons, loadedEdges, dbDoc);
            const tUpdateR = benchUpdateR(loadedPersons, loadedEdges, dbDoc);
            const tRemoveN = benchRemoveN(loadedPersons, loadedEdges, dbDoc);
            const tRemoveR = benchRemoveR(loadedPersons, loadedEdges, dbDoc);
            const tReadN = benchReadN(loadedPersons, loadedEdges, dbDoc);
            const tReadR = benchReadR(loadedPersons, loadedEdges, dbDoc);

            benchResults.push({
                nodes: loadedPersons.length,
                edges: loadedEdges.length,
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
    const results = run();
    const outPath = path.join(__dirname, './results/results_density_old.json');
    fs.writeFileSync(outPath, JSON.stringify({ results }, null, 2), 'utf-8');
    console.log(`Saved dense results to ${outPath}`);
}
