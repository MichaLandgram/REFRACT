import * as Y from 'yjs';
import { SchemaError } from '../Helper/ErrorDefinition';
import { dataTypes, defaultVal, whatType, SchemaDefinition, FoundUUIDs } from '../Helper/types';
import { getOrThrow } from '../Helper/ErrorDefinition';
import { v4 as uuidv4 } from 'uuid';

export class Schema_v1 {
    private doc: Y.Doc;
    private nodeTypes: Y.Map<any>;
    private finalNodeTypes: Map<string, any>;
    private nodeTypesToUuid: Map<string, Set<string>>;
    private relationshipTypes: Y.Map<any>;
    private Uuid: Y.Map<any>;
    private labels: Map<string, Set<string>>;
    private schemaMappings: Y.Map<any>;

    public get yjsDoc(): Y.Doc {
        return this.doc;
    }

    constructor(schemaDef?: SchemaDefinition, doc?: Y.Doc) {
        this.doc = doc || new Y.Doc();
        this.nodeTypes = this.doc.getMap('nodeTypes');
        this.finalNodeTypes = new Map<string, any>();
        this.nodeTypesToUuid = new Map<string, Set<string>>();

        this.relationshipTypes = this.doc.getMap('relationshipTypes');

        this.Uuid = this.doc.getMap('schema_uuid');
        this.labels = new Map<string, Set<string>>();
        this.schemaMappings = this.doc.getMap('schema_mappings');

        if (schemaDef) {
            this.doc.transact(() => {
                schemaDef.nodes?.forEach(node => {
                    this.addNodeType({ IdenifyingType: node.identifyingType, labels: node.labels, properties: node.properties });
                });
                schemaDef.relationships?.forEach(rel => {
                    this.addRelationshipType({ IdenifyingEdge: rel.identifyingEdge, sourceNodeLabel: rel.sourceNodeLabel, targetNodeLabel: rel.targetNodeLabel, properties: rel.properties });
                });
            });
        }

        const addToLabels = (name: string, uuid: string) => {
            if (!this.labels.has(name)) this.labels.set(name, new Set<string>());
            this.labels.get(name)!.add(uuid);
        };
        const removeFromLabels = (name: string, uuid: string) => {
            const bucket = this.labels.get(name);
            if (!bucket) return;
            bucket.delete(uuid);
            if (bucket.size === 0) this.labels.delete(name);
        };
        const recomputeMergeNodeTypesAll = () => {
            this.nodeTypes.forEach((nodeTypeMap: Y.Map<any>, uuid: string) => {
                const name = nodeTypeMap.get('name');
                if (name && typeof name === 'string') {
                    let uuidSet = this.nodeTypesToUuid.get(name);
                    if (!uuidSet) {
                        uuidSet = new Set<string>();
                        this.nodeTypesToUuid.set(name, uuidSet);
                    }
                    uuidSet.add(uuid);
                    try {
                        this.finalNodeTypes.set(name, this.mergeNodeTypesToOne(name));
                    } catch (e) { }
                }
            });
        }
        this.Uuid.forEach((labelName: unknown, uuid: string) => {
            addToLabels(labelName as string, uuid);
        });
        this.Uuid.observe((event: Y.YMapEvent<unknown>) => {
            event.changes.keys.forEach((change, uuid) => {
                if (change.action === 'add') {
                    addToLabels(this.Uuid.get(uuid) as string, uuid);
                } else if (change.action === 'update') {
                    removeFromLabels(change.oldValue as string, uuid);
                    addToLabels(this.Uuid.get(uuid) as string, uuid);
                } else if (change.action === 'delete') {
                    removeFromLabels(change.oldValue as string, uuid);
                }
                recomputeMergeNodeTypesAll();
            });
        });
        this.nodeTypes.forEach((nodeTypeMap: Y.Map<any>, uuid: string) => {
            const name = nodeTypeMap.get('name');
            if (name) {
                let uuidSet = this.nodeTypesToUuid.get(name);
                if (!uuidSet) {
                    uuidSet = new Set<string>();
                    this.nodeTypesToUuid.set(name, uuidSet);
                }
                uuidSet.add(uuid);
                try {
                    this.finalNodeTypes.set(name, this.mergeNodeTypesToOne(name));
                } catch (e) { }
            }
        });
        this.nodeTypes.observeDeep((events) => {
            const changedTypes = new Set<string>();

            const findNameByUuid = (uuidToFind: string): string | undefined => {
                let foundName: string | undefined = undefined;
                this.nodeTypesToUuid.forEach((uuids, name) => {
                    if (uuids.has(uuidToFind)) foundName = name;
                });
                return foundName;
            };

            events.forEach(event => {
                if (event.path.length > 0) {
                    const uuid = event.path[0] as string;
                    const name = findNameByUuid(uuid);
                    if (name) changedTypes.add(name);
                } else {
                    event.changes.keys.forEach((change, uuid) => {
                        if (change.action === 'add' || change.action === 'update') {
                            const nodeTypeMap = this.nodeTypes.get(uuid) as Y.Map<any> | undefined;
                            if (nodeTypeMap) {
                                const name = nodeTypeMap.get('name');
                                if (name) {
                                    let uuidSet = this.nodeTypesToUuid.get(name);
                                    if (!uuidSet) {
                                        uuidSet = new Set<string>();
                                        this.nodeTypesToUuid.set(name, uuidSet);
                                    }
                                    uuidSet.add(uuid);
                                    changedTypes.add(name);
                                }
                            }
                        } else if (change.action === 'delete') {
                            const name = findNameByUuid(uuid);
                            if (name) {
                                changedTypes.add(name);
                                const uuidSet = this.nodeTypesToUuid.get(name);
                                if (uuidSet) {
                                    uuidSet.delete(uuid);
                                    if (uuidSet.size === 0) {
                                        this.nodeTypesToUuid.delete(name);
                                    }
                                }
                            }
                        }
                    });
                }
            });
            changedTypes.forEach(name => {
                try {
                    const json = this.mergeNodeTypesToOne(name);
                    this.finalNodeTypes.set(name, json);
                } catch (e) {
                    this.finalNodeTypes.delete(name);
                }
            });
        });

    }

