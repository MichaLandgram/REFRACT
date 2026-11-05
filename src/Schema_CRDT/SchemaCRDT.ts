import * as Y from 'yjs';
import { SchemaError } from '../Helper/ErrorDefinition';
import { dataTypes, defaultVal, whatType, SchemaDefinition, FoundUUIDs } from '../Helper/types';
import { getOrThrow } from '../Helper/ErrorDefinition';
import { v4 as uuidv4 } from 'uuid';

export class Schema_v1 {
    private doc: Y.Doc;
    // concurrency storage for nodeTypes
    private nodeTypes: Y.Map<any>;
    // concurrency storage for relationshipTypes
    private relationshipTypes: Y.Map<any>;
    // concurrency storage for labelName to UUID mapping
    private Uuid: Y.Map<any>;
    // stores the split history of labels (only the 2nd label is stored, first is based on the original label uuid)
    private labelSplits: Y.Map<string>;
    // stores the "parent" label for a split label (the 2nd label is stored, first is based on the original label uuid)
    private labelParents: Y.Map<string>;
    // concurreny storage for schema mappings
    // for Node Types, and for Relationship Types. This is used to resolve the final schema after concurrent modifications.
    // only grow only for labels - for node types and relationship types partial cleanup when a type is re-created
    private schemaMappings: Y.Map<any>;
    // stores the final merged nodeTypes for each identifyingType, after resolving any concurrent modifications
    // node tpyes are stored under unique ideas but are merged under a common identifyingType name
    private finalNodeTypes: Map<string, any>;
    // stores the mapping of identifyingType names to the set of UUIDs that represent them in the Yjs document.
    private nodeTypesToUuid: Map<string, Set<string>>;
    // stores the mapping of identifyingType names to the set of UUIDs that represent them in the Yjs document.
    private labels: Map<string, Set<string>>;
    // caches for fast label resolution
    private unionMap: Map<string, string[]> = new Map();
    private splitMap: Map<string, string[]> = new Map();
    private labelCache: Map<string, string[]> = new Map();
    // reverse index: label UUID -> set of type names that use this label
    private labelUuidToTypeNames: Map<string, Set<string>> = new Map();

    public get yjsDoc(): Y.Doc {
        return this.doc;
    }
    private rebuildMappingCache() {
        this.unionMap.clear();
        this.splitMap.clear();
        this.schemaMappings.forEach((mapping: any) => {
            if (!mapping) return;
            if (mapping.kind === "unionLabels" && mapping.legacyUuids && mapping.targetUuid) {
                mapping.legacyUuids.forEach((u: string) => {
                    let list = this.unionMap.get(u);
                    if (!list) {
                        list = [];
                        this.unionMap.set(u, list);
                    }
                    list.push(mapping.targetUuid);
                });
            } else if (mapping.kind === "splitLabels" && mapping.legacyUuid && mapping.targetUuids) {
                let list = this.splitMap.get(mapping.legacyUuid);
                if (!list) {
                    list = [];
                    this.splitMap.set(mapping.legacyUuid, list);
                }
                mapping.targetUuids.forEach((u: string) => {
                    list.push(u);
                });
            }
        });
        this.labelCache.clear();
    }

    private recomputeResolvedLabels() {
        this.labelCache.clear();
        const resolved = new Map<string, Set<string>>();
        this.Uuid.forEach((_labelName: unknown, uuid: string) => {
            const resolvedNames = this.resolveLabelNames(uuid);
            resolvedNames.forEach(name => {
                if (!resolved.has(name)) {
                    resolved.set(name, new Set<string>());
                }
                resolved.get(name)!.add(uuid);
            });
        });
        this.labels = resolved;
    }

    private recomputeMergeNodeTypesForLabels(changedUuids: Set<string>) {
        this.recomputeResolvedLabels();
        const affectedNames = new Set<string>();
        changedUuids.forEach(uuid => {
            const names = this.labelUuidToTypeNames.get(uuid);
            if (names) {
                names.forEach(n => affectedNames.add(n));
            }
        });
        affectedNames.forEach(name => {
            try {
                this.finalNodeTypes.set(name, this.mergeNodeTypesToOne(name));
            } catch (e) { }
        });
    }

