import { ns2ms } from '../Helper/benchHelper';
import { snbFullSchemaDef } from '../../src/Helper/Schema/Snb_Full_Schema';
import {
    addProperty     as cambriaAddOp,
    LensSource,
    initLensGraph,
    registerLens,
    lensFromTo,
} from 'cambria';
import * as Automerge from 'automerge';

/** Lens that establishes the Person schema (mu → v1) so that remove/rename/convert ops can be applied on top. */
export const PERSON_BASE_LENS: LensSource = [
    cambriaAddOp({ name: 'firstName',   type: 'string', default: '' }),
    cambriaAddOp({ name: 'lastName',    type: 'string', default: '' }),
    cambriaAddOp({ name: 'gender',      type: 'string', default: '' }),
    cambriaAddOp({ name: 'birthday',    type: 'string', default: '' }),
    cambriaAddOp({ name: 'locationIP',  type: 'string', default: '' }),
    cambriaAddOp({ name: 'browserUsed', type: 'string', default: '' }),
    cambriaAddOp({ name: 'type', type: 'string', default: '' }),
];

export const KNOWS_BASE_LENS: LensSource = [
    cambriaAddOp({ name: 'creationDate', type: 'string', default: '' }),
    cambriaAddOp({ name: 'since',        type: 'string', default: '' }),
    cambriaAddOp({ name: 'sourceNodeLabel', type: 'string', default: '' }),
    cambriaAddOp({ name: 'targetNodeLabel', type: 'string', default: '' }),
    cambriaAddOp({ name: 'type', type: 'string', default: '' }),
];

/** Drain V8 heap before a timed section. Requires --expose-gc. */
export function gcIfAvailable(): void {
    if (typeof (global as any).gc === 'function') (global as any).gc();
}
export function measureREFRACT(sc: any, le: any, smoFn: () => void): { smoMs: number; lensGenMs: number; lazyReadyMs: number } {
    gcIfAvailable();
    const s0 = process.hrtime.bigint();
    smoFn();
    const smoMs = ns2ms(process.hrtime.bigint() - s0);
    gcIfAvailable();
    const g0 = process.hrtime.bigint();
    le.refreshCache();
    const lensGenMs = ns2ms(process.hrtime.bigint() - g0);
    return { smoMs, lensGenMs, lazyReadyMs: smoMs + lensGenMs };
}

export function buildCambriaLens(ops: LensSource, baseLens?: LensSource): LensSource {
    let graph = initLensGraph();
    if (baseLens) {
        graph = registerLens(graph, 'mu', 'v1', baseLens);
        graph = registerLens(graph, 'v1', 'v2', ops);
        return lensFromTo(graph, 'v1', 'v2');
    }
    graph = registerLens(graph, 'mu', 'v1', ops);
    return lensFromTo(graph, 'mu', 'v1');
}

function propsToBaseLens(properties: Record<string, string>): LensSource {
    return Object.entries(properties).map(([key, valType]) => {
        const cambriaType = valType === 'number' ? 'number' : 'string';
        const defaultVal  = valType === 'number' ? 0 : '';
        return cambriaAddOp({ name: key, type: cambriaType, default: defaultVal });
    });
}

const baseGraphCache = new WeakMap<object, { nodeGraphs: { graph: any; from: string; to: string }[]; edgeGraphs: { graph: any; from: string; to: string }[] }>();

function getPrebuiltGraphs(schemaDef: any) {
    if (!schemaDef || typeof schemaDef !== 'object') {
        schemaDef = snbFullSchemaDef;
    }
    let cached = baseGraphCache.get(schemaDef);
    if (!cached) {
        const nodeGraphs: { graph: any; from: string; to: string }[] = [];
        const edgeGraphs: { graph: any; from: string; to: string }[] = [];
        const nodes = schemaDef.nodes || [];
        const edges = schemaDef.relationships || [];
        for (let i = 0; i < nodes.length; i++) {
            let g = initLensGraph();
            const typeLens = propsToBaseLens(nodes[i].properties || {});
            g = registerLens(g, 'mu', 'v1', typeLens);
            nodeGraphs.push({ graph: g, from: 'mu', to: 'v1' });
        }
        for (let i = 0; i < edges.length; i++) {
            let g = initLensGraph();
            const typeLens = propsToBaseLens(edges[i].properties || {});
            g = registerLens(g, 'mu', 'v1', typeLens);
            edgeGraphs.push({ graph: g, from: 'mu', to: 'v1' });
        }
        cached = { nodeGraphs, edgeGraphs };
        baseGraphCache.set(schemaDef, cached);
    }
    return cached;
}

export function cambriaSMO(lensSpec: LensSource, baseLens?: LensSource, schemaDef: any = snbFullSchemaDef): { cambriaSmoMs: number; cambriaReadyMs: number } {
    const base = Automerge.init<{ lens: any[] }>();
    const { nodeGraphs, edgeGraphs } = getPrebuiltGraphs(schemaDef);

    gcIfAvailable();
    const sw0 = process.hrtime.bigint();
    const doc  = Automerge.change(base, 'smo', d => { d.lens = lensSpec; });

    let smoGraph = initLensGraph();
    if (baseLens) {
        smoGraph = registerLens(smoGraph, 'mu', 'v1', baseLens);
        smoGraph = registerLens(smoGraph, 'v1', 'v2', lensSpec);
        lensFromTo(smoGraph, 'v1', 'v2');
    } else {
        smoGraph = registerLens(smoGraph, 'mu', 'v1', lensSpec);
        lensFromTo(smoGraph, 'mu', 'v1');
    }

    for (const ng of nodeGraphs) lensFromTo(ng.graph, ng.from, ng.to);
    for (const eg of edgeGraphs) lensFromTo(eg.graph, eg.from, eg.to);

    const cambriaSmoMs = ns2ms(process.hrtime.bigint() - sw0);
    gcIfAvailable();
    const rb0 = process.hrtime.bigint();
    // JSON.parse(JSON.stringify(doc.lens));
    const cambriaReadyMs = cambriaSmoMs + ns2ms(process.hrtime.bigint() - rb0);

    return { cambriaSmoMs, cambriaReadyMs };
}
