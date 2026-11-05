import express from 'express';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { LensedPropertyGraph } from './LensEngine/LensedPropertyGraph';
import { DatabaseDriver } from './Connectors/connector';
import { Neo4jConnector } from './Connectors/neo4jConnector';
import { YjsDBSync } from './Connectors/yjsDBSync';
import { snbFullSchemaDef_YCSB } from './Helper/Schema/Snb_Full_Schema_YCSB';
import { PropertyGraph } from './GraphDB_CRDT/PropertyGraph';

const PORT = Number(process.env.PORT) || 3001;

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
const doc = new Y.Doc();

const wsProvider = new WebsocketProvider(
  process.env.WS_SERVER_URL || 'ws://localhost:1234',
  'refract-shared-room',
  doc
);

wsProvider.on('status', (event: any) => {
  console.log(`WebSocket Sync Status: ${event.status}`);
});

const whatSystem = process.env.WHAT_SYSTEM || 'fullRefract'; // fullRefract, graphOnly

// The fullRefract System
let lpg: LensedPropertyGraph;
let schema: any;
let lens: any ;
let pg: PropertyGraph;
if (whatSystem === 'fullRefract') {
lpg = new LensedPropertyGraph({ doc, predefinedSchema: snbFullSchemaDef_YCSB });
schema = lpg.getSchemaInteraction();
lens = lpg.getLensEngine();
} else {

// just the GraphDB (eagerMigration needed)
pg = new PropertyGraph(doc);
}

let sync: YjsDBSync | null = null;
let driver: DatabaseDriver | null = null;
const decideDriver = (): DatabaseDriver | null => {
    switch (process.env.DB_DRIVER) {
    case 'none':
        return null;
    case 'neo4j':
        driver = new Neo4jConnector();
        break;
    default:
        driver = null;
    }
    return driver;
};

async function init() {
  const driverType = process.env.DB_DRIVER || 'neo4j';
  if (driverType === 'none') {
    console.log('Running in PURE MIDDLEWARE mode (no database database, no sync bridge).');
    return;
  }

  driver = decideDriver();
  if (!driver) return;
  
  await driver.connect();
  console.log(`DB connected: ${driverType}`);

  sync = new YjsDBSync(doc, driver, {
    lensedPG: lpg,
    lens,
    schemaDoc: schema.yjsDoc, // same as doc for current development :D
    debounceMs: 100,
    initialSync: true,
  });

  sync.on('sync', (ops: any[]) => console.log(`Synced ${ops.length} ops`));
  sync.on('error', (err: Error, ops: any[]) => console.error(`Sync failed (${ops.length} ops):`, err.message));
  sync.start();
  console.log('Sync bridge started' + whatSystem);
}

app.post('/nodes/:id', (req, res) => {
  try {
    const id = req.params.id;
    const type = (req.query.type as string) || 'Person';
    const exists = doc.getMap('pg_node_data').has(`${id}:__type`);
    if (exists) {
      return res.json({ ok: true, nodeId: id });
    }
    if (whatSystem === 'fullRefract') {
      lpg.addNode({ nodeId: id, type, props: req.body });
    } else {
      pg.addNode({ doc: doc, nodeId: id, type, props: req.body });
    }
    res.json({ ok: true, nodeId: id });
  } catch (e: any) {
    console.error(`[API ERROR] POST /nodes/${req.params.id} failed:`, e.message);
    res.status(400).json({ error: e.message });
  }
});

app.put('/nodes/:id', (req, res) => {
  try {
    const id = req.params.id;
        if (whatSystem === 'fullRefract') {
      lpg.updateNode({ nodeId: id, props: req.body });
    } else {
      pg.updateNode({ doc: doc, nodeId: id, props: req.body });
    }
    res.json({ ok: true });
  } catch (e: any) {
    console.error(`[API ERROR] PUT /nodes/${req.params.id} failed:`, e.message);
    res.status(400).json({ error: e.message });
  }
});