    private recomputeMergeNodeTypesAll() {
        this.recomputeResolvedLabels();
        this.labelUuidToTypeNames.clear();
        this.nodeTypes.forEach((nodeTypeMap: Y.Map<any>, uuid: string) => {
            const name = nodeTypeMap.get('name');
            if (name && typeof name === 'string') {
                let uuidSet = this.nodeTypesToUuid.get(name);
                if (!uuidSet) {
                    uuidSet = new Set<string>();
                    this.nodeTypesToUuid.set(name, uuidSet);
                }
                uuidSet.add(uuid);
                const labelsYMap = nodeTypeMap.get('labels') as Y.Map<any> | undefined;
                if (labelsYMap) {
                    labelsYMap.forEach((_val: any, labelUuid: string) => {
                        let nameSet = this.labelUuidToTypeNames.get(labelUuid);
                        if (!nameSet) {
                            nameSet = new Set<string>();
                            this.labelUuidToTypeNames.set(labelUuid, nameSet);
                        }
                        nameSet.add(name);
                    });
                }
                try {
                    this.finalNodeTypes.set(name, this.mergeNodeTypesToOne(name));
                } catch (e) { }
            }
        });
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
        this.labelSplits = this.doc.getMap('label_splits');
        this.labelParents = this.doc.getMap('label_parents');

        /* Initialize the schema */
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

        this.rebuildMappingCache();
        this.recomputeMergeNodeTypesAll();

        this.Uuid.observe((event: Y.YMapEvent<unknown>) => {
            const changedUuids = new Set<string>();
            event.changes.keys.forEach((_change, uuid) => {
                changedUuids.add(uuid);
            });
            if (changedUuids.size > 0) {
                this.recomputeMergeNodeTypesForLabels(changedUuids);
            }
        });
        this.schemaMappings.observe((event: Y.YMapEvent<any>) => {
            this.rebuildMappingCache();
            this.recomputeResolvedLabels();
            const affectedTypes = new Set<string>();
            let needFullRecompute = false;
            event.changes.keys.forEach((_change, key) => {
                const rule = this.schemaMappings.get(key) as any;
                if (!rule) return;
                if (rule.kind === 'split' || rule.kind === 'union' ||
                    rule.kind === 'splitRT' || rule.kind === 'unionRT') {
                    if (rule.legacyType) affectedTypes.add(rule.legacyType);
                    if (rule.defaultType) affectedTypes.add(rule.defaultType);
                    if (rule.mapping) {
                        const vals = Object.values(rule.mapping) as string[];
                        vals.forEach(t => affectedTypes.add(t));
                    }
                    if (rule.newType) affectedTypes.add(rule.newType);
                    if (rule.legacyTypes) {
                        (rule.legacyTypes as string[]).forEach(t => affectedTypes.add(t));
                    }
                } else if (rule.kind === 'unionLabels' || rule.kind === 'splitLabels') {
                    const labelUuids: string[] = [];
                    if (rule.legacyUuids) labelUuids.push(...rule.legacyUuids);
                    if (rule.targetUuid) labelUuids.push(rule.targetUuid);
                    if (rule.targetUuids) labelUuids.push(...rule.targetUuids);
                    if (rule.legacyUuid) labelUuids.push(rule.legacyUuid);
                    for (const uuid of labelUuids) {
                        const names = this.labelUuidToTypeNames.get(uuid);
                        if (names) {
                            names.forEach(n => affectedTypes.add(n));
                        }
                    }
                    needFullRecompute = true;
                } else {
                    needFullRecompute = true;
                }
            });
            if (needFullRecompute) {
                this.finalNodeTypes.forEach((_json, name) => {
                    try {
                        this.finalNodeTypes.set(name, this.mergeNodeTypesToOne(name));
                    } catch (e) { }
                });
            } else {
                affectedTypes.forEach(name => {
                    try {
                        this.finalNodeTypes.set(name, this.mergeNodeTypesToOne(name));
                    } catch (e) { }
                });
            }
        });
        this.Uuid.observe((events) => {
            events.changes.keys.forEach((change, uuid) => {
                if (change.action === 'delete') {
                    const labelSet = new Set<string>([uuid]);
                    if (this.labelSplits.has(uuid)) {
                        const partner = this.labelSplits.get(uuid);
                        if (partner) labelSet.add(partner);
                    }
                    this.cascadingLabelDeletions(labelSet);
                }
            });
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
                                    const labelsYMap = nodeTypeMap.get('labels') as Y.Map<any> | undefined;
                                    if (labelsYMap) {
                                        labelsYMap.forEach((_val: any, labelUuid: string) => {
                                            let nameSet = this.labelUuidToTypeNames.get(labelUuid);
                                            if (!nameSet) {
                                                nameSet = new Set<string>();
                                                this.labelUuidToTypeNames.set(labelUuid, nameSet);
                                            }
                                            nameSet.add(name);
                                        });
                                    }
                                }
                                // Apply any known splits to this newly arrived nodeType
                                this.doc.transact(() => this.applySplitCorrections(nodeTypeMap));
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
                                this.labelUuidToTypeNames.forEach((nameSet) => {
                                    nameSet.delete(name);
                                });
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

        this.labelSplits.observe((event: Y.YMapEvent<string>) => {
            event.changes.keys.forEach((change, _uuid) => {
                if (change.action === 'add' || change.action === 'update') {
                    this.doc.transact(() => {
                        this.nodeTypes.forEach((nodeTypeMap: Y.Map<any>) => {
                            this.applySplitCorrections(nodeTypeMap);
                        });
                    });
                }
            });
        });

    }

    public resolveLabelNames(uuid: string): string[] {
        if (this.labelCache.has(uuid)) {
            return this.labelCache.get(uuid)!;
        }

        let currentUuids = new Set<string>([uuid]);
        const maxIterations = 100;
        let iterations = 0;
        let changed = true;

        while (changed && iterations < maxIterations) {
            iterations++;
            changed = false;
            const nextUuids = new Set<string>();
            /* eslint-disable-next-line @typescript-eslint/no-unused-vars */
            currentUuids.forEach(curUuid => {
                let mapped = false;

                const targetUnions = this.unionMap.get(curUuid);
                if (targetUnions) {
                    targetUnions.forEach(u => nextUuids.add(u));
                    mapped = true;
                }

                const targetSplits = this.splitMap.get(curUuid);
                if (targetSplits) {
                    targetSplits.forEach(u => nextUuids.add(u));
                    mapped = true;
                }

                if (!mapped) {
                    nextUuids.add(curUuid);
                } else {
                    changed = true;
                }
            });
            currentUuids = nextUuids;
        }

        const names = new Set<string>();
        currentUuids.forEach(u => {
            const name = this.Uuid.get(u);
            if (name) names.add(name);
        });
        const namesArray = Array.from(names);
        this.labelCache.set(uuid, namesArray);
        return namesArray;
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
                    const resolvedNames = this.resolveLabelNames(labelUuid);
                    resolvedNames.forEach(labelName => {
                        if (labelName) mergedLabels[labelName] = labelName;
                    });
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
            this.recomputeResolvedLabels();
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
        this.doc.transact(() => {
            founduuids.forEach((uuid: string) => {
                this.Uuid.delete(uuid);
                const partner = this.labelSplits.get(uuid);
                if (partner) {
                    this.Uuid.delete(partner);
                    this.labelSplits.delete(partner);
                    this.labelParents.delete(partner);
                }
                this.labelSplits.delete(uuid);
                this.labelParents.delete(uuid);
            });
        });
        this.cascadingLabelDeletions(founduuids);
        this.recomputeMergeNodeTypesAll();
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
        this.recomputeResolvedLabels();
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
        const uuid1 = this.createLabel(newLabel1);
        const uuid2 = this.createLabel(newLabel2);

        this.nodeTypes.forEach(nodeTypeMap => {
            const labelsMap = nodeTypeMap.get('labels');
            if (labelsMap) {
                oldUuids.forEach((uuid: string) => {
                    if (labelsMap.has(uuid)) {
                        labelsMap.set(uuid1, uuid1);
                        labelsMap.set(uuid2, uuid2);
                    }
                });
            }
        });

        oldUuids.forEach((oldUuid: string) => {
            this.labelSplits.set(oldUuid, uuid2);
            this.labelSplits.set(uuid2, oldUuid);
            this.labelParents.set(uuid2, oldUuid);
            
            this.labelSplits.set(uuid1, oldUuid);
            this.labelParents.set(uuid1, oldUuid);

            const mappingKey = `split_lbl_${oldName}_${oldUuid}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
            this.schemaMappings.set(mappingKey, {
                kind: "splitLabels",
                legacyUuid: oldUuid,
                targetUuids: [uuid1, uuid2]
            });
        });
        this.rebuildMappingCache();
        this.recomputeMergeNodeTypesAll();
    }

    private applySplitCorrections(nodeTypeMap: Y.Map<any>): void {
        const labelsMap: Y.Map<string> | undefined = nodeTypeMap.get('labels');
        if (!labelsMap) return;

        const toAdd: string[] = [];
        const toDelete: string[] = [];

        labelsMap.forEach((_val: string, uuid: string) => {
            const partner = this.labelSplits.get(uuid);
            if (partner) {
                const isChild = this.labelParents.get(uuid) === partner;
                if (isChild) {
                    if (!labelsMap.has(partner)) {
                        toDelete.push(uuid);
                    }
                } else {
                    if (!labelsMap.has(partner) && this.Uuid.has(partner)) {
                        toAdd.push(partner);
                    }
                }
            }
        });

        toAdd.forEach(uuid => labelsMap.set(uuid, uuid));
        toDelete.forEach(uuid => labelsMap.delete(uuid));
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

        const targetUuid = this.createLabel(newLabel);
        const mappingKey = `union_lbl_${oldLabel1}_${oldLabel2}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        this.schemaMappings.set(mappingKey, {
            kind: "unionLabels",
            newLabel,
            targetUuid: targetUuid,
            legacyUuids: [...Array.from(oldUuids1), ...Array.from(oldUuids2)]
        });
        this.rebuildMappingCache();
        this.recomputeMergeNodeTypesAll();
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
        return this.labels.get(name) ?? new Set<string>();
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
            const propUuid = uuidv4(); // idea to change the prop under uuid storage but not implemented yet - not implemented in this thesis, but included in the thesis
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
            this.schemaMappings.forEach((val, key) => {
                if (val && (
                    val.newType === IdenifyingType || 
                    val.legacyType === IdenifyingType ||
                    (val.legacyTypes && val.legacyTypes.includes(IdenifyingType))
                )) {
                    this.schemaMappings.delete(key);
                }
            });
        });
    }

    private dropNodeType(IdenifyingType: string) {
        if (this.schemaMappings.has(IdenifyingType)) {
            throw new SchemaError('This Type is mapped: cannot be dropped: ' + IdenifyingType);
        }
        const uuids = this.findAllTypeUuids(IdenifyingType);
        if (uuids.size === 0) {
            throw new SchemaError('Node type not found: ' + IdenifyingType);
        }
        this.doc.transact(() => {
            uuids.forEach(uuid => { this.nodeTypes.delete(uuid); });
        });
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

    private isRelationshipTypeValid(rtMap: Y.Map<any>): boolean {
        const sourceYMap = rtMap.get('sourceNodeLabel') as Y.Map<string> | undefined;
        const targetYMap = rtMap.get('targetNodeLabel') as Y.Map<string> | undefined;
        const sourceUuids = sourceYMap ? Array.from(sourceYMap.keys()) : [];
        const targetUuids = targetYMap ? Array.from(targetYMap.keys()) : [];
        const isSourceInvalid = sourceUuids.length > 0 && !sourceUuids.some(uuid => this.resolveLabelNames(uuid).length > 0);
        const isTargetInvalid = targetUuids.length > 0 && !targetUuids.some(uuid => this.resolveLabelNames(uuid).length > 0);
        return !isSourceInvalid && !isTargetInvalid;
    }

    private addRelationshipType({ IdenifyingEdge, sourceNodeLabel, targetNodeLabel, properties, defa }: { IdenifyingEdge: string, sourceNodeLabel: string, targetNodeLabel: string, properties: any, defa?: any }) {
        if (this.relationshipTypes.has(IdenifyingEdge)) {
            const rt = this.relationshipTypes.get(IdenifyingEdge)!;
            if (this.isRelationshipTypeValid(rt)) {
                throw new SchemaError('Type already exists');
            }
            this.relationshipTypes.delete(IdenifyingEdge);
        }
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
            this.schemaMappings.forEach((val, key) => {
                if (val && (
                    val.newEdge === IdenifyingEdge || 
                    val.legacyEdge === IdenifyingEdge ||
                    (val.legacyEdges && val.legacyEdges.includes(IdenifyingEdge))
                )) {
                    this.schemaMappings.delete(key);
                }
            });
        });
    }
    private deleteRelationshipType(IdenifyingEdge: string) {
        if (!this.relationshipTypes.has(IdenifyingEdge)) throw new SchemaError('Relationship type not found');
        this.relationshipTypes.delete(IdenifyingEdge);
    }
    private getRelationshipType(IdenifyingEdge: string) {
        const relationshipType = getOrThrow(this.relationshipTypes.get(IdenifyingEdge), 'Relationship type not found');
        if (!this.isRelationshipTypeValid(relationshipType)) {
            throw new SchemaError('Relationship type not found');
        }
        return relationshipType;
    }


