import * as Y from 'yjs';
import { ScopedDualKeyMap } from './ScopedDualKeyMap';
import { EntityKeyIndex } from './EntityKeyIndex';
import { NodeId, EdgeId, NodeProps, EdgeProps, VisibleEdge, VisibleNode } from '../Helper/types';
import { GraphCRDTError } from '../Helper/ErrorDefinition';


export class PropertyGraph {
    private doc: Y.Doc;
    private _outgoingCache!: Map<NodeId, Set<EdgeId>>;
    private _incomingCache!: Map<NodeId, Set<EdgeId>>;

    private static _outgoingCaches = new WeakMap<Y.Doc, Map<NodeId, Set<EdgeId>>>();
    private static _incomingCaches = new WeakMap<Y.Doc, Map<NodeId, Set<EdgeId>>>();
    private static _initializedDocs = new WeakSet<Y.Doc>();
    private static _nodeKeyIndexCache = new WeakMap<Y.Doc, EntityKeyIndex>();
    private static _edgeKeyIndexCache = new WeakMap<Y.Doc, EntityKeyIndex>();

    private addToCache(cache: Map<NodeId, Set<EdgeId>>, nodeKey: any, edgeId: any) {
        let edgeSet = cache.get(nodeKey);
        if (!edgeSet) {
            edgeSet = new Set<EdgeId>();
            cache.set(nodeKey, edgeSet);
        }
        edgeSet.add(edgeId);
    }

    private removeFromCache(cache: Map<NodeId, Set<EdgeId>>, nodeKey: NodeId, edgeId: EdgeId) {
        const edgeSet = cache.get(nodeKey);
        if (edgeSet) {
            edgeSet.delete(edgeId);
            if (edgeSet.size === 0) {
                cache.delete(nodeKey);
            }
        }
    }

    private initEdgeCaches(doc: Y.Doc) {
        let outgoing = PropertyGraph._outgoingCaches.get(doc);
        let incoming = PropertyGraph._incomingCaches.get(doc);

        if (!outgoing || !incoming) {
            outgoing = new Map<NodeId, Set<EdgeId>>();
            incoming = new Map<NodeId, Set<EdgeId>>();
            PropertyGraph._outgoingCaches.set(doc, outgoing);
            PropertyGraph._incomingCaches.set(doc, incoming);
        }

        this._outgoingCache = outgoing;
        this._incomingCache = incoming;

        if (!PropertyGraph._initializedDocs.has(doc)) {
            PropertyGraph._initializedDocs.add(doc);

            const edgeData = doc.getMap('pg_edge_data');
            const keyIndex = this.getEdgeKeyIndex(doc);

            const processEdge = (edgeId: string) => {
                const sourceId = edgeData.get(`${edgeId}:__sourceId`);
                const targetId = edgeData.get(`${edgeId}:__targetId`);
                if (sourceId && targetId) {
                    this.addToCache(outgoing!, sourceId, edgeId);
                    this.addToCache(incoming!, targetId, edgeId);
                }
            };

            for (const edgeId of keyIndex.getAllEntities()) {
                processEdge(edgeId);
            }

            edgeData.observe((event) => {
                event.changes.keys.forEach((change, key) => {
                    const idx = key.indexOf(':');
                    if (idx < 0) return;
                    const edgeId = key.substring(0, idx);

                    if (change.action === 'add' || change.action === 'update') {
                        processEdge(edgeId);
                    } else if (change.action === 'delete' && change.oldValue) {
                        if (key.endsWith(':__sourceId')) {
                            this.removeFromCache(outgoing!, change.oldValue as string, edgeId);
                        } else if (key.endsWith(':__targetId')) {
                            this.removeFromCache(incoming!, change.oldValue as string, edgeId);
                        }
                    }
                });
            });
        }
    }

    constructor(doc: Y.Doc) {
        this.doc = doc;
        
        this.getNodeKeyIndex(doc);
        this.getEdgeKeyIndex(doc);
        this.initEdgeCaches(doc);
    }

