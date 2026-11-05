import * as Y from 'yjs';
import { PropertyGraph } from '../../GraphDB_CRDT/PropertyGraph';
import { getDoc } from '../../Helper/helper';
import { unpackProp } from '../../Test/Helper';
import { bidirectionalSync, trialSync } from '../../Helper/sync';

describe('Sequential Updates - basic operations', () => {
    let doc1: Y.Doc;
    let doc2: Y.Doc;
    let pg1: PropertyGraph;
    let pg2: PropertyGraph;

    beforeEach(() => {
        // doc2 will always win the clientID tie-breaker in the tests
        doc1 = getDoc(1);
        doc2 = getDoc(2);
        pg1 = new PropertyGraph(doc1);
        pg2 = new PropertyGraph(doc2);
    });
    describe('CREATE NODE ROW', () => {
        test('CC_n', () => {
            pg1.addNode({ doc: doc1, nodeId: '1', type: 'Person', props: { name: 'Alice', address: 'Mainstreet' } });
            pg2.addNode({ doc: doc2, nodeId: '1', type: 'Person', props: { name: 'Bob' } });

            bidirectionalSync(doc1, doc2);

            const visibleNodes1 = pg1.getVisibleNodes(doc1);

            expect(visibleNodes1.length).toBe(1);
            expect(visibleNodes1[0].id).toBe('1');
            expect(unpackProp(visibleNodes1[0].props!.name)).toBe('Bob');
            // not overwritten because the address property was not set in doc2
            expect(unpackProp(visibleNodes1[0].props!.address)).toBe('Mainstreet');
            expect(visibleNodes1[0].type).toBe('Person');
            const visibleNodes2 = pg2.getVisibleNodes(doc2);
            expect(visibleNodes1).toEqual(visibleNodes2);
        });
        /* Based on the concurrency table not needed, but I wrote it and it is a good test case to have */
        test.skip("CC_ne", () => {
            pg1.addNode({ doc: doc1, nodeId: '1', type: 'Person', props: { name: 'Alice' } });
            bidirectionalSync(doc1, doc2);

            pg1.addNode({ doc: doc1, nodeId: '2', type: 'Person', props: { name: 'Bob' } });
            pg2.addNode({ doc: doc2, nodeId: '2', type: 'Person', props: { name: 'Bob' } });    
            pg2.addEdge({ doc: doc2, sourceId: '1', targetId: '2', type: 'KNOWS', props: { since: 2020 } });

            bidirectionalSync(doc1, doc2);
            expect(pg1.getVisibleNodes(doc1)).toEqual(pg2.getVisibleNodes(doc2));
            
        });
        // important to note: Updates will win over Adds even if the Add is done by an higher clientID.
        test("CU_n", () => {
            pg1.addNode({ doc: doc1, nodeId: '1', type: 'Person', props: { name: 'Alice', address: '123 Main St' } });
            pg1.updateNode({ doc: doc1, nodeId: '1', props: { name: 'Bob1' } });
            pg2.addNode({ doc: doc2, nodeId: '1', type: 'Person', props: { name: 'Bob2' } });

            bidirectionalSync(doc1, doc2);

            const visibleNodes1 = pg1.getVisibleNodes(doc1);
            const node = visibleNodes1.find(n => n.id === '1');
            expect(node).toBeDefined();
            expect(unpackProp(node!.props!.name)).toBe('Bob1');
            expect(unpackProp(node!.props!.address)).toBe('123 Main St');
            expect(visibleNodes1).toEqual(pg2.getVisibleNodes(doc2));
            
        });
        test("CR_n", () => {
            // extendet to test the case of the nodeType undefined situation; with a doc that is weaker than the others
            // see getMapType in PropertyGraph.ts for details
            // eventho the higest clientId wins the node is still there via the observed remove strategy
            const doc3 = getDoc(3);
            const pg3 = new PropertyGraph(doc3);
            pg1.addNode({ doc: doc1, nodeId: '1', type: 'TEST', props: { name: 'Charlie', address: '123 Main St' } });
            pg3.addNode({ doc: doc3, nodeId: '1', type: 'Person', props: { name: 'Alice', address: '456 Oak Ave', hat: true } });
            pg3.deleteNode({ doc: doc3, nodeId: '1' });
            pg2.addNode({ doc: doc2, nodeId: '1', type: 'Person', props: { name: 'Bob', dance: true } });

            trialSync(doc3, doc1, doc2);

            const visibleNodes1 = pg1.getVisibleNodes(doc1);
            expect(visibleNodes1.length).toBe(1);
            expect(visibleNodes1[0].id).toBe('1');
            expect(visibleNodes1[0].type).toBe('Person');
            expect(unpackProp(visibleNodes1[0].props!.name)).toBe('Bob');
            expect(unpackProp(visibleNodes1[0].props!.address)).toBe('123 Main St');
            expect(unpackProp(visibleNodes1[0].props!.dance)).toBe(true);
            expect(unpackProp(visibleNodes1[0].props!.hat)).toBeUndefined();
            expect(visibleNodes1[0].type).toBe('Person');
            expect(pg1.getVisibleNodes(doc1)).toEqual(pg2.getVisibleNodes(doc2));
            expect(pg1.getVisibleNodes(doc1)).toEqual(pg3.getVisibleNodes(doc3));
        });
    });
    describe('CREATE EDGE ROW', () => {
        test('CC_e', () => {
            pg1.addNode({ doc: doc1, nodeId: '1', type: 'Person', props: { name: 'Alice' } });
            pg1.addNode({ doc: doc1, nodeId: '2', type: 'Person', props: { name: 'Bob' } });

            bidirectionalSync(doc1, doc2);

            pg1.addEdge({ doc: doc1, sourceId: '1', targetId: '2', type: 'KNOWS', props: { since: 2020, dance: true }, edgeId: 'e1' });
            pg2.addEdge({ doc: doc2, sourceId: '1', targetId: '2', type: 'KNOWS', props: { since: 2021, hat: true }, edgeId: 'e1' });

            bidirectionalSync(doc1, doc2);

            const visgraph1 = pg1.getFullVisibleGraph(doc1);
            const edge = visgraph1.edges.find(e => e.id === 'e1');
            expect(edge).toBeDefined();
            expect(unpackProp(edge!.props!.since)).toBe(2021);
            expect(unpackProp(edge!.props!.dance)).toBe(true);
            expect(unpackProp(edge!.props!.hat)).toBe(true);
            expect(edge!.type).toBe('KNOWS');
            expect(pg1.getFullVisibleGraph(doc1)).toEqual(pg2.getFullVisibleGraph(doc2));
        });
        test('CU_e', () => {
            pg1.addNode({ doc: doc1, nodeId: '1', type: 'Person', props: { name: 'Alice' } });
            pg1.addNode({ doc: doc1, nodeId: '2', type: 'Person', props: { name: 'Bob' } });
            bidirectionalSync(doc1, doc2);
            pg1.addEdge({ doc: doc1, sourceId: '1', targetId: '2', type: 'KNOWS', props: { since: 2020 }, edgeId: 'e1' });
            pg1.updateEdge({ doc: doc1, props: { since: 2021, dance: true, hat: false }, edgeId: 'e1' });
            pg2.addEdge({ doc: doc2, sourceId: '1', targetId: '2', type: 'KNOWS', props: { since: 2020, hat: true, team: 'A' }, edgeId: 'e1' });

            bidirectionalSync(doc1, doc2);
            const visgraph1 = pg1.getFullVisibleGraph(doc1);
            expect(visgraph1.edges.length).toBe(1);
            const edge = visgraph1.edges.find(e => e.id === 'e1');
            expect(edge).toBeDefined();
            expect(unpackProp(edge!.props!.since)).toBe(2021);
            expect(unpackProp(edge!.props!.dance)).toBe(true);
            expect(unpackProp(edge!.props!.hat)).toBe(false);
            expect(unpackProp(edge!.props!.team)).toBe('A');
            expect(edge!.type).toBe('KNOWS');
            expect(pg1.getFullVisibleGraph(doc1)).toEqual(pg2.getFullVisibleGraph(doc2));
        });
        test('Dep_c => no-dangling-edges', () => {
            pg1.addNode({ doc: doc1, nodeId: '1', type: 'Person', props: { name: 'Alice' } });
            pg1.addNode({ doc: doc1, nodeId: '2', type: 'Person', props: { name: 'Bob' } });

            bidirectionalSync(doc1, doc2);
            pg1.addEdge({ doc: doc1, sourceId: '1', targetId: '2', type: 'KNOWS', props: { since: 2020 }, edgeId: 'e1' });
            pg2.deleteNode({ doc: doc2, nodeId: '1' });
            bidirectionalSync(doc1, doc2);
            const visgraph1 = pg1.getFullVisibleGraph(doc1);
            expect(visgraph1.nodes.length).toBe(1);
            expect(visgraph1.edges.length).toBe(0);
            expect(visgraph1.nodes[0].id).toBe('2');
            expect(unpackProp(visgraph1.nodes[0].props!.name)).toBe('Bob');
            expect(visgraph1.nodes[0].type).toBe('Person');
            expect(pg1.getFullVisibleGraph(doc1)).toEqual(pg2.getFullVisibleGraph(doc2));

            pg1.addNode({ doc: doc1, nodeId: '1', type: 'Person', props: { name: 'Alice' } });

            bidirectionalSync(doc1, doc2);

            const visgraph2 = pg1.getFullVisibleGraph(doc1);
            expect(visgraph2.nodes.length).toBe(2);
            expect(visgraph2.edges.length).toBe(1);

        });
        test('CR_e', () => {
            pg1.addNode({ doc: doc1, nodeId: '1', type: 'Person', props: { name: 'Alice' } });
            pg1.addNode({ doc: doc1, nodeId: '2', type: 'Person', props: { name: 'Bob' } });

            bidirectionalSync(doc1, doc2);

            pg1.addEdge({ doc: doc1, sourceId: '1', targetId: '2', type: 'KNOWS', props: { since: 2020, fun: true }, edgeId: 'e1' });
            pg1.deleteEdge({ doc: doc1, edgeId: 'e1' });
            pg2.addEdge({ doc: doc2, sourceId: '1', targetId: '2', type: 'KNOWS', props: { since: 2021, fun: false }, edgeId: 'e1' });

            bidirectionalSync(doc1, doc2);

            const visgraph1 = pg1.getFullVisibleGraph(doc1);
            expect(visgraph1.edges.length).toBe(1);
            const edge = visgraph1.edges.find(e => e.id === 'e1');
            expect(edge).toBeDefined();
            expect(unpackProp(edge!.props!.since)).toBe(2021);
            expect(unpackProp(edge!.props!.fun)).toBe(false);
            expect(edge!.type).toBe('KNOWS');
            expect(pg1.getFullVisibleGraph(doc1)).toEqual(pg2.getFullVisibleGraph(doc2));

            const doc3 = getDoc(3);
            const pg3 = new PropertyGraph(doc3);
            const doc4 = getDoc(4);
            const pg4 = new PropertyGraph(doc4);
            pg3.addNode({ doc: doc3, nodeId: '1', type: 'Person', props: { name: 'Alice' } });
            pg3.addNode({ doc: doc3, nodeId: '2', type: 'Person', props: { name: 'Bob' } });

            bidirectionalSync(doc3, doc4);
            
            pg4.addEdge({ doc: doc4, sourceId: '1', targetId: '2', type: 'KNOWS', props: { since: 2020, fun: true }, edgeId: 'e1' });
            pg4.deleteEdge({ doc: doc4, edgeId: 'e1' });
            pg3.addEdge({ doc: doc3, sourceId: '1', targetId: '2', type: 'KNOWS', props: { since: 2021, fun: false }, edgeId: 'e1' });

            bidirectionalSync(doc3, doc4);

            const visgraph2 = pg3.getFullVisibleGraph(doc3);
            expect(visgraph2.edges.length).toBe(0);
            expect(pg3.getFullVisibleGraph(doc3)).toEqual(pg4.getFullVisibleGraph(doc4));
        });
    });
    describe('Update Node ROW', () => {
        test('UU_n', () => {
            pg1.addNode({ doc: doc1, nodeId: '1', type: 'Person', props: { name: 'Alice', address: '123 Main St' } });

            bidirectionalSync(doc1, doc2);

            pg1.updateNode({ doc: doc1, nodeId: '1', props: { name: 'Bob1' } });
            pg2.updateNode({ doc: doc2, nodeId: '1', props: { name: 'Bob2' } });

            bidirectionalSync(doc1, doc2);

            const visGraph1 = pg1.getFullVisibleGraph(doc1);
            const node = visGraph1.nodes.find(n => n.id === '1');
            expect(node).toBeDefined();
            expect(node!.props!.name).toEqual({"1": "Bob1", "2": "Bob2"});
            expect(unpackProp(node!.props!.address)).toBe('123 Main St');
            expect(node!.type).toBe('Person');
            expect(pg1.getFullVisibleGraph(doc1)).toEqual(pg2.getFullVisibleGraph(doc2));
        });
        test('UR_n', () => {
            pg1.addNode({ doc: doc1, nodeId: '1', type: 'Person', props: { name: 'Alice', address: '123 Main St' } });
            bidirectionalSync(doc1, doc2);
            pg1.updateNode({ doc: doc1, nodeId: '1', props: { name: 'Bob1', dance: true } });
            pg2.deleteNode({ doc: doc2, nodeId: '1' });
            bidirectionalSync(doc1, doc2);
            const visGraph1 = pg1.getFullVisibleGraph(doc1);
            const node = visGraph1.nodes.find(n => n.id === '1');
            expect(node).toBeUndefined();
            expect(pg1.getFullVisibleGraph(doc1)).toEqual(pg2.getFullVisibleGraph(doc2));

            pg1.addNode({ doc: doc1, nodeId: '1', type: 'Person', props: { name: 'Alice', address: '123 Main St' } });
            bidirectionalSync(doc1, doc2);
            expect(pg1.getFullVisibleGraph(doc1).nodes.length).toBe(1);
            expect(pg1.getFullVisibleGraph(doc1).nodes[0].id).toBe('1');
            expect(unpackProp(pg1.getFullVisibleGraph(doc1).nodes[0].props!.name)).toBe('Alice');
            expect(unpackProp(pg1.getFullVisibleGraph(doc1).nodes[0].props!.address)).toBe('123 Main St');
            expect(pg1.getFullVisibleGraph(doc1).nodes[0].type).toBe('Person');
            expect(pg1.getFullVisibleGraph(doc1).nodes[0].props!.dance).toBeUndefined();
            expect(pg1.getFullVisibleGraph(doc1)).toEqual(pg2.getFullVisibleGraph(doc2));
        });
    });
    describe('Update Edge ROW', () => {
        test('UU_e', () => {
            pg1.addNode({ doc: doc1, nodeId: '1', type: 'Person', props: { name: 'Alice' } });
            pg1.addNode({ doc: doc1, nodeId: '2', type: 'Person', props: { name: 'Bob' } });
            pg1.addEdge({ doc: doc1, sourceId: '1', targetId: '2', type: 'KNOWS', props: { since: 2020 }, edgeId: 'e1' });
            bidirectionalSync(doc1, doc2);

            pg1.updateEdge({ doc: doc1, props: { since: 2021, dance: true }, edgeId: 'e1' });
            pg2.updateEdge({ doc: doc2, props: { since: 2022, hat: true }, edgeId: 'e1' });

            bidirectionalSync(doc1, doc2);

            const visgraph1 = pg1.getFullVisibleGraph(doc1);
            expect(visgraph1.edges.length).toBe(1);
            const edge = visgraph1.edges.find(e => e.id === 'e1');
            expect(edge).toBeDefined();
            expect(edge!.props!.since).toEqual({"1": 2021, "2": 2022});
            expect(unpackProp(edge!.props!.dance)).toBe(true);
            expect(unpackProp(edge!.props!.hat)).toBe(true);
            expect(edge!.type).toBe('KNOWS');
            expect(pg1.getFullVisibleGraph(doc1)).toEqual(pg2.getFullVisibleGraph(doc2));
        });
        test('Dep_u => no-dangling-edges', () => {
            // update information aka properties are still stored but not referenced anywhere
            pg1.addNode({ doc: doc1, nodeId: '1', type: 'Person', props: { name: 'Alice' } });
            pg1.addNode({ doc: doc1, nodeId: '2', type: 'Person', props: { name: 'Bob' } });
            pg1.addEdge({ doc: doc1, sourceId: '1', targetId: '2', type: 'KNOWS', props: { since: 2020 }, edgeId: 'e1' });
            bidirectionalSync(doc1, doc2);

            pg1.updateEdge({ doc: doc1, props: { since: 2021, dance: true }, edgeId: 'e1' });
            pg2.deleteNode({ doc: doc2, nodeId: '1' });

            bidirectionalSync(doc1, doc2);

            const visgraph1 = pg1.getFullVisibleGraph(doc1);
            expect(visgraph1.edges.length).toBe(0);
            expect(visgraph1.nodes.length).toBe(1);

            expect(pg1.getFullVisibleGraph(doc1)).toEqual(pg2.getFullVisibleGraph(doc2));
        });
        test('UR_e', () => {
            pg1.addNode({ doc: doc1, nodeId: '1', type: 'Person', props: { name: 'Alice' } });
            pg1.addNode({ doc: doc1, nodeId: '2', type: 'Person', props: { name: 'Bob' } });
            pg1.addEdge({ doc: doc1, sourceId: '1', targetId: '2', type: 'KNOWS', props: { since: 2020 }, edgeId: 'e1' });
            bidirectionalSync(doc1, doc2);
            pg1.updateEdge({ doc: doc1, props: { since: 2021, dance: true }, edgeId: 'e1' });
            pg2.deleteEdge({ doc: doc2, edgeId: 'e1' });
            bidirectionalSync(doc1, doc2);
            const visgraph1 = pg1.getFullVisibleGraph(doc1);
            expect(visgraph1.edges.length).toBe(0);

            // updated information is still stored but not referenced anywhere
        });
    });
    describe('Remove Node ROW', () => {
        test('RR_n', () => {
            pg1.addNode({ doc: doc1, nodeId: '1', type: 'Person', props: { name: 'Alice' } });
            pg2.addNode({ doc: doc2, nodeId: '2', type: 'Person', props: { name: 'Bob' } });

            bidirectionalSync(doc1, doc2);

            pg1.deleteNode({ doc: doc1, nodeId: '1' });
            pg2.deleteNode({ doc: doc2, nodeId: '1' });

            bidirectionalSync(doc1, doc2);
            
            const visGraph1 = pg1.getFullVisibleGraph(doc1);
            expect(visGraph1.nodes.length).toBe(1);
            expect(visGraph1.nodes[0].id).toBe('2');
            expect(pg1.getFullVisibleGraph(doc1)).toEqual(pg2.getFullVisibleGraph(doc2));
        });
    });
    describe('Remove Edge ROW', () => {
        test('RR_e', () => {
            pg1.addNode({ doc: doc1, nodeId: '1', type: 'Person', props: { name: 'Alice' } });
            pg1.addNode({ doc: doc1, nodeId: '2', type: 'Person', props: { name: 'Bob' } });
            pg1.addEdge({ doc: doc1, sourceId: '1', targetId: '2', type: 'KNOWS', props: { since: 2020 }, edgeId: 'e1' });
            
            bidirectionalSync(doc1, doc2);

            pg1.deleteEdge({ doc: doc1, edgeId: 'e1' });
            pg2.deleteEdge({ doc: doc2, edgeId: 'e1' });

            bidirectionalSync(doc1, doc2);

            expect(pg1.getFullVisibleGraph(doc1).edges.length).toBe(0);
            expect(pg1.getFullVisibleGraph(doc1)).toEqual(pg2.getFullVisibleGraph(doc2));
        });
    });
});
