import { SchemaDefinition } from '../../Helper/types';
import { Schema_v1 } from '../../Schema_CRDT/SchemaCRDT';

const PROPERTY_VALUE_TYPES = ['string', 'number', 'string', 'string'];
class SeededRandom {
    private seed: number;
    constructor(seed: number) { this.seed = seed; }
    next(): number {
        this.seed = (this.seed * 16807 + 0) % 2147483647;
        return this.seed / 2147483647;
    }
    int(min: number, max: number): number {
        return Math.floor(this.next() * (max - min + 1)) + min;
    }
    pick<T>(arr: T[]): T {
        return arr[this.int(0, arr.length - 1)];
    }
}

const NODE_PROP_NAMES = [
    'name', 'title', 'description', 'status', 'createdAt', 'updatedAt',
    'email', 'url', 'content', 'language', 'version', 'category',
    'priority', 'rating', 'score', 'label', 'code', 'type',
    'firstName', 'lastName', 'birthday', 'location', 'phone', 'address',
    'country', 'city', 'zipCode', 'department', 'role', 'level',
];

const EDGE_PROP_NAMES = [
    'creationDate', 'weight', 'since', 'strength', 'order', 'note',
];

function generateProperties(
    propNames: string[],
    count: number,
    rng: SeededRandom,
    usedGlobal: Set<string>,
    prefix: string
): Record<string, string> {
    const props: Record<string, string> = {};
    const available = propNames.filter(p => true);
    let added = 0;
    const tried = new Set<string>();

    while (added < count && tried.size < available.length) {
        const propName = rng.pick(available);
        if (tried.has(propName)) continue;
        tried.add(propName);

        const finalName = usedGlobal.has(`${prefix}:${propName}`) ? `${propName}_${prefix}` : propName;
        usedGlobal.add(`${prefix}:${propName}`);
        props[finalName] = rng.pick(PROPERTY_VALUE_TYPES);
        added++;
    }

    while (added < count) {
        const syntheticName = `prop_${prefix}_${added}`;
        props[syntheticName] = rng.pick(PROPERTY_VALUE_TYPES);
        added++;
    }

    return props;
}

export function generateSchema(totalTypes: number, seed: number = 42): SchemaDefinition {
    const rng = new SeededRandom(seed);

    const nodeCount = Math.ceil(totalTypes / 2);
    const edgeCount = Math.floor(totalTypes / 2);

    const usedProps = new Set<string>();

    const nodes: SchemaDefinition['nodes'] = [];
    nodes.push({
            identifyingType: 'Person',
            labels: ['citizen', 'resident', 'person'],
            properties: {
                firstName: 'string',
                lastName: 'string',
                gender: 'string',
                birthday: 'string',
                creationDate: 'string',
                locationIP: 'string',
                browserUsed: 'string',
                email: 'string',
                language: 'string'
            }
        });
    for (let i = 0; i < nodeCount-1; i++) {
        const typeName = `NodeType_${i}`;
        const labelBase = typeName.toLowerCase();
        const propCount = rng.int(3, 6);

        nodes.push({
            identifyingType: typeName,
            labels: [labelBase],
            properties: generateProperties(NODE_PROP_NAMES, propCount, rng, usedProps, `n${i}`),
        });
    }

    const relationships: SchemaDefinition['relationships'] = [];
    relationships.push({
            identifyingEdge: 'KNOWS',
            sourceNodeLabel: 'person',
            targetNodeLabel: 'person',
            properties: {
                creationDate: 'string',
                since: 'number',
            }});
    for (let i = 0; i < edgeCount-1; i++) {
        const edgeName = `EdgeType_${i}`;
        const propCount = rng.int(0, 3);

        const sourceNode = nodes[rng.int(0, nodeCount - 1)];
        const targetNode = nodes[rng.int(0, nodeCount - 1)];

        relationships.push({
            identifyingEdge: edgeName,
            sourceNodeLabel: sourceNode.labels[0],
            targetNodeLabel: targetNode.labels[0],
            properties: generateProperties(EDGE_PROP_NAMES, propCount, rng, usedProps, `e${i}`),
        });
    }

    return { nodes, relationships };
}

export function generateSchemaInstance(totalTypes: number, seed: number = 42): Schema_v1 {
    return new Schema_v1(generateSchema(totalTypes, seed));
}