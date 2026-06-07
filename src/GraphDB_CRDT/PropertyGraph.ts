import * as Y from 'yjs';
import { ORSetRegistry } from './ORSetRegistry';
import { DualKeyMap } from './DualKeyMap';
import { NodeId, EdgeId, NodeProps, EdgeProps, VisibleEdge, VisibleNode } from '../Helper/types';
import { GraphCRDTError } from '../Helper/ErrorDefinition';

export class PropertyGraph {
    private _registryCache = new WeakMap<Y.Doc, ORSetRegistry>();

    private getNodeRegistry(doc: Y.Doc): ORSetRegistry {
        let registry = this._registryCache.get(doc);
        if (!registry) {
            registry = new ORSetRegistry(doc, 'pg_nodes');
            this._registryCache.set(doc, registry);
        }
        return registry;
    }
    private isNodeAlive(nodeId: NodeId, doc: Y.Doc): boolean {
        return this.getNodeRegistry(doc).isAlive(nodeId);
    }

    public addNode({doc, nodeId, type, props = {}}: { doc: Y.Doc; nodeId: NodeId; type: string; props?: NodeProps; policy?: string; color?: string; }): void {
        doc.transact(() => {
            this.getNodeRegistry(doc).add(nodeId);
            const nodeMap = doc.getMap(`pg_n_${nodeId}`);
            if (nodeMap.size > 0) {
                throw new GraphCRDTError(`Node "${nodeId}" already exists.`);
            }
            nodeMap.set('__type', type);
            const dkm = new DualKeyMap(nodeMap);
            for (const [key, value] of Object.entries(props)) {
                dkm.setInitial(key, value);
            }
        });
    }

    public updateNode({doc, nodeId, props}: { doc: Y.Doc; nodeId: NodeId; props: NodeProps}): void {
        if (!this.isNodeAlive(nodeId, doc)) {
            throw new GraphCRDTError(`Node "${nodeId}" not found or already removed.`);
        }
        const nodeMap = doc.getMap(`pg_n_${nodeId}`);
        const dkm = new DualKeyMap(nodeMap);
        doc.transact(() => {
            for (const [key, value] of Object.entries(props)) {
                dkm.setUpdate(key, value);
            }
        });
    }

    public deleteNode({doc, nodeId}: {doc: Y.Doc; nodeId: NodeId;}): void {
        if (!this.isNodeAlive(nodeId, doc)) {
            throw new GraphCRDTError(`Node "${nodeId}" not found or already removed.`);
        }
        doc.transact(() => {
            this.getNodeRegistry(doc).remove(nodeId);
            doc.getMap(`pg_n_${nodeId}`).clear();
        });
    }

    public getVisibleNodes(doc: Y.Doc): VisibleNode[] {
        return this.getNodeRegistry(doc).getAllAlive().map(id => {
            const nodeMap = doc.getMap(`pg_n_${id}`);
            const dkm = new DualKeyMap(nodeMap);
            return {
                id,
                type: nodeMap.get('__type') as string ?? id,
                policy: 'OBSERVED_REMOVE' as const,
                props: dkm.getAll(),
            };
        });
    }

    public getNodeProps(doc: Y.Doc, nodeId: NodeId): NodeProps | undefined {
        if (!this.isNodeAlive(nodeId, doc)) return undefined;
        return new DualKeyMap(doc.getMap(`pg_n_${nodeId}`)).getAll();
    }

    public addEdge({ doc, sourceId, targetId, type, props = {}, edgeId }: { doc: Y.Doc; sourceId: NodeId; targetId: NodeId; type: string; props?: EdgeProps; edgeId?: EdgeId; }): EdgeId {
        if (!this.isNodeAlive(sourceId, doc)) {
            throw new GraphCRDTError(`Source node "${sourceId}" does not exist or is removed.`);
        }
        if (!this.isNodeAlive(targetId, doc)) {
            throw new GraphCRDTError(`Target node "${targetId}" does not exist or is removed.`);
        }

        const uuid: EdgeId = edgeId ?? crypto.randomUUID();

        doc.transact(() => {
            const edgeMap = doc.getMap(`pg_e_${uuid}`);
            edgeMap.set('__sourceId', sourceId);
            edgeMap.set('__targetId', targetId);
            edgeMap.set('__type', type);

            const dkm = new DualKeyMap(edgeMap);
            for (const [key, value] of Object.entries(props)) {
                dkm.setInitial(key, value);
            }

            const edgesTargets = doc.getMap<Y.Map<Y.Array<string>>>('pg_edgesTargets');
            let targetMap = edgesTargets.get(sourceId);
            if (!targetMap) {
                targetMap = new Y.Map<Y.Array<string>>();
                edgesTargets.set(sourceId, targetMap);
            }
            let edgeList = targetMap.get(targetId);
            if (!edgeList) {
                edgeList = new Y.Array<string>();
                targetMap.set(targetId, edgeList);
            }
            edgeList.push([uuid]);
        });
        return uuid;
    }