    private getNodeKeyIndex(doc: Y.Doc): EntityKeyIndex {
        let index = PropertyGraph._nodeKeyIndexCache.get(doc);
        if (!index) {
            index = new EntityKeyIndex(doc.getMap('pg_node_data'));
            PropertyGraph._nodeKeyIndexCache.set(doc, index);
        }
        return index;
    }

    private getEdgeKeyIndex(doc: Y.Doc): EntityKeyIndex {
        let index = PropertyGraph._edgeKeyIndexCache.get(doc);
        if (!index) {
            index = new EntityKeyIndex(doc.getMap('pg_edge_data'));
            PropertyGraph._edgeKeyIndexCache.set(doc, index);
        }
        return index;
    }

    private isNodeAlive(nodeId: NodeId, doc: Y.Doc): boolean {
        const keyIndex = this.getNodeKeyIndex(doc);
        return keyIndex.isEntityAlive(nodeId);
    }

    private clearEntityKeys(dataMap: Y.Map<any>, entityId: string, keyIndex: EntityKeyIndex): void {
        const keys = keyIndex.getKeysForEntity(entityId);
        for (const key of keys) {
            dataMap.delete(key);
        }
    }


    public addNode({doc, nodeId, type, props = {}}: { doc: Y.Doc; nodeId: NodeId; type: string; props?: NodeProps; policy?: string; color?: string; }): void {
        const nodeData = doc.getMap('pg_node_data');
        const keyIndex = this.getNodeKeyIndex(doc);
        doc.transact(() => {
            if (keyIndex.hasEntity(nodeId)) {
                if (this.isNodeAlive(nodeId, doc)) {
                    throw new GraphCRDTError(`Node "${nodeId}" already exists.`);
                } else {
                    this.clearEntityKeys(nodeData, nodeId, keyIndex);
                }
            }
            nodeData.set(`${nodeId}:__type`, type);
            const clientID = doc.clientID.toString();
            nodeData.set(`${nodeId}:__type_${clientID}`, type);
            const dkm = new ScopedDualKeyMap(nodeData, nodeId, keyIndex);
            for (const [key, value] of Object.entries(props)) {
                dkm.setInitial(key, value);
            }
        });
    }
        public updateNode({doc, nodeId, props}: { doc: Y.Doc; nodeId: NodeId; props: NodeProps}): void {
        if (!this.isNodeAlive(nodeId, doc)) {
            throw new GraphCRDTError(`Node "${nodeId}" not found or already removed.`);
        }
        const nodeData = doc.getMap('pg_node_data');
        const keyIndex = this.getNodeKeyIndex(doc);
        const dkm = new ScopedDualKeyMap(nodeData, nodeId, keyIndex);
        doc.transact(() => {
            props = props || {};
            for (const [key, value] of Object.entries(props)) {
                dkm.setUpdate(key, value);
            }
        });
    }
    public deleteNodeProperty({doc, nodeId, propKeys}: { doc: Y.Doc; nodeId: NodeId; propKeys: string[] }): void {
        if (!this.isNodeAlive(nodeId, doc)) {
            throw new GraphCRDTError(`Node "${nodeId}" not found or already removed.`);
        }
        const nodeData = doc.getMap('pg_node_data');
        const keyIndex = this.getNodeKeyIndex(doc);
        const dkm = new ScopedDualKeyMap(nodeData, nodeId, keyIndex);
        doc.transact(() => {
            for (const key of propKeys) {
                dkm.delete(key);
            }
        });
    }


    public deleteNode({doc, nodeId}: {doc: Y.Doc; nodeId: NodeId;}): void {
        if (!this.isNodeAlive(nodeId, doc)) {
            throw new GraphCRDTError(`Node "${nodeId}" not found or already removed.`);
        }
        const nodeData = doc.getMap('pg_node_data');
        const keyIndex = this.getNodeKeyIndex(doc);
        doc.transact(() => {
            this.clearEntityKeys(nodeData, nodeId, keyIndex);
        });
    }