    private mergeNodeTypesToOne(IdenifyingType: string) {
        const uuids = this.findAllTypeUuids(IdenifyingType);
        if (uuids.size === 0) {
            throw new SchemaError('Node type not found');
        }
        const mergedLabels: Record<string, string> = {};
        const mergedProperties: Record<string, any> = {};

        // sorting UUIDs deterministically (lexicographically) to guarantee eventual consistency 
        // across replicas, mimicking Yjs's deterministic tie-breaking logic.
        const sortedUuids = Array.from(uuids).sort();
        sortedUuids.forEach(uuid => {
            const nodeTypeMap = this.nodeTypes.get(uuid)!;
            const rawJson = nodeTypeMap.toJSON();
            if (rawJson.labels) {
                for (const labelUuid of Object.keys(rawJson.labels)) {
                    const labelName = this.Uuid.get(labelUuid);
                    if (labelName) mergedLabels[labelName] = labelName;
                   }
            }
            if (rawJson.properties) {
                for (const [propKey, propVal] of Object.entries(rawJson.properties)) {
                    if (!mergedProperties[propKey]) {
                        const name = (propVal as any).name;
                        mergedProperties[propKey] = { name: name, activeTypes: {} };
                    }
                    const activeTypes = (propVal as any).activeTypes;
                    if (activeTypes) {
                        for (const [client, activeVal] of Object.entries(activeTypes)) {
                            mergedProperties[propKey].activeTypes[client] = activeVal;
                        }
                    }
                }
            }
        });

        return {
            labels: mergedLabels,
            properties: mergedProperties
        };
    }

    private createLabel(label: string): string {
        const foundUuid = this.findAllLabelUuids(label);
        let newUUID = '';
        if (foundUuid.size === 0) {
            newUUID = uuidv4();
            this.Uuid.set(newUUID, label);
        } else {
            throw new SchemaError('Label already exists: ' + label);
        }
        return newUUID;
    }

    private findOrCreateLabelsUuids(label: string): Set<string> {
        let foundUuids = this.labels.get(label);
        if (foundUuids === undefined) {
            const uuidFromDoc = this.findAllLabelUuids(label);
            if (uuidFromDoc.size > 0) {
                return uuidFromDoc;
            }
            foundUuids = new Set<string>();
            foundUuids.add(this.createLabel(label));
        }
        return foundUuids;
    }

    private findOrCreateMultipleLabelsUuids(labels: string[]): Set<string> {
        const allLabelsUuids = new Set<string>();
        labels.forEach(label => {
            const labelUuids: Set<string> = this.findOrCreateLabelsUuids(label);
            labelUuids.forEach(uuid => allLabelsUuids.add(uuid));
        });
        return allLabelsUuids;
    }

