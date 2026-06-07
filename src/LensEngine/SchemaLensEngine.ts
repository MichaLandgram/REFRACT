import * as Y from 'yjs';
import { Schema_v1 } from '../Schema_CRDT/SchemaCRDT';
import { whatType, PropertyLensMap, dataTypes, GraphedVisibleEdge, GraphedVisibleNode, EdgeId, NodeId } from '../Helper/types';
import { SchemaError } from '../Helper/ErrorDefinition';
import { PropertyGraph } from '../GraphDB_CRDT/PropertyGraph';
import { VisibleNode, VisibleEdge } from '../Helper/types';
import { unpack, toArray } from '../Helper/helper';

export class SchemaLensEngine {
    private schemaCRDT: Schema_v1;
    private cachedSchema: any | null = null;
    private propertyLensCache = new Map<string, PropertyLensMap | null>();
    private appKeyDbKeyCache = new Map<string, { appKey: string, dbKey: string }>();
    private identityTransformCache = new Map<string, boolean>();
    private resolveActiveTypeCache = new Map<string, string>();

    constructor(schemaCRDT: Schema_v1) {
        this.schemaCRDT = schemaCRDT;
        this.refreshCache();
        this.schemaCRDT.yjsDoc.on('update', () => {
            this.cachedSchema = null;
            this.propertyLensCache.clear();
            this.appKeyDbKeyCache.clear();
            this.identityTransformCache.clear();
            this.resolveActiveTypeCache.clear();
        });
    }
    public refreshCache() {
        // this is what "lens rebuilding means"
        this.cachedSchema = this.schemaCRDT.transformToJSONCleanSchema();
        this.propertyLensCache.clear();
        this.appKeyDbKeyCache.clear();
        this.identityTransformCache.clear();
        this.resolveActiveTypeCache.clear();
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
                const propertyMap = targetTypes[identifyingType].properties;
                if (propertyMap) {
                    let propVal = propertyMap[propertyKey];
                    if (!propVal) {
                        for (const v of Object.values(propertyMap)) {
                            if ((v as any).name === propertyKey) {
                                propVal = v;
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
                }
            }

            if (changeType === "NodeType") {
                const mappings = this.cachedSchema.schema_mappings || {};
                for (const [legacyTypeName, splitRule] of Object.entries(mappings)) {
                    const rule = splitRule as any;
                    if (rule.kind === 'split' && Object.values(rule.mapping).includes(identifyingType)) {
                        if (targetTypes[legacyTypeName]) {
                            const legacyPropertyMap = targetTypes[legacyTypeName].properties;
                            if (legacyPropertyMap) {
                                let propVal = legacyPropertyMap[propertyKey];
                                if (!propVal) {
                                    for (const v of Object.values(legacyPropertyMap)) {
                                        if ((v as any).name === propertyKey) {
                                            propVal = v;
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
                            }
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
    public resolveActiveType(rawType: string, rawProps: Record<string, any>): string {
        if (!this.cachedSchema) this.refreshCache();
        const mappings = this.cachedSchema.schema_mappings || {};

        if (!mappings || Object.keys(mappings).length === 0) return rawType;

        const maxIterations = 10;
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
                for (const [, rule] of Object.entries(mappings)) {
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
    
    public encodeNodeForGraph( appType: string, appProps: Record<string, any>): { dbType: string, dbProps: Record<string, any> } {
        if (!this.cachedSchema) this.refreshCache();

        let currentType = appType;
        const dbProps: Record<string, any> = { ...appProps };
        const mappings = this.cachedSchema.schema_mappings || {};

        let stabilized = false;
        const maxIterations = 10;
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
                    dbProps[splitProp] = mapEntry[0];
                } else if (splitRuleFound.defaultType === currentType) {
                    if (dbProps[splitProp] === undefined) {
                        dbProps[splitProp] = splitRuleFound.defaultType;
                    }
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
        const finalEncodedProps: Record<string, any> = {};
        for (const [key, rawVal] of Object.entries(dbProps)) {
            if (key.startsWith('__')) continue;
            const { dbKey } = this.getAppKeyAndDbKey(appType, key, 'NodeType');
            finalEncodedProps[dbKey] = this.encodeValueForGraph(appType, key, rawVal, 'NodeType');
        }

        return { dbType: currentType, dbProps: finalEncodedProps };
    }

    public encodeRelationshipForGraph( appType: string, appProps: Record<string, any> ): { dbType: string, dbProps: Record<string, any> } {
        const finalEncodedProps: Record<string, any> = {};
        for (const [key, rawVal] of Object.entries(appProps)) {
            if (key.startsWith('__')) continue;
            const { dbKey } = this.getAppKeyAndDbKey(appType, key, 'RelationshipType');
            finalEncodedProps[dbKey] = this.encodeValueForGraph(appType, key, rawVal, 'RelationshipType');
        }
        return { dbType: appType, dbProps: finalEncodedProps };
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
        }

        const finalResult = result ?? { appKey: propKey, dbKey: propKey };
        this.appKeyDbKeyCache.set(cacheKey, finalResult);
        return finalResult;
    }

    public decodeAndFilterProperties(identifyingType: string, rawProps: Record<string, any>, changeType: whatType): Record<string, any> {
        if (!this.cachedSchema) this.refreshCache();
        const targetTypes = changeType === "NodeType" ? this.cachedSchema.nodeTypes : this.cachedSchema.relationshipTypes;
        if (!targetTypes || !targetTypes[identifyingType]) throw new SchemaError(`Type ${identifyingType} not found`);
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
                }

                const result = Array.from(appKeys);
                return result;
            },
            getOwnPropertyDescriptor(target, prop) {
                if (typeof prop !== 'string' || prop.startsWith('__')) return undefined;
                const lens = engine.getPropertyLens(identifyingType, prop, changeType);
                if (!lens) return undefined;
                return {
                    enumerable: true,
                    configurable: true,
                    writable: true
                };
            },
            has(target, prop) {
                if (typeof prop !== 'string' || prop.startsWith('__')) return false;
                return engine.getPropertyLens(identifyingType, prop, changeType) !== undefined;
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

    private getEndpointLabel(labelField: any): string {
        if (typeof labelField === 'string') return labelField;
        if (labelField && typeof labelField === 'object') {
            const uuid = Object.keys(labelField)[0];
            if (!uuid) return '';
            return (this.cachedSchema?.schema_uuid as Record<string, string>)?.[uuid] ?? uuid;
        }
        return '';
    }

    public isConnectionAllowed(edgeType: string, sType: string, tType: string): boolean {
        if (!this.cachedSchema) this.refreshCache();
        const relDef = this.cachedSchema.relationshipTypes?.[edgeType];
        if (!relDef) return false;

        const exsLabel = this.getEndpointLabel(relDef.sourceNodeLabel);
        const extLabel = this.getEndpointLabel(relDef.targetNodeLabel);

        if (!exsLabel || !extLabel) return false;

        const sLabels = this.getNLabels(sType, 'NodeType');
        const tLabels = this.getNLabels(tType, 'NodeType');

        return toArray(sLabels).includes(exsLabel) && toArray(tLabels).includes(extLabel);
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

        const validEdges = this.filterAllowedRelationships(rawEdges, edge => edge.type).filter(edge => validNodeIds.has(edge.sourceId) && validNodeIds.has(edge.targetId));

        const lensedEdges = validEdges.map(edge => ({
            ...edge,
            appProps: options.lazy ? this.decodeAndFilterPropertiesLazy(edge.type, edge.props, 'RelationshipType') : this.decodeAndFilterProperties(edge.type, edge.props, 'RelationshipType')
        }));

        return { lensedNodes, lensedEdges };
    }

    public lensNode(rawNode: { id: string; type: string; props: Record<string, any> } ): { id: string; rawType: string; type: string; appProps: Record<string, any> } | null {
        if (!this.cachedSchema) this.refreshCache();
        const resolved = this.resolveActiveType(rawNode.type, rawNode.props);
        if (!this.isNodeAllowed(resolved)) return null;
        const appProps = this.decodeAndFilterPropertiesLazy(resolved, rawNode.props, 'NodeType');
        return { id: rawNode.id, rawType: rawNode.type, type: resolved, appProps };
    }

    public lensEdge(rawEdge: { id: string; type: string; sourceId: string; targetId: string; props: Record<string, any> }, sResType: string, tResType: string, ): { id: string; type: string; sourceId: string; targetId: string; appProps: Record<string, any> } | null {
        if (!this.cachedSchema) this.refreshCache();
        if (!this.isConnectionAllowed(rawEdge.type, sResType, tResType)) return null;
        const appProps = this.decodeAndFilterPropertiesLazy(rawEdge.type, rawEdge.props, 'RelationshipType');
        return { id: rawEdge.id, type: rawEdge.type, sourceId: rawEdge.sourceId, targetId: rawEdge.targetId, appProps };
    }

    public *traverse( db: PropertyGraph, doc: Y.Doc, startNodeIds: string[], opts: { edgeTypes?: string[]; targetTypes?: string[]; maxDepth?: number; direction?: 'out' | 'in' | 'both'; predicate?: (node: { id: string; rawType: string; type: string; appProps: Record<string, any> }) => boolean; } = {},
    ): Generator<{
        node:    { id: string; rawType: string; type: string; appProps: Record<string, any> };
        depth:   number;
        viaEdge: { id: string; type: string; sourceId: string; targetId: string; appProps: Record<string, any> } | null;
    }> {
        if (!this.cachedSchema) this.refreshCache();
        const maxDepth  = opts.maxDepth  ?? 1;
        const direction = opts.direction ?? 'out';
        const visited   = new Set<string>();
        const queue: Array<{ id: NodeId; depth: number; viaEdge: { id: EdgeId; type: string; sourceId: NodeId; targetId: NodeId; appProps: Record<string, any> } | null }> = startNodeIds.map(id => ({ id, depth: 0, viaEdge: null }));

        while (queue.length > 0) {
            const item = queue.shift()!;
            if (visited.has(item.id)) continue;
            visited.add(item.id);

            const rawNode = db.getRawNode(doc, item.id);
            if (!rawNode) continue;
            const node = this.lensNode(rawNode);
            if (!node) continue;

            if (!opts.predicate || opts.predicate(node)) {
                yield { node, depth: item.depth, viaEdge: item.viaEdge };
            }

            if (item.depth >= maxDepth) continue;

            const edgeIds: string[] = [];
            if (direction === 'out' || direction === 'both') {
                const out = db.getOutgoingEdgeIds(doc, item.id);
                for (let i = 0; i < out.length; i++) edgeIds.push(out[i]);
            }
            if (direction === 'in' || direction === 'both') {
                const inc = db.getIncomingEdgeIds(doc, item.id);
                for (let i = 0; i < inc.length; i++) edgeIds.push(inc[i]);
            }

            for (let eIDpos = 0; eIDpos < edgeIds.length; eIDpos++) {
                const rawEdge = db.getRawEdgeById(doc, edgeIds[eIDpos]);
                if (!rawEdge) continue;
                const nextId = direction === 'in' ? rawEdge.sourceId : rawEdge.targetId;
                if (visited.has(nextId)) continue;
                const nextRawType = db.getRawNode(doc, nextId)?.type;
                if (!nextRawType) continue;
                const nextResolved = this.resolveActiveType(nextRawType, {});
                const lensedEdge = this.lensEdge(rawEdge, node.type, nextResolved);
                if (!lensedEdge) continue;
                if (opts.edgeTypes && opts.edgeTypes.indexOf(lensedEdge.type) === -1) continue;
                queue.push({ id: nextId, depth: item.depth + 1, viaEdge: lensedEdge });
            }
        }
    }

    // typescript seems to like this more, putting generator results into an array with a simple helper function
    private static collectGen<T>(gen: Generator<T>): T[] {
        const arr: T[] = [];
        for (;;) { const s = gen.next(); if (s.done) return arr; arr.push(s.value); }
    }

    public oneHopRQ4(
        db:          PropertyGraph,
        doc:         Y.Doc,
        startNodeId: string,
        edgeType:    string,
        targetType?: string,
    ): { id: string; rawType: string; type: string; appProps: Record<string, any> }[] {
        return SchemaLensEngine.collectGen(this.traverse(db, doc, [startNodeId], { maxDepth: 1, edgeTypes: [edgeType], targetTypes: targetType ? [targetType] : undefined })).filter(s => s.depth === 1).map(s => s.node);
    }

}