import * as Y from 'yjs';
import { DualKeyMap } from '../../src/GraphDB_CRDT/DualKeyMap';
import { unpackMVR } from './helper';
import { EagerEdge } from './resultInterfaces';

function nodeMap(n: Record<string, any>, doc: Y.Doc): Y.Map<any> {
    if (!n._nodeId) throw new Error(
        `eager migration: node missing _nodeId`
    );
    return doc.getMap(`pg_n_${n._nodeId}`);
}

function isType(nm: Y.Map<any>, targetType: string): boolean {
    return nm.get('__type') === targetType;
}

function edgeMap(e: EagerEdge, doc: Y.Doc): Y.Map<any> {
    return doc.getMap(`pg_e_${e._edgeId}`);
}

function isEdgeType(em: Y.Map<any>, targetType?: string): boolean {
    return targetType === undefined || em.get('__type') === targetType;
}

export function eagerRenamePropertyKey(nodes: Record<string, any>[], doc: Y.Doc, oldKey: string, newKey: string, targetType: string): void {
    doc.transact(() => {
        nodes.forEach(n => {
            const nm = nodeMap(n, doc);
            if (!isType(nm, targetType)) return;
            const dkm = new DualKeyMap(nm);
            const raw = unpackMVR(dkm.get(oldKey));
            if (raw !== undefined && raw !== null) {
                dkm.delete(oldKey);
                dkm.setInitial(newKey, raw);
            }
        });
    });
}

export function eagerRetype(nodes: Record<string, any>[], doc: Y.Doc, propKey: string, converter: (s: string) => number, targetType: string): void {
    doc.transact(() => {
        nodes.forEach(n => {
            const nm = nodeMap(n, doc);
            if (!isType(nm, targetType)) return;
            const dkm = new DualKeyMap(nm);
            const raw = unpackMVR(dkm.get(propKey));
            if (raw !== undefined && raw !== null) {
                dkm.delete(propKey);
                dkm.setInitial(propKey, converter(String(raw)));
            }
        });
    });
}

export function eagerAddProp(nodes: Record<string, any>[], doc: Y.Doc, propKey: string, defaultVal: any, targetType: string): void {
    doc.transact(() => {
        nodes.forEach(n => {
            const nm = nodeMap(n, doc);
            if (!isType(nm, targetType)) return;
            new DualKeyMap(nm).setInitial(propKey, defaultVal);
        });
    });
}

export function eagerDropProp(nodes: Record<string, any>[], doc: Y.Doc, propKey: string, targetType: string): void {
    doc.transact(() => {
        nodes.forEach(n => {
            const nm = nodeMap(n, doc);
            if (!isType(nm, targetType)) return;
            new DualKeyMap(nm).delete(propKey);
        });
    });
}

export function eagerLabelSet(nodes: Record<string, any>[], doc: Y.Doc, labelName: string, targetType: string ): void {
    doc.transact(() => {
        nodes.forEach(n => {
            const nm = nodeMap(n, doc);
            if (!isType(nm, targetType)) return;
            // DB does not support labels, therefore we simulate it.
            nm.set(`__label_${labelName}`, labelName);
        });
    });
}

export function eagerLabelDrop(nodes: Record<string, any>[], doc: Y.Doc, labelName: string, targetType: string): void {
    doc.transact(() => {
        nodes.forEach(n => {
            const nm = nodeMap(n, doc);
            if (!isType(nm, targetType)) return;
            nm.delete(`__label_${labelName}`);
        });
    });
}

export function eagerLabelRename(nodes: Record<string, any>[], doc: Y.Doc, oldLabel: string, newLabel: string, edges?: EagerEdge[]): void {
    doc.transact(() => {
        nodes.forEach(n => {
            const nm = nodeMap(n, doc);
            if (nm.has(`__label_${oldLabel}`)) {
                nm.set(`__label_${newLabel}`, newLabel);
                nm.delete(`__label_${oldLabel}`);
            }
        });

        if (edges) {
            edges.forEach(e => {
                const em = edgeMap(e, doc);
                if (em.has(`__label_${oldLabel}`)) {
                    em.set(`__label_${newLabel}`, newLabel);
                    em.delete(`__label_${oldLabel}`);
                }
            });
        }
    });
}

