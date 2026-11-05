import * as Y from 'yjs';
import { Schema_v1 } from '../Schema_CRDT/SchemaCRDT';
import { whatType, PropertyLensMap, dataTypes, GraphedVisibleEdge, GraphedVisibleNode, EdgeId, NodeId } from '../Helper/types';
import { SchemaError } from '../Helper/ErrorDefinition';
import { PropertyGraph } from '../GraphDB_CRDT/PropertyGraph';
import { VisibleNode, VisibleEdge } from '../Helper/types';
import { unpack, toArray } from '../Helper/helper';

export class SchemaLensEngine {
    private schemaCRDT: Schema_v1;
    // Cache for the schema data to avoid repeding translations of the Yjs state ot JSON
    private cachedSchema: any | null = null;
    // Caches for various lookups to improve performance - all 9 following
    private propertyLensCache = new Map<string, PropertyLensMap | null>();
    private appKeyDbKeyCache = new Map<string, { appKey: string, dbKey: string }>();
    private identityTransformCache = new Map<string, boolean>();
    private resolveActiveTypeCache = new Map<string, string>();
    private resolveActiveEdgeTypeCache = new Map<string, string>();
    private nodeTypeEncodingCache = new Map<string, { dbType: string, staticProps: Record<string, any> }>();
    private relTypeEncodingCache = new Map<string, { dbType: string, staticProps: Record<string, any> }>();
    private propEncodingCache = new Map<string, Map<string, { dbKey: string, lens: PropertyLensMap | null }>>();
    private relPropEncodingCache = new Map<string, Map<string, { dbKey: string, lens: PropertyLensMap | null }>>();

    constructor(schemaCRDT: Schema_v1) {
        this.schemaCRDT = schemaCRDT;
        this.refreshCache();

        // observe changes inside the schemaCRDT and update the cachedSchema accordingly
        // not necessary. Only done to not always rebuild the cache from scratch for smaller changes 
        this.schemaCRDT.yjsDoc.on('update', (_update: Uint8Array, _origin: any, doc: Y.Doc, tr: Y.Transaction) => {
            const nodeTypesMap     = doc.getMap('nodeTypes');
            const relTypesMap      = doc.getMap('relationshipTypes');
            const schemaMappingsMap = doc.getMap('schema_mappings');
            const schemaUuidMap    = doc.getMap('schema_uuid');
            const labelSplitsMap   = doc.getMap('label_splits');
            const labelParentsMap  = doc.getMap('label_parents');

            let mappingsChanged = false;
            let labelsChanged   = false;
            let nodeTypesChanged = false;
            let relTypesChanged  = false;

            const changedKeys = Array.from(tr.changed.keys());
            for (let i = 0; i < changedKeys.length && !mappingsChanged; i++) {
                const type = changedKeys[i];
                let current: any = type;
                while (current) {
                    if (current === schemaMappingsMap) {
                        mappingsChanged = true;
                        break;
                    }
                    if (current === schemaUuidMap || current === labelSplitsMap || current === labelParentsMap) {
                        labelsChanged = true;
                        break;
                    }
                    if (current === nodeTypesMap) {
                        nodeTypesChanged = true;
                        break;
                    }
                    if (current === relTypesMap) {
                        relTypesChanged = true;
                        break;
                    }
                    current = current.parent;
                }
            }

            if (mappingsChanged) {
                if (this.cachedSchema) {
                    this.cachedSchema.schema_mappings = this.schemaCRDT.getSchemaMappings();
                    this.cachedSchema.schema_uuid = this.schemaCRDT.getSchemaUuids();
                    this.clearAllCaches();
                    const currentNames = this.schemaCRDT.getNodeTypeNamesFast();
                    const freshNodeTypes: Record<string, any> = {};
                    for (const name of currentNames) {
                        freshNodeTypes[name] = this.schemaCRDT.getNodeTypeJSONFast(name);
                    }
                    this.cachedSchema.nodeTypes = freshNodeTypes;
                    const relNames = this.schemaCRDT.getRelationshipTypeNamesFast();
                    const freshRelTypes: Record<string, any> = {};
                    for (const name of relNames) {
                        freshRelTypes[name] = this.schemaCRDT.getRelationshipTypeJSONFast(name);
                    }
                    this.cachedSchema.relationshipTypes = freshRelTypes;
                } else {
                    this.refreshCache();
                }
            } else if (labelsChanged && !nodeTypesChanged && !relTypesChanged) {
                if (this.cachedSchema) {
                    this.cachedSchema.schema_uuid = this.schemaCRDT.getSchemaUuids();
                    const currentNames = this.schemaCRDT.getNodeTypeNamesFast();
                    const freshNodeTypes: Record<string, any> = {};
                    for (const name of currentNames) {
                        freshNodeTypes[name] = this.schemaCRDT.getNodeTypeJSONFast(name);
                    }
                    this.cachedSchema.nodeTypes = freshNodeTypes;
                    const relNames = this.schemaCRDT.getRelationshipTypeNamesFast();
                    const freshRelTypes: Record<string, any> = {};
                    for (const name of relNames) {
                        freshRelTypes[name] = this.schemaCRDT.getRelationshipTypeJSONFast(name);
                    }
                    this.cachedSchema.relationshipTypes = freshRelTypes;
                    this.clearAllCaches();
                } else {
                    this.refreshCache();
                }
            } else if (nodeTypesChanged || relTypesChanged) {
                const changedNodeTypes = new Set<string>();
                const changedRelTypes  = new Set<string>();

                if (nodeTypesChanged) {
                    const currentNames = this.schemaCRDT.getNodeTypeNamesFast();
                    for (const name of currentNames) changedNodeTypes.add(name);
                    if (this.cachedSchema) {
                        for (const name of Object.keys(this.cachedSchema.nodeTypes)) {
                            if (!changedNodeTypes.has(name)) changedNodeTypes.add(name);
                        }
                    }
                }
                if (relTypesChanged) {
                    const names = this.schemaCRDT.getRelationshipTypeNamesFast();
                    for (const n of names) changedRelTypes.add(n);
                }

                this.refreshCacheIncremental(changedNodeTypes, changedRelTypes);
            }
        });
    }
    private clearAllCaches() {
        this.propertyLensCache.clear();
        this.appKeyDbKeyCache.clear();
        this.identityTransformCache.clear();
        this.resolveActiveTypeCache.clear();
        this.resolveActiveEdgeTypeCache.clear();
        this.nodeTypeEncodingCache.clear();
        this.relTypeEncodingCache.clear();
        this.propEncodingCache.clear();
        this.relPropEncodingCache.clear();
    }
    // full build of the cachedSchema from the Yjs state.
    // Should be called when the schema is first loaded or when a large change occurs.
    public refreshCache() {
        if (this.cachedSchema) return;
        const nodeTypeNames = this.schemaCRDT.getNodeTypeNamesFast();
        const nodeTypes: Record<string, any> = {};
        for (const name of nodeTypeNames) {
            nodeTypes[name] = this.schemaCRDT.getNodeTypeJSONFast(name);
        }

        const relTypeNames = this.schemaCRDT.getRelationshipTypeNamesFast();
        const relationshipTypes: Record<string, any> = {};
        for (const name of relTypeNames) {
            relationshipTypes[name] = this.schemaCRDT.getRelationshipTypeJSONFast(name);
        }

        this.cachedSchema = {
            nodeTypes,
            relationshipTypes,
            schema_mappings: this.schemaCRDT.getSchemaMappings(),
            schema_uuid: this.schemaCRDT.getSchemaUuids(),
        };

        this.clearAllCaches();
    }

