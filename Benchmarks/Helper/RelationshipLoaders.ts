import * as Y from 'yjs';
import { PropertyGraph } from '../../src/GraphDB_CRDT/PropertyGraph';
import { IdLookup, EdgeRow } from '../../src/Helper/types';
import { Edge } from './resultInterfaces';

export function loadEdges(persons: Record<string, any>[], edges: Edge[], doc: Y.Doc, db: PropertyGraph): void {
    const lookup = new Map<string, string>(persons.map(p => [String(p.id), String(p._nodeId)]));
    doc.transact(() => {
        edges.forEach(e => {
            const sourceId = lookup.get(e.src);
            const targetId = lookup.get(e.tgt);
            if (!sourceId || !targetId) return;
            try {
                db.addEdge({ doc, edgeId: e._edgeId, type: 'KNOWS',
                             sourceId, targetId,
                             props: { creationDate: e.creationDate } });
            } catch { /* skip */ }
        });
    });
}
