import type { dataTypes } from './types';

export class PropertyStoreObeject {
    value: dataTypes;
    writeType: dataTypes;

    constructor(value: dataTypes, writeType: dataTypes) {
        this.value = value;
        this.writeType = writeType;
    }
}