    private refreshCacheIncremental(changedNodeTypes: Set<string>, changedRelTypes: Set<string>) {
        if (!this.cachedSchema) {
            this.refreshCache();
            return;
        }

        changedNodeTypes.forEach(name => {
            const json = this.schemaCRDT.getNodeTypeJSONFast(name);
            if (json) {
                this.cachedSchema.nodeTypes[name] = json;
            } else {
                delete this.cachedSchema.nodeTypes[name];
            }
        });

        const allNames = this.schemaCRDT.getNodeTypeNamesFast();
        const allNamesSet = new Set(allNames);
        for (const name of allNames) {
            if (!(name in this.cachedSchema.nodeTypes)) {
                this.cachedSchema.nodeTypes[name] = this.schemaCRDT.getNodeTypeJSONFast(name);
                changedNodeTypes.add(name);
            }
        }

        for (const name of Object.keys(this.cachedSchema.nodeTypes)) {
            if (!allNamesSet.has(name)) {
                delete this.cachedSchema.nodeTypes[name];
                changedNodeTypes.add(name);
            }
        }

        changedRelTypes.forEach(name => {
            const json = this.schemaCRDT.getRelationshipTypeJSONFast(name);
            if (json) {
                this.cachedSchema.relationshipTypes[name] = json;
            } else {
                delete this.cachedSchema.relationshipTypes[name];
            }
        });

        const allRelNames = this.schemaCRDT.getRelationshipTypeNamesFast();
        const allRelNamesSet = new Set(allRelNames);
        for (const name of Object.keys(this.cachedSchema.relationshipTypes)) {
            if (!allRelNamesSet.has(name)) {
                delete this.cachedSchema.relationshipTypes[name];
                changedRelTypes.add(name);
            }
        }

        this.cachedSchema.schema_mappings = this.schemaCRDT.getSchemaMappings();
        this.cachedSchema.schema_uuid = this.schemaCRDT.getSchemaUuids();

        // If most types changed, bulk-clear is faster than per-type invalidation
        const totalTypes = Object.keys(this.cachedSchema.nodeTypes).length;
        if (changedNodeTypes.size >= totalTypes * 0.5 || changedRelTypes.size > 0) {
            this.clearAllCaches();
        } else {
            changedNodeTypes.forEach(name => {
                this.invalidateCachesForType(name);
            });
        }
    }
    private invalidateCachesForType(typeName: string) {
        this.propertyLensCache.keys().forEach(key => {
            if (key.startsWith(typeName + '#')) this.propertyLensCache.delete(key);
        });
        this.appKeyDbKeyCache.keys().forEach(key => {
            if (key.startsWith(typeName + '#')) this.appKeyDbKeyCache.delete(key);
        });
        this.identityTransformCache.keys().forEach(key => {
            if (key.startsWith(typeName + '#')) this.identityTransformCache.delete(key);
        });
        this.resolveActiveTypeCache.clear();
        this.resolveActiveEdgeTypeCache.clear();
        this.nodeTypeEncodingCache.delete(typeName);
        this.relTypeEncodingCache.delete(typeName);
        this.propEncodingCache.delete(typeName);
        this.relPropEncodingCache.delete(typeName);
    }
    private static readonly TYPE_LATTICE: Record<string, number> = {
        string:  4,
        number:  3,
        date:    2,
        boolean: 1,
    };
    private resolveOrdering(activeValues: any[]): PropertyLensMap {
        let bestLens = activeValues[0];
        let maxPriority = -1;
        for (const val of activeValues) {
            const typeStr = typeof val === 'string' ? val : (val as any).value;
            const priority = SchemaLensEngine.TYPE_LATTICE[typeStr] ?? 0;
            if (priority > maxPriority) {
                maxPriority = priority;
                bestLens = val;
            }
        }
        if (typeof bestLens === 'string') {
            return { value: bestLens as dataTypes, default: bestLens };
        }
        return bestLens as PropertyLensMap;
    }
    public getPropertyLens(identifyingType: string, propertyKey: string, changeType: whatType): PropertyLensMap | undefined {
        const cacheKey = `${identifyingType}#${propertyKey}#${changeType}`;
        const cached = this.propertyLensCache.get(cacheKey);
        if (cached !== undefined) {
            return cached === null ? undefined : cached;
        }
        const resolve = (): PropertyLensMap | undefined => {
            if (!this.cachedSchema) this.refreshCache();

            const targetTypes = changeType === "NodeType" ? this.cachedSchema.nodeTypes : this.cachedSchema.relationshipTypes;

            if (!targetTypes) return undefined;

            if (targetTypes[identifyingType]) {
                const lens = this.extractPropertyLens(targetTypes[identifyingType].properties, propertyKey);
                if (lens) return lens;
            }

            if (changeType === "NodeType") {
                const mappings = this.cachedSchema.schema_mappings || {};
                for (const [legacyTypeName, splitRule] of Object.entries(mappings)) {
                    const rule = splitRule as any;
                    if (rule.kind === 'split' && Object.values(rule.mapping).includes(identifyingType)) {
                        if (targetTypes[legacyTypeName]) {
                            const lens = this.extractPropertyLens(targetTypes[legacyTypeName].properties, propertyKey);
                            if (lens) return lens;
                        }
                    }
                }
                const unionRule = mappings[identifyingType];
                if (unionRule && unionRule.kind === 'union') {
                    for (const legacyTypeName of unionRule.legacyTypes) {
                        if (targetTypes[legacyTypeName]) {
                            const lens = this.extractPropertyLens(targetTypes[legacyTypeName].properties, propertyKey);
                            if (lens) return lens;
                        }
                    }
                }
            }
            if (changeType === "RelationshipType") {
                const mappings = this.cachedSchema.schema_mappings || {};
                for (const [legacyEdgeName, splitRule] of Object.entries(mappings)) {
                    const rule = splitRule as any;
                    if (rule.kind === 'splitRT' && (rule.newEdge1 === identifyingType || rule.newEdge2 === identifyingType)) {
                        if (targetTypes[legacyEdgeName]) {
                            const lens = this.extractPropertyLens(targetTypes[legacyEdgeName].properties, propertyKey);
                            if (lens) return lens;
                        }
                    }
                }
                const unionRule = mappings[identifyingType];
                if (unionRule && unionRule.kind === 'unionRT') {
                    for (const legacyEdgeName of unionRule.legacyEdges) {
                        if (targetTypes[legacyEdgeName]) {
                            const lens = this.extractPropertyLens(targetTypes[legacyEdgeName].properties, propertyKey);
                            if (lens) return lens;
                        }
                    }
                }
            }

            return undefined;
        };

        const result = resolve();
        this.propertyLensCache.set(cacheKey, result === undefined ? null : result);
        return result;
    }

