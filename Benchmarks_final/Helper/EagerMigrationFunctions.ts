import * as Y from 'yjs';
import { ScopedDualKeyMap } from '../../src/GraphDB_CRDT/ScopedDualKeyMap';
import { EntityKeyIndex } from '../../src/GraphDB_CRDT/EntityKeyIndex';
import { unpackMVR } from './benchHelper';

type Edge = Record<string, any>;

export type EagerEdge = { _edgeId: string; [k: string]: any };

function nodeDataMap(doc: Y.Doc): Y.Map<any> {
    return doc.getMap('pg_node_data');
}

function edgeDataMap(doc: Y.Doc): Y.Map<any> {
    return doc.getMap('pg_edge_data');
}

/** WeakMap-based cache so we don't rebuild EntityKeyIndex for every call. */
const _nodeKeyIndexCache = new WeakMap<Y.Doc, EntityKeyIndex>();
const _edgeKeyIndexCache = new WeakMap<Y.Doc, EntityKeyIndex>();

function nodeKeyIndex(doc: Y.Doc): EntityKeyIndex {
    let idx = _nodeKeyIndexCache.get(doc);
    if (!idx) {
        idx = new EntityKeyIndex(nodeDataMap(doc));
        _nodeKeyIndexCache.set(doc, idx);
    }
    return idx;
}

function edgeKeyIndex(doc: Y.Doc): EntityKeyIndex {
    let idx = _edgeKeyIndexCache.get(doc);
    if (!idx) {
        idx = new EntityKeyIndex(edgeDataMap(doc));
        _edgeKeyIndexCache.set(doc, idx);
    }
    return idx;
}

function nodeDKM(doc: Y.Doc, nodeId: string): ScopedDualKeyMap {
    return new ScopedDualKeyMap(nodeDataMap(doc), nodeId, nodeKeyIndex(doc));
}

function edgeDKM(doc: Y.Doc, edgeId: string): ScopedDualKeyMap {
    return new ScopedDualKeyMap(edgeDataMap(doc), edgeId, edgeKeyIndex(doc));
}

function getNodeType(doc: Y.Doc, nodeId: string): string | undefined {
    return nodeKeyIndex(doc).getEntityType(nodeId);
}

function getEdgeType(doc: Y.Doc, edgeId: string): string | undefined {
    return edgeKeyIndex(doc).getEntityType(edgeId);
}

function isType(doc: Y.Doc, nodeId: string, targetType: string): boolean {
    return getNodeType(doc, nodeId) === targetType;
}

function isEdgeType(doc: Y.Doc, edgeId: string, targetType?: string): boolean {
    return targetType === undefined || getEdgeType(doc, edgeId) === targetType;
}

function getNodeId(n: Record<string, any>): string {
    if (!n._nodeId) throw new Error('eager migration: node missing _nodeId');
    return n._nodeId;
}

export function eagerRenamePropertyKey(nodes: Record<string, any>[], doc: Y.Doc, oldKey: string, newKey: string, targetType: string): void {
    doc.transact(() => {
        nodes.forEach(n => {
            const nodeId = getNodeId(n);
            if (!isType(doc, nodeId, targetType)) return;
            const dkm = nodeDKM(doc, nodeId);
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
            const nodeId = getNodeId(n);
            if (!isType(doc, nodeId, targetType)) return;
            const dkm = nodeDKM(doc, nodeId);
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
            const nodeId = getNodeId(n);
            if (!isType(doc, nodeId, targetType)) return;
            nodeDKM(doc, nodeId).setInitial(propKey, defaultVal);
        });
    });
}

export function eagerDropProp(nodes: Record<string, any>[], doc: Y.Doc, propKey: string, targetType: string): void {
    doc.transact(() => {
        nodes.forEach(n => {
            const nodeId = getNodeId(n);
            if (!isType(doc, nodeId, targetType)) return;
            nodeDKM(doc, nodeId).delete(propKey);
        });
    });
}

export function eagerLabelSet(nodes: Record<string, any>[], doc: Y.Doc, labelName: string, targetType: string): void {
    const nd = nodeDataMap(doc);
    doc.transact(() => {
        nodes.forEach(n => {
            const nodeId = getNodeId(n);
            if (!isType(doc, nodeId, targetType)) return;
            nd.set(`${nodeId}:__label_${labelName}`, labelName);
        });
    });
}

export function eagerLabelDrop(nodes: Record<string, any>[], doc: Y.Doc, labelName: string, targetType: string): void {
    const nd = nodeDataMap(doc);
    doc.transact(() => {
        nodes.forEach(n => {
            const nodeId = getNodeId(n);
            if (!isType(doc, nodeId, targetType)) return;
            nd.delete(`${nodeId}:__label_${labelName}`);
        });
    });
}

