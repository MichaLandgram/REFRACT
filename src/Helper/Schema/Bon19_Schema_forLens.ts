import { Schema_v1 } from "../../Schema_CRDT/SchemaCRDT";
import { SchemaDefinition } from "../types";

export const bon19SchemaDef: SchemaDefinition = {
    nodes: [
        {
            identifyingType: 'Person',
            labels: ['resident', 'citizen', 'person'],
            properties: {
                firstName: 'string',
                lastName: 'string',
                age: 'number',
            }
        },
        {
            identifyingType: 'Message',
            labels: ['note', 'message'],
            properties: {
                mood: 'string',
                imageFile: 'string',
                creationDate: 'string',
                browserUsed: 'string'
            }
        }
    ],
    relationships: [
        {
            identifyingEdge: 'KNOWS',
            sourceNodeLabel: 'person',
            targetNodeLabel: 'person',
            properties: {
                since: 'string'
            }
        },
        {
            identifyingEdge: 'HAS_CREATOR',
            sourceNodeLabel: 'message',
            targetNodeLabel: 'resident',
            properties: {
                username: 'string'
            }
        },
        {
            identifyingEdge: 'LIKES',
            sourceNodeLabel: 'person',
            targetNodeLabel: 'message',
            properties: {
                date: 'string'
            }
        },
        {
            identifyingEdge: 'REPLY_OF',
            sourceNodeLabel: 'message',
            targetNodeLabel: 'message',
            properties: {
                date: 'string'
            }
        }
    ]
};

export const bon19Schema = new Schema_v1(bon19SchemaDef);