    private extractPropertyLens(propertyMap: any, propertyKey: string): PropertyLensMap | undefined {
        if (!propertyMap) return undefined;
        let propVal = propertyMap[propertyKey];
        if (!propVal) {
            for (const value of Object.values(propertyMap)) {
                if ((value as any).name === propertyKey) {
                    propVal = value;
                    break;
                }
            }
        }
        if (propVal) {
            const activeTypes = propVal.activeTypes;
            if (activeTypes) {
                const activeValues = Object.values(activeTypes);
                if (activeValues.length > 0) {
                    return this.resolveOrdering(activeValues);
                }
            }
        }
        return undefined;
    }
    public resolveActiveType(rawType: string, rawProps: Record<string, any>): string {
        if (!this.cachedSchema) this.refreshCache();
        const mappings = this.cachedSchema.schema_mappings || {};

        if (!mappings || Object.keys(mappings).length === 0) return rawType;

        const maxIterations = 100;
        let cacheKey = rawType;
        let temp = rawType;
        for (let i = 0; i < maxIterations; i++) {
            const rule = mappings[temp];
            if (!rule || rule.kind !== 'split') break;
            const decide = unpack(rawProps[rule.splitProperty]);
            cacheKey += '#' + decide;
            const next = rule.mapping[decide] || rule.defaultType;
            if (next === temp) break;
            temp = next;
        }

        const cached = this.resolveActiveTypeCache.get(cacheKey);
        if (cached !== undefined) return cached;

        let currentType = rawType;
        let stabilized = false;
        let iterations = 0;

        while (!stabilized && iterations < maxIterations) {
            iterations++;
            let nextType = currentType;
            const splitRule = mappings[currentType];
            if (splitRule && splitRule.kind === 'split') {
                const decide = unpack(rawProps[splitRule.splitProperty]);
                const targetType = splitRule.mapping[decide];
                nextType = targetType || splitRule.defaultType;
            }
            if (nextType === currentType) {
                const sortedRules = Object.entries(mappings).sort((a, b) => a[0].localeCompare(b[0]));
                for (const [, rule] of sortedRules) {
                    const ru = rule as any;
                    if (ru.kind === 'union' && ru.legacyTypes.includes(currentType)) {
                        nextType = ru.newType;
                        break;
                    }
                }
            }

            if (nextType === currentType) stabilized = true;
            else currentType = nextType;
        }

        this.resolveActiveTypeCache.set(cacheKey, currentType);
        return currentType;
    }

    public resolveActiveEdgeType(rawType: string, rawProps: Record<string, any>): string {
        if (!this.cachedSchema) this.refreshCache();
        const mappings = this.cachedSchema.schema_mappings || {};

        if (!mappings || Object.keys(mappings).length === 0) return rawType;

        const maxIterations = 100;
        let cacheKey = rawType;
        const cached = this.resolveActiveEdgeTypeCache.get(cacheKey);
        if (cached !== undefined) return cached;

        let currentType = rawType;
        let stabilized = false;
        let iterations = 0;

        while (!stabilized && iterations < maxIterations) {
            iterations++;
            let nextType = currentType;
            const splitRule = mappings[currentType];
            if (splitRule && splitRule.kind === 'splitRT') {
                const splitProp = splitRule.splitProperty;
                if (splitProp && rawProps[splitProp] !== undefined) {
                    const decide = unpack(rawProps[splitProp]);
                    nextType = (splitRule.mapping && splitRule.mapping[decide]) || splitRule.newEdge1;
                } else {
                    nextType = splitRule.newEdge1;
                }
            }
            if (nextType === currentType) {
                const sortedRules = Object.entries(mappings).sort((a, b) => a[0].localeCompare(b[0]));
                for (const [, rule] of sortedRules) {
                    const rul = rule as any;
                    if (rul.kind === 'unionRT' && rul.legacyEdges.includes(currentType)) {
                        nextType = rul.newEdge;
                        break;
                    }
                }
            }

            if (nextType === currentType) stabilized = true;
            else currentType = nextType;
        }

        this.resolveActiveEdgeTypeCache.set(cacheKey, currentType);
        return currentType;
    }
    