    public updateEdge({ doc, edgeId, props }: { doc: Y.Doc; edgeId: EdgeId; props: EdgeProps;  }): void {
        const edgeMap = doc.getMap(`pg_e_${edgeId}`);
        if (edgeMap.size === 0) {
            throw new Error(`PropertyGraph: Edge "${edgeId}" does not exist.`);
        }
        const dkm = new DualKeyMap(edgeMap);
        doc.transact(() => {
            for (const [key, value] of Object.entries(props)) {
                dkm.setUpdate(key, value);
            }
        });
    }

    public deleteEdge({ doc, edgeId }: { doc: Y.Doc; edgeId: EdgeId }): void {
        doc.transact(() => {
            doc.getMap(`pg_e_${edgeId}`).clear();
        });
    }

    public getVisibleEdges(doc: Y.Doc): VisibleEdge[] {
        const aliveNodes = new Set(this.getNodeRegistry(doc).getAllAlive());
        const edgesTargets = doc.getMap<Y.Map<Y.Array<string>>>('pg_edgesTargets');
        const edges: VisibleEdge[] = [];

        edgesTargets.forEach(sourceMap => {
            if (!sourceMap) return;
            sourceMap.forEach(edgeList => {
                if (!edgeList) return;
                edgeList.forEach((uuid: string) => {
                    const edgeMap = doc.getMap(`pg_e_${uuid}`);
                    if (edgeMap.size === 0) return;

                    const storedSourceId = edgeMap.get('__sourceId') as string;
                    const storedTargetId = edgeMap.get('__targetId') as string;
                    if (!aliveNodes.has(storedSourceId)) return;
                    if (!aliveNodes.has(storedTargetId)) return;

                    const dkm = new DualKeyMap(edgeMap);
                    edges.push({
                        id: uuid,
                        sourceId: storedSourceId,
                        targetId: storedTargetId,
                        type: edgeMap.get('__type') as string ?? '',
                        props: dkm.getAll(),
                    });
                });
            });
        });
        return edges;
    }

    public getRawNode(doc: Y.Doc, nodeId: NodeId): { id: string; type: string; props: Record<string, any> } | null {
        const rawType = doc.getMap(`pg_n_${nodeId}`).get('__type') as string ?? nodeId;
        const props = this.getNodeProps(doc, nodeId);
        if (!rawType || props === undefined) return null;
        return { id: nodeId, type: rawType, props };
    }

    public getRawEdgeById(doc: Y.Doc, edgeId: EdgeId): { id: string; type: string; sourceId: string; targetId: string; props: Record<string, any> } | null {
        const edgeMap = doc.getMap(`pg_e_${edgeId}`);
        if (edgeMap.size === 0) return null;
        const dkm = new DualKeyMap(edgeMap);
        return {
            id:       edgeId,
            type:     edgeMap.get('__type')     as string ?? '',
            sourceId: edgeMap.get('__sourceId') as string ?? '',
            targetId: edgeMap.get('__targetId') as string ?? '',
            props:    dkm.getAll(),
        };
    }

    public getOutgoingEdgeIds(doc: Y.Doc, nodeId: NodeId): string[] {
        const edgesTargets = doc.getMap<Y.Map<Y.Array<string>>>('pg_edgesTargets');
        const targetMap    = edgesTargets.get(nodeId);
        if (!targetMap) return [];
        const ids: string[] = [];
        targetMap.forEach(edgeList => {
            if (edgeList) edgeList.forEach((id: string) => ids.push(id));
        });
        return ids;
    }

    public getIncomingEdgeIds(doc: Y.Doc, nodeId: NodeId): string[] {
        const edgesTargets = doc.getMap<Y.Map<Y.Array<string>>>('pg_edgesTargets');
        const ids: string[] = [];
        edgesTargets.forEach(targetMap => {
            if (!targetMap) return;
            const list = targetMap.get(nodeId);
            if (list) list.forEach((id: string) => ids.push(id));
        });
        return ids;
    }

}
