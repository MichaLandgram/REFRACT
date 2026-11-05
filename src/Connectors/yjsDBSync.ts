import * as Y from 'yjs';
import { DatabaseDriver } from './connector';
import { DatabaseOperation, SyncOptions, ErrorHandler, SyncHandler } from './types_interfaces';
import { ScopedDualKeyMap } from '../GraphDB_CRDT/ScopedDualKeyMap';
import { EntityKeyIndex } from '../GraphDB_CRDT/EntityKeyIndex';
import { LensedPropertyGraph } from '../LensEngine/LensedPropertyGraph';
import { SchemaLensEngine } from '../LensEngine/SchemaLensEngine';

const DEFAULT_OPTIONS: Required<SyncOptions> = {
  debounceMs: 50,
  initialSync: true,
};

export class YjsDBSync {
  private readonly doc: Y.Doc;
  private readonly driver: DatabaseDriver;
  private readonly options: Required<SyncOptions>;
  private readonly lensedPG?: LensedPropertyGraph;
  private readonly lens?: SchemaLensEngine;
  private readonly schemaDoc?: Y.Doc;
  private readonly nodeData: Y.Map<any>;
  private readonly edgeData: Y.Map<any>;
  private readonly nodeKeyIndex: EntityKeyIndex;
  private readonly edgeKeyIndex: EntityKeyIndex;
  private observerCleanups: Array<() => void> = [];
  private pendingOps: DatabaseOperation[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private errorHandlers: Array<ErrorHandler> = [];
  private syncHandlers: Array<SyncHandler> = [];

  constructor(
    doc: Y.Doc,
    driver: DatabaseDriver,
    options?: SyncOptions & { lensedPG?: LensedPropertyGraph; lens?: SchemaLensEngine; schemaDoc?: Y.Doc; },
  ) {
    this.doc = doc;
    this.driver = driver;
    this.lensedPG = options?.lensedPG;
    this.lens = options?.lens;
    this.schemaDoc = options?.schemaDoc;
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.nodeData = doc.getMap('pg_node_data');
    this.edgeData = doc.getMap('pg_edge_data');
    this.nodeKeyIndex = new EntityKeyIndex(this.nodeData);
    this.edgeKeyIndex = new EntityKeyIndex(this.edgeData);
  }

  on(event: 'error', handler: ErrorHandler): void;
  on(event: 'sync', handler: SyncHandler): void;
  on(event: 'error' | 'sync', handler: ErrorHandler | SyncHandler): void {
    if (event === 'error') {
      this.errorHandlers.push(handler as ErrorHandler);
    } else {
      this.syncHandlers.push(handler as SyncHandler);
    }
  }

  start(): void {
    this.attachNodeDataObserver();
    this.attachEdgeDataObserver();
    if (this.schemaDoc) {
      this.attachSchemaObserver();
    }

    if (this.options.initialSync) {
      this.pushFullState();
    }
  }

  stop(): void {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.observerCleanups.forEach((cleanup) => cleanup());
    this.observerCleanups = [];
    this.pendingOps = [];
  }

  private attachSchemaObserver(): void {
    if (!this.schemaDoc) return;
    const handler = () => this.onSchemaChange();
    const schemaMapNames = [
      'nodeTypes',
      'relationshipTypes',
      'schema_uuid',
      'schema_mappings',
      'label_splits',
      'label_parents',
    ];
    for (const name of schemaMapNames) {
      const map = this.schemaDoc.getMap(name);
      map.observeDeep(handler);
      this.observerCleanups.push(() => map.unobserveDeep(handler));
    }
  }

  private onSchemaChange(): void {
    if (this.lens) this.lens.refreshCache();
    this.pushFullState();
  }

  private attachNodeDataObserver(): void {
    const handler = (event: Y.YMapEvent<any>) => {
      const changedNodeIds = new Set<string>();
      event.changes.keys.forEach((change, key) => {
        const sep = key.indexOf(':');
        if (sep !== -1) {
          changedNodeIds.add(key.substring(0, sep));
        }
      });
      changedNodeIds.forEach(nodeId => this.evaluateNodeState(nodeId));
    };
    this.nodeData.observe(handler);
    this.observerCleanups.push(() => this.nodeData.unobserve(handler));
  }

  private attachEdgeDataObserver(): void {
    const handler = (event: Y.YMapEvent<any>) => {
      const changedEdgeIds = new Set<string>();
      event.changes.keys.forEach((_, key) => {
        const sep = key.indexOf(':');
        if (sep !== -1) {
          changedEdgeIds.add(key.substring(0, sep));
        }
      });
      changedEdgeIds.forEach(edgeId => this.evaluateEdgeState(edgeId));
    };
    this.edgeData.observe(handler);
    this.observerCleanups.push(() => this.edgeData.unobserve(handler));
  }

  private evaluateNodeState(nodeId: string): void {
    if (this.nodeKeyIndex.isEntityAlive(nodeId)) {
      const lensed = this.readLensedNode(nodeId);
      if (lensed) {
        this.enqueue({ op: 'upsertNode', nodeId, type: lensed.type, props: lensed.props });
      }
    } else {
      this.enqueue({ op: 'deleteNode', nodeId });
    }
  }

  private evaluateEdgeState(edgeId: string): void {
    if (this.edgeKeyIndex.hasEntity(edgeId)) {
      const lensed = this.readLensedEdge(edgeId);
      if (lensed) {
        this.enqueue({
          op: 'upsertEdge',
          edgeId,
          sourceId: lensed.sourceId,
          targetId: lensed.targetId,
          type: lensed.type,
          props: lensed.props,
        });
      }
    } else {
      this.enqueue({ op: 'deleteEdge', edgeId });
    }
  }

  pushFullState(): void {
    if (this.lensedPG) {
      const { lensedNodes, lensedEdges } = this.lensedPG.getVisibleGraph({ lazy: false });
      for (const node of lensedNodes) {
        this.enqueue({ op: 'upsertNode', nodeId: node.id, type: node.type, props: node.appProps });
      }
      for (const edge of lensedEdges) {
        this.enqueue({ op: 'upsertEdge', edgeId: edge.id, sourceId: edge.sourceId, targetId: edge.targetId, type: edge.type, props: edge.appProps });
      }
    } else {
      const aliveNodeIds = this.nodeKeyIndex.getAllAliveEntities();
      for (const nodeId of aliveNodeIds) {
        const data = this.readLensedNode(nodeId);
        if (data) this.enqueue({ op: 'upsertNode', nodeId, type: data.type, props: data.props });
      }
      for (const edgeId of this.edgeKeyIndex.getAllEntities()) {
        const data = this.readLensedEdge(edgeId);
        if (data) {
          this.enqueue({ op: 'upsertEdge', edgeId, sourceId: data.sourceId, targetId: data.targetId, type: data.type, props: data.props });
        }
      }
    }
    this.flushImmediate();
  }

  private readLensedNode(nodeId: string): { type: string; props: Record<string, any> } | null {
    const rawType = this.nodeKeyIndex.getEntityType(nodeId);
    if (!rawType) return null;

    const dkm = new ScopedDualKeyMap(this.nodeData, nodeId, this.nodeKeyIndex);
    const rawProps = dkm.getAll();

    if (this.lens) {
      if (!this.lens.isNodeAllowed(rawType)) return null;
      const decodedProps = this.lens.decodeAndFilterProperties(rawType, rawProps, 'NodeType');
      return { type: rawType, props: this.flattenProxyProps(decodedProps) };
    }

    return { type: rawType, props: this.resolveProps(rawProps) };
  }

  private readLensedEdge(edgeId: string): { sourceId: string; targetId: string; type: string; props: Record<string, any> } | null {
    if (!this.edgeKeyIndex.hasEntity(edgeId)) return null;

    const sourceId = (this.edgeData.get(`${edgeId}:__sourceId`) as string) ?? '';
    const targetId = (this.edgeData.get(`${edgeId}:__targetId`) as string) ?? '';
    const rawType = this.edgeKeyIndex.getEntityType(edgeId) ?? '';
    const dkm = new ScopedDualKeyMap(this.edgeData, edgeId, this.edgeKeyIndex);
    const rawProps = dkm.getAll();

    if (this.lens) {
      const decodedProps = this.lens.decodeAndFilterProperties(rawType, rawProps, 'RelationshipType');
      return { sourceId, targetId, type: rawType, props: this.flattenProxyProps(decodedProps) };
    }

    return { sourceId, targetId, type: rawType, props: this.resolveProps(rawProps) };
  }

  private flattenProxyProps(appProps: Record<string, any>): Record<string, any> {
    const flat: Record<string, any> = {};
    for (const key of Object.keys(appProps)) {
      const val = appProps[key];
      if (val !== undefined) flat[key] = val;
    }
    return flat;
  }

  private resolveProps(rawProps: Record<string, any>): Record<string, any> {
    const resolved: Record<string, any> = {};
    for (const [key, value] of Object.entries(rawProps)) {
      if (key.startsWith('__')) continue;
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        const values = Object.values(value);
        if (values.length > 0) resolved[key] = values[0];
      } else {
        resolved[key] = value;
      }
    }
    return resolved;
  }

  private enqueue(op: DatabaseOperation): void {
    this.pendingOps.push(op);
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.flushTimer !== null) return;
    this.flushTimer = setTimeout(() => this.flush(), this.options.debounceMs);
  }

  private flush(): void {
    this.flushTimer = null;
    const ops = this.pendingOps.splice(0);
    if (ops.length === 0) return;
    void this.executeWithRetry(ops);
  }

  private flushImmediate(): void {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    const ops = this.pendingOps.splice(0);
    if (ops.length === 0) return;
    void this.executeWithRetry(ops);
  }

  private async executeWithRetry(ops: DatabaseOperation[]): Promise<void> {
    try {
      await this.driver.executeBatch(ops);
      for (const handler of this.syncHandlers) handler(ops);
    } catch (err) {
      for (const handler of this.errorHandlers) handler(err as Error, ops);
    }
  }
}