    private getTypeEncodingPath(appType: string): { dbType: string, staticProps: Record<string, any> } {
        let cached = this.nodeTypeEncodingCache.get(appType);
        if (cached) return cached;

        if (!this.cachedSchema) this.refreshCache();

        let currentType = appType;
        const staticProps: Record<string, any> = {};
        const mappings = this.cachedSchema.schema_mappings || {};

        let stabilized = false;
        const maxIterations = 100;
        let iterations = 0;

        while (!stabilized && iterations < maxIterations) {
            iterations++;
            let nextType = currentType;
            let splitRuleFound: any = null;
            for (const [legacyTypeName, rule] of Object.entries(mappings)) {
                const ru = rule as any;
                if (ru.kind === 'split' && (Object.values(ru.mapping).includes(currentType) || ru.defaultType === currentType)) {
                    splitRuleFound = ru;
                    nextType = legacyTypeName;
                    break;
                }
            }
            if (splitRuleFound) {
                const splitProp = splitRuleFound.splitProperty;
                const mapEntry = Object.entries(splitRuleFound.mapping).find(([k, v]) => v === currentType);
                if (mapEntry) {
                    staticProps[splitProp] = mapEntry[0];
                } else if (splitRuleFound.defaultType === currentType) {
                    staticProps[splitProp] = splitRuleFound.defaultType;
                }
                currentType = nextType;
                continue;
            }
            let unionRuleFound = false;
            for (const [newTypeName, rule] of Object.entries(mappings)) {
                const r = rule as any;
                if (r.kind === 'union' && r.newType === currentType) {
                    nextType = r.writeDefault;
                    unionRuleFound = true;
                    break;
                }
            }

            if (unionRuleFound) {
                currentType = nextType;
            } else {
                stabilized = true;
            }
        }

        const result = { dbType: currentType, staticProps };
        this.nodeTypeEncodingCache.set(appType, result);
        return result;
    }

    private getPropEncodingInfo(appType: string, propKey: string): { dbKey: string, lens: PropertyLensMap | null } {
        let typeCache = this.propEncodingCache.get(appType);
        if (!typeCache) {
            typeCache = new Map();
            this.propEncodingCache.set(appType, typeCache);
        }
        let info = typeCache.get(propKey);
        if (info === undefined) {
            const { dbKey } = this.getAppKeyAndDbKey(appType, propKey, 'NodeType');
            const lens = this.getPropertyLens(appType, propKey, 'NodeType') || null;
            info = { dbKey, lens };
            typeCache.set(propKey, info);
        }
        return info;
    }

    private encodeValueWithLens(lens: PropertyLensMap | null, rawAppValue: any): any {
        let stringifiedValue = String(rawAppValue);

        if (!lens) {
            if (rawAppValue instanceof Date) return { value: rawAppValue.toISOString(), writeType: 'date' as dataTypes };
            if (typeof rawAppValue === 'number') return { value: stringifiedValue, writeType: 'number' as dataTypes };
            if (typeof rawAppValue === 'boolean') return { value: stringifiedValue, writeType: 'boolean' as dataTypes };
            return { value: stringifiedValue, writeType: 'string' as dataTypes }; 
        }

        if (lens.value === 'date' && rawAppValue instanceof Date) {
            stringifiedValue = rawAppValue.toISOString();
        } else if (lens.value === 'boolean') {
            stringifiedValue = rawAppValue === true ? "true" : "false";
        } else {
            stringifiedValue = String(rawAppValue); 
        }

        if (lens.transformerMap) {
            for (const [dbKey, appMappedValue] of Object.entries(lens.transformerMap)) {
                if (dbKey !== 'default' && String(appMappedValue) === stringifiedValue) {
                    return { value: dbKey, writeType: lens.value }; 
                }
            }
        }

        return { value: stringifiedValue, writeType: lens.value };
    }

    public encodeNodeForGraph(appType: string, appProps: Record<string, any>): { dbType: string, dbProps: Record<string, any> } {
        const { dbType, staticProps } = this.getTypeEncodingPath(appType);
        
        const finalEncodedProps: Record<string, any> = {};
        for (const [key, val] of Object.entries(staticProps)) {
            finalEncodedProps[key] = { value: val, writeType: 'string' as dataTypes };
        }
        appProps = appProps || {};
        for (const [key, rawVal] of Object.entries(appProps)) {
            if (key.startsWith('__')) continue;
            const { dbKey, lens } = this.getPropEncodingInfo(appType, key);
            finalEncodedProps[dbKey] = this.encodeValueWithLens(lens, rawVal);
        }

        return { dbType, dbProps: finalEncodedProps };
    }

    private getRelPropEncodingInfo(appType: string, propKey: string): { dbKey: string, lens: PropertyLensMap | null } {
        let typeCache = this.relPropEncodingCache.get(appType);
        if (!typeCache) {
            typeCache = new Map();
            this.relPropEncodingCache.set(appType, typeCache);
        }
        let info = typeCache.get(propKey);
        if (info === undefined) {
            const { dbKey } = this.getAppKeyAndDbKey(appType, propKey, 'RelationshipType');
            const lens = this.getPropertyLens(appType, propKey, 'RelationshipType') || null;
            info = { dbKey, lens };
            typeCache.set(propKey, info);
        }
        return info;
    }