    public dropLabel(label: string) {
        const founduuids: FoundUUIDs = this.findAllLabelUuids(label);
        if (founduuids.size === 0) {
            throw new SchemaError('Label does not exist: ' + label);
        }
        founduuids.forEach((uuid: string) => {
            this.Uuid.delete(uuid);
        });
        this.cascadingLabelDeletions(founduuids);
    }

    private cascadingLabelDeletions(uuids: Set<string>) {
        this.nodeTypes.forEach((nodeTypeMap: Y.Map<any>) => {
            const labelsMap = nodeTypeMap.get('labels');
            if (labelsMap) {
                labelsMap.forEach((uuid: string) => {
                    if (uuids.has(uuid)) labelsMap.delete(uuid);
                });
            }
        });
        this.relationshipTypes.forEach((relationshipTypeMap: Y.Map<any>, identifyingType: string) => {
            const sourceYMap: Y.Map<string> | undefined = relationshipTypeMap.get('sourceNodeLabel');
            const targetYMap: Y.Map<string> | undefined = relationshipTypeMap.get('targetNodeLabel');

            const sourceOverlaps = sourceYMap ? Array.from(sourceYMap.keys()).some(uuid => uuids.has(uuid)) : false;
            const targetOverlaps = targetYMap ? Array.from(targetYMap.keys()).some(uuid => uuids.has(uuid)) : false;

            if (sourceOverlaps || targetOverlaps) {
                this.relationshipTypes.delete(identifyingType);
            }
        });
    }

    public renameLabel(oldName: string, newName: string, skip: boolean = false) {
        const founduuids: FoundUUIDs = this.findAllLabelUuids(oldName);

        if (founduuids.size === 0) {
            throw new SchemaError('Non-exsistant Label for Rename: ' + oldName);
        }
        if (!skip && this.findAllLabelUuids(newName).size !== 0) { throw new SchemaError('Label already exists: ' + newName); }

        founduuids.forEach((uuid: string) => {
            this.Uuid.set(uuid, newName);
        });
    }

    private splitLabel(oldName: string, newLabel1: string, newLabel2: string) {
        const oldUuids = this.findAllLabelUuids(oldName);
        if (oldUuids.size === 0) {
            throw new SchemaError('Non-exsistant Label for Split: ' + oldName);
        }
        if (this.findAllLabelUuids(newLabel1).size !== 0) {
            throw new SchemaError('New label already exists: ' + newLabel1);
        }
        if (this.findAllLabelUuids(newLabel2).size !== 0) {
            throw new SchemaError('New label already exists: ' + newLabel2);
        }
        const uuid2 = this.createLabel(newLabel2);

        this.nodeTypes.forEach(nodeTypeMap => {
            const labelsMap = nodeTypeMap.get('labels');
            if (labelsMap) {
                oldUuids.forEach((uuid: string) => {
                    if (labelsMap.has(uuid)) {
                        labelsMap.set(uuid2, uuid2);
                    }
                });
            }
        })

        this.renameLabel(oldName, newLabel1);
    }

    private unionLabel(oldLabel1: string, oldLabel2: string, newLabel: string) {
        const oldUuids1 = this.findAllLabelUuids(oldLabel1);
        const oldUuids2 = this.findAllLabelUuids(oldLabel2);
        const newUuid = this.findAllLabelUuids(newLabel);
        if (oldUuids1.size === 0) {
            throw new SchemaError('Non-exsistant Label for Union: ' + oldLabel1);
        }
        if (oldUuids2.size === 0) {
            throw new SchemaError('Non-exsistant Label for Union: ' + oldLabel2);
        }
        if (newUuid.size !== 0) {
            throw new SchemaError('New label already exists: ' + newLabel);
        }

        this.renameLabel(oldLabel1, newLabel);
        this.renameLabel(oldLabel2, newLabel, true);


    }

    private addLabeltoNodeType(IdenifyingType: string, newLabel: string) {
        const uuids = this.findAllTypeUuids(IdenifyingType);
        if (uuids.size === 0) {
            throw new SchemaError('Node type not found: ' + IdenifyingType);
        }
        const labelUuids = this.findOrCreateLabelsUuids(newLabel);
        uuids.forEach(uuid => {
            const nodeTypeMap = this.nodeTypes.get(uuid)!;
            const labelsMap = nodeTypeMap.get('labels');
            if (!labelsMap) {
                throw new SchemaError('Node type labels not found: ' + IdenifyingType);
            }
            labelUuids.forEach(labelUuid => {
                labelsMap.set(labelUuid, labelUuid);
            });
        });
    }

