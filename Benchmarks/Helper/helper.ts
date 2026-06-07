import * as fs from 'fs';
import * as path from 'path';
import * as Y from 'yjs';
import { snbFullSchemaDef } from '../../src/Helper/Schema/Snb_Full_Schema';
import { Schema_v1 } from '../../src/Schema_CRDT/SchemaCRDT';
import { SchemaLensEngine } from '../../src/LensEngine/SchemaLensEngine';


/** Extend real LDBC data to N by cycling rows with unique IDs.
 * NOT IN USE ANYMORE - currently use to clip to N instead, which is faster and more realistic.
 */
function padPersons(base: Record<string, any>[], N: number): Record<string, any>[] {
    if (N <= base.length) return base.slice(0, N);
    const result: Record<string, any>[] = [];
    for (let i = 0; i < N; i++) {
        result.push({ ...base[i % base.length], id: i + 1 });
    }
    return result;
}
function freshSchema(): { sc: Schema_v1; le: SchemaLensEngine } {
    const sc = new Schema_v1(snbFullSchemaDef, new Y.Doc());
    return { sc, le: new SchemaLensEngine(sc) };
}
// speed up through not loading it always :D
function cloneDoc(src: Y.Doc): Y.Doc {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(src));
    return doc;
}
function unpackMVR(val: any): any {
    if (val && typeof val === 'object' && !Array.isArray(val)) {
        const vals = Object.values(val);
        if (vals.length === 0) return undefined;
        const first = vals[0] as any;
        return (first && typeof first === 'object' && 'value' in first) ? first.value : first;
    }
    return val;
}
function median(times: number[]): number {
    const s = [...times].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 === 1 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export { freshSchema, cloneDoc, unpackMVR, padPersons, median };