    private getEdgeTypeEncodingPath(appType: string): { dbType: string, staticProps: Record<string, any> } {
        let cached = this.relTypeEncodingCache.get(appType);
        if (cached) return cached;

        if (!this.cachedSchema) this.refreshCache();

        let currentType = appType;
        const staticProps: Record<string, any> = {};
        const mappings = this.cachedSchema.schema_mappings || {};

        let stabilized = false;
        const maxIterations = 100;
        let iterations = 0;

        while (!stabilized && iterations < maxIterations) {
            iterations++;
            let nextType = currentType;
            let splitRuleFound: any = null;
            for (const [legacyEdgeName, rule] of Object.entries(mappings)) {
                const ru = rule as any;
                if (ru.kind === 'splitRT' && (ru.newEdge1 === currentType || ru.newEdge2 === currentType)) {
                    splitRuleFound = ru;
                    nextType = legacyEdgeName;
                    break;
                }
            }
            if (splitRuleFound) {
                const splitProp = splitRuleFound.splitProperty;
                if (splitProp) {
                    if (splitRuleFound.newEdge1 === currentType) {
                        staticProps[splitProp] = '1';
                    } else if (splitRuleFound.newEdge2 === currentType) {
                        staticProps[splitProp] = '2';
                    }
                }
                currentType = nextType;
                continue;
            }
            let unionRuleFound = false;
            for (const [newEdgeName, rule] of Object.entries(mappings)) {
                const r = rule as any;
                if (r.kind === 'unionRT' && r.newEdge === currentType) {
                    nextType = r.legacyEdges[0] || currentType;
                    unionRuleFound = true;
                    break;
                }
            }

            if (unionRuleFound) {
                currentType = nextType;
            } else {
                stabilized = true;
            }
        }

        const result = { dbType: currentType, staticProps };
        this.relTypeEncodingCache.set(appType, result);
        return result;
    }

    public encodeRelationshipForGraph( appType: string, appProps: Record<string, any> ): { dbType: string, dbProps: Record<string, any> } {
        const { dbType, staticProps } = this.getEdgeTypeEncodingPath(appType);
        
        const finalEncodedProps: Record<string, any> = { ...staticProps };
        appProps = appProps || {};
        for (const [key, rawVal] of Object.entries(appProps)) {
            if (key.startsWith('__')) continue;
            const { dbKey, lens } = this.getRelPropEncodingInfo(appType, key);
            finalEncodedProps[dbKey] = this.encodeValueWithLens(lens, rawVal);
        }
        return { dbType, dbProps: finalEncodedProps };
    }

    public decodeStringFromGraph(identifyingType: string, propertyKey: string, rawValue: any, changeType: whatType): any {
        const lens = this.getPropertyLens(identifyingType, propertyKey, changeType);

        const decodeSingle = (valStr: string, writeType?: dataTypes): any => {
            let toBeTranslatedString = valStr;

            if (lens && lens.transformerMap) {
                if (lens.transformerMap[valStr] !== undefined) {
                    toBeTranslatedString = lens.transformerMap[valStr];
                } else if (lens.transformerMap['default'] !== undefined) {
                    toBeTranslatedString = lens.transformerMap['default'];
                }
            }

            const targetType = lens ? lens.value : writeType;
            if (!targetType) return toBeTranslatedString;


            // idea for type interpretation conflict "24" and "false"
            // if (writeType && targetType && writeType !== targetType) {
            //     if (writeType === 'boolean' && targetType === 'string') {
            //         if (toBeTranslatedString === 'false') {
            //             toBeTranslatedString = '0';
            //         } else if (toBeTranslatedString === 'true') {
            //             toBeTranslatedString = '1';
            //         }
            //     }
            // }

            switch (targetType) {
                case 'number': {
                    const parsedNum = Number(toBeTranslatedString);
                    return isNaN(parsedNum) ? (lens ? lens.default : 0) : parsedNum;
                }
                case 'boolean': {
                    if (toBeTranslatedString.toLowerCase() === 'true' || toBeTranslatedString === '1') return true;
                    if (toBeTranslatedString.toLowerCase() === 'false' || toBeTranslatedString === '0') return false;
                    return Boolean(toBeTranslatedString);
                }
                case 'date': {
                    const parsedDate = new Date(toBeTranslatedString);
                    return isNaN(parsedDate.getTime()) ? (lens ? lens.default : null) : parsedDate;
                }
                case 'string':
                default:
                    return toBeTranslatedString;
            }
        };

        const decodeItem = (item: any): any => {
            if (item && typeof item === 'object' && 'value' in item && 'writeType' in item) {
                return decodeSingle(String(item.value ?? ''), item.writeType);
            }
            return decodeSingle(String(item ?? ''));
        };

        if (rawValue && typeof rawValue === 'object' && !Array.isArray(rawValue)) {
            if ('value' in rawValue && 'writeType' in rawValue) {
                return decodeItem(rawValue);
            }
            let bestClientId: string | null = null;
            let bestValue: any = null;
            let maxPriority = -1;
            for (const [clientId, val] of Object.entries(rawValue)) {
                const writeType = (val && typeof val === 'object' && 'writeType' in val) ? (val as any).writeType : 'string';
                const priority = SchemaLensEngine.TYPE_LATTICE[writeType] ?? 0;
                if (priority > maxPriority) {
                    maxPriority = priority;
                    bestClientId = clientId;
                    bestValue = val;
                } else if (priority === maxPriority) {
                    if (bestClientId === null || clientId > bestClientId) {
                        bestClientId = clientId;
                        bestValue = val;
                    }
                }
            }
            if (bestValue !== null) {
                return decodeItem(bestValue);
            }
        }
        return decodeItem(rawValue);
    }

    public encodeValueForGraph(identifyingType: string, propertyKey: string, rawAppValue: any, changeType: whatType): any {
        const lens = this.getPropertyLens(identifyingType, propertyKey, changeType);
        
        let stringifiedValue = String(rawAppValue);

        if (!lens) {
            if (rawAppValue instanceof Date) return { value: rawAppValue.toISOString(), writeType: 'date' as dataTypes };
            if (typeof rawAppValue === 'number') return { value: stringifiedValue, writeType: 'number' as dataTypes };
            if (typeof rawAppValue === 'boolean') return { value: stringifiedValue, writeType: 'boolean' as dataTypes };
            return { value: stringifiedValue, writeType: 'string' as dataTypes }; 
        }

        if (lens.value === 'date' && rawAppValue instanceof Date) {
            stringifiedValue = rawAppValue.toISOString();
        } else if (lens.value === 'boolean') {
            stringifiedValue = rawAppValue === true ? "true" : "false";
        } else {
            stringifiedValue = String(rawAppValue); 
        }

        if (lens.transformerMap) {
            for (const [dbKey, appMappedValue] of Object.entries(lens.transformerMap)) {
                if (dbKey !== 'default' && String(appMappedValue) === stringifiedValue) {
                    return { value: dbKey, writeType: lens.value }; 
                }
            }
        }

        return { value: stringifiedValue, writeType: lens.value };
    }

