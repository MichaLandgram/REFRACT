import * as Y from 'yjs'

export function getDoc(clientId?: number): Y.Doc {
  let ydoc = new Y.Doc()
  if (clientId) {
    ydoc.clientID = clientId
  }
  return ydoc
}