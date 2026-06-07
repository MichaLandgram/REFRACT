import * as Y from 'yjs';
import { PropertyGraph } from '../../src/GraphDB_CRDT/PropertyGraph';
import { NodeRow } from '../../src/Helper/types';

export function loadPersons(nodes: NodeRow[], doc: Y.Doc, db: PropertyGraph): void {
    doc.transact(() => {
        nodes.forEach(n => {
            n._nodeId = (n._nodeId as string | undefined) ?? crypto.randomUUID();
            db.addNode({ doc, nodeId: n._nodeId, type: 'Person', props: {
                firstName:    n.firstName    ?? '',
                lastName:     n.lastName     ?? '',
                gender:       n.gender       ?? '',
                birthday:     n.birthday     ?? '',
                creationDate: n.creationDate ?? '',
                locationIP:   n.locationIP   ?? '',
                browserUsed:  n.browserUsed  ?? '',
                email:        n.email        ?? '',
                language:     n.language     ?? '',
            }});
        });
    });
}