    public isNodeAllowed(identifyingType: string): boolean {
        if (!this.cachedSchema) this.refreshCache();
        const mappings = this.cachedSchema.schema_mappings || {};
        if (mappings[identifyingType] && mappings[identifyingType].kind === 'split') {
            return false;
        }
        return this.cachedSchema.nodeTypes?.[identifyingType] !== undefined;
    }

    public isRelationshipAllowed(identifyingEdge: string): boolean {
        if (!this.cachedSchema) this.refreshCache();
        const mappings = this.cachedSchema.schema_mappings || {};
        if (mappings[identifyingEdge] && mappings[identifyingEdge].kind === 'splitRT') {
            return false;
        }
        return this.cachedSchema.relationshipTypes?.[identifyingEdge] !== undefined;
    }

    public filterAllowedNodes<T>(nodes: T[], getType: (node: T) => string): T[] {
        if (!this.cachedSchema) this.refreshCache();
        const allowedNodes = this.cachedSchema.nodeTypes || {};
        return nodes.filter(node => allowedNodes[getType(node)] !== undefined);
    }

    public filterAllowedRelationships<T>(relationships: T[], getType: (rel: T) => string): T[] {
        if (!this.cachedSchema) this.refreshCache();
        const allowedEdges = this.cachedSchema.relationshipTypes || {};
        return relationships.filter(rel => allowedEdges[getType(rel)] !== undefined);
    }

    public getAppKeyAndDbKey(identifyingType: string, propKey: string, changeType: whatType): { appKey: string, dbKey: string } {
        const cacheKey = `${identifyingType}#${propKey}#${changeType}`;
        const cached = this.appKeyDbKeyCache.get(cacheKey);
        if (cached !== undefined) return cached;

        if (!this.cachedSchema) this.refreshCache();
        const targetTypes = changeType === "NodeType" ? this.cachedSchema.nodeTypes : this.cachedSchema.relationshipTypes;
        
        if (!targetTypes) {
            const fallback = { appKey: propKey, dbKey: propKey };
            this.appKeyDbKeyCache.set(cacheKey, fallback);
            return fallback;
        }

        const scanMap = (propertyMap: any): { appKey: string, dbKey: string } | null => {
            if (!propertyMap) return null;
            if (propertyMap[propKey]) {
                return { appKey: propertyMap[propKey].name || propKey, dbKey: propKey };
            }
            for (const [k, v] of Object.entries(propertyMap)) {
                if ((v as any).name === propKey) {
                    return { appKey: propKey, dbKey: k };
                }
            }
            return null;
        };

        let result: { appKey: string, dbKey: string } | null = null;

        if (targetTypes[identifyingType]) {
            result = scanMap(targetTypes[identifyingType].properties);
        }

        if (!result && changeType === "NodeType") {
            const mappings = this.cachedSchema.schema_mappings || {};
            for (const [legacyTypeName, splitRule] of Object.entries(mappings)) {
                const rule = splitRule as any;
                if (rule.kind === 'split' && Object.values(rule.mapping).includes(identifyingType)) {
                    if (targetTypes[legacyTypeName]) {
                        result = scanMap(targetTypes[legacyTypeName].properties);
                        if (result) break;
                    }
                }
            }
            if (!result) {
                const unionRule = mappings[identifyingType];
                if (unionRule && unionRule.kind === 'union') {
                    for (const legacyTypeName of unionRule.legacyTypes) {
                        if (targetTypes[legacyTypeName]) {
                            result = scanMap(targetTypes[legacyTypeName].properties);
                            if (result) break;
                        }
                    }
                }
            }
        }
        if (!result && changeType === "RelationshipType") {
            const mappings = this.cachedSchema.schema_mappings || {};
            for (const [legacyEdgeName, splitRule] of Object.entries(mappings)) {
                const rule = splitRule as any;
                if (rule.kind === 'splitRT' && (rule.newEdge1 === identifyingType || rule.newEdge2 === identifyingType)) {
                    if (targetTypes[legacyEdgeName]) {
                        result = scanMap(targetTypes[legacyEdgeName].properties);
                        if (result) break;
                    }
                }
            }
            if (!result) {
                const unionRule = mappings[identifyingType];
                if (unionRule && unionRule.kind === 'unionRT') {
                    for (const legacyEdgeName of unionRule.legacyEdges) {
                        if (targetTypes[legacyEdgeName]) {
                            result = scanMap(targetTypes[legacyEdgeName].properties);
                            if (result) break;
                        }
                    }
                }
            }
        }

        const finalResult = result ?? { appKey: propKey, dbKey: propKey };
        this.appKeyDbKeyCache.set(cacheKey, finalResult);
        return finalResult;
    }

    public decodeAndFilterProperties(identifyingType: string, rawProps: Record<string, any>, changeType: whatType): Record<string, any> {
        if (!this.cachedSchema) this.refreshCache();
        const targetTypes = changeType === "NodeType" ? this.cachedSchema.nodeTypes : this.cachedSchema.relationshipTypes;
        // if (!targetTypes || !targetTypes[identifyingType]) throw new SchemaError(`Type ${identifyingType} not found`);
        const decodedProps: Record<string, any> = {};

        for (const [key, rawValue] of Object.entries(rawProps)) {
            if (key.startsWith('__')) continue;
            const { appKey } = this.getAppKeyAndDbKey(identifyingType, key, changeType);
            const lens = this.getPropertyLens(identifyingType, appKey, changeType);
            if (!lens) continue;
            decodedProps[appKey] = this.decodeStringFromGraph(identifyingType, key, rawValue, changeType);
        }
        return decodedProps;
    }