    private getRelationshipTypeLabelName(rtMap: Y.Map<any>, field: 'sourceNodeLabel' | 'targetNodeLabel'): string {
        const orSet = rtMap.get(field) as Y.Map<string> | undefined;
        if (!orSet) return '';
        const firstUuid = Array.from(orSet.keys())[0];
        if (!firstUuid) return '';
        const resolved = this.resolveLabelNames(firstUuid);
        return resolved[0] ?? firstUuid;
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
        // Garbage collection of invalid relationship types
        this.doc.transact(() => {
            this.relationshipTypes.forEach((relationshipTypeMap, identifyingType) => {
                if (!this.isRelationshipTypeValid(relationshipTypeMap)) {
                    this.relationshipTypes.delete(identifyingType);
                }
            });
        });

        const jsonSchema = this.doc.toJSON();
        const mergedNodeTypes: Record<string, any> = {};
        this.finalNodeTypes.forEach((json, name) => {
            mergedNodeTypes[name] = json;
        });
        jsonSchema.nodeTypes = mergedNodeTypes;

        if (jsonSchema.relationshipTypes) {
            const validRelationshipTypes: Record<string, any> = {};
            for (const [key, val] of Object.entries(jsonSchema.relationshipTypes)) {
                const sourceUuids = Object.keys((val as any).sourceNodeLabel || {});
                const targetUuids = Object.keys((val as any).targetNodeLabel || {});
                const hasValidSource = sourceUuids.length > 0 && sourceUuids.some(uuid => this.resolveLabelNames(uuid).length > 0);
                const hasValidTarget = targetUuids.length > 0 && targetUuids.some(uuid => this.resolveLabelNames(uuid).length > 0);
                if (hasValidSource && hasValidTarget) {
                    validRelationshipTypes[key] = val;
                }
            }
            jsonSchema.relationshipTypes = validRelationshipTypes;
        }

        if (this.schemaMappings) {
            const rawMappings = this.schemaMappings.toJSON();
            const sortedMappings: Record<string, any> = {};
            Object.keys(rawMappings).sort().forEach(key => {
                sortedMappings[key] = rawMappings[key];
            });
            jsonSchema.schema_mappings = sortedMappings;
        }

        delete jsonSchema.identifyingTypeIndex;
        return jsonSchema;
    }
    public transformToJSONFullSchema() {
        // Garbage collection of invalid relationship types
        this.doc.transact(() => {
            this.relationshipTypes.forEach((relationshipTypeMap, identifyingType) => {
                if (!this.isRelationshipTypeValid(relationshipTypeMap)) {
                    this.relationshipTypes.delete(identifyingType);
                }
            });
        });

        const jsonSchema = this.doc.toJSON();
        const mergedNodeTypes: Record<string, any> = {};
        this.finalNodeTypes.forEach((json, name) => {
            mergedNodeTypes[name] = json;
        });
        jsonSchema.nodeTypes = mergedNodeTypes;

        if (jsonSchema.relationshipTypes) {
            const validRelationshipTypes: Record<string, any> = {};
            for (const [key, val] of Object.entries(jsonSchema.relationshipTypes)) {
                const sourceUuids = Object.keys((val as any).sourceNodeLabel || {});
                const targetUuids = Object.keys((val as any).targetNodeLabel || {});
                const hasValidSource = sourceUuids.length > 0 && sourceUuids.some(uuid => this.resolveLabelNames(uuid).length > 0);
                const hasValidTarget = targetUuids.length > 0 && targetUuids.some(uuid => this.resolveLabelNames(uuid).length > 0);
                if (hasValidSource && hasValidTarget) {
                    validRelationshipTypes[key] = val;
                }
            }
            jsonSchema.relationshipTypes = validRelationshipTypes;
        }

        if (this.schemaMappings) {
            const rawMappings = this.schemaMappings.toJSON();
            const sortedMappings: Record<string, any> = {};
            Object.keys(rawMappings).sort().forEach(key => {
                sortedMappings[key] = rawMappings[key];
            });
            jsonSchema.schema_mappings = sortedMappings;
        }

        return jsonSchema;
    }