    private getLabels(): Map<string, Set<string>> {
        return this.labels;
    }

    private getUuidsForLabel(name: string): Set<string> | undefined {
        return this.labels.get(name);
    }

    private findAllLabelUuids(name: string): FoundUUIDs {
        const foundUuids: FoundUUIDs = new Set<string>();
        this.Uuid.forEach((label: string, uuid: string) => {
            if (label === name) {
                foundUuids.add(uuid);
            }
        });
        return foundUuids;
    }

    private addNodeType({ IdenifyingType, labels, properties, defa }: { IdenifyingType: string, labels: string[], properties: any, defa?: any }) {
        if (this.findAllTypeUuids(IdenifyingType).size > 0) {
            throw new SchemaError('Type already exists');
        }

        const nodeTypeMap = new Y.Map<any>();
        const propertiesMap = new Y.Map<any>();
        const labelsMap = new Y.Map<string>();

        const labelUuids = this.findOrCreateMultipleLabelsUuids(labels);
        labelUuids.forEach(labelUuid => {
            labelsMap.set(labelUuid, labelUuid);
        });

        for (const [propName, propType] of Object.entries(properties)) {
            const valueMap = new Y.Map<any>();
            const activeTypes = new Y.Map<any>();
            const propUuid = uuidv4();
            activeTypes.set(this.doc.clientID.toString(), { value: propType, default: defa });
            valueMap.set('activeTypes', activeTypes);
            valueMap.set('name', propName);
            propertiesMap.set(propName, valueMap);
        }

        const newUuid = uuidv4();
        this.doc.transact(() => {
            nodeTypeMap.set('name', IdenifyingType);
            nodeTypeMap.set('labels', labelsMap);
            nodeTypeMap.set('properties', propertiesMap);
            this.nodeTypes.set(newUuid, nodeTypeMap);
        });
    }

    private dropNodeType(IdenifyingType: string) {
        const uuids = this.findAllTypeUuids(IdenifyingType);
        if (uuids.size === 0) {
            throw new SchemaError('Node type not found: ' + IdenifyingType);
        }
        uuids.forEach(uuid => { this.nodeTypes.delete(uuid); });
    }

    private removeNodeLabels(IdenifyingType: string, dropLabels: string[]) {
        const uuids = this.findAllTypeUuids(IdenifyingType);
        if (uuids.size === 0) {
            throw new SchemaError('Node type not found: ' + IdenifyingType);
        }
        const labelUuids = this.findOrCreateMultipleLabelsUuids(dropLabels);
        uuids.forEach(uuid => {
            const nodeTypeMap = this.nodeTypes.get(uuid)!;
            const labelsMap = nodeTypeMap.get('labels');
            if (!labelsMap) throw new SchemaError('Node type labels not found: ' + IdenifyingType);
            labelUuids.forEach(labelUuid => {
                labelsMap.delete(labelUuid);
            });
        });
    }

    private findAllTypeUuids(identifyingType: string): Set<string> {
        const uuids = new Set<string>();
        this.nodeTypes.forEach((nodeTypeMap: Y.Map<any>, uuid: string) => {
            if (nodeTypeMap.get('name') === identifyingType) uuids.add(uuid);
        });
        return uuids;
    }

    private addRelationshipType({ IdenifyingEdge, sourceNodeLabel, targetNodeLabel, properties, defa }: { IdenifyingEdge: string, sourceNodeLabel: string, targetNodeLabel: string, properties: any, defa?: any }) {
        if (this.relationshipTypes.has(IdenifyingEdge)) throw new SchemaError('Type already exists');
        const relationshipTypeMap = new Y.Map<any>();
        const propertiesMap = new Y.Map<any>();
        for (const [key, value] of Object.entries(properties)) {
            const valueMap = new Y.Map<any>();
            const activeTypes = new Y.Map<any>();
            activeTypes.set(this.doc.clientID.toString(), { value: value, default: defa });
            valueMap.set('activeTypes', activeTypes);
            valueMap.set('name', key);
            propertiesMap.set(key, valueMap);
        }

        const sourceUuids = this.uuidsToYMap(this.findAllLabelUuids(sourceNodeLabel));
        const targetUuids = this.uuidsToYMap(this.findAllLabelUuids(targetNodeLabel));


        this.doc.transact(() => {
            relationshipTypeMap.set('properties', propertiesMap);
            relationshipTypeMap.set('sourceNodeLabel', sourceUuids);
            relationshipTypeMap.set('targetNodeLabel', targetUuids);

            this.relationshipTypes.set(IdenifyingEdge, relationshipTypeMap);
        });
    }
    private deleteRelationshipType(IdenifyingEdge: string) {
        this.relationshipTypes.delete(IdenifyingEdge);
    }
    private getRelationshipType(IdenifyingEdge: string) {
        const relationshipType = getOrThrow(this.relationshipTypes.get(IdenifyingEdge), 'Relationship type not found');
        return relationshipType;
    }