    public getVisibleNodes(doc: Y.Doc): VisibleNode[] {
        const nodeData = doc.getMap('pg_node_data');
        const keyIndex = this.getNodeKeyIndex(doc);
        return keyIndex.getAllAliveEntities().map(id => {
            const type = keyIndex.getEntityType(id);
            if (!type) return null;
            const dkm = new ScopedDualKeyMap(nodeData, id, keyIndex);
            return {
                id,
                type: type as string,
                policy: 'OBSERVED_REMOVE' as const,
                props: dkm.getAll(),
            };
        }).filter(n => n !== null) as VisibleNode[];
    }

    public getNodeProps(doc: Y.Doc, nodeId: NodeId): NodeProps | undefined {
        if (!this.isNodeAlive(nodeId, doc)) return undefined;
        const nodeData = doc.getMap('pg_node_data');
        const keyIndex = this.getNodeKeyIndex(doc);
        return new ScopedDualKeyMap(nodeData, nodeId, keyIndex).getAll();
    }

    public addEdge({ doc, sourceId, targetId, type, props = {}, edgeId }: { doc: Y.Doc; sourceId: NodeId; targetId: NodeId; type: string; props?: EdgeProps; edgeId?: EdgeId; }): EdgeId {
        if (!this.isNodeAlive(sourceId, doc)) {
            throw new GraphCRDTError(`Source node "${sourceId}" does not exist or is removed.`);
        }
        if (!this.isNodeAlive(targetId, doc)) {
            throw new GraphCRDTError(`Target node "${targetId}" does not exist or is removed.`);
        }
        const uuid = edgeId ?? crypto.randomUUID();
        const edgeData = doc.getMap('pg_edge_data');
        const keyIndex = this.getEdgeKeyIndex(doc);

        if (keyIndex.hasEntity(uuid)) {
            throw new GraphCRDTError(`Edge "${uuid}" already exists.`);
        }

        doc.transact(() => {
            edgeData.set(`${uuid}:__sourceId`, sourceId);
            edgeData.set(`${uuid}:__targetId`, targetId);
            edgeData.set(`${uuid}:__type`, type);

            const dkm = new ScopedDualKeyMap(edgeData, uuid, keyIndex);
            for (const [key, value] of Object.entries(props)) {
                dkm.setInitial(key, value);
            }
        });
        return uuid;
    }

    public updateEdge({ doc, edgeId, props }: { doc: Y.Doc; edgeId: EdgeId; props: EdgeProps;  }): void {
        const edgeData = doc.getMap('pg_edge_data');
        const keyIndex = this.getEdgeKeyIndex(doc);
        if (!keyIndex.hasEntity(edgeId)) {
            throw new GraphCRDTError(`Edge "${edgeId}" does not exist.`);
        }
        const dkm = new ScopedDualKeyMap(edgeData, edgeId, keyIndex);
        doc.transact(() => {
            props = props || {};
            for (const [key, value] of Object.entries(props)) {
                dkm.setUpdate(key, value);
            }
        });
    }

    public deleteEdgeProperty({ doc, edgeId, propKeys }: { doc: Y.Doc; edgeId: EdgeId; propKeys: string[] }): void {
        const edgeData = doc.getMap('pg_edge_data');
        const keyIndex = this.getEdgeKeyIndex(doc);
        if (!keyIndex.hasEntity(edgeId)) {
            throw new GraphCRDTError(`Edge "${edgeId}" does not exist.`);
        }
        const dkm = new ScopedDualKeyMap(edgeData, edgeId, keyIndex);
        doc.transact(() => {
            for (const key of propKeys) {
                dkm.delete(key);
            }
        });
    }

    public deleteEdge({ doc, edgeId }: { doc: Y.Doc; edgeId: EdgeId }): void {
        const edgeData = doc.getMap('pg_edge_data');
        const keyIndex = this.getEdgeKeyIndex(doc);
        if (!keyIndex.hasEntity(edgeId)) {
            throw new GraphCRDTError(`Edge "${edgeId}" does not exist or is already removed.`);
        }

        doc.transact(() => {
            this.clearEntityKeys(edgeData, edgeId, keyIndex);
        });
    }

