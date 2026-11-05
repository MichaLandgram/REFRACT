export type DatabaseOperation =
    | { op: 'upsertNode'; nodeId: string; type: string; props: Record<string, any> }
    | { op: 'deleteNode'; nodeId: string }
    | { op: 'upsertEdge'; edgeId: string; sourceId: string; targetId: string; type: string; props: Record<string, any> }
    | { op: 'deleteEdge'; edgeId: string }
    | { op: 'setNodeProperty'; nodeId: string; key: string; value: any }
    | { op: 'setEdgeProperty'; edgeId: string; key: string; value: any };

export type ErrorHandler = (err: Error, ops: DatabaseOperation[]) => void;
export type SyncHandler = (ops: DatabaseOperation[]) => void;

export interface DatabaseConfig {
  uri: string;
  username: string;
  password: string;
  database?: string;
}

export interface SyncOptions {
  debounceMs?: number;
  initialSync?: boolean;
}
