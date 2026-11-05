import * as Y from 'yjs';
import { PropertyGraph } from '../GraphDB_CRDT/PropertyGraph';
import { SchemaLensEngine } from './SchemaLensEngine';
import { Policy, SchemaDefinition } from '../Helper/types';
import { LensEngineError } from '../Helper/ErrorDefinition';
import { Schema_v1 } from '../Schema_CRDT/SchemaCRDT';

export class LensedPropertyGraph {
    private doc: Y.Doc;
    private db: PropertyGraph;
    private schema: Schema_v1;
    private lens: SchemaLensEngine;

    constructor({doc, db, lens, predefinedSchema}: { doc?: Y.Doc; db?: PropertyGraph; lens?: SchemaLensEngine; predefinedSchema?: SchemaDefinition } = {}) {
        this.doc = doc || new Y.Doc();
        this.db = db || new PropertyGraph(this.doc);
        this.schema = new Schema_v1(predefinedSchema, this.doc);
        this.lens = lens || new SchemaLensEngine(this.schema);
    }

    public getGraphDatabase(): PropertyGraph {
        return this.db;
    }

    public addNode({nodeId, type, props, policy = 'OBSERVED_REMOVE', color}: { nodeId: string, type: string, props: Record<string, any>, policy?: Policy, color?: string }): void {
        if (!this.lens.isNodeAllowed(type)) throw new LensEngineError(`Node type "${type}" is not allowed in schema.`);
        const { dbType, dbProps } = this.lens.encodeNodeForGraph(type, props);
        this.db.addNode({ doc: this.doc, nodeId, type: dbType, props: dbProps, policy, color });
    }

    public addEdge({sourceId, targetId, type, props, edgeId}: { sourceId: string, targetId: string, type: string, props: Record<string, any>, edgeId?: string }): string {
        if (!this.lens.isRelationshipAllowed(type)) throw new LensEngineError(`Relationship type "${type}" is not allowed in schema.`);
        const { dbType, dbProps } = this.lens.encodeRelationshipForGraph(type, props);
        return this.db.addEdge({ doc: this.doc, sourceId, targetId, type: dbType, props: dbProps, edgeId});
    }

    public updateNode({nodeId, props}: { nodeId: string, props: Record<string, any> }): void {
        const rawNode = this.db.getRawNode(this.doc, nodeId);
        if (!rawNode) {
            throw new LensEngineError(`Node "${nodeId}" not found or already removed.`);
        }
        const dbType = rawNode.type;
        // if (!dbType) {
        //     throw new LensEngineError(`Node "${nodeId}" not found or already removed.`);
        // }
        const dbProps: Record<string, any> = {};
        props = props || {};
        for (const [key, rawVal] of Object.entries(props)) {
            if (key.startsWith('__')) continue;
            const { dbKey } = this.lens.getAppKeyAndDbKey(dbType, key, 'NodeType');
            dbProps[dbKey] = this.lens.encodeValueForGraph(dbType, key, rawVal, 'NodeType');
        }
        this.db.updateNode({ doc: this.doc, nodeId, props: dbProps });
    }

    public updateEdge({edgeId, props}: { edgeId: string, props: Record<string, any> }): void {
        const rawEdge = this.db.getRawEdgeById(this.doc, edgeId);
        if (!rawEdge) {
            throw new LensEngineError(`Edge "${edgeId}" not found or already removed.`);
        }
        const dbType = rawEdge.type;
        // if (!dbType) {
        //     throw new LensEngineError(`Edge "${edgeId}" not found or already removed.`);
        // }
        const dbProps: Record<string, any> = {};
        for (const [key, rawVal] of Object.entries(props)) {
            if (key.startsWith('__')) continue;
            const { dbKey } = this.lens.getAppKeyAndDbKey(dbType, key, 'RelationshipType');
            dbProps[dbKey] = this.lens.encodeValueForGraph(dbType, key, rawVal, 'RelationshipType');
        }
        this.db.updateEdge({ doc: this.doc, edgeId, props: dbProps });
    }
    public deleteNodeProperty({nodeId, propKeys}: { nodeId: string, propKeys: string[] }): void {
        const rawNode = this.db.getRawNode(this.doc, nodeId);
        if (!rawNode) {
            throw new LensEngineError(`Node "${nodeId}" not found or already removed.`);
        }
        const dbType = rawNode.type;
        // if (!dbType) {
        //     throw new LensEngineError(`Node "${nodeId}" not found or already removed.`);
        // }
        const dbPropKeys: string[] = [];
        for (const key of propKeys) {
            if (key.startsWith('__')) continue;
            const { dbKey } = this.lens.getAppKeyAndDbKey(dbType, key, 'NodeType');
            dbPropKeys.push(dbKey);
        }
        this.db.deleteNodeProperty({ doc: this.doc, nodeId, propKeys: dbPropKeys });
    }

    public deleteEdgeProperty({edgeId, propKeys}: { edgeId: string, propKeys: string[] }): void {
        const rawEdge = this.db.getRawEdgeById(this.doc, edgeId);
        if (!rawEdge) {
            throw new LensEngineError(`Edge "${edgeId}" not found or already removed.`);
        }
        const dbType = rawEdge.type;
        // if (!dbType) {
        //     throw new LensEngineError(`Edge "${edgeId}" not found or already removed.`);
        // }
        const dbPropKeys: string[] = [];
        for (const key of propKeys) {
            if (key.startsWith('__')) continue;
            const { dbKey } = this.lens.getAppKeyAndDbKey(dbType, key, 'RelationshipType');
            dbPropKeys.push(dbKey);
        }
        this.db.deleteEdgeProperty({ doc: this.doc, edgeId, propKeys: dbPropKeys });
    }

    public deleteNode({nodeId}: { nodeId: string }): void {
        this.db.deleteNode({ doc: this.doc, nodeId });
    }

    public deleteEdge({edgeId}: { edgeId: string }): void {
        this.db.deleteEdge({ doc: this.doc, edgeId });
    }

    public getSchemaInteraction(): Schema_v1 {
        return this.schema;
    }

    public getLensEngine(): SchemaLensEngine {
        return this.lens;
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

    public getLensedNode(nodeId: string): any {
        const rawNode = this.db.getRawNode(this.doc, nodeId);
        if (!rawNode) return null;
        if (!this.lens.isNodeAllowed(rawNode.type)) return null;
        const decodedProps = this.lens.decodeAndFilterProperties(rawNode.type, rawNode.props, 'NodeType');
        return {
            id: rawNode.id,
            type: rawNode.type,
            appProps: decodedProps,
        };
    }

    public getLensedEdge(edgeId: string): any {
        const rawEdge = this.db.getRawEdgeById(this.doc, edgeId);
        if (!rawEdge) return null;
        const decodedProps = this.lens.decodeAndFilterProperties(rawEdge.type, rawEdge.props, 'RelationshipType');
        return {
            id: rawEdge.id,
            type: rawEdge.type,
            sourceId: rawEdge.sourceId,
            targetId: rawEdge.targetId,
            appProps: decodedProps,
        };
    }

    public getDoc(): Y.Doc {
        return this.doc;
    }
}
