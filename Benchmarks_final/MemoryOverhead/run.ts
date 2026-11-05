import * as fs from 'fs';
import * as path from 'path';
import * as Y from 'yjs';

import { PropertyGraph } from '../../src/GraphDB_CRDT/PropertyGraph';
import { LensedPropertyGraph } from '../../src/LensEngine/LensedPropertyGraph';
import { SchemaLensEngine } from '../../src/LensEngine/SchemaLensEngine';
import { Schema_v1 } from '../../src/Schema_CRDT/SchemaCRDT';
import { snbFullSchemaDef } from '../../src/Helper/Schema/Snb_Full_Schema';
import { readSnbPersonsAndKnows, filterKnowsEdges } from '../Helper/SnbDataReader';
import {
    cutNodes,
    median,
    gcIfAvailable,
    SF3_DIR,
} from '../Helper/benchHelper';
import { generateSchema } from '../../src/Helper/Schema/SchemaGenerator';

//  Shared result shape 
export interface MemoryResult {
    scalingDimension:      'data' | 'schema';
    N:                     number;
    E:                     number;
    schemaSize:            number;   // number of type definitions
    yjsBytes_graphOnly:    number;
    yjsBytes_full:         number;
    yjsBytes_overhead:     number;
    yjsBytes_overheadPct:  number;
}

//  Helpers 

function measureYjsDocSize(doc: Y.Doc): number {
    return Y.encodeStateAsUpdate(doc).byteLength;
}

function toKB(bytes: number): string { return (bytes / 1024).toFixed(1); }
function toMB(bytes: number): string { return (bytes / (1024 * 1024)).toFixed(2); }

/** Shared inline loader — identical data loading for both paths. */
function loadInline(
    doc: Y.Doc,
    db: PropertyGraph,
    persons: Record<string, any>[],
    edges: Record<string, any>[],
): void {
    doc.transact(() => {
        persons.forEach(p => {
            const nodeId = String(p.id);
            const props: Record<string, any> = {};
            for (const [key, value] of Object.entries(p)) {
                if (key === 'id' || key === 'type' || key.startsWith('_')) continue;
                props[key] = value;
            }
            try { db.addNode({ doc, nodeId, type: p.type ?? 'Person', props }); } catch {}
        });
    });

    const lookup = new Set<string>(persons.map(p => String(p.id)));
    doc.transact(() => {
        edges.forEach(e => {
            const sourceId = String(e.Person1Id ?? e.src);
            const targetId = String(e.Person2Id ?? e.tgt);
            if (!lookup.has(sourceId) || !lookup.has(targetId)) return;
            const props: Record<string, any> = {};
            for (const [key, value] of Object.entries(e)) {
                if (key === 'id' || key === 'type' || key === 'src' || key === 'tgt' ||
                    key === 'sourceId' || key === 'targetId' ||
                    key === 'Person1Id' || key === 'Person2Id' ||
                    key.startsWith('_')) continue;
                props[key] = value;
            }
            try { db.addEdge({ doc, sourceId, targetId, type: 'KNOWS', props }); } catch {}
        });
    });
}

/** GraphOnly: PropertyGraph only, no schema/lens. */
function measureGraphOnly(
    persons: Record<string, any>[],
    edges: Record<string, any>[],
): number {
    const doc = new Y.Doc();
    const db = new PropertyGraph(doc);
    loadInline(doc, db, persons, edges);
    return measureYjsDocSize(doc);
}

/** Full REFRACT: PropertyGraph + Schema + LensEngine. */
function measureFull(
    persons: Record<string, any>[],
    edges: Record<string, any>[],
    schemaDef?: any,
): number {
    const doc = new Y.Doc();
    const sc = new Schema_v1(schemaDef ?? snbFullSchemaDef, doc);
    const le = new SchemaLensEngine(sc);
    const db = new PropertyGraph(doc);
    // LensedPropertyGraph is created but data is loaded via db directly
    // to ensure identical byte-for-byte data as graphOnly
    const lpg = new LensedPropertyGraph({ doc, db, lens: le });
    loadInline(doc, db, persons, edges);
    return measureYjsDocSize(doc);
}

//  1. Data Scaling (fixed LDBC schema, varying N) 

