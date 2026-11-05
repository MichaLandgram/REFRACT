import * as Y from 'yjs';
export function unpack(rawDisc: any): string {
        if (rawDisc && typeof rawDisc === 'object' && !Array.isArray(rawDisc)) {
            let firstEntry: any;
            for (const k in rawDisc) { firstEntry = rawDisc[k]; break; }
            if (firstEntry && typeof firstEntry === 'object' && 'value' in firstEntry) {
                return String(firstEntry.value ?? '');
            }
            return String(firstEntry ?? '');
        }
        return String(rawDisc ?? '');
    }

export const toArray = (v: any): string[] => Array.isArray(v) ? v : (v && typeof v === 'object' ? Object.values(v) : []);

export function getDoc(clientId?: number): Y.Doc {
  let ydoc = new Y.Doc()
  if (clientId) {
    ydoc.clientID = clientId
  }
  return ydoc
}