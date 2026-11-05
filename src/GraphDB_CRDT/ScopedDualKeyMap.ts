import * as Y from 'yjs';
import { EntityKeyIndex } from './EntityKeyIndex';

export class ScopedDualKeyMap {
    private map: Y.Map<any>;
    private entityId: string;
    private prefix: string;
    private prefixLen: number;
    private keyIndex: EntityKeyIndex;

    constructor(map: Y.Map<any>, entityId: string, keyIndex: EntityKeyIndex) {
        this.map = map;
        this.entityId = entityId;
        this.prefix = entityId + ':';
        this.prefixLen = this.prefix.length;
        this.keyIndex = keyIndex;
    }

    public setInitial(key: string, value: any): void {
        const doc = this.map.doc;
        const clientID = doc ? doc.clientID.toString() : crypto.randomUUID();
        this.map.set(`${this.prefix}init_${key}_${clientID}`, value);
    }

    public setUpdate(key: string, value: any): void {
        const doc = this.map.doc;
        const clientID = doc ? doc.clientID.toString() : crypto.randomUUID();

        this.map.delete(`${this.prefix}init_${key}_${clientID}`);
        this.map.delete(`${this.prefix}update_${key}_${clientID}`);
        this.map.set(`${this.prefix}update_${key}_${clientID}`, value);
    }

    private getWinningEntry(entries: Record<string, any>): Record<string, any> {
        const clientIDs = Object.keys(entries);
        if (clientIDs.length <= 1) {
            return entries;
        }
        clientIDs.sort((a, b) => {
            const numA = Number(a);
            const numB = Number(b);
            if (!isNaN(numA) && !isNaN(numB)) {
                return numB - numA;
            }
            return b.localeCompare(a);
        });
        const winningClientID = clientIDs[0];
        return { [winningClientID]: entries[winningClientID] };
    }

    // note: this method returns either a single winning entry or all updates if they exist
    // only used in eager migration functions
    /* istanbul ignore next */
    public get(key: string): any {
        if (key.startsWith('__')) {
            return this.map.get(`${this.prefix}${key}`);
        }

        const keys = this.keyIndex.getKeysForEntity(this.entityId);
        const updatePrefix = `${this.prefix}update_${key}_`;
        const updates: Record<string, any> = {};

        for (const fullKey of keys) {
            if (fullKey.startsWith(updatePrefix)) {
                const clientID = fullKey.substring(updatePrefix.length);
                updates[clientID] = this.map.get(fullKey);
            }
        }

        if (Object.keys(updates).length > 0) {
            return updates;
        }

        const initPrefix = `${this.prefix}init_${key}_`;
        const inits: Record<string, any> = {};

        for (const fullKey of keys) {
            if (fullKey.startsWith(initPrefix)) {
                const clientID = fullKey.substring(initPrefix.length);
                inits[clientID] = this.map.get(fullKey);
            }
        }

        return this.getWinningEntry(inits);
    }

    public delete(key: string): void {
        if (key.startsWith('__')) {
            this.map.delete(`${this.prefix}${key}`);
            return;
        }

        const keys = this.keyIndex.getKeysForEntity(this.entityId);
        const initPrefix = `${this.prefix}init_${key}_`;
        const updatePrefix = `${this.prefix}update_${key}_`;
        const keysToDelete: string[] = [];

        for (const fullKey of keys) {
            if (fullKey.startsWith(initPrefix) || fullKey.startsWith(updatePrefix)) {
                keysToDelete.push(fullKey);
            }
        }
        keysToDelete.forEach(k => this.map.delete(k));
    }

    public getAll(): any {
        const result: any = {};
        const inits: Record<string, Record<string, any>> = {};
        const updates: Record<string, Record<string, any>> = {};

        const keys = this.keyIndex.getKeysForEntity(this.entityId);

        for (const fullKey of keys) {
            const localKey = fullKey.substring(this.prefixLen);
            const value = this.map.get(fullKey);

            if (localKey.startsWith('__')) {
                result[localKey] = value;
            } else if (localKey.startsWith('init_')) {
                const withoutPrefix = localKey.substring(5);
                const lastUnderscore = withoutPrefix.lastIndexOf('_');
                if (lastUnderscore !== -1) {
                    const propName = withoutPrefix.substring(0, lastUnderscore);
                    const clientID = withoutPrefix.substring(lastUnderscore + 1);
                    inits[propName] = inits[propName] || {};
                    inits[propName][clientID] = value;
                }
            } else if (localKey.startsWith('update_')) {
                const withoutPrefix = localKey.substring(7);
                const lastUnderscore = withoutPrefix.lastIndexOf('_');
                if (lastUnderscore !== -1) {
                    const propName = withoutPrefix.substring(0, lastUnderscore);
                    const clientID = withoutPrefix.substring(lastUnderscore + 1);
                    updates[propName] = updates[propName] || {};
                    updates[propName][clientID] = value;
                }
            }
        }

        const allProps = new Set([...Object.keys(inits), ...Object.keys(updates)]);
        allProps.forEach(propName => {
            const propUpdates = updates[propName];
            if (propUpdates && Object.keys(propUpdates).length > 0) {
                result[propName] = propUpdates;
            } else {
                const propInits = inits[propName];
                if (propInits && Object.keys(propInits).length > 0) {
                    // result[propName] = this.getWinningEntry(propInits);
                    result[propName] = propInits;
                }
            }
        });

        return result;
    }
}