export function runDataScaling(): MemoryResult[] {
    const scales = [100, 250, 500, 1000, 2500, 5000, 10000];
    const REPS = 3;
    const results: MemoryResult[] = [];

    // LDBC SNB schema = 8 types (used via freshSimpleSchema default)
    const LDBC_SCHEMA_SIZE = 8;

    const data = readSnbPersonsAndKnows(path.resolve(process.cwd(), SF3_DIR));
    console.log(`[DataScaling] Loaded ${data.persons.length} persons, ${data.knows.length} edges from SF3`);
    console.log(`  Fixed schema: LDBC SNB (${LDBC_SCHEMA_SIZE} types)\n`);

    for (const N of scales) {
        const persons = cutNodes(data.persons, N);
        const personIds = new Set(persons.map(p => String(p.id)));
        const edges = filterKnowsEdges(data.knows, personIds);

        const yjsGraphOnly: number[] = [];
        const yjsFull:       number[] = [];

        for (let rep = 0; rep < REPS; rep++) {
            gcIfAvailable();
            yjsGraphOnly.push(measureGraphOnly(persons, edges));

            gcIfAvailable();
            yjsFull.push(measureFull(persons, edges));
        }

        const medG = median(yjsGraphOnly);
        const medF = median(yjsFull);

        const result: MemoryResult = {
            scalingDimension: 'data',
            N: persons.length,
            E: edges.length,
            schemaSize: LDBC_SCHEMA_SIZE,
            yjsBytes_graphOnly:   medG,
            yjsBytes_full:        medF,
            yjsBytes_overhead:    medF - medG,
            yjsBytes_overheadPct: medG > 0 ? ((medF - medG) / medG) * 100 : 0,
        };
        results.push(result);

        console.log(
            `  N=${String(result.N).padStart(6)}  E=${String(result.E).padStart(6)}` +
            `  graphOnly=${toKB(result.yjsBytes_graphOnly).padStart(9)} KB` +
            `  full=${toKB(result.yjsBytes_full).padStart(9)} KB` +
            `  overhead=${toKB(result.yjsBytes_overhead).padStart(8)} KB (${result.yjsBytes_overheadPct.toFixed(1)}%)`
        );

        const outPath = path.join(__dirname, 'results', 'memory_data_scaling.json');
        fs.writeFileSync(outPath, JSON.stringify({ results }, null, 2));
    }

    return results;
}

//  2. Schema Scaling (fixed N=1000, varying schema size) 

export function runSchemaScaling(): MemoryResult[] {
    const schemaScales = [100, 250, 500, 1000, 2500, 5000, 10000];
    const nodeCount = 1000;
    const REPS = 3;
    const results: MemoryResult[] = [];

    const data = readSnbPersonsAndKnows(path.resolve(process.cwd(), SF3_DIR));
    const persons = cutNodes(data.persons, nodeCount);
    const personIds = new Set(persons.map(p => String(p.id)));
    const edges = filterKnowsEdges(data.knows, personIds);
    console.log(`[SchemaScaling] Fixed N=${persons.length}, E=${edges.length}\n`);

    for (const schemaSize of schemaScales) {
        const schemaDef = generateSchema(schemaSize);

        const yjsGraphOnly: number[] = [];
        const yjsFull:       number[] = [];

        for (let rep = 0; rep < REPS; rep++) {
            // GraphOnly is always the same (no schema), but we re-measure for consistency
            gcIfAvailable();
            yjsGraphOnly.push(measureGraphOnly(persons, edges));

            gcIfAvailable();
            yjsFull.push(measureFull(persons, edges, schemaDef));
        }

        const medG = median(yjsGraphOnly);
        const medF = median(yjsFull);

        const result: MemoryResult = {
            scalingDimension: 'schema',
            N: persons.length,
            E: edges.length,
            schemaSize,
            yjsBytes_graphOnly:   medG,
            yjsBytes_full:        medF,
            yjsBytes_overhead:    medF - medG,
            yjsBytes_overheadPct: medG > 0 ? ((medF - medG) / medG) * 100 : 0,
        };
        results.push(result);

        console.log(
            `  types=${String(schemaSize).padStart(6)}` +
            `  graphOnly=${toKB(result.yjsBytes_graphOnly).padStart(9)} KB` +
            `  full=${toKB(result.yjsBytes_full).padStart(9)} KB` +
            `  overhead=${toKB(result.yjsBytes_overhead).padStart(8)} KB (${result.yjsBytes_overheadPct.toFixed(1)}%)`
        );

        const outPath = path.join(__dirname, 'results', 'memory_schema_scaling.json');
        fs.writeFileSync(outPath, JSON.stringify({ results }, null, 2));
    }

    return results;
}

//  Main 

if (require.main === module) {
    console.log('═══ 1. Data Scaling (fixed LDBC schema, varying N) ═══');
    runDataScaling();

    console.log('\n═══ 2. Schema Scaling (fixed N=1000, varying schema size) ═══');
    runSchemaScaling();
}