app.get('/nodes/:id', (req, res) => {
  try {
    const id = req.params.id;
    if (whatSystem === 'fullRefract') {
      const node = lpg.getLensedNode(id);
      if (!node) return res.status(404).json({ error: 'node not found' });
      res.json(node.appProps);
    } else {
      const node = pg.getRawNode(doc, id);
      if (!node) return res.status(404).json({ error: 'node not found' });
      res.json(node.props);
    }
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/nodes/:id', (req, res) => {
  try {
    const id = req.params.id;
    const exists = doc.getMap('pg_node_data').has(`${id}:__type`);
    if (!exists) {
      return res.json({ ok: true });
    }
    if (whatSystem === 'fullRefract') {
      lpg.deleteNode({ nodeId: id });
    } else {
      pg.deleteNode({ doc: doc, nodeId: id });
    }
    res.json({ ok: true });
  } catch (e: any) {
    // res.json({ ok: true });
    res.status(400).json({ error: e.message });
  }
});

app.post('/edges/:id/:sourceId/:targetId', (req, res) => {
  try {
    const { id, sourceId, targetId } = req.params;
    const type = (req.query.type as string) || 'KNOWS';
    const edgeId = lpg.addEdge({ sourceId, targetId, type, props: req.body, edgeId: id });
    res.json({ ok: true, edgeId });
  } catch (e: any) {
    console.error(`[API ERROR] POST /edges/${req.params.id}/${req.params.sourceId}/${req.params.targetId} failed:`, e.message);
    res.status(400).json({ error: e.message });
  }
});


app.post('/edges/:id', (req, res) => {
  try {
    const id = req.params.id;
    const { sourceId, targetId, type = 'KNOWS' } = req.body;
    if (!sourceId || !targetId) {
      return res.status(400).json({ error: 'sourceId and targetId required in JSON body' });
    }
    const props = { ...req.body };
    delete props.sourceId;
    delete props.targetId;
    delete props.type;
    
    const edgeId = lpg.addEdge({ sourceId, targetId, type, props, edgeId: id });
    res.json({ ok: true, edgeId });
  } catch (e: any) {
    console.error(`[API ERROR] POST /edges/${req.params.id} failed:`, e.message);
    res.status(400).json({ error: e.message });
  }
});

app.post('/edges', (req, res) => {
  try {
    const { sourceId, targetId, type, props = {}, edgeId } = req.body;
    if (!sourceId || !targetId || !type) return res.status(400).json({ error: 'sourceId, targetId, type required' });
    const id = lpg.addEdge({ sourceId, targetId, type, props, edgeId });
    res.json({ ok: true, edgeId: id });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/edges/:id', (req, res) => {
  try {
    const id = req.params.id;
    const edge = lpg.getLensedEdge(id);
    if (!edge) return res.status(404).json({ error: 'edge not found' });
    res.json(edge.appProps);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/edges/:id', (req, res) => {
  try {
    const id = req.params.id;
    lpg.updateEdge({ edgeId: id, props: req.body });
    res.json({ ok: true });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

app.delete('/edges/:id', (req, res) => {
  try {
    lpg.deleteEdge({ edgeId: req.params.id });
    res.json({ ok: true });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/graph', (_req, res) => {
  try {
    const { lensedNodes, lensedEdges } = lpg.getVisibleGraph({ lazy: false });
    res.json({
      nodes: lensedNodes.map((n: any) => ({ id: n.id, type: n.type, labels: n.label, props: n.appProps })),
      edges: lensedEdges.map((e: any) => ({ id: e.id, type: e.type, sourceId: e.sourceId, targetId: e.targetId, props: e.appProps })),
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/schema', (_req, res) => {
  try {
    if (whatSystem === 'fullRefract') {
    const schemaJson = lpg.getSchemaInteraction().transformToJSONCleanSchema();
    res.json(schemaJson);
    } else {
      res.status(400).json({ error: 'Schema evolution endpoints are only available in fullRefract mode.' });
    }
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// did not want to change name before submitting as it could break something before the deadline
app.post('/schema/smo/rename-property', (req, res) => {
  try {
    if (whatSystem !== 'fullRefract') {
        const graph = pg.getFullVisibleGraph(doc);
        const nodes = graph.nodes;
        nodes.forEach(n =>
          pg.updateNode({doc, nodeId: n.id, props: {prop: "newType"} })
        )
        res.json({ ok: true, message: 'Added Label to NT' });
        return;
    }
    const { identifying, oldPropertyKey, newPropertyKey } = req.body;
    if (!identifying || !oldPropertyKey || !newPropertyKey) {
      return res.status(400).json({ error: 'Missing parameters: identifying, oldPropertyKey, newPropertyKey are required.' });
    }
    
    lpg.getSchemaInteraction().SMO_renamePropertyKey({
      Idenifying: identifying,
      oldPropertyKey,
      newPropertyKey,
      whatType: 'NodeType'
    });
    
    res.json({ ok: true, message: `Renamed property "${oldPropertyKey}" to "${newPropertyKey}" on node type "${identifying}"` });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/schema/smo/add-property', (req, res) => {
  try {
    const { identifying, key, value, defaultValue } = req.body;
    if (!identifying || !key || !value) {
      return res.status(400).json({ error: 'Missing parameters: identifying, key, value are required.' });
    }

    lpg.getSchemaInteraction().SMO_AddPropertyType({
      Idenifying: identifying,
      newProperty: { key, value },
      defa: defaultValue,
      whatType: 'NodeType'
    });

    res.json({ ok: true, message: `Added property "${key}" (type: ${value}) to node type "${identifying}"` });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/graph/neo4j', async (_req, res) => {
  try {
    if (!driver) return res.status(400).json({ error: 'Database connector is not enabled (running in pure middleware mode).' });
    const result = await driver.queryFullGraph();
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/graph/compare', async (_req, res) => {
  try {
    if (!driver) return res.status(400).json({ error: 'Database connector is not enabled (running in pure middleware mode).' });
    const { lensedNodes, lensedEdges } = lpg.getVisibleGraph({ lazy: false });
    const neo4j = await driver.queryFullGraph();
    res.json({
      yjs: { nodeCount: lensedNodes.length, edgeCount: lensedEdges.length },
      neo4j: { nodeCount: neo4j.nodes.length, edgeCount: neo4j.edges.length },
      match: lensedNodes.length === neo4j.nodes.length && lensedEdges.length === neo4j.edges.length,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/sync/push', (_req, res) => {
  try {
    if (!sync) return res.status(400).json({ error: 'Sync bridge is not enabled (running in pure middleware mode).' });
    sync.pushFullState();
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

init()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`REFRACT running on http://localhost:${PORT}`);
      console.log('  POST   /nodes/:id      Create node (YCSB compatible)');
      console.log('  PUT    /nodes/:id      Update node (YCSB compatible)');
      console.log('  GET    /nodes/:id      Read node (YCSB compatible)');
      console.log('  DELETE /nodes/:id      Delete node (YCSB compatible)');
      console.log('  POST   /edges/:id/:sourceId/:targetId  Create edge (YCSB compatible)');
      console.log('  PUT    /edges/:id      Update edge properties');
      console.log('  GET    /edges/:id      Read edge properties');
      console.log('  DELETE /edges/:id      Delete edge');
      console.log('  GET    /graph          Lensed Yjs view');
      console.log('  GET    /graph/neo4j    Raw Neo4j view');
      console.log('  GET    /graph/compare  Compare counts');
      console.log('  GET    /sync/status');
      console.log('  POST   /sync/retry');
      console.log('  POST   /sync/push');
    });
  })
  .catch((err) => {
    console.error('Failed to start:', err);
    process.exit(1);
  });