    public getNodeTypeJSONFast(identifyingType: string): any | undefined {
        return this.finalNodeTypes.get(identifyingType);
    }

    public getNodeTypeNamesFast(): string[] {
        return Array.from(this.finalNodeTypes.keys());
    }

    public getRelationshipTypeJSONFast(identifyingEdge: string): any | undefined {
        const rtMap = this.relationshipTypes.get(identifyingEdge);
        if (!rtMap) return undefined;
        if (!this.isRelationshipTypeValid(rtMap)) return undefined;
        return rtMap.toJSON();
    }

    public getRelationshipTypeNamesFast(): string[] {
        const names: string[] = [];
        this.relationshipTypes.forEach((rtMap, name) => {
            if (this.isRelationshipTypeValid(rtMap)) {
                names.push(name);
            }
        });
        return names;
    }

    public getSchemaMappings(): Record<string, any> {
        return this.schemaMappings.toJSON();
    }

    public getSchemaUuids(): Record<string, string> {
        return this.Uuid.toJSON() as Record<string, string>;
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
        if (this.schemaMappings.has(legacyType)) throw new SchemaError('This Type is already mapped: cannot be split: ' + legacyType);
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
                            const resolved = this.resolveLabelNames(lblUuid);
                            resolved.forEach(lblName => {
                                if (lblName) labels.push(lblName);
                            });
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

    public SMO_splitRelationshipType({ legacyType, newType1, newType2 }: { legacyType: string, newType1: string, newType2: string }) {
        if (this.schemaMappings.has(legacyType)) {
            throw new SchemaError('This Type is already mapped: cannot be split: ' + legacyType);
        }
        this.doc.transact(() => {
            const oldRT = this.relationshipTypes.get(legacyType);
            const sLabel  = oldRT ? this.getRelationshipTypeLabelName(oldRT, 'sourceNodeLabel') : 'person';
            const tLabel  = oldRT ? this.getRelationshipTypeLabelName(oldRT, 'targetNodeLabel') : 'person';
            const properties = oldRT ? this.getRelationshipTypeProperties(oldRT) : {};

            [newType1, newType2].forEach(newName => {
                if (!this.relationshipTypes.has(newName)) {
                    this.addRelationshipType({
                        IdenifyingEdge: newName,
                        sourceNodeLabel: sLabel,
                        targetNodeLabel: tLabel,
                        properties,
                    });
                }
            });
            this.schemaMappings.set(legacyType, {
                kind: 'splitRT',
                legacyEdge: legacyType,
                newEdge1: newType1,
                newEdge2: newType2,
            });
        });
    }

    public SMO_unionLabels({ oldLabel1, oldLabel2, newLabel }: { oldLabel1: string, oldLabel2: string, newLabel: string }) {
        this.unionLabel(oldLabel1, oldLabel2, newLabel)
    }

    public SMO_unionNodeTypes({ newType, legacyTypes, writeDefault }: { newType: string; legacyTypes: string[]; writeDefault: string; }) {
        this.doc.transact(() => {

            if (this.findAllTypeUuids(newType).size === 0) {
                const labels = new Set<string>();
                const properties: Record<string, any> = {};

                legacyTypes.forEach(legacyType => {
                    const legacyUuid = Array.from(this.findAllTypeUuids(legacyType))[0];
                    const legacyNodeTypeMap = legacyUuid ? this.nodeTypes.get(legacyUuid) : null;

                    if (legacyNodeTypeMap) {
                        if (legacyNodeTypeMap.get('labels')) {
                            legacyNodeTypeMap.get('labels').forEach((lblUuid: string) => {
                                const resolved = this.resolveLabelNames(lblUuid);
                                resolved.forEach(lblName => {
                                    if (lblName) labels.add(lblName);
                                });
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

                this.schemaMappings.set(newType, {
                kind: "union",
                newType,
                legacyTypes,
                writeDefault
                });
            }
        });
    }

    public SMO_unionRelationshipTypes({ newType, legacyTypes, writeDefault }: { newType: string; legacyTypes: string[]; writeDefault: string }) {
        this.doc.transact(() => {
            if (!this.relationshipTypes.has(newType)) {
                const rt1 = this.relationshipTypes.get(legacyTypes[0]);
                const rt2 = this.relationshipTypes.get(legacyTypes[1]);

                if (!rt1) throw new SchemaError(`Legacy relationship type "${legacyTypes[0]}" not found`);
                if (!rt2) throw new SchemaError(`Legacy relationship type "${legacyTypes[1]}" not found`);

                const srcLabel1 = this.getRelationshipTypeLabelName(rt1, 'sourceNodeLabel');
                const tgtLabel1 = this.getRelationshipTypeLabelName(rt1, 'targetNodeLabel');
                const srcLabel2 = this.getRelationshipTypeLabelName(rt2, 'sourceNodeLabel');
                const tgtLabel2 = this.getRelationshipTypeLabelName(rt2, 'targetNodeLabel');

                if (srcLabel1 !== srcLabel2 || tgtLabel1 !== tgtLabel2) {
                    throw new SchemaError(
                        `Cannot union relationship types with different endpoints: ` +
                        `"${legacyTypes[0]}" (${srcLabel1} -> ${tgtLabel1}) vs ` +
                        `"${legacyTypes[1]}" (${srcLabel2} -> ${tgtLabel2})`
                    );
                }

                const properties: Record<string, string> = {};
                Object.assign(properties, this.getRelationshipTypeProperties(rt1));
                Object.assign(properties, this.getRelationshipTypeProperties(rt2));

                this.addRelationshipType({
                    IdenifyingEdge: newType,
                    sourceNodeLabel: srcLabel1,
                    targetNodeLabel: tgtLabel1,
                    properties,
                });
            }

            this.schemaMappings.set(newType, {
                kind: 'unionRT',
                newEdge: newType,
                legacyEdges: legacyTypes,
            });
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
        const relationshipType = this.getRelationshipType(IdenifyingEdge);
        const rawJson = relationshipType.toJSON();
        const srcUuid = Object.keys(rawJson.sourceNodeLabel)[0];
        const tgtUuid = Object.keys(rawJson.targetNodeLabel)[0];
        const resolvedSourceLabel = srcUuid ? this.resolveLabelNames(srcUuid)[0] : undefined;
        const resolvedTargetLabel = tgtUuid ? this.resolveLabelNames(tgtUuid)[0] : undefined;

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
    public testAccessSchemaMappings(): Y.Map<any> {
        return this.schemaMappings;
    }

}