export function eagerLabelRename(nodes: Record<string, any>[], doc: Y.Doc, oldLabel: string, newLabel: string, edges?: Edge[]): void {
    const nd = nodeDataMap(doc);
    const ed = edgeDataMap(doc);
    doc.transact(() => {
        nodes.forEach(n => {
            const nodeId = getNodeId(n);
            const oldKey = `${nodeId}:__label_${oldLabel}`;
            if (nd.has(oldKey)) {
                nd.set(`${nodeId}:__label_${newLabel}`, newLabel);
                nd.delete(oldKey);
            }
        });

        if (edges) {
            edges.forEach(e => {
                const edgeId = e._edgeId;
                const oldKey = `${edgeId}:__label_${oldLabel}`;
                if (ed.has(oldKey)) {
                    ed.set(`${edgeId}:__label_${newLabel}`, newLabel);
                    ed.delete(oldKey);
                }
            });
        }
    });
}

export function eagerSplit(nodes: Record<string, any>[], doc: Y.Doc, legacyType: string, mapping: Record<string, string>, splitProperty: string, defaultType: string): void {
    const nd = nodeDataMap(doc);
    doc.transact(() => {
        nodes.forEach(n => {
            const nodeId = getNodeId(n);
            if (getNodeType(doc, nodeId) !== legacyType) return;
            const dkm = nodeDKM(doc, nodeId);
            const discriminatorValue = String(unpackMVR(dkm.get(splitProperty)) ?? '');
            const newType = mapping[discriminatorValue] ?? defaultType;
            nd.set(`${nodeId}:__type`, newType);
        });
    });
}

export function eagerUnion(nodes: Record<string, any>[], doc: Y.Doc, oldTypes: string[], newType: string): void {
    const nd = nodeDataMap(doc);
    doc.transact(() => {
        nodes.forEach(n => {
            const nodeId = getNodeId(n);
            const curType = getNodeType(doc, nodeId);
            if (curType && oldTypes.includes(curType)) {
                nd.set(`${nodeId}:__type`, newType);
            }
        });
    });
}

export const GENDER_MAP: Record<string, number> = { male: 1, female: 2 };

export function eagerDeleteNodes(nodes: Record<string, any>[], doc: Y.Doc): void {
    const nd = nodeDataMap(doc);
    const ki = nodeKeyIndex(doc);
    doc.transact(() => {
        nodes.forEach(n => {
            if (!n._nodeId) return;
            const nodeId = n._nodeId;
            const keys = ki.getKeysForEntity(nodeId);
            for (const key of keys) {
                nd.delete(key);
            }
        });
    });
}

export function eagerDeleteEdges(edges: Edge[], doc: Y.Doc, targetType?: string): void {
    const ed = edgeDataMap(doc);
    const ki = edgeKeyIndex(doc);
    doc.transact(() => {
        edges.forEach(e => {
            const edgeId = e._edgeId;
            if (!isEdgeType(doc, edgeId, targetType)) return;
            const keys = ki.getKeysForEntity(edgeId);
            for (const key of keys) {
                ed.delete(key);
            }
        });
    });
}


export function eagerEdgeLabelSet(edges: Edge[], doc: Y.Doc, labelName: string, targetType?: string): void {
    const ed = edgeDataMap(doc);
    doc.transact(() => {
        edges.forEach(e => {
            const edgeId = e._edgeId;
            if (!isEdgeType(doc, edgeId, targetType)) return;
            ed.set(`${edgeId}:__label_${labelName}`, labelName);
        });
    });
}

export function eagerEdgeLabelRename(edges: Edge[], doc: Y.Doc, oldLabel: string, newLabel: string, targetType?: string): void {
    const ed = edgeDataMap(doc);
    doc.transact(() => {
        edges.forEach(e => {
            const edgeId = e._edgeId;
            if (!isEdgeType(doc, edgeId, targetType)) return;
            const oldKey = `${edgeId}:__label_${oldLabel}`;
            if (ed.has(oldKey)) {
                ed.set(`${edgeId}:__label_${newLabel}`, newLabel);
                ed.delete(oldKey);
            }
        });
    });
}