    private getRelationshipTypeLabelName(rtMap: Y.Map<any>, field: 'sourceNodeLabel' | 'targetNodeLabel'): string {
        const orSet = rtMap.get(field) as Y.Map<string> | undefined;
        if (!orSet) return '';
        const firstUuid = Array.from(orSet.keys())[0];
        if (!firstUuid) return '';
        return this.Uuid.get(firstUuid) ?? firstUuid;
    }

    private getRelationshipTypeProperties(rtMap: Y.Map<any>): Record<string, string> {
        const rawJson = rtMap.toJSON();
        const properties: Record<string, string> = {};
        if (rawJson.properties) {
            Object.entries(rawJson.properties).forEach(([key, val]: [string, any]) => {
                const activeTypes = val.activeTypes ?? {};
                const firstActive = Object.values(activeTypes)[0] as any;
                properties[key] = (typeof firstActive === 'string')
                    ? firstActive
                    : (firstActive?.value || 'string');
            });
        }
        return properties;
    }


    public transformToJSONCleanSchema() {
        const jsonSchema = this.doc.toJSON();
        const mergedNodeTypes: Record<string, any> = {};
        this.finalNodeTypes.forEach((json, name) => {
            mergedNodeTypes[name] = json;
        });
        jsonSchema.nodeTypes = mergedNodeTypes;

        if (this.schemaMappings) {
            jsonSchema.schema_mappings = this.schemaMappings.toJSON();
        }

        delete jsonSchema.identifyingTypeIndex;
        return jsonSchema;
    }
    public transformToJSONFullSchema() {
        const jsonSchema = this.doc.toJSON();
        const mergedNodeTypes: Record<string, any> = {};
        this.finalNodeTypes.forEach((json, name) => {
            mergedNodeTypes[name] = json;
        });
        jsonSchema.nodeTypes = mergedNodeTypes;
        return jsonSchema;
    }

    private uuidsToYMap(uuids: FoundUUIDs): Y.Map<string> {
        const ymap = new Y.Map<string>();
        uuids.forEach(uuid => ymap.set(uuid, uuid));
        return ymap;
    }

    private addProperty(TYPE: Y.Map<any>, newProperty: any, defa?: any): void {
        const properties = getOrThrow(TYPE.get('properties'), 'Properties not found');
        // cannot readd the same Property
        if (properties.has(newProperty.key)) {
            throw new SchemaError('Property already exists');
        }
        const valueMap = new Y.Map<any>();
        const activeTypes = new Y.Map<any>();
        activeTypes.set(this.doc.clientID.toString(), { value: newProperty.value, default: defa });
        valueMap.set('activeTypes', activeTypes);
        valueMap.set('name', newProperty.key);
        properties.set(newProperty.key, valueMap);
    }

    private renameProperty(Type: Y.Map<any>, oldPropertyKey: string, newPropertyKey: string) {
        const properties = Type.get('properties');
        if (properties) {
            let valueMap = properties.get(oldPropertyKey);
            if (!valueMap) {
                for (const key of properties.keys()) {
                    const temp = properties.get(key);
                    if (temp && temp.get('name') === oldPropertyKey) {
                        valueMap = temp;
                        break;
                    }
                }
            }
            if (valueMap) {
                valueMap.set('name', newPropertyKey);
            }
        }
    }
        // Schema Modification Operations - PUBLIC ACTIONS  (todo keep structure and clean)

    public SMO_addNodeType(IdenifyingType: string, labels: string[], properties: any) {
        this.addNodeType({ IdenifyingType, labels, properties });
    }

    public SMO_addRelationshipType(IdenifyingEdge: string, sourceNodeLabel: string, targetNodeLabel: string, properties: any) {
        this.addRelationshipType({ IdenifyingEdge, sourceNodeLabel, targetNodeLabel, properties });
    }

    public SMO_createLabel(label: string) {
        this.createLabel(label);
    }


    public SMO_dropNodeType(IdenifyingType: string) {
        this.dropNodeType(IdenifyingType);
    }

    public SMO_dropRelationshipType(IdenifyingEdge: string) {
        this.deleteRelationshipType(IdenifyingEdge);
    }

