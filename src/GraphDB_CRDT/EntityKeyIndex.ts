import * as Y from 'yjs';

export class EntityKeyIndex {
    private map: Y.Map<any>;
    private index: Map<string, Set<string>> = new Map();

    constructor(map: Y.Map<any>) {
        this.map = map;
        map.forEach((_: any, key: string) => {
            this.addKey(key);
        });

        map.observe((event: Y.YMapEvent<any>) => {
            event.changes.keys.forEach((change, key) => {
                if (change.action === 'add' || change.action === 'update') {
                    this.addKey(key);
                } else if (change.action === 'delete') {
                    this.removeKey(key);
                }
            });
        });
    }

    private parseEntityId(key: string): string | null {
        const idx = key.indexOf(':');
        return idx >= 0 ? key.substring(0, idx) : null;
    }

    private addKey(key: string): void {
        const entityId = this.parseEntityId(key);
        if (!entityId) return;
        let keys = this.index.get(entityId);
        if (!keys) {
            keys = new Set();
            this.index.set(entityId, keys);
        }
        keys.add(key);
    }

    private removeKey(key: string): void {
        const entityId = this.parseEntityId(key);
        if (!entityId) return;
        const keys = this.index.get(entityId);
        if (keys) {
            keys.delete(key);
            if (keys.size === 0) {
                this.index.delete(entityId);
            }
        }
    }


    public getEntityType(entityId: string): string | undefined {
        const directType = this.map.get(`${entityId}:__type`) as string;
        if (directType) return directType;

        const keys = this.getKeysForEntity(entityId);
        const prefix = `${entityId}:__type_`;
        const candidates: Array<{ clientID: string; value: string }> = [];

        for (const key of keys) {
            if (key.startsWith(prefix)) {
                const clientID = key.substring(prefix.length);
                const val = this.map.get(key) as string;
                if (val) {
                    candidates.push({ clientID, value: val });
                }
            }
        }

        if (candidates.length === 0) return undefined;
        if (candidates.length === 1) return candidates[0].value;

        candidates.sort((a, b) => {
            const numA = Number(a.clientID);
            const numB = Number(b.clientID);
            if (!isNaN(numA) && !isNaN(numB)) {
                return numB - numA;
            }
            return b.clientID.localeCompare(a.clientID);
        });

        return candidates[0].value;
    }

    public isEntityAlive(entityId: string): boolean {
        return this.getEntityType(entityId) !== undefined;
    }

    public getAllAliveEntities(): string[] {
        const result: string[] = [];
        this.index.keys().forEach((entityId) => {
            if (this.isEntityAlive(entityId)) {
                result.push(entityId);
            }
        });
        return result;
    }

    getKeysForEntity(entityId: string): string[] {
        const keys = this.index.get(entityId);
        return keys ? Array.from(keys) : [];
    }

    hasEntity(entityId: string): boolean {
        const keys = this.index.get(entityId);
        return keys !== undefined && keys.size > 0;
    }

    getAllEntities(): string[] {
        return Array.from(this.index.keys());
    }
}