export function eagerEdgeLabelDrop(edges: Edge[], doc: Y.Doc, labelName: string, targetType?: string): void {
    const ed = edgeDataMap(doc);
    const nd = nodeDataMap(doc);
    doc.transact(() => {
        edges.forEach(e => {
            const edgeId = e._edgeId;
            if (!isEdgeType(doc, edgeId, targetType)) return;

            const sourceId = ed.get(`${edgeId}:__sourceId`);
            const targetId = ed.get(`${edgeId}:__targetId`);

            let shouldDrop = false;

            if (sourceId && nd.has(`${sourceId}:__label_${labelName}`)) {
                shouldDrop = true;
            }
            if (targetId && !shouldDrop && nd.has(`${targetId}:__label_${labelName}`)) {
                shouldDrop = true;
            }

            if (shouldDrop) {
                const ki = edgeKeyIndex(doc);
                const keys = ki.getKeysForEntity(edgeId);
                for (const key of keys) {
                    ed.delete(key);
                }
            }
        });
    });
}

export function eagerAddPropToEdge(edges: Edge[], doc: Y.Doc, propKey: string, defaultVal: any, targetType?: string): void {
    doc.transact(() => {
        edges.forEach(e => {
            const edgeId = e._edgeId;
            if (!isEdgeType(doc, edgeId, targetType)) return;
            edgeDKM(doc, edgeId).setInitial(propKey, defaultVal);
        });
    });
}

export function eagerDropPropFromEdge(edges: Edge[], doc: Y.Doc, propKey: string, targetType?: string): void {
    doc.transact(() => {
        edges.forEach(e => {
            const edgeId = e._edgeId;
            if (!isEdgeType(doc, edgeId, targetType)) return;
            edgeDKM(doc, edgeId).delete(propKey);
        });
    });
}

export function eagerSplitEdges(edges: Edge[], doc: Y.Doc, oldType: string, newType: string): void {
    const ed = edgeDataMap(doc);
    doc.transact(() => {
        edges.forEach(e => {
            const edgeId = e._edgeId;
            if (getEdgeType(doc, edgeId) === oldType) {
                ed.set(`${edgeId}:__type`, newType);
            }
        });
    });
}

export function eagerUnionEdges(edges: Edge[], doc: Y.Doc, oldTypes: string[], newType: string): void {
    const ed = edgeDataMap(doc);
    doc.transact(() => {
        edges.forEach(e => {
            const edgeId = e._edgeId;
            const curType = getEdgeType(doc, edgeId);
            if (curType && oldTypes.includes(curType)) {
                ed.set(`${edgeId}:__type`, newType);
            }
        });
    });
}

export function eagerSplitLabel(nodes: Record<string, any>[], doc: Y.Doc, oldLabel: string, newLabel1: string, newLabel2: string, edges?: Edge[]): void {
    const nd = nodeDataMap(doc);
    const ed = edgeDataMap(doc);
    doc.transact(() => {
        nodes.forEach(n => {
            const nodeId = getNodeId(n);
            const oldKey = `${nodeId}:__label_${oldLabel}`;
            if (nd.has(oldKey)) {
                nd.set(`${nodeId}:__label_${newLabel1}`, newLabel1);
                nd.set(`${nodeId}:__label_${newLabel2}`, newLabel2);
                nd.delete(oldKey);
            }
        });

        if (edges) {
            edges.forEach(e => {
                const edgeId = e._edgeId;
                const oldKey = `${edgeId}:__label_${oldLabel}`;
                if (ed.has(oldKey)) {
                    ed.set(`${edgeId}:__label_${newLabel1}`, newLabel1);
                    ed.set(`${edgeId}:__label_${newLabel2}`, newLabel2);
                    ed.delete(oldKey);
                }
            });
        }
    });
}

export function eagerUnionLabels(nodes: Record<string, any>[], doc: Y.Doc, oldLabel1: string, oldLabel2: string, newLabel: string, edges?: Edge[]): void {
    const nd = nodeDataMap(doc);
    const ed = edgeDataMap(doc);
    doc.transact(() => {
        nodes.forEach(n => {
            const nodeId = getNodeId(n);
            const key1 = `${nodeId}:__label_${oldLabel1}`;
            const key2 = `${nodeId}:__label_${oldLabel2}`;
            if (nd.has(key1) || nd.has(key2)) {
                nd.set(`${nodeId}:__label_${newLabel}`, newLabel);
                nd.delete(key1);
                nd.delete(key2);
            }
        });

        if (edges) {
            edges.forEach(e => {
                const edgeId = e._edgeId;
                const key1 = `${edgeId}:__label_${oldLabel1}`;
                const key2 = `${edgeId}:__label_${oldLabel2}`;
                if (ed.has(key1) || ed.has(key2)) {
                    ed.set(`${edgeId}:__label_${newLabel}`, newLabel);
                    ed.delete(key1);
                    ed.delete(key2);
                }
            });
        }
    });
}

