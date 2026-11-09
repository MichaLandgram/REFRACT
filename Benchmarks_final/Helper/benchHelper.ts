import * as Y from 'yjs';
import * as path from 'path';
import { PropertyGraph } from '../../src/GraphDB_CRDT/PropertyGraph';
import { Edge } from './interfaces';
import { SchemaLensEngine } from '../../src/LensEngine/SchemaLensEngine';
import { snbFullSchemaDef } from '../../src/Helper/Schema/Snb_Full_Schema';
import { Schema_v1 } from '../../src/Schema_CRDT/SchemaCRDT';

/** Default location of the LDBC SF0.1 initial snapshot (relative to cwd). */
export const SF01_DIR = path.join(
    'snb-output-sf0.1',
    'graphs', 'csv', 'bi', 'composite-merged-fk', 'initial_snapshot',
);

/** LDBC SF3 initial snapshot. */
export const SF3_DIR = path.join(
    'snb-output-sf3',
    'graphs', 'csv', 'bi', 'composite-merged-fk', 'initial_snapshot',
);

/** Drain V8 heap before a timed section. Requires --expose-gc. */
export function gcIfAvailable(): void {
    if (typeof (global as any).gc === 'function') (global as any).gc();
}

export function randomSuffix(): string {
    return Math.random().toString(36).slice(2, 8).toUpperCase();
}

export function freshSimpleSchema(schemaDef: any = snbFullSchemaDef): { sc: Schema_v1; le: SchemaLensEngine } {
    if (!schemaDef) schemaDef = snbFullSchemaDef;
    const sc = new Schema_v1(schemaDef, new Y.Doc());
    return { sc, le: new SchemaLensEngine(sc) };
}

export function cutNodes(base: Record<string, any>[], N: number): Record<string, any>[] {
    if (N <= base.length) return base.slice(0, N);
    const result: Record<string, any>[] = [];
    for (let i = 0; i < N; i++) {
        result.push({ ...base[i % base.length], id: i + 1 });
    }
    return result;
}

// speed up through not loading it always :D
export function cloneDoc(src: Y.Doc): Y.Doc {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(src));
    return doc;
}

export function median(times: number[]): number {
    const s = [...times].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 === 1 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function loadEdges(persons: Record<string, any>[], edges: Record<string, any>[], doc: Y.Doc, db: PropertyGraph, type: string = 'KNOWS'): Record<string, any>[] {
    const lookup = new Map<string, string>(persons.map(p => [String(p.id), String(p._nodeId)]));
    const storedEdges: Record<string, any>[] = [];
    doc.transact(() => {
        edges.forEach(e => {
            const rawSrc = e.src ?? e.sourceId ?? e.Person1Id ?? e['Person.id'];
            const rawTgt = e.tgt ?? e.targetId ?? e.Person2Id ?? e['Person.id.1'];
            const sourceId = lookup.get(String(rawSrc));
            const targetId = lookup.get(String(rawTgt));
            if (!sourceId || !targetId) return;
            
            e._edgeId = (e._edgeId as string | undefined) ?? (e.id ? String(e.id) : undefined) ?? crypto.randomUUID();
            const edgeType = e.type ?? type;

            const props: Record<string, any> = {};
            for (const [key, value] of Object.entries(e)) {
                if (
                    key === 'id' ||
                    key === 'type' ||
                    key === 'src' ||
                    key === 'tgt' ||
                    key === 'sourceId' ||
                    key === 'targetId' ||
                    key === 'Person1Id' ||
                    key === 'Person2Id' ||
                    key === 'Person.id' ||
                    key === 'Person.id.1' ||
                    key.startsWith('_')
                ) {
                    continue;
                }
                props[key] = value;
            }

            try {
                db.addEdge({ doc, edgeId: e._edgeId, type: edgeType,
                             sourceId, targetId,
                             props });
                storedEdges.push(e);
            } catch (err) { console.warn('Failed to add edge:', err); }
        });
    });
    return storedEdges;
}

export function loadPersons(nodes: Record<string, any>[], doc: Y.Doc, db: PropertyGraph, type: string = 'Person'): Record<string, any>[] {
    const storedPersons: Record<string, any>[] = [];
    doc.transact(() => {
        nodes.forEach(n => {
            n._nodeId = (n._nodeId as string | undefined) ?? (n.id ? String(n.id) : undefined) ?? crypto.randomUUID();
            const nodeType = n.type ?? type;

            const props: Record<string, any> = {};
            for (const [key, value] of Object.entries(n)) {
                if (
                    key === 'id' ||
                    key === 'type' ||
                    key.startsWith('_')
                ) {
                    continue;
                }
                props[key] = value;
            }

            try {
                db.addNode({ doc, nodeId: n._nodeId, type: nodeType, props });
                storedPersons.push(n);
            } catch (err) {
                console.warn('Failed to add node:', err);
            }
        });
    });
    return storedPersons;
}

export function unpackMVR(val: any): any {
    if (val && typeof val === 'object' && !Array.isArray(val)) {
        const vals = Object.values(val);
        if (vals.length === 0) return undefined;
        const first = vals[0] as any;
        return (first && typeof first === 'object' && 'value' in first) ? first.value : first;
    }
    return val;
}

/** Convert hrtime bigint (nanoseconds) -> milliseconds (float). */
export function ns2ms(ns: bigint): number { return Number(ns) / 1_000_000; }