export function eagerSplit(nodes: Record<string, any>[], doc: Y.Doc, legacyType: string, mapping: Record<string, string>, splitProperty: string, defaultType: string): void {
    doc.transact(() => {
        nodes.forEach(n => {
            const nm = nodeMap(n, doc);
            if (nm.get('__type') !== legacyType) return;
            // Read discriminator property this is the real per-node cost of a split (simulated)
            const dkm = new DualKeyMap(nm);
            const discriminatorValue = String(unpackMVR(dkm.get(splitProperty)) ?? '');
            const newType = mapping[discriminatorValue] ?? defaultType;

            nm.set('__type', newType);
        });
    });
}

export function eagerUnion( nodes: Record<string, any>[], doc: Y.Doc, oldTypes: string[], newType: string): void {
    doc.transact(() => {
        nodes.forEach(n => {
            const nm = nodeMap(n, doc);
            if (oldTypes.includes(nm.get('__type'))) nm.set('__type', newType);
        });
    });
}

export const GENDER_MAP: Record<string, number> = { male: 1, female: 2 };


export function eagerDeleteNodes(nodes: Record<string, any>[], doc: Y.Doc): void {
    doc.transact(() => {
        nodes.forEach(n => {
            if (!n._nodeId) return;
            doc.getMap(`pg_n_${n._nodeId}`).clear();
        });
    });
}


export function eagerDeleteEdges( edges: EagerEdge[], doc: Y.Doc, targetType?: string ): void {
    doc.transact(() => {
        edges.forEach(e => {
            const em = edgeMap(e, doc);
            if (!isEdgeType(em, targetType)) return;
            em.clear();
        });
    });
}

export function eagerEdgeLabelSet( edges: EagerEdge[], doc: Y.Doc, labelName: string, targetType?: string): void {
    doc.transact(() => {
        edges.forEach(e => {
            const em = edgeMap(e, doc);
            if (!isEdgeType(em, targetType)) return;
            em.set(`__label_${labelName}`, labelName);
        });
    });
}

export function eagerEdgeLabelRename(edges: EagerEdge[], doc: Y.Doc, oldLabel: string, newLabel: string, targetType?: string): void {
    doc.transact(() => {
        edges.forEach(e => {
            const em = edgeMap(e, doc);
            if (!isEdgeType(em, targetType)) return;
            if (em.has(`__label_${oldLabel}`)) {
                em.set(`__label_${newLabel}`, newLabel);
                em.delete(`__label_${oldLabel}`);
            }
        });
    });
}

export function eagerEdgeLabelDrop( edges: EagerEdge[], doc: Y.Doc, labelName: string, targetType?: string ): void {
    doc.transact(() => {
        edges.forEach(e => {
            const em = edgeMap(e, doc);
            if (!isEdgeType(em, targetType)) return;

            const sourceId = em.get('__sourceId');
            const targetId = em.get('__targetId');

            let shouldDrop = false;

            if (sourceId) {
                const sNodeMap = doc.getMap(`pg_n_${sourceId}`);
                if (sNodeMap && sNodeMap.has(`__label_${labelName}`)) {
                    shouldDrop = true;
                }
            }

            if (targetId && !shouldDrop) {
                const tNodeMap = doc.getMap(`pg_n_${targetId}`);
                if (tNodeMap && tNodeMap.has(`__label_${labelName}`)) {
                    shouldDrop = true;
                }
            }

            if (shouldDrop) {
                em.clear();
            }
        });
    });
}

export function eagerAddPropToEdge( edges: EagerEdge[], doc: Y.Doc, propKey: string, defaultVal: any, targetType?: string): void {
    doc.transact(() => {
        edges.forEach(e => {
            const em = edgeMap(e, doc);
            if (!isEdgeType(em, targetType)) return;
            new DualKeyMap(em).setInitial(propKey, defaultVal);
        });
    });
}

export function eagerDropPropFromEdge( edges: EagerEdge[], doc: Y.Doc, propKey: string, targetType?: string): void {
    doc.transact(() => {
        edges.forEach(e => {
            const em = edgeMap(e, doc);
            if (!isEdgeType(em, targetType)) return;
            new DualKeyMap(em).delete(propKey);
        });
    });
}

export function eagerSplitEdges(edges: EagerEdge[], doc: Y.Doc, oldType: string, newType: string): void {
    doc.transact(() => {
        edges.forEach(e => {
            const em = edgeMap(e, doc);
            if (em.get('__type') === oldType) em.set('__type', newType);
        });
    });
}

export function eagerUnionEdges(edges: EagerEdge[], doc: Y.Doc, oldTypes: string[], newType: string): void {
    doc.transact(() => {
        edges.forEach(e => {
            const em = edgeMap(e, doc);
            if (oldTypes.includes(em.get('__type'))) em.set('__type', newType);
        });
    });
}