    public getVisibleEdges(doc: Y.Doc): VisibleEdge[] {
        const edgeData = doc.getMap('pg_edge_data');
        const keyIndex = this.getEdgeKeyIndex(doc);
        const edges: VisibleEdge[] = [];

        for (const edgeId of keyIndex.getAllEntities()) {
            const sourceId = edgeData.get(`${edgeId}:__sourceId`) as string;
            const targetId = edgeData.get(`${edgeId}:__targetId`) as string;
            if (!sourceId || !targetId) continue;
            if (!this.isNodeAlive(sourceId, doc) || !this.isNodeAlive(targetId, doc)) continue;

            const dkm = new ScopedDualKeyMap(edgeData, edgeId, keyIndex);
            edges.push({
                id: edgeId,
                sourceId,
                targetId,
                type: edgeData.get(`${edgeId}:__type`) as string,
                props: dkm.getAll(),
            });
        }
        return edges;
    }

    public getRawNode(doc: Y.Doc, nodeId: NodeId): { id: string; type: string; props: Record<string, any> } | null {
        const nodeData = doc.getMap('pg_node_data');
        const keyIndex = this.getNodeKeyIndex(doc);
        const rawType = keyIndex.getEntityType(nodeId);
        const props = this.getNodeProps(doc, nodeId);
        if (!rawType || props === undefined) return null;
        return { id: nodeId, type: rawType, props };
    }

    public getRawEdgeById(doc: Y.Doc, edgeId: EdgeId): { id: string; type: string; sourceId: string; targetId: string; props: Record<string, any> } | null {
        const edgeData = doc.getMap('pg_edge_data');
        const keyIndex = this.getEdgeKeyIndex(doc);
        if (!keyIndex.hasEntity(edgeId)) return null;
        const dkm = new ScopedDualKeyMap(edgeData, edgeId, keyIndex);
        return {
            id:       edgeId,
            type:     edgeData.get(`${edgeId}:__type`) as string,
            sourceId: edgeData.get(`${edgeId}:__sourceId`) as string,
            targetId: edgeData.get(`${edgeId}:__targetId`) as string,
            props:    dkm.getAll(),
        };
    }

    public getOutgoingEdgeIds(doc: Y.Doc, nodeId: NodeId): string[] {
        const edgeSet = this._outgoingCache.get(nodeId);
        return edgeSet ? Array.from(edgeSet) : [];
    }

    public getIncomingEdgeIds(doc: Y.Doc, nodeId: NodeId): string[] {
        const edgeSet = this._incomingCache.get(nodeId);
        return edgeSet ? Array.from(edgeSet) : [];
    }

    
/* FULL GRAPH READ */
    public getFullVisibleGraph(doc: Y.Doc): { nodes: VisibleNode[]; edges: VisibleEdge[] } {
        const nodes = this.getVisibleNodes(doc);
        const edges = this.getVisibleEdges(doc);
        return { nodes, edges };
    }
    /* istanbul ignore next */
    public cleanDanglingEdges(doc: Y.Doc): void {
        const edgeData = doc.getMap('pg_edge_data');
        const keyIndex = this.getEdgeKeyIndex(doc);
        if (keyIndex.getAllEntities().length === 0) return;
        doc.transact(() => {
            const danglingEdgeIds: string[] = [];

            for (const edgeId of keyIndex.getAllEntities()) {
                const sourceId = edgeData.get(`${edgeId}:__sourceId`) as string;
                const targetId = edgeData.get(`${edgeId}:__targetId`) as string;
                if (sourceId && targetId) {
                    if (!this.isNodeAlive(sourceId, doc) || !this.isNodeAlive(targetId, doc)) {
                        danglingEdgeIds.push(edgeId);
                    }
                }
            }

            danglingEdgeIds.forEach(edgeId => {
                try {
                    this.deleteEdge({ doc, edgeId });
                } catch (e) {
                }
            });
        });
    }
    /* istanbul ignore next */
    public getDoc(): Y.Doc {
        return this.doc;
    }
}