    public SMO_dropLabel(label: string) {
        this.dropLabel(label);
    }

    public SMO_renamePropertyKey({ Idenifying, oldPropertyKey, newPropertyKey, whatType }: { Idenifying: string, oldPropertyKey: string, newPropertyKey: string, whatType: whatType }) {
        let Types: Y.Map<any>[] = [];
        if (whatType === "NodeType") {
            const uuids = this.findAllTypeUuids(Idenifying);
            Types = Array.from(uuids).map(uuid => this.nodeTypes.get(uuid)!);
            Types.forEach(type => {
                this.renameProperty(type, oldPropertyKey, newPropertyKey);
            });
        }
        else if (whatType === "RelationshipType") {
            Types = [this.getRelationshipType(Idenifying)];
            Types.forEach(type => {
                this.renameProperty(type, oldPropertyKey, newPropertyKey);
            });
        }
    }

    public SMO_renameLabel(oldLabel: string, newLabel: string) {
            this.renameLabel(oldLabel, newLabel);
    }

    public SMO_AddPropertyType({ Idenifying, newProperty, defa, whatType }: { Idenifying: string, newProperty: { key: string, value: any }, defa?: any, whatType: whatType }) {
        let Types: Y.Map<any>[] = [];
        if (whatType === "NodeType") {
            const uuids = this.findAllTypeUuids(Idenifying);
            Types = Array.from(uuids).map(uuid => this.nodeTypes.get(uuid)!);
            Types.forEach(type => {
                this.addProperty(type, newProperty, defa);
            });
        }
        else if (whatType === "RelationshipType") {
            Types = [this.getRelationshipType(Idenifying)];
            Types.forEach(type => {
                this.addProperty(type, newProperty, defa);
            });
        }
    }

    public SMO_AddLabelToNodeType(IdenifyingType: string, newLabel: string) {
        this.addLabeltoNodeType(IdenifyingType, newLabel);
    }

    public SMO_RemoveLabelFromNodeType(IdenifyingType: string, labelName: string) {
            this.removeNodeLabels(IdenifyingType, [labelName]);
    }

    public SMO_DropPropertyType({ Idenifying, propertyKey, whatType }: { Idenifying: string, propertyKey: string, whatType: whatType }) {
        let Types: Y.Map<any>[] = [];
        if (whatType === "NodeType") {
            const uuids = this.findAllTypeUuids(Idenifying);
            Types = Array.from(uuids).map(uuid => this.nodeTypes.get(uuid)!);
        }
        else if (whatType === "RelationshipType") {
            Types = [this.getRelationshipType(Idenifying)];
        }
        Types.forEach(Type => {
            const properties = Type.get('properties');
            if (properties) properties.delete(propertyKey);
        });
    }

    public getPropertyTypeTags(Idenifying: string, propertyKey: string, whatType: whatType): string[] {
        let Types: Y.Map<any>[] = [];
        if (whatType === "NodeType") {
            const uuids = this.findAllTypeUuids(Idenifying);
            // Sort deterministically to avoid replica divergence
            Types = Array.from(uuids).sort().map(uuid => this.nodeTypes.get(uuid)!);
        } else {
            Types = [this.getRelationshipType(Idenifying)];
        }

        const tags = new Set<string>();
        Types.forEach(Type => {
            const properties = Type.get('properties');
            if (properties) {
                const propertyMap = properties.get(propertyKey);
                if (propertyMap) {
                    const activeTypes = propertyMap.get('activeTypes');
                    if (activeTypes) {
                        Array.from(activeTypes.keys()).forEach(key => tags.add(key as string));
                    }
                }
            }
        });
        return Array.from(tags);
    }

    private foldMappings( oldMap: Record<string, any> | undefined, newMap: Record<string, any> | undefined ): Record<string, any> {
        if (!oldMap) return newMap ?? {};
        if (!newMap) return oldMap;
        const composed: Record<string, any> = {};
        for (const [key, tempVal] of Object.entries(oldMap)) {
            if (tempVal !== null && tempVal !== undefined && String(tempVal) in newMap) {
                composed[key] = newMap[String(tempVal)];
            } else {
                composed[key] = tempVal;
            }
        }
        for (const [key, val] of Object.entries(newMap)) {
            if (!(key in oldMap) || key === 'default') {
                composed[key] = val;
            }
        }
        return composed;
    }

