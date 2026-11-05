import * as Y from 'yjs';

export function syncDocs(docFrom: Y.Doc, docTo: Y.Doc) {
  const update = Y.encodeStateAsUpdate(docFrom);
  Y.applyUpdate(docTo, update);
}

export function bidirectionalSync(docFrom: Y.Doc, docTo: Y.Doc) {
  syncDocs(docFrom, docTo);
  syncDocs(docTo, docFrom);
}
export function trialSync(doc1: Y.Doc, doc2: Y.Doc, doc3: Y.Doc) {
  bidirectionalSync(doc1, doc2);
  bidirectionalSync(doc1, doc3);
  bidirectionalSync(doc2, doc3);
}