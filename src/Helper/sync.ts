import * as Y from 'yjs';

export function syncDocs(docFrom: Y.Doc, docTo: Y.Doc) {
  const update = Y.encodeStateAsUpdate(docFrom);
  Y.applyUpdate(docTo, update);
}

export function bidirectionalSync(docFrom: Y.Doc, docTo: Y.Doc) {
  syncDocs(docFrom, docTo);
  syncDocs(docTo, docFrom);
}
// not used currently
export function trialSync(doc1: Y.Doc, doc2: Y.Doc, doc3: Y.Doc) {
  syncDocs(doc1, doc2);
  syncDocs(doc2, doc3);
  syncDocs(doc3, doc1);
}