    public SMO_ChangePropertyType({ Idenifying, propertyKey, oldTags, newPropertyType, defaultVal, whatType }: { Idenifying: string, propertyKey: string, oldTags?: string[], newPropertyType: dataTypes, defaultVal: defaultVal, whatType: whatType }) {
        let Types: Y.Map<any>[] = [];
        if (whatType === "NodeType") {
            const uuids = this.findAllTypeUuids(Idenifying);
            Types = Array.from(uuids).map(uuid => this.nodeTypes.get(uuid)!);
        } else {
            Types = [this.getRelationshipType(Idenifying)];
        }

        this.doc.transact(() => {
            Types.forEach(Type => {
                const properties = Type.get('properties');
                if (properties) {
                    const propertyMap = properties.get(propertyKey);
                    if (propertyMap) {
                        const activeTypes = propertyMap.get('activeTypes');
                        if (activeTypes) {
                            let currentRawMap: Record<string, any> | undefined = undefined;
                            if(!oldTags) { oldTags = this.getPropertyTypeTags(Idenifying, propertyKey, whatType) }
                            for (const tag of oldTags) {
                                const activeVal = activeTypes.get(tag);
                                if (activeVal && activeVal.transformerMap) {
                                    currentRawMap = activeVal.transformerMap;
                                    break;
                                }
                            }
                            const finalTransMap = this.foldMappings(currentRawMap, defaultVal.transformerMap);
                            const upDefValue = {
                                ...defaultVal,
                                transformerMap: finalTransMap
                            };
                            for (const tag of oldTags) {
                                activeTypes.delete(tag);
                            }
                            activeTypes.set(this.doc.clientID.toString(), { value: newPropertyType, ...upDefValue });
                        }
                    }
                }
            });
        });
    }


    public SMO_splitLabel({ oldName, newName1, newName2 }: { oldName: string, newName1: string, newName2: string }) {
        this.splitLabel(oldName, newName1, newName2)
    }

    public SMO_splitNodeType({ legacyType, splitProperty, mapping, defaultType }: { legacyType: string; splitProperty: string; mapping: Record<string, string>; defaultType: string; }) {
        this.doc.transact(() => {
            this.schemaMappings.set(legacyType, {
                kind: "split",
                legacyType,
                splitProperty,
                mapping,
                defaultType
            });

            Object.values(mapping).forEach(targetType => {
                if (this.findAllTypeUuids(targetType).size === 0) {
                    const legacyUuid = Array.from(this.findAllTypeUuids(legacyType))[0];
                    const legacyNodeTypeMap = legacyUuid ? this.nodeTypes.get(legacyUuid) : null;

                    const labels: string[] = [];
                    if (legacyNodeTypeMap && legacyNodeTypeMap.get('labels')) {
                        legacyNodeTypeMap.get('labels').forEach((lblUuid: string) => {
                            const lblName = this.Uuid.get(lblUuid);
                            if (lblName) labels.push(lblName);
                        });
                    }

                    const properties: Record<string, any> = {};
                    if (legacyNodeTypeMap && legacyNodeTypeMap.get('properties')) {
                        legacyNodeTypeMap.get('properties').forEach((valMap: Y.Map<any>, key: string) => {
                            const activeTypes = valMap.get('activeTypes');
                            if (activeTypes) {
                                const firstActive = Array.from(activeTypes.values())[0];
                                const propValType = (typeof firstActive === 'string')
                                    ? firstActive
                                    : (firstActive as any)?.value || 'string';
                                properties[key] = propValType;
                            }
                        });
                    }

                    this.addNodeType({
                        IdenifyingType: targetType,
                        labels,
                        properties
                    });
                }
            });
        });
    }

    public SMO_splitRelationshipType({ oldName, newName1, newName2 }: { oldName: string, newName1: string, newName2: string }) {
        this.doc.transact(() => {
            this.schemaMappings.set(oldName, {
                kind: 'splitRT',
                legacyEdge: oldName,
                newEdge1: newName1,
                newEdge2: newName2,
            });

            const oldRT = this.relationshipTypes.get(oldName);
            const sLabel  = oldRT ? this.getRelationshipTypeLabelName(oldRT, 'sourceNodeLabel') : 'person';
            const tLabel  = oldRT ? this.getRelationshipTypeLabelName(oldRT, 'targetNodeLabel') : 'person';
            const properties = oldRT ? this.getRelationshipTypeProperties(oldRT) : {};

            [newName1, newName2].forEach(newName => {
                if (!this.relationshipTypes.has(newName)) {
                    this.addRelationshipType({
                        IdenifyingEdge: newName,
                        sourceNodeLabel: sLabel,
                        targetNodeLabel: tLabel,
                        properties,
                    });
                }
            });
        });
    }

