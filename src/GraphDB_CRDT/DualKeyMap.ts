import * as Y from 'yjs';

export class DualKeyMap {
    private map: Y.Map<any>;
    constructor(map: Y.Map<any>) {
        this.map = map;
    }

    public setInitial(key: string, value: any) {
        const initKey = `init_${key}`;
        const doc = this.map.doc;
        const clientID = doc ? doc.clientID.toString() : crypto.randomUUID();

        let valMap = this.map.get(initKey);
        if (!valMap || !(valMap instanceof Y.Map)) {
            valMap = new Y.Map();
            this.map.set(initKey, valMap);
        }
        valMap.clear();
        valMap.set(clientID, value);

        let updateMap = this.map.get(key);
        if (!updateMap || !(updateMap instanceof Y.Map)) {
            updateMap = new Y.Map();
            this.map.set(key, updateMap);
        }
    }

    public setUpdate(key: string, value: any) {
        const doc = this.map.doc;
        const clientID = doc ? doc.clientID.toString() : crypto.randomUUID();

        const initKey = `init_${key}`;
        if (this.map.has(initKey)) {
            this.map.delete(initKey);
        }

        let valMap = this.map.get(key);
        if (!valMap || !(valMap instanceof Y.Map)) {
            valMap = new Y.Map();
            this.map.set(key, valMap);
        }
        valMap.clear();
        valMap.set(clientID, value);
    }

    public get(key: string): any {
        let valMap = this.map.get(key);
        if (!valMap || (valMap instanceof Y.Map && valMap.size === 0)) {
            const initKey = `init_${key}`;
            valMap = this.map.get(initKey);
        }
        if (valMap instanceof Y.Map) {
            return valMap.toJSON();
        }
        return valMap;
    }

    public delete(key: string): void {
        this.map.delete(key);
        this.map.delete(`init_${key}`);
    }

    public getAll(): any {
        const combinedProps = new Map<string, any>();
        this.map.forEach((value: any, key: string) => {
             if (key.startsWith('init_')) {
                 const realKey = key.replace('init_', '');
                 const updateVal = this.map.get(realKey);
                 if (!updateVal || (updateVal instanceof Y.Map && updateVal.size === 0)) {
                     combinedProps.set(realKey, value);
                 }
             } else {
                 if (!(value instanceof Y.Map && value.size === 0)) {
                     combinedProps.set(key, value);
                 }
             }
        });

        const result: any = {};
        combinedProps.forEach((value, key) => {
            if (value instanceof Y.Map) {
                result[key] = value.toJSON();
            } else {
                result[key] = value;
            }
        });
        return result;
    }
}
