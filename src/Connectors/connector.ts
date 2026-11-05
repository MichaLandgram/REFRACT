import { DatabaseOperation } from './types_interfaces';
export interface DatabaseDriver {
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    isConnected(): boolean;

    upsertNode(nodeId: string, type: string, props: Record<string, any>): Promise<void>;
    deleteNode(nodeId: string): Promise<void>;
    setNodeProperty(nodeId: string, key: string, value: any): Promise<void>;

    upsertEdge(edgeId: string, sourceId: string, targetId: string, type: string, props: Record<string, any>): Promise<void>;
    deleteEdge(edgeId: string): Promise<void>;
    setEdgeProperty(edgeId: string, key: string, value: any): Promise<void>;

    queryFullGraph(): Promise<{ nodes: any[]; edges: any[] }>;
    executeBatch(operations: DatabaseOperation[]): Promise<void>;
    
}
