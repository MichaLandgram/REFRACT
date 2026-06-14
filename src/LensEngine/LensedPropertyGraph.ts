import * as Y from 'yjs';
import { PropertyGraph } from '../GraphDB_CRDT/PropertyGraph';
import { SchemaLensEngine } from './SchemaLensEngine';
import { Policy } from '../Helper/types';
import { LensEngineError } from '../Helper/ErrorDefinition';

/* combines GRAPH and SCHEMA in one */
export class LensedPropertyGraph {
    private doc: Y.Doc;
    private db: PropertyGraph;
    private lens: SchemaLensEngine;

    constructor(doc: Y.Doc, db: PropertyGraph, lens: SchemaLensEngine) {
        this.doc = doc;
        this.db = db;
        this.lens = lens;
    }

    public addNode(nodeId: string, type: string, props: Record<string, any>, policy: Policy = 'OBSERVED_REMOVE', color?: string ): void {
        const { dbType, dbProps } = this.lens.encodeNodeForGraph(type, props);
        this.db.addNode({ doc: this.doc, nodeId, type: dbType, props: dbProps, policy, color });
    }

    public addEdge(sourceId: string, targetId: string, type: string, appProps: Record<string, any> = {}, edgeId?: string ): string {
        if (!this.lens.isRelationshipAllowed(type)) {
            throw new LensEngineError(`Relationship type "${type}" is not allowed in schema.`);
        }
        const { dbType, dbProps } = this.lens.encodeRelationshipForGraph(type, appProps);
        return this.db.addEdge({ doc: this.doc, sourceId, targetId, type: dbType, props: dbProps, edgeId});
    }

    public updateNode(nodeId: string, appProps: Record<string, any> ): void {
        const rawNode = this.db.getRawNode(this.doc, nodeId);
        if (!rawNode) {
            throw new LensEngineError(`Node "${nodeId}" not found or already removed.`);
        }
        const dbType = rawNode.type;
        if (!dbType) {
            throw new LensEngineError(`Node "${nodeId}" not found or already removed.`);
        }
        const dbProps: Record<string, any> = {};
        for (const [key, rawVal] of Object.entries(appProps)) {
            if (key.startsWith('__')) continue;
            const { dbKey } = this.lens.getAppKeyAndDbKey(dbType, key, 'NodeType');
            dbProps[dbKey] = this.lens.encodeValueForGraph(dbType, key, rawVal, 'NodeType');
        }
        this.db.updateNode({ doc: this.doc, nodeId, props: dbProps });
    }

    public updateEdge(edgeId: string, appProps: Record<string, any> ): void {
        const rawEdge = this.db.getRawEdgeById(this.doc, edgeId);
        if (!rawEdge) {
            throw new LensEngineError(`Edge "${edgeId}" not found or already removed.`);
        }
        const dbType = rawEdge.type;
        if (!dbType) {
            throw new LensEngineError(`Edge "${edgeId}" not found or already removed.`);
        }
        const dbProps: Record<string, any> = {};
        for (const [key, rawVal] of Object.entries(appProps)) {
            if (key.startsWith('__')) continue;
            const { dbKey } = this.lens.getAppKeyAndDbKey(dbType, key, 'RelationshipType');
            dbProps[dbKey] = this.lens.encodeValueForGraph(dbType, key, rawVal, 'RelationshipType');
        }
        this.db.updateEdge({ doc: this.doc, edgeId, props: dbProps });
    }   

    public deleteNode(nodeId: string): void {
        this.db.deleteNode({ doc: this.doc, nodeId });
    }

    public deleteEdge(edgeId: string): void {
        this.db.deleteEdge({ doc: this.doc, edgeId });
    }

    // full read
    public getVisibleGraph(options?: { lazy?: boolean }) {
        const rawNodes = this.db.getVisibleNodes(this.doc);
        const rawEdges = this.db.getVisibleEdges(this.doc);

        return this.lens.applyLensToGraph(
            rawNodes.map(n => ({ id: n.id, type: n.type, props: n.props })),
            rawEdges.map(e => ({ id: e.id, type: e.type, sourceId: e.sourceId, targetId: e.targetId, props: e.props })),
            options
        );
    }

    // mainly for testing and debugging
    public getDoc(): Y.Doc {
        return this.doc;
    }
}