    private isIdentityTransform(identifyingType: string, changeType: whatType): boolean {
        const cacheKey = `${identifyingType}#${changeType}`;
        const cached = this.identityTransformCache.get(cacheKey);
        if (cached !== undefined) return cached;

        if (!this.cachedSchema) this.refreshCache();

        const mappings = this.cachedSchema.schema_mappings || {};
        for (const [, rule] of Object.entries(mappings)) {
            const r = rule as any;
            if (
                (r.kind === 'split' && (r.legacyType === identifyingType || Object.values(r.mapping).includes(identifyingType))) ||
                (r.kind === 'union' && (r.legacyTypes?.includes(identifyingType) || r.newType === identifyingType))
            ) {
                this.identityTransformCache.set(cacheKey, false);
                return false;
            }
        }

        const targetTypes = changeType === 'NodeType' ? this.cachedSchema.nodeTypes : this.cachedSchema.relationshipTypes;

        if (!targetTypes?.[identifyingType]) {
            this.identityTransformCache.set(cacheKey, false);
            return false;
        }

        const properties = targetTypes[identifyingType].properties || {};
        for (const [dbKey, propDef] of Object.entries(properties)) {
            const pd = propDef as any;
            const appKey = pd.name || dbKey;
            if (appKey !== dbKey) {
                this.identityTransformCache.set(cacheKey, false);
                return false;
            }
            if (pd.activeTypes) {
                const activeValues = Object.values(pd.activeTypes);
                if (activeValues.length > 0) {
                    const lens = activeValues[0] as any;
                    const typeName = typeof lens === 'string' ? lens : lens.value;
                    if (typeName !== 'string') {
                        this.identityTransformCache.set(cacheKey, false);
                        return false;
                    }
                    if (typeof lens === 'object' && lens.transformerMap && Object.keys(lens.transformerMap).length > 0) {
                        this.identityTransformCache.set(cacheKey, false);
                        return false;
                    }
                }
            }
        }

        this.identityTransformCache.set(cacheKey, true);
        return true;
    }

    public decodeAndFilterPropertiesLazy(identifyingType: string, rawProps: Record<string, any>, changeType: whatType): Record<string, any> {
        if (this.isIdentityTransform(identifyingType, changeType)) {
            let hasMVRConflict = false;
            for (const key in rawProps) {
                const va = rawProps[key];
                if (!va || typeof va !== 'object') continue;
                const keys = Object.keys(va);
                if (keys.length !== 1) { hasMVRConflict = true; break; }
                const pso = va[keys[0]];
                if (!(pso && typeof pso === 'object' && pso.writeType === 'string')) {
                    hasMVRConflict = true;
                    break;
                }
            }
            if (!hasMVRConflict) {
                const targetTypes = changeType === 'NodeType' ? this.cachedSchema!.nodeTypes : this.cachedSchema!.relationshipTypes;
                const schemaProperties = targetTypes?.[identifyingType]?.properties ?? {};
                const unwrapped: Record<string, any> = {};
                for (const dbKey in schemaProperties) {
                    if (!(dbKey in rawProps)) continue;
                    const va = rawProps[dbKey];
                    if (va && typeof va === 'object') {
                        let firstPSO: any;
                        for (const ck in va) { firstPSO = va[ck]; break; }
                        unwrapped[dbKey] = (firstPSO && typeof firstPSO === 'object') ? firstPSO.value : firstPSO;
                    } else {
                        unwrapped[dbKey] = va;
                    }
                }
                return unwrapped;
            }
        }

        const engine = this; // not acessible in the proxy otherwise
        const localCache: Record<string, any> = {};

        return new Proxy(rawProps, {
            get(target, prop) {
                if (typeof prop !== 'string') return Reflect.get(target, prop);
                if (prop.startsWith('__')) return undefined;

                if (prop in localCache) {
                    return localCache[prop];
                }

                const { appKey, dbKey } = engine.getAppKeyAndDbKey(identifyingType, prop, changeType);
                if (appKey !== prop) return undefined;
                const hasRawProp = dbKey in target;
                const lens = engine.getPropertyLens(identifyingType, appKey, changeType);
                if (!lens) return undefined;

                if (!hasRawProp) {
                    localCache[appKey] = lens.default;
                    return lens.default;
                }

                const rawValue = target[dbKey];
                const decoded = engine.decodeStringFromGraph(identifyingType, prop, rawValue, changeType);
                localCache[prop] = decoded;
                return decoded;
            },
            ownKeys(target) {
                if (!engine.cachedSchema) engine.refreshCache();
                const targetTypes = changeType === "NodeType" ? engine.cachedSchema.nodeTypes : engine.cachedSchema.relationshipTypes;
                if (!targetTypes || !targetTypes[identifyingType]) {
                    return [];
                }
                
                const appKeys = new Set<string>();
                const propertyMap = targetTypes[identifyingType].properties || {};
                
                for (const [k, v] of Object.entries(propertyMap)) {
                    if ((v as any).name) appKeys.add((v as any).name);
                }

                if (changeType === "NodeType") {
                    const mappings = engine.cachedSchema.schema_mappings || {};
                    for (const [legacyTypeName, splitRule] of Object.entries(mappings)) {
                        const rule = splitRule as any;
                        if (rule.kind === 'split' && Object.values(rule.mapping).includes(identifyingType)) {
                            if (targetTypes[legacyTypeName]) {
                                const legacyPropertyMap = targetTypes[legacyTypeName].properties || {};
                                for (const [k, v] of Object.entries(legacyPropertyMap)) {
                                    if ((v as any).name) appKeys.add((v as any).name);
                                }
                            }
                        }
                    }
                    const unionRule = mappings[identifyingType];
                    if (unionRule && unionRule.kind === 'union') {
                        for (const legacyTypeName of unionRule.legacyTypes) {
                            if (targetTypes[legacyTypeName]) {
                                const legacyPropertyMap = targetTypes[legacyTypeName].properties || {};
                                for (const [k, v] of Object.entries(legacyPropertyMap)) {
                                    if ((v as any).name) appKeys.add((v as any).name);
                                }
                            }
                        }
                    }
                }
                if (changeType === "RelationshipType") {
                    const mappings = engine.cachedSchema.schema_mappings || {};
                    for (const [legacyEdgeName, splitRule] of Object.entries(mappings)) {
                        const rule = splitRule as any;
                        if (rule.kind === 'splitRT' && (rule.newEdge1 === identifyingType || rule.newEdge2 === identifyingType)) {
                            if (targetTypes[legacyEdgeName]) {
                                const legacyPropertyMap = targetTypes[legacyEdgeName].properties || {};
                                for (const [k, v] of Object.entries(legacyPropertyMap)) {
                                    if ((v as any).name) appKeys.add((v as any).name);
                                }
                            }
                        }
                    }
                    const unionRule = mappings[identifyingType];
                    if (unionRule && unionRule.kind === 'unionRT') {
                        for (const legacyEdgeName of unionRule.legacyEdges) {
                            if (targetTypes[legacyEdgeName]) {
                                const legacyPropertyMap = targetTypes[legacyEdgeName].properties || {};
                                for (const [k, v] of Object.entries(legacyPropertyMap)) {
                                    if ((v as any).name) appKeys.add((v as any).name);
                                }
                            }
                        }
                    }
                }
                const result = Array.from(appKeys);
                return result;
            },
            getOwnPropertyDescriptor(target, prop) {
                if (typeof prop !== 'string' || prop.startsWith('__')) return undefined;
                const { appKey } = engine.getAppKeyAndDbKey(identifyingType, prop, changeType);
                if (appKey !== prop) return undefined;
                const lens = engine.getPropertyLens(identifyingType, appKey, changeType);
                if (!lens) return undefined;
                return {
                    enumerable: true,
                    configurable: true,
                    writable: true
                };
            },
            has(target, prop) {
                if (typeof prop !== 'string' || prop.startsWith('__')) return false;
                const { appKey } = engine.getAppKeyAndDbKey(identifyingType, prop, changeType);
                if (appKey !== prop) return false;
                return engine.getPropertyLens(identifyingType, appKey, changeType) !== undefined;
            }
        });
    }

