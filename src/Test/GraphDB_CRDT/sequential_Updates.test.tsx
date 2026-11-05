import * as Y from 'yjs';
import { PropertyGraph } from '../../GraphDB_CRDT/PropertyGraph';
import { getDoc } from '../../Helper/helper';
import { unpackProp } from '../../Test/Helper';
import { GraphCRDTError } from '../../Helper/ErrorDefinition';

describe('Sequential Updates - basic operations', () => {
    let doc: Y.Doc;
    let pg: PropertyGraph;

    beforeEach(() => {
        doc = getDoc();
        pg = new PropertyGraph(doc);
    });
    describe('Adding', () => {
        test('AN - Adding nodes', () => {
            pg.addNode({ doc, nodeId: '1', type: 'Person', props: { name: 'Alice' } });
            pg.addNode({ doc, nodeId: '2', type: 'Person', props: { name: 'Bob' } });

            const visibleNodes = pg.getVisibleNodes(doc);
            expect(visibleNodes.length).toBe(2);
            const aliceNode = visibleNodes.find(node => node.id === '1');
            const bobNode = visibleNodes.find(node => node.id === '2');
            expect(aliceNode).not.toBeNull();
            expect(unpackProp(aliceNode!.props!.name)).toBe('Alice');
            expect(aliceNode!.type).toBe('Person');
            expect(bobNode).not.toBeNull();
            expect(unpackProp(bobNode!.props!.name)).toBe('Bob');
            expect(bobNode!.type).toBe('Person');

            // errors tests readding the same node
            expect(() => pg.addNode({ doc, nodeId: '1', type: 'Person' })).toThrow(GraphCRDTError);
        });
        test('AE - Adding edges', () => {
            // We need some nodes to connect with edges
            pg.addNode({ doc, nodeId: '1', type: 'Person', props: { name: 'Alice' } });
            pg.addNode({ doc, nodeId: '2', type: 'Person', props: { name: 'Bob' } });

            // basic edge addition test
            const edgeId12 = pg.addEdge({ doc, sourceId: '1', targetId: '2', type: 'KNOWS', props: { since: 2020 } });
            const edgeId21 = pg.addEdge({ doc, sourceId: '2', targetId: '1', type: 'KNOWS', props: { since: 2021 } });

            const visibleGraph = pg.getFullVisibleGraph(doc);
            expect(visibleGraph.nodes.length).toBe(2);
            expect(visibleGraph.edges.length).toBe(2);

            const edge12 = visibleGraph.edges.find(edge => edge.id === edgeId12);
            expect(edge12).not.toBeNull();
            expect(unpackProp(edge12!.props!.since)).toBe(2020);
            expect(edge12!.type).toBe('KNOWS');
            expect(edge12!.sourceId).toBe('1');
            expect(edge12!.targetId).toBe('2');

            const edge21 = visibleGraph.edges.find(edge => edge.id === edgeId21);
            expect(edge21).not.toBeNull();
            expect(unpackProp(edge21!.props!.since)).toBe(2021);
            expect(edge21!.type).toBe('KNOWS');
            expect(edge21!.sourceId).toBe('2');
            expect(edge21!.targetId).toBe('1');

            // errors: 1. Adding an edge with an existing edgeId, 2. Adding an edge with a non-existing sourceId, 3. Adding an edge with a non-existing targetId
            expect(() => pg.addEdge({ doc, sourceId: '1', targetId: '2', type: 'KNOWS', props: { since: 2020 }, edgeId: edgeId12 })).toThrow(GraphCRDTError);
            expect(() => pg.addEdge({ doc, sourceId: 'wrongId', targetId: '2', type: 'KNOWS', props: { since: 2020 }, edgeId: "1111" })).toThrow(GraphCRDTError);
            expect(() => pg.addEdge({ doc, sourceId: '1', targetId: 'wrongId', type: 'KNOWS', props: { since: 2020 }, edgeId: "324e343" })).toThrow(GraphCRDTError);

            // multiedge test
            const edgeId12_2 = pg.addEdge({ doc, sourceId: '1', targetId: '2', type: 'FRIENDS', props: { since: 2022 } });
            const visibleGraph2 = pg.getFullVisibleGraph(doc);
            expect(visibleGraph2.edges.length).toBe(3);
            const edge12_2 = visibleGraph2.edges.find(edge => edge.id === edgeId12_2);
            expect(edge12_2).not.toBeNull();
            expect(unpackProp(edge12_2!.props!.since)).toBe(2022);
            expect(edge12_2!.type).toBe('FRIENDS');
            expect(edge12_2!.sourceId).toBe('1');
            expect(edge12_2!.targetId).toBe('2');

            // self-loop test 
            const edgeIdSelfLoop = pg.addEdge({ doc, sourceId: '1', targetId: '1', type: 'SELF_LOOP', props: { since: 2023 } });
            const visibleGraph3 = pg.getFullVisibleGraph(doc);
            expect(visibleGraph3.edges.length).toBe(4);
            const edgeSelfLoop = visibleGraph3.edges.find(edge => edge.id === edgeIdSelfLoop);
            expect(edgeSelfLoop).not.toBeNull();
            expect(unpackProp(edgeSelfLoop!.props!.since)).toBe(2023);
            expect(edgeSelfLoop!.type).toBe('SELF_LOOP');
            expect(edgeSelfLoop!.sourceId).toBe('1');
            expect(edgeSelfLoop!.targetId).toBe('1');
        });
    });

    describe('Props Updates / Deleting', () => {
        test('UN - Updating node properties', () => {
            pg.addNode({ doc, nodeId: '1', type: 'Person', props: { name: 'Alice', age: 30 } });

            pg.updateNode({ doc, nodeId: '1', props: { age: 31, city: 'New York' } });
            const visibleNodes = pg.getVisibleNodes(doc);
            expect(visibleNodes.length).toBe(1);
            const aliceNode = visibleNodes[0];
            expect(aliceNode.id).toBe('1');
            expect(unpackProp(aliceNode.props!.name)).toBe('Alice');
            expect(unpackProp(aliceNode.props!.age)).toBe(31);
            expect(unpackProp(aliceNode.props!.city)).toBe('New York');

            // error
            expect(() => pg.updateNode({ doc, nodeId: 'wrongId', props: { age: 31 } })).toThrow(GraphCRDTError);

        });
        test('UE - Updating edge properties', () => {
            pg.addNode({ doc, nodeId: '1', type: 'Person', props: { name: 'Alice' } });
            pg.addNode({ doc, nodeId: '2', type: 'Person', props: { name: 'Bob' } });
            const edgeId = pg.addEdge({ doc, sourceId: '1', targetId: '2', type: 'KNOWS', props: { since: 2020, metAt: 'Conference' } });
            pg.updateEdge({ doc, edgeId, props: { since: 2021, friendly: true } });
            const visibleGraph = pg.getFullVisibleGraph(doc);
            expect(visibleGraph.edges.length).toBe(1);
            const edge = visibleGraph.edges[0];
            expect(edge.id).toBe(edgeId);
            expect(unpackProp(edge.props!.since)).toBe(2021);
            expect(unpackProp(edge.props!.metAt)).toBe('Conference');
            expect(unpackProp(edge.props!.friendly)).toBe(true);

            // error
            expect(() => pg.updateEdge({ doc, edgeId: 'wrongId', props: { since: 2021 } })).toThrow(GraphCRDTError);
        });
        test('Deleting node properties', () => {
            pg.addNode({ doc, nodeId: '1', type: 'Person', props: { name: 'Alice', age: 30, city: 'New York' } });
            pg.deleteNodeProperty({ doc, nodeId: '1', propKeys: ['age', 'city'] });
            const visibleNodes = pg.getVisibleNodes(doc);
            expect(visibleNodes.length).toBe(1);
            const aliceNode = visibleNodes[0];
            expect(aliceNode.id).toBe('1');
            expect(unpackProp(aliceNode.props!.name)).toBe('Alice');
            expect(aliceNode.props!.age).toBeUndefined();
            expect(unpackProp(aliceNode.props!.city)).toBeUndefined();

            // error 
            expect(() => pg.deleteNodeProperty({ doc, nodeId: 'wrongId', propKeys: ['age'] })).toThrow(GraphCRDTError);
        });
        test('Deleting edge properties', () => {
            pg.addNode({ doc, nodeId: '1', type: 'Person', props: { name: 'Alice' } });
            pg.addNode({ doc, nodeId: '2', type: 'Person', props: { name: 'Bob' } });

            const edgeId = pg.addEdge({ doc, sourceId: '1', targetId: '2', type: 'KNOWS', props: { since: 2020, metAt: 'Conference' } });

            pg.deleteEdgeProperty({ doc, edgeId, propKeys: ['metAt'] });
            const visibleGraph = pg.getFullVisibleGraph(doc);
            expect(visibleGraph.edges.length).toBe(1);
            const edge = visibleGraph.edges[0];
            expect(edge.id).toBe(edgeId);
            expect(unpackProp(edge.props!.since)).toBe(2020);
            expect(edge.props!.metAt).toBeUndefined();

            // error
            expect(() => pg.deleteEdgeProperty({ doc, edgeId: 'wrongId', propKeys: ['metAt'] })).toThrow(GraphCRDTError);
        });
    });

    describe('Deleting', () => {
        test('Deleting an Edge (test also reference cleanup)', () => {

            pg.addNode({ doc, nodeId: 'Alice', type: 'Person', props: { name: 'Alice' } });
            pg.addNode({ doc, nodeId: 'Bob', type: 'Person', props: { name: 'Bob' } });

            const edgeId = pg.addEdge({ doc, sourceId: 'Alice', targetId: 'Bob', type: 'KNOWS', props: { since: 2020 }, edgeId: 'e1' });
            expect(edgeId).toBe('e1');

            const ingoingEdges = pg.getIncomingEdgeIds(doc, 'Bob');
            const outgoingEdges = pg.getOutgoingEdgeIds(doc, 'Alice');
            expect(ingoingEdges).toContain('e1');
            expect(outgoingEdges).toContain('e1');
            expect(pg.getRawEdgeById(doc, 'e1')).not.toBeNull();

            pg.deleteEdge({ doc, edgeId: 'e1' });

            expect(pg.getRawEdgeById(doc, 'e1')).toBeNull();

            const ingoingEdges1 = pg.getIncomingEdgeIds(doc, 'Bob');
            const outgoingEdges1 = pg.getOutgoingEdgeIds(doc, 'Alice');
            expect(ingoingEdges1).not.toContain('e1');
            expect(outgoingEdges1).not.toContain('e1');

            // error 
            expect(() => pg.deleteEdge({ doc, edgeId: 'wrongId' })).toThrow(GraphCRDTError);
        });

        test.skip('Deleting a node cascades deletion to connected edges and cleans up pg_edgesTargets', () => {
            pg.addNode({ doc, nodeId: 'Alice', type: 'Person', props: { name: 'Alice' } });
            pg.addNode({ doc, nodeId: 'Bob', type: 'Person', props: { name: 'Bob' } });
            pg.addNode({ doc, nodeId: 'Charlie', type: 'Person', props: { name: 'Charlie' } });

            pg.addEdge({ doc, sourceId: 'Alice', targetId: 'Bob', type: 'KNOWS', edgeId: 'e1' });
            pg.addEdge({ doc, sourceId: 'Bob', targetId: 'Charlie', type: 'KNOWS', edgeId: 'e2' });

            const ingoingEdgesBob = pg.getIncomingEdgeIds(doc, 'Bob');
            const outgoingEdgesBob = pg.getOutgoingEdgeIds(doc, 'Bob');
            expect(ingoingEdgesBob).toContain('e1');
            expect(outgoingEdgesBob).toContain('e2');
            
            pg.deleteNode({ doc, nodeId: 'Bob' });
            expect(pg.getRawNode(doc, 'Bob')).toBeNull();

            const ingoingEdgesBobAfter = pg.getIncomingEdgeIds(doc, 'Bob');
            const outgoingEdgesBobAfter = pg.getOutgoingEdgeIds(doc, 'Bob');
            expect(ingoingEdgesBobAfter).not.toContain('e1');
            expect(outgoingEdgesBobAfter).not.toContain('e2');

            // error 
            expect(() => pg.deleteNode({ doc, nodeId: 'wrongId' })).toThrow(GraphCRDTError);
        });
    });
});