import { Schema_v1 } from "../../Schema_CRDT/SchemaCRDT";
import { SchemaDefinition } from "../types";

export const snbFullSchemaDef: SchemaDefinition = {
    nodes: [
        {
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
        },
        {
            identifyingType: 'Post',
            labels: ['message', 'post'],
            properties: {
                creationDate: 'string',
                imageFile: 'string',
                locationIP: 'string',
                browserUsed: 'string',
                language: 'string',
                content: 'string',
                length: 'number'
            }
        },
        {
            identifyingType: 'Comment',
            labels: ['message', 'comment'],
            properties: {
                creationDate: 'string',
                locationIP: 'string',
                browserUsed: 'string',
                content: 'string',
                length: 'number'
            }
        },
        {
            identifyingType: 'Forum',
            labels: ['forum'],
            properties: {
                title: 'string',
                creationDate: 'string'
            }
        },
        {
            identifyingType: 'Organization',
            labels: ['organization', 'company', 'university'],
            properties: {
                type: 'string',
                name: 'string',
                url: 'string'
            }
        },
        {
            identifyingType: 'Place',
            labels: ['place', 'city', 'country', 'continent'],
            properties: {
                type: 'string',
                name: 'string',
                url: 'string'
            }
        },
        {
            identifyingType: 'Tag',
            labels: ['tag'],
            properties: {
                name: 'string',
                url: 'string'
            }
        },
        {
            identifyingType: 'TagClass',
            labels: ['tagClass'],
            properties: {
                name: 'string',
                url: 'string'
            }
        }
    ],
    relationships: [
        {
            identifyingEdge: 'KNOWS',
            sourceNodeLabel: 'person',
            targetNodeLabel: 'person',
            properties: {
                creationDate: 'string'
            }
        },
        {
            identifyingEdge: 'HAS_CREATOR',
            sourceNodeLabel: 'message',
            targetNodeLabel: 'person',
            properties: {}
        },
        {
            identifyingEdge: 'LIKES',
            sourceNodeLabel: 'person',
            targetNodeLabel: 'message',
            properties: {
                creationDate: 'string'
            }
        },
        {
            identifyingEdge: 'REPLY_OF',
            sourceNodeLabel: 'comment',
            targetNodeLabel: 'message',
            properties: {}
        },
        {
            identifyingEdge: 'CONTAINER_OF',
            sourceNodeLabel: 'forum',
            targetNodeLabel: 'post',
            properties: {}
        },
        {
            identifyingEdge: 'HAS_MEMBER',
            sourceNodeLabel: 'forum',
            targetNodeLabel: 'person',
            properties: {
                creationDate: 'string'
            }
        },
        {
            identifyingEdge: 'HAS_TAG',
            sourceNodeLabel: 'message',
            targetNodeLabel: 'tag',
            properties: {}
        },
        {
            identifyingEdge: 'STUDY_AT',
            sourceNodeLabel: 'person',
            targetNodeLabel: 'university',
            properties: {
                classYear: 'number'
            }
        },
        {
            identifyingEdge: 'WORK_AT',
            sourceNodeLabel: 'person',
            targetNodeLabel: 'company',
            properties: {
                workFrom: 'number'
            }
        },
        {
            identifyingEdge: 'IS_LOCATED_IN',
            sourceNodeLabel: 'person',
            targetNodeLabel: 'place',
            properties: {}
        },
        {
            identifyingEdge: 'IS_PART_OF',
            sourceNodeLabel: 'place',
            targetNodeLabel: 'place',
            properties: {}
        },
        {
            identifyingEdge: 'HAS_TYPE',
            sourceNodeLabel: 'tag',
            targetNodeLabel: 'tagClass',
            properties: {}
        },
        {
            identifyingEdge: 'IS_SUBCLASS_OF',
            sourceNodeLabel: 'tagClass',
            targetNodeLabel: 'tagClass',
            properties: {}
        }
    ]
};

export const snbFullSchema = new Schema_v1(snbFullSchemaDef);