    public SMO_unionLabels({ oldLabel1, oldLabel2, newLabel }: { oldLabel1: string, oldLabel2: string, newLabel: string }) {
        this.unionLabel(oldLabel1, oldLabel2, newLabel)
    }

    public SMO_unionNodeTypes({ newType, legacyTypes, writeDefault }: { newType: string; legacyTypes: string[]; writeDefault: string; }) {
        this.doc.transact(() => {

            this.schemaMappings.set(newType, {
                kind: "union",
                newType,
                legacyTypes,
                writeDefault
            });

            if (this.findAllTypeUuids(newType).size === 0) {
                const labels = new Set<string>();
                const properties: Record<string, any> = {};

                legacyTypes.forEach(legacyType => {
                    const legacyUuid = Array.from(this.findAllTypeUuids(legacyType))[0];
                    const legacyNodeTypeMap = legacyUuid ? this.nodeTypes.get(legacyUuid) : null;

                    if (legacyNodeTypeMap) {
                        if (legacyNodeTypeMap.get('labels')) {
                            legacyNodeTypeMap.get('labels').forEach((lblUuid: string) => {
                                const lblName = this.Uuid.get(lblUuid);
                                if (lblName) labels.add(lblName);
                            });
                        }
                        if (legacyNodeTypeMap.get('properties')) {
                            legacyNodeTypeMap.get('properties').forEach((valMap: Y.Map<any>, key: string) => {
                                const activeTypes = valMap.get('activeTypes');
                                if (activeTypes) {
                                    const firstActive = Array.from(activeTypes.values())[0];
                                    const propValType = (typeof firstActive === 'string')
                                        ? firstActive
                                        : (firstActive as any)?.value || 'string';
                                    properties[key] = propValType;
                                }
                            });
                        }
                    }
                });

                this.addNodeType({
                    IdenifyingType: newType,
                    labels: Array.from(labels),
                    properties
                });
            }
        });
    }

    public SMO_unionRelationshipTypes({ oldLabel1, oldLabel2, newLabel }: { oldLabel1: string, oldLabel2: string, newLabel: string }) {
        this.doc.transact(() => {
            this.schemaMappings.set(newLabel, {
                kind: 'unionRT',
                newEdge: newLabel,
                legacyEdges: [oldLabel1, oldLabel2],
            });

            if (!this.relationshipTypes.has(newLabel)) {
                const rt1 = this.relationshipTypes.get(oldLabel1);
                const rt2 = this.relationshipTypes.get(oldLabel2);

                const srcLabel = rt1 ? this.getRelationshipTypeLabelName(rt1, 'sourceNodeLabel') : 'person';
                const tgtLabel = rt1 ? this.getRelationshipTypeLabelName(rt1, 'targetNodeLabel') : 'person';

                const properties: Record<string, string> = {};
                if (rt1) Object.assign(properties, this.getRelationshipTypeProperties(rt1));
                if (rt2) Object.assign(properties, this.getRelationshipTypeProperties(rt2));

                this.addRelationshipType({
                    IdenifyingEdge: newLabel,
                    sourceNodeLabel: srcLabel,
                    targetNodeLabel: tgtLabel,
                    properties,
                });
            }
        });
    }


    // TEST HELPER
    public getNodeTypeJSON(IdenifyingType: string) {
        const json = this.finalNodeTypes.get(IdenifyingType);
        if (!json) {
            throw new SchemaError('Node type not found');
        }
        return json;
    }

    public getRelationshipTypeJSON(IdenifyingEdge: string) {
        const relationshipType = getOrThrow(this.relationshipTypes.get(IdenifyingEdge), 'Relationship type not found');
        const rawJson = relationshipType.toJSON();
        const resolvedSourceLabel = this.Uuid.get(Object.keys(rawJson.sourceNodeLabel)[0]);
        const resolvedTargetLabel = this.Uuid.get(Object.keys(rawJson.targetNodeLabel)[0]);

        if (resolvedSourceLabel) rawJson.sourceNodeLabel = resolvedSourceLabel;
        if (resolvedTargetLabel) rawJson.targetNodeLabel = resolvedTargetLabel;

        return rawJson;
    }

    public testAccessAllLabels(): Map<string, Set<string>> {
        return this.getLabels();
    }
    public LabelUuidTestAcess(labelName: string): Set<string> | undefined {
        return this.getUuidsForLabel(labelName);
    }

}