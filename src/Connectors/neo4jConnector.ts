import * as fs from 'fs';
import neo4j, { Driver, Session, ManagedTransaction } from 'neo4j-driver';
import {   DatabaseDriver } from './connector';
import { DatabaseOperation } from './types_interfaces';

const config = {
  uri: process.env.NEO4J_URI || "bolt://localhost:7687",
  username: process.env.NEO4J_USER || "neo4j",
  password: process.env.NEO4J_PASSWORD || "password",
  database: process.env.NEO4J_DATABASE || "neo4j"
}

export class Neo4jConnector implements DatabaseDriver {
  private driver: Driver | null = null;
  private readonly config: { uri: string; username: string; password: string; database?: string };
  constructor() {
    this.config = config;
  }

  async connect(): Promise<void> {
    this.driver = neo4j.driver(
      this.config.uri,
      neo4j.auth.basic(this.config.username, this.config.password),
    );
    await this.driver.verifyConnectivity();
  }

  async disconnect(): Promise<void> {
    if (this.driver) {
      await this.driver.close();
      this.driver = null;
    }
  }

  isConnected(): boolean {
    return this.driver !== null;
  }

  async upsertNode(nodeId: string, type: string, props: Record<string, any>): Promise<void> {
    const session = this.getSession();
    try {
      const label = this.sanitize(type);
      const cleaned = this.cleanProps(props);
      await session.run(
        `MERGE (n {id: $nodeId})
         SET n:\`${label}\`, n.type = $type, n += $props`,
        { nodeId, type, props: cleaned },
      );
    } finally {
      await session.close();
    }
  }

  async deleteNode(nodeId: string): Promise<void> {
    const session = this.getSession();
    try {
      await session.run(
        `MATCH (n {id: $nodeId}) DETACH DELETE n`,
        { nodeId },
      );
    } finally {
      await session.close();
    }
  }

  async setNodeProperty(
    nodeId: string,
    key: string,
    value: any,
  ): Promise<void> {
    const session = this.getSession();
    try {
      const safeKey = this.sanitize(key);
      await session.run(
        `MATCH (n {id: $nodeId}) SET n.\`${safeKey}\` = $value`,
        { nodeId, value },
      );
    } finally {
      await session.close();
    }
  }

  async upsertEdge(
    edgeId: string,
    sourceId: string,
    targetId: string,
    type: string,
    props: Record<string, any>,
  ): Promise<void> {
    const session = this.getSession();
    try {
      const relType = this.sanitize(type);
      const cleaned = this.cleanProps(props);
      await session.run(
        `MATCH (s {id: $sourceId}), (t {id: $targetId})
         MERGE (s)-[r:\`${relType}\` {id: $edgeId}]->(t)
         SET r += $props`,
        { sourceId, targetId, edgeId, props: cleaned },
      );
    } finally {
      await session.close();
    }
  }

  async deleteEdge(edgeId: string): Promise<void> {
    const session = this.getSession();
    try {
      await session.run(
        `MATCH ()-[r {id: $edgeId}]->() DELETE r`,
        { edgeId },
      );
    } finally {
      await session.close();
    }
  }

  async setEdgeProperty(
    edgeId: string,
    key: string,
    value: any,
  ): Promise<void> {
    const session = this.getSession();
    try {
      const safeKey = this.sanitize(key);
      await session.run(
        `MATCH ()-[r {id: $edgeId}]->() SET r.\`${safeKey}\` = $value`,
        { edgeId, value },
      );
    } finally {
      await session.close();
    }
  }

  async queryFullGraph(): Promise<{ nodes: any[]; edges: any[] }> {
    const session = this.getSession();
    try {
      const result = await session.run(
        `MATCH (n)
         OPTIONAL MATCH (n)-[r]->(m)
         RETURN n, r, m`,
      );

      const nodesById = new Map<string, any>();
      const edgesById = new Map<string, any>();

      for (const record of result.records) {
        const n = record.get('n');
        if (n && !nodesById.has(n.properties.id)) {
          nodesById.set(n.properties.id, { ...n.properties, _labels: n.labels });
        }

        const m = record.get('m');
        if (m && !nodesById.has(m.properties.id)) {
          nodesById.set(m.properties.id, { ...m.properties, _labels: m.labels });
        }

        const r = record.get('r');
        if (r && !edgesById.has(r.properties.id)) {
          edgesById.set(r.properties.id, {
            ...r.properties,
            _type: r.type,
            _startNodeId: n.properties.id,
            _endNodeId: m.properties.id,
          });
        }
      }

      return {
        nodes: Array.from(nodesById.values()),
        edges: Array.from(edgesById.values()),
      };
    } finally {
      await session.close();
    }
  }

  async executeBatch(operations: DatabaseOperation[]): Promise<void> {
    if (operations.length === 0) return;

    const session = this.getSession();
    try {
      await session.executeWrite(async (tx: ManagedTransaction) => {
        for (const op of operations) {
          await this.executeOperation(tx, op);
        }
      });
    } finally {
      await session.close();
    }
  }

  private getSession(): Session {
    if (!this.driver) {
      throw new Error('Neo4jConnector is not connected. Call connect() first.');
    }
    return this.driver.session({
      database: this.config.database ?? 'neo4j',
    });
  }

  // safe is safe to prevent illigal caracters
  private sanitize(name: string): string {
    return name.replace(/[^a-zA-Z0-9_]/g, '');
  }

  private cleanProps(props: Record<string, any>): Record<string, any> {
    const cleaned: Record<string, any> = {};
    for (const [key, value] of Object.entries(props)) {
      if (key.startsWith('__')) continue;

      if (value === null || value === undefined) {
        // null equals not defined, so we skip it. 
        continue;
      }

      if (
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean'
      ) {
        cleaned[key] = value;
      } else if (Array.isArray(value) && value.every((v) => typeof v !== 'object')) {
        cleaned[key] = value;
      } else {
        cleaned[key] = JSON.stringify(value);
      }
    }
    return cleaned;
  }

  private async executeOperation(
    tx: ManagedTransaction,
    op: DatabaseOperation,
  ): Promise<void> {
    switch (op.op) {
      case 'upsertNode': {
        const label = this.sanitize(op.type);
        const cleaned = this.cleanProps(op.props);
        await tx.run(
          `MERGE (n {id: $nodeId})
           SET n:\`${label}\`, n.type = $type, n += $props`,
          { nodeId: op.nodeId, type: op.type, props: cleaned },
        );
        break;
      }

      case 'deleteNode': {
        await tx.run(
          `MATCH (n {id: $nodeId}) DETACH DELETE n`,
          { nodeId: op.nodeId },
        );
        break;
      }

      case 'upsertEdge': {
        const relType = this.sanitize(op.type);
        const cleaned = this.cleanProps(op.props);
        await tx.run(
          `MATCH (s {id: $sourceId}), (t {id: $targetId})
           MERGE (s)-[r:\`${relType}\` {id: $edgeId}]->(t)
           SET r += $props`,
          {
            sourceId: op.sourceId,
            targetId: op.targetId,
            edgeId: op.edgeId,
            props: cleaned,
          },
        );
        break;
      }

      case 'deleteEdge': {
        await tx.run(
          `MATCH ()-[r {id: $edgeId}]->() DELETE r`,
          { edgeId: op.edgeId },
        );
        break;
      }

      case 'setNodeProperty': {
        const safeKey = this.sanitize(op.key);
        await tx.run(
          `MATCH (n {id: $nodeId}) SET n.\`${safeKey}\` = $value`,
          { nodeId: op.nodeId, value: op.value },
        );
        break;
      }

      case 'setEdgeProperty': {
        const safeKey = this.sanitize(op.key);
        await tx.run(
          `MATCH ()-[r {id: $edgeId}]->() SET r.\`${safeKey}\` = $value`,
          { edgeId: op.edgeId, value: op.value },
        );
        break;
      }

      default: {
        const _exhaustive: never = op;
        throw new Error(`Unknown operation: ${(_exhaustive as any).op}`);
      }
    }
  }
}