    // Utility Functions for Lens Application
    public getNLabels(identifyingType: string, what: whatType): string[] {
        if (!this.cachedSchema) this.refreshCache();
        const targetTypes = what === "NodeType" ? this.cachedSchema.nodeTypes : this.cachedSchema.relationshipTypes;
        if (!targetTypes || !targetTypes[identifyingType]) return [];
        return targetTypes[identifyingType].labels;
    }

    private getEndpointLabels(labelField: any): string[] {
        if (typeof labelField === 'string') return [labelField];
        if (labelField && typeof labelField === 'object') {
            const uuid = Object.keys(labelField)[0];
            if (!uuid) return [];
            return this.schemaCRDT.resolveLabelNames(uuid);
        }
        return [];
    }

    public isConnectionAllowed(edgeType: string, sType: string, tType: string): boolean {
        if (!this.cachedSchema) this.refreshCache();
        const relDef = this.cachedSchema.relationshipTypes?.[edgeType];
        if (!relDef) return false;

        const exsLabels = this.getEndpointLabels(relDef.sourceNodeLabel);
        const extLabels = this.getEndpointLabels(relDef.targetNodeLabel);

        if (exsLabels.length === 0 || extLabels.length === 0) return false;

        const sLabels = toArray(this.getNLabels(sType, 'NodeType'));
        const tLabels = toArray(this.getNLabels(tType, 'NodeType'));

        return exsLabels.some(l => sLabels.includes(l)) && extLabels.some(l => tLabels.includes(l));
    }

    // full graph lensing with optional lazy property decoding
    public applyLensToGraph( rawNodes: VisibleNode[], rawEdges: VisibleEdge[], options: { lazy?: boolean } = { lazy: true }): { lensedNodes: (GraphedVisibleNode)[], lensedEdges: (GraphedVisibleEdge)[] } {
        const resolvedNodes = rawNodes.map(node => {
            const activeType = this.resolveActiveType(node.type, node.props);
            return {
                ...node,
                type: activeType
            };
        });

        const validNodes = this.filterAllowedNodes(resolvedNodes, node => node.type);
        const validNodeIds = new Set(validNodes.map(node => node.id));

        const lensedNodes = validNodes.map(node => ({
            ...node,
            label: this.getNLabels(node.type, 'NodeType'),
            appProps: options.lazy ? this.decodeAndFilterPropertiesLazy(node.type, node.props, 'NodeType') : this.decodeAndFilterProperties(node.type, node.props, 'NodeType')
        }));

        const resolvedEdges = rawEdges.map(edge => {
            const activeType = this.resolveActiveEdgeType(edge.type, edge.props);
            return {
                ...edge,
                type: activeType
            };
        });

        const nodeTypeMap = new Map(validNodes.map(n => [n.id, n.type]));
        const validEdges = this.filterAllowedRelationships(resolvedEdges, edge => edge.type).filter(edge => {
            if (!validNodeIds.has(edge.sourceId) || !validNodeIds.has(edge.targetId)) return false;
            const sType = nodeTypeMap.get(edge.sourceId);
            const tType = nodeTypeMap.get(edge.targetId);
            if (!sType || !tType) return false;
            return this.isConnectionAllowed(edge.type, sType, tType);
        });

        const lensedEdges = validEdges.map(edge => ({
            ...edge,
            appProps: options.lazy ? this.decodeAndFilterPropertiesLazy(edge.type, edge.props, 'RelationshipType') : this.decodeAndFilterProperties(edge.type, edge.props, 'RelationshipType')
        }));

        return { lensedNodes, lensedEdges };
    }


    /* istanbul ignore next */
    public lensNode(rawNode: { id: string; type: string; props: Record<string, any> } ): { id: string; rawType: string; type: string; appProps: Record<string, any> } | null {
        if (!this.cachedSchema) this.refreshCache();
        const resolved = this.resolveActiveType(rawNode.type, rawNode.props);
        if (!this.isNodeAllowed(resolved)) return null;
        const appProps = this.decodeAndFilterPropertiesLazy(resolved, rawNode.props, 'NodeType');
        return { id: rawNode.id, rawType: rawNode.type, type: resolved, appProps };
    }

}