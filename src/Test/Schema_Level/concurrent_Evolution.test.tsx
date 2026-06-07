import * as Y from 'yjs';
import { bon19SchemaDef } from "../../Helper/Schema/Bon19_Schema";
import { Schema_v1 } from "../../Schema_CRDT/SchemaCRDT";
import { SchemaError } from "../../Helper/ErrorDefinition";
import { getDoc } from "../../Helper/creator";
import { bidirectionalSync } from "../../Helper/sync";
import { SchemaLensEngine } from "../../LensEngine/SchemaLensEngine";

const checkPreloadLabels = (schema: Schema_v1) => {
    expect(schema.testAccessAllLabels().has("resident")).toBeTruthy();
    expect(schema.testAccessAllLabels().has("citizen")).toBeTruthy();
    expect(schema.testAccessAllLabels().has("note")).toBeTruthy();
    expect(schema.testAccessAllLabels().get("resident")?.size).toBe(1);
    expect(schema.testAccessAllLabels().get("citizen")?.size).toBe(1);
    expect(schema.testAccessAllLabels().get("note")?.size).toBe(1);
}

const checkPersonNodeType = (schema: Schema_v1) => {
    expect(schema.getNodeTypeJSON('Person')).toBeDefined();
    expect(schema.getNodeTypeJSON('Person').labels).toEqual({ resident: 'resident', person: 'person', citizen: 'citizen' });
    expect(schema.getNodeTypeJSON('Person').properties).toEqual(
        {
            firstName: { name: 'firstName', activeTypes: { '1': { value: 'string', default: undefined } } },
            lastName: { name: 'lastName', activeTypes: { '1': { value: 'string', default: undefined } } }
        });
}

const checkMessageNodeType = (schema: Schema_v1) => {
    expect(schema.getNodeTypeJSON('Message')).toBeDefined();
    expect(schema.getNodeTypeJSON('Message').labels).toEqual({ note: 'note', message: 'message' });
    expect(schema.getNodeTypeJSON('Message').properties).toEqual(
        {
            mood: { name: 'mood', activeTypes: { '1': { value: 'string', default: undefined } } },
            imageFile: { name: 'imageFile', activeTypes: { '1': { value: 'string', default: undefined } } },
            creationDate: { name: 'creationDate', activeTypes: { '1': { value: 'string', default: undefined } } },
            browserUsed: { name: 'browserUsed', activeTypes: { '1': { value: 'string', default: undefined } } }
        });
}

const checkKnowsRelationshipType = (schema: Schema_v1) => {
    expect(schema.getRelationshipTypeJSON('KNOWS')).toBeDefined();
    expect(schema.getRelationshipTypeJSON('KNOWS').sourceNodeLabel).toEqual('person');
    expect(schema.getRelationshipTypeJSON('KNOWS').targetNodeLabel).toEqual('person');
    expect(schema.getRelationshipTypeJSON('KNOWS').properties).toEqual(
        { since: { name: 'since', activeTypes: { '1': { value: 'string', default: undefined } } } });
}

const checkHasCreatorRelationshipType = (schema: Schema_v1) => {
    expect(schema.getRelationshipTypeJSON('HAS_CREATOR')).toBeDefined();
    expect(schema.getRelationshipTypeJSON('HAS_CREATOR').sourceNodeLabel).toEqual('message');
    expect(schema.getRelationshipTypeJSON('HAS_CREATOR').targetNodeLabel).toEqual('resident');
    expect(schema.getRelationshipTypeJSON('HAS_CREATOR').properties).toEqual(
        { username: { name: 'username', activeTypes: { '1': { value: 'string', default: undefined } } } });
}

const checkLikesRelationshipType = (schema: Schema_v1) => {
    expect(schema.getRelationshipTypeJSON('LIKES')).toBeDefined();
    expect(schema.getRelationshipTypeJSON('LIKES').sourceNodeLabel).toEqual('person');
    expect(schema.getRelationshipTypeJSON('LIKES').targetNodeLabel).toEqual('message');
    expect(schema.getRelationshipTypeJSON('LIKES').properties).toEqual({
        date: { name: 'date', activeTypes: { '1': { value: 'string', default: undefined } } }
    });
}

const checkReplyOfRelationshipType = (schema: Schema_v1) => {
    expect(schema.getRelationshipTypeJSON('REPLY_OF')).toBeDefined();
    expect(schema.getRelationshipTypeJSON('REPLY_OF').sourceNodeLabel).toEqual('message');
    expect(schema.getRelationshipTypeJSON('REPLY_OF').targetNodeLabel).toEqual('message');
    expect(schema.getRelationshipTypeJSON('REPLY_OF').properties).toEqual(
        { date: { name: 'date', activeTypes: { '1': { value: 'string', default: undefined } } } });
}

describe("Sequential Evolution - basic", () => {
    let schema: Schema_v1;
    let schema2: Schema_v1;
    let doc: Y.Doc;
    let doc2: Y.Doc;
    beforeEach(() => {
        doc = getDoc(1);
        schema = new Schema_v1(bon19SchemaDef, doc);

        doc2 = getDoc(2);
        schema2 = new Schema_v1(undefined, doc2);
    })
    describe("Base Tests", () => {
        test("Autoloading and sync test", () => {
            checkPreloadLabels(schema);
            checkPersonNodeType(schema);
            checkMessageNodeType(schema);
            checkKnowsRelationshipType(schema);
            checkHasCreatorRelationshipType(schema);
            checkLikesRelationshipType(schema);
            checkReplyOfRelationshipType(schema);

            bidirectionalSync(doc, doc2);

            checkPreloadLabels(schema2);
            checkPersonNodeType(schema2);
            checkMessageNodeType(schema2);
            checkKnowsRelationshipType(schema2);
            checkHasCreatorRelationshipType(schema2);
            checkLikesRelationshipType(schema2);
            checkReplyOfRelationshipType(schema2);
        })
    });
    describe("Concurrent Evolution Tests - Base", () => {

        describe("CREATE - CREATE Concurrent Behavior", () => {
            describe("CC_NT", () => {

                test("SAME TYPE", () => {
                    schema.SMO_addNodeType("Account", ["acc"], { iban: "string", balance: "number", bankID: "string" });

                    const schemaJson = schema.getNodeTypeJSON("Account");
                    expect(schemaJson).toBeDefined();
                    expect(schemaJson.labels).toEqual({ acc: "acc" });
                    expect(schemaJson.properties).toEqual(
                        {
                            iban: { name: 'iban', activeTypes: { '1': { value: 'string', default: undefined } } },
                            balance: { name: 'balance', activeTypes: { '1': { value: 'number', default: undefined } } },
                            bankID: { name: 'bankID', activeTypes: { '1': { value: 'string', default: undefined } } }
                        });

                    schema2.SMO_addNodeType("Account", ["account"], { iban: "number", balance: "number", bankID: "string", testDiff: "boolean" });
                    const schema2Json = schema2.getNodeTypeJSON("Account");
                    expect(schema2Json).toBeDefined();
                    expect(schema2Json.labels).toEqual({ account: "account" });
                    expect(schema2Json.properties).toEqual(
                        {
                            iban: { name: 'iban', activeTypes: { '2': { value: 'number', default: undefined } } },
                            balance: { name: 'balance', activeTypes: { '2': { value: 'number', default: undefined } } },
                            bankID: { name: 'bankID', activeTypes: { '2': { value: 'string', default: undefined } } },
                            testDiff: { name: 'testDiff', activeTypes: { '2': { value: 'boolean', default: undefined } } }
                        });

                    bidirectionalSync(doc, doc2);

                    const schema2FinalJson = schema2.getNodeTypeJSON("Account");
                    expect(schema2FinalJson).toBeDefined();
                    expect(schema2FinalJson.labels).toEqual({ acc: "acc", account: "account" });
                    expect(schema2FinalJson.properties).toEqual(
                        {
                            iban: { name: 'iban', activeTypes: { '1': { value: 'string', default: undefined }, '2': { value: 'number', default: undefined } } },
                            balance: { name: 'balance', activeTypes: { '1': { value: 'number', default: undefined }, '2': { value: 'number', default: undefined } } },
                            bankID: { name: 'bankID', activeTypes: { '1': { value: 'string', default: undefined }, '2': { value: 'string', default: undefined } } },
                            testDiff: { name: 'testDiff', activeTypes: { '2': { value: 'boolean', default: undefined } } }
                        });

                    const schema1FinalJson = schema.getNodeTypeJSON("Account");
                    expect(schema1FinalJson).toBeDefined();
                    expect(schema1FinalJson.labels).toEqual({ acc: "acc", account: "account" });
                    expect(schema1FinalJson.properties).toEqual(
                        {
                            iban: { name: 'iban', activeTypes: { '1': { value: 'string', default: undefined }, '2': { value: 'number', default: undefined } } },
                            balance: { name: 'balance', activeTypes: { '1': { value: 'number', default: undefined }, '2': { value: 'number', default: undefined } } },
                            bankID: { name: 'bankID', activeTypes: { '1': { value: 'string', default: undefined }, '2': { value: 'string', default: undefined } } },
                            testDiff: { name: 'testDiff', activeTypes: { '2': { value: 'boolean', default: undefined } } }
                        });

                });

                test("DIFFERENT TYPE: Create Node Type - Node Type Concurrent", () => {
                    schema.SMO_addNodeType("Account", ["acc"], { iban: "string", balance: "number", bankID: "string" });
                    schema2.SMO_addNodeType("Company", ["com"], { location: "string", revenue: "number", founded: "string" });
                    bidirectionalSync(doc, doc2);
                    const schema2Temp = schema2.getNodeTypeJSON("Account");
                    expect(schema2Temp).toBeDefined();
                    expect(schema2Temp.labels).toEqual({ acc: "acc" });
                    expect(schema2Temp.properties).toEqual(
                        {
                            iban: { name: 'iban', activeTypes: { '1': { value: 'string', default: undefined } } },
                            balance: { name: 'balance', activeTypes: { '1': { value: 'number', default: undefined } } },
                            bankID: { name: 'bankID', activeTypes: { '1': { value: 'string', default: undefined } } }
                        });

                    const schema2Temp2 = schema2.getNodeTypeJSON("Company");
                    expect(schema2Temp2).toBeDefined();
                    expect(schema2Temp2.labels).toEqual({ com: "com" });
                    expect(schema2Temp2.properties).toEqual(
                        {
                            location: { name: 'location', activeTypes: { '2': { value: 'string', default: undefined } } },
                            revenue: { name: 'revenue', activeTypes: { '2': { value: 'number', default: undefined } } },
                            founded: { name: 'founded', activeTypes: { '2': { value: 'string', default: undefined } } }
                        });
                    const schemeTemp = schema.getNodeTypeJSON("Account");
                    expect(schemeTemp).toBeDefined();
                    expect(schemeTemp.labels).toEqual({ acc: "acc" });
                    expect(schemeTemp.properties).toEqual(
                        {
                            iban: { name: 'iban', activeTypes: { '1': { value: 'string', default: undefined } } },
                            balance: { name: 'balance', activeTypes: { '1': { value: 'number', default: undefined } } },
                            bankID: { name: 'bankID', activeTypes: { '1': { value: 'string', default: undefined } } }
                        });

                    const schemaTemp2 = schema.getNodeTypeJSON("Company");
                    expect(schemaTemp2).toBeDefined();
                    expect(schemaTemp2.labels).toEqual({ com: "com" });
                    expect(schemaTemp2.properties).toEqual(
                        {
                            location: { name: 'location', activeTypes: { '2': { value: 'string', default: undefined } } },
                            revenue: { name: 'revenue', activeTypes: { '2': { value: 'number', default: undefined } } },
                            founded: { name: 'founded', activeTypes: { '2': { value: 'string', default: undefined } } }
                        });
                });
            });

            describe("CC_RT", () => {

                test("SAME TYPE: Create Relationship Type - Relationship Type Concurrent", () => {
                    bidirectionalSync(doc, doc2);

                    schema.SMO_addRelationshipType("HATE", "person", "person", { role: "string" });
                    schema2.SMO_addRelationshipType("HATE", "message", "message", { position: "string" });
                    bidirectionalSync(doc, doc2);
                    const schemaTemp = schema.getRelationshipTypeJSON("HATE")
                    expect(schemaTemp).toBeDefined();
                    expect(schemaTemp.sourceNodeLabel).toEqual("message");
                    expect(schemaTemp.targetNodeLabel).toEqual("message");
                    expect(schemaTemp.properties).toEqual(
                        { position: { name: 'position', activeTypes: { '2': { value: 'string', default: undefined } } } });
                    const schema2Temp = schema2.getRelationshipTypeJSON("HATE")
                    expect(schema2Temp).toBeDefined();
                    expect(schema2Temp.sourceNodeLabel).toEqual("message");
                    expect(schema2Temp.targetNodeLabel).toEqual("message");
                    expect(schema2Temp.properties).toEqual(
                        { position: { name: 'position', activeTypes: { '2': { value: 'string', default: undefined } } } });
                });

                test("DIFFERENT TYPE: Create Relationship Type - Relationship Type Concurrent", () => {
                    bidirectionalSync(doc, doc2);

                    schema.SMO_addRelationshipType("HATES", "Person", "Person", { why: "string" });
                    schema2.SMO_addRelationshipType("SUPPORTS", "Person", "Message", { citation: "string" });

                    bidirectionalSync(doc, doc2);

                    const schema2Temp = schema2.getRelationshipTypeJSON("HATES");
                    const schema2Temp2 = schema2.getRelationshipTypeJSON("SUPPORTS");
                    expect(schema2Temp).toBeDefined();
                    expect(schema2Temp2).toBeDefined();
                    expect(schema2Temp.properties).toEqual(
                        { why: { name: 'why', activeTypes: { '1': { value: 'string', default: undefined } } } });
                    expect(schema2Temp2.properties).toEqual(
                        { citation: { name: 'citation', activeTypes: { '2': { value: 'string', default: undefined } } } });

                    const schemaTemp = schema.getRelationshipTypeJSON("HATES");
                    const schemaTemp2 = schema.getRelationshipTypeJSON("SUPPORTS");
                    expect(schemaTemp).toBeDefined();
                    expect(schemaTemp2).toBeDefined();
                    expect(schemaTemp.properties).toEqual(
                        { why: { name: 'why', activeTypes: { '1': { value: 'string', default: undefined } } } });
                    expect(schemaTemp2.properties).toEqual(
                        { citation: { name: 'citation', activeTypes: { '2': { value: 'string', default: undefined } } } });
                });
            });

            describe("CC_L", () => {
                test("SAME LABEL: Create Label - Label Concurrent", () => {
                    bidirectionalSync(doc, doc2);
                    expect(schema.testAccessAllLabels().size).toBe(5);
                    expect(schema2.testAccessAllLabels().size).toBe(5);
                    schema.SMO_createLabel("TestLabel");
                    schema2.SMO_createLabel("TestLabel");

                    bidirectionalSync(doc, doc2);
                    const schemaLabels = schema.testAccessAllLabels();
                    const schema2Labels = schema2.testAccessAllLabels();
                    expect(schemaLabels.size).toBe(6);
                    expect(schema2Labels.size).toBe(6);
                    expect(schemaLabels.has("TestLabel")).toBeTruthy();
                    expect(schema2Labels.has("TestLabel")).toBeTruthy();
                    expect(schemaLabels.get("TestLabel")?.size).toBe(2);
                    expect(schema2Labels.get("TestLabel")?.size).toBe(2);
                });
                test("DIFFERENT LABEL: Create Label - Label Concurrent", () => {
                    bidirectionalSync(doc, doc2);
                    expect(schema.testAccessAllLabels().size).toBe(5);
                    expect(schema2.testAccessAllLabels().size).toBe(5);
                    schema.SMO_createLabel("TestLabel1");
                    schema2.SMO_createLabel("TestLabel2");
                    bidirectionalSync(doc, doc2);
                    const schemaLabels = schema.testAccessAllLabels();
                    const schema2Labels = schema2.testAccessAllLabels();
                    expect(schemaLabels.size).toBe(7);
                    expect(schema2Labels.size).toBe(7);
                    expect(schemaLabels.get("TestLabel1")?.size).toBe(1);
                    expect(schemaLabels.get("TestLabel2")?.size).toBe(1);
                    expect(schema2Labels.get("TestLabel1")?.size).toBe(1);
                    expect(schema2Labels.get("TestLabel2")?.size).toBe(1);
                });
            });
        })

        describe("CREATE - DROP", () => {
            describe("CD_NT", () => {
                test("SAME NODE TYPE: Create NodeType vs Drop NodeType Concurrent", () => {
                    const doc3 = getDoc(3);
                    const schema3 = new Schema_v1({ nodes: [], relationships: [] }, doc3);
                    schema3.SMO_addNodeType("Person", ["citizen"], { name: "string", address: "string" });
                    schema.SMO_dropNodeType("Person");
                    expect(schema3.getNodeTypeJSON("Person")).toBeDefined();
                    expect(() => schema.getNodeTypeJSON("Person")).toThrow();
                    bidirectionalSync(doc3, doc);
                    expect(schema.getNodeTypeJSON("Person")).toBeDefined();
                    expect(schema3.getNodeTypeJSON("Person")).toBeDefined();
                });
            })
            describe("CD_RT", () => {
                // TODO
            })

            describe("CD_L", () => {
                test("Create Label vs Drop Label Concurrent", () => {
                    bidirectionalSync(doc, doc2);
                    schema.SMO_createLabel("TestLabelCreateDrop");
                    schema2.SMO_dropLabel("resident");
                    bidirectionalSync(doc, doc2);
                    expect(schema.testAccessAllLabels().has("TestLabelCreateDrop")).toBeTruthy();
                    expect(schema.testAccessAllLabels().has("resident")).toBeFalsy();
                    expect(schema2.testAccessAllLabels().has("TestLabelCreateDrop")).toBeTruthy();
                    expect(schema2.testAccessAllLabels().has("resident")).toBeFalsy();
                });
            })

            // TODO
            describe("Dep_NTL", () => {
                test("Create NodeType vs Change Label Concurrent", () => {

                });
            })

            // TODO
            describe("Dep_RTL", () => {
                test("Create RelationshipType vs Change Label Concurrent", () => {

                });
            })
        });

        describe("CREATE - RENAME", () => {
            test("Create Label vs Rename Label Concurrent", () => {
                bidirectionalSync(doc, doc2);
                schema.SMO_createLabel("TestLabelCreateRename");
                schema2.SMO_renameLabel("citizen", "citizen_old");
                bidirectionalSync(doc, doc2);
                expect(schema.testAccessAllLabels().has("TestLabelCreateRename")).toBeTruthy();
                expect(schema.testAccessAllLabels().has("citizen")).toBeFalsy();
                expect(schema.testAccessAllLabels().has("citizen_old")).toBeTruthy();
                expect(schema2.testAccessAllLabels().has("TestLabelCreateRename")).toBeTruthy();
                expect(schema2.testAccessAllLabels().has("citizen")).toBeFalsy();
            });
        })
        describe("CREATE - CHANGE", () => {
            test("Create Label vs Change Property Concurrent", () => {
                bidirectionalSync(doc, doc2);
                schema.SMO_createLabel("TestLabelCreateChange");

                const tags2 = schema2.getPropertyTypeTags("Message", "mood", "NodeType");
                schema2.SMO_ChangePropertyType({ Idenifying: "Message", propertyKey: "mood", oldTags: tags2, newPropertyType: "string", defaultVal: { default: "0" }, whatType: "NodeType" });

                bidirectionalSync(doc, doc2);
                expect(schema.testAccessAllLabels().has("TestLabelCreateChange")).toBeTruthy();
                expect(schema.transformToJSONFullSchema().nodeTypes.Message.properties.mood.activeTypes).toBeDefined();
            });
        })
        describe("DROP - DROP", () => {
            test("Drop NodeType Concurrent (Drop vs Update)", () => {
                bidirectionalSync(doc, doc2);
                schema.SMO_dropNodeType("Message");
                schema2.SMO_AddPropertyType({ Idenifying: "Message", newProperty: { key: "newProp", value: "string" }, whatType: "NodeType" });
                bidirectionalSync(doc, doc2);
                expect(schema.transformToJSONFullSchema().nodeTypes.Message).toBeUndefined();
                expect(schema2.transformToJSONFullSchema().nodeTypes.Message).toBeUndefined();
            });
            test("Drop RelationshipType Concurrent (Both drop)", () => {
                bidirectionalSync(doc, doc2);
                schema.SMO_dropRelationshipType("KNOWS");
                schema2.SMO_dropRelationshipType("KNOWS");
                bidirectionalSync(doc, doc2);
                expect(schema.transformToJSONFullSchema().relationshipTypes.KNOWS).toBeUndefined();
                expect(schema2.transformToJSONFullSchema().relationshipTypes.KNOWS).toBeUndefined();
            });
            test("Drop Label Concurrent (Both drop)", () => {
                bidirectionalSync(doc, doc2);
                schema.SMO_dropLabel("resident");
                schema2.SMO_dropLabel("resident");
                bidirectionalSync(doc, doc2);
                expect(schema.testAccessAllLabels().has("resident")).toBeFalsy();
                expect(schema2.testAccessAllLabels().has("resident")).toBeFalsy();
            });
        });
        describe("DROP - RENAME", () => {
            test("Drop Label vs Rename Same Label Concurrent", () => {
                bidirectionalSync(doc, doc2);
                schema.SMO_dropLabel("citizen");
                schema2.SMO_renameLabel("citizen", "citizen_old");
                bidirectionalSync(doc, doc2);
                expect(schema.testAccessAllLabels().has("citizen")).toBeFalsy();
                expect(schema.testAccessAllLabels().has("citizen_old")).toBeTruthy();
            });
        })
        describe("DROP - CHANGE", () => {
            test("Drop Label vs Change Property Concurrent", () => {
                bidirectionalSync(doc, doc2);
                schema.SMO_dropLabel("note");

                const tags2 = schema2.getPropertyTypeTags("Message", "mood", "NodeType");
                schema2.SMO_ChangePropertyType({ Idenifying: "Message", propertyKey: "mood", oldTags: tags2, newPropertyType: "string", defaultVal: { default: "0" }, whatType: "NodeType" });

                bidirectionalSync(doc, doc2);
                expect(schema.testAccessAllLabels().has("note")).toBeFalsy();
                expect(schema.transformToJSONFullSchema().nodeTypes.Message.properties.mood.activeTypes).toBeDefined();
            });
        })
        describe("RENAME - RENAME", () => {
            test("Rename Property Key of NodeType Concurrent (Both rename)", () => {
                bidirectionalSync(doc, doc2);
                schema.SMO_renamePropertyKey({ Idenifying: "Person", oldPropertyKey: "lastName", newPropertyKey: "familyName", whatType: "NodeType" });
                schema2.SMO_renamePropertyKey({ Idenifying: "Person", oldPropertyKey: "lastName", newPropertyKey: "surname", whatType: "NodeType" });
                bidirectionalSync(doc, doc2);
                const props = schema.getNodeTypeJSON("Person").properties
                expect(["surname"]).toContain(props.lastName.name);
            });
            test("Rename Property Key of RelationshipType Concurrent", () => {
                bidirectionalSync(doc, doc2);
                schema.SMO_renamePropertyKey({ Idenifying: "KNOWS", oldPropertyKey: "since", newPropertyKey: "seit", whatType: "RelationshipType" });
                schema2.SMO_renamePropertyKey({ Idenifying: "KNOWS", oldPropertyKey: "since", newPropertyKey: "startDate", whatType: "RelationshipType" });
                bidirectionalSync(doc, doc2);
                const props = schema.transformToJSONFullSchema().relationshipTypes.KNOWS.properties;
                expect(["seit", "startDate"]).toContain(props.since.name);
            });
            test("Rename Label of NodeType Concurrent", () => {
                bidirectionalSync(doc, doc2);
                schema.SMO_renameLabel("note", "memo");
                schema2.SMO_renameLabel("note", "messageDoc");
                bidirectionalSync(doc, doc2);
                const labels = schema.transformToJSONFullSchema().nodeTypes.Message.labels;
                expect(labels.note).toBeUndefined();
                expect(labels.messageDoc).toBeDefined();
            });
            test("Rename Label of RelationshipType Concurrent", () => {
                // TODO
                expect(true).toBe(true);
            });
        });
        describe("RENAME - CHANGE", () => {
            test("Rename Label vs Change Property Concurrent", () => {
                bidirectionalSync(doc, doc2);
                schema.SMO_renameLabel("note", "memo");

                const tags2 = schema2.getPropertyTypeTags("Message", "mood", "NodeType");
                schema2.SMO_ChangePropertyType({ Idenifying: "Message", propertyKey: "mood", oldTags: tags2, newPropertyType: "string", defaultVal: { default: "0" }, whatType: "NodeType" });

                bidirectionalSync(doc, doc2);
                expect(schema.testAccessAllLabels().has("note")).toBeFalsy();
                expect(schema.testAccessAllLabels().has("memo")).toBeTruthy();
                expect(schema.transformToJSONFullSchema().nodeTypes.Message.properties.mood.activeTypes).toBeDefined();
            });
        })
        describe("CHANGE - CHANGE", () => {
            test("Add Property to NodeType Concurrent", () => {
                bidirectionalSync(doc, doc2);
                schema.SMO_AddPropertyType({ Idenifying: "Person", newProperty: { key: "age", value: "number" }, whatType: "NodeType" });
                schema2.SMO_AddPropertyType({ Idenifying: "Person", newProperty: { key: "city", value: "string" }, whatType: "NodeType" });
                bidirectionalSync(doc, doc2);
                const props = schema.transformToJSONFullSchema().nodeTypes.Person.properties;
                expect(props.age).toBeDefined();
                expect(props.city).toBeDefined();
                expect(props.age.name).toEqual("age");
            });
            test("Add Property to RelationshipType Concurrent", () => {
                bidirectionalSync(doc, doc2);
                schema.SMO_AddPropertyType({ Idenifying: "KNOWS", newProperty: { key: "strength", value: "number" }, whatType: "RelationshipType" });
                schema2.SMO_AddPropertyType({ Idenifying: "KNOWS", newProperty: { key: "context", value: "string" }, whatType: "RelationshipType" });
                bidirectionalSync(doc, doc2);
                const props = schema.transformToJSONFullSchema().relationshipTypes.KNOWS.properties;
                expect(props.strength).toBeDefined();
                expect(props.context).toBeDefined();
            });
            test("Drop Property from NodeType Concurrent", () => {
                bidirectionalSync(doc, doc2);
                schema.SMO_DropPropertyType({ Idenifying: "Person", propertyKey: "firstName", whatType: "NodeType" });
                schema2.SMO_DropPropertyType({ Idenifying: "Person", propertyKey: "lastName", whatType: "NodeType" });
                bidirectionalSync(doc, doc2);
                const props = schema.transformToJSONFullSchema().nodeTypes.Person.properties;
                expect(props.firstName).toBeUndefined();
                expect(props.lastName).toBeUndefined();
            });
            test("Drop Property from RelationshipType Concurrent", () => {
                bidirectionalSync(doc, doc2);
                schema.SMO_DropPropertyType({ Idenifying: "KNOWS", propertyKey: "since", whatType: "RelationshipType" });
                schema2.SMO_DropPropertyType({ Idenifying: "KNOWS", propertyKey: "since", whatType: "RelationshipType" });
                bidirectionalSync(doc, doc2);
                const props = schema.transformToJSONFullSchema().relationshipTypes.KNOWS.properties;
                expect(props.since).toBeUndefined();
            });
            test("Change Property Type of NodeType Concurrent", () => {
                bidirectionalSync(doc, doc2);
                const tags = schema.getPropertyTypeTags("Message", "mood", "NodeType");
                const tags2 = schema2.getPropertyTypeTags("Message", "mood", "NodeType");

                const transformerMap = { "happy": "10", "sad": "0", "neutral": "5", "default": "-1" }
                schema.SMO_ChangePropertyType({ Idenifying: "Message", propertyKey: "mood", oldTags: tags, newPropertyType: "number", defaultVal: { default: -1, transformerMap: transformerMap }, whatType: "NodeType" });

                schema2.SMO_ChangePropertyType({ Idenifying: "Message", propertyKey: "mood", oldTags: tags2, newPropertyType: "string", defaultVal: { default: "0" }, whatType: "NodeType" });

                bidirectionalSync(doc, doc2);

                const mergedProps = schema.transformToJSONFullSchema().nodeTypes.Message.properties.mood.activeTypes;
                const clientKeys = Object.keys(mergedProps);
                expect(clientKeys.length).toBeGreaterThan(0);
            });
            test("Change Property Type of RelationshipType Concurrent", () => {
                bidirectionalSync(doc, doc2);
                const tags = schema.getPropertyTypeTags("KNOWS", "since", "RelationshipType");
                const tags2 = schema2.getPropertyTypeTags("KNOWS", "since", "RelationshipType");
                schema.SMO_ChangePropertyType({ Idenifying: "KNOWS", propertyKey: "since", oldTags: tags, newPropertyType: "number", defaultVal: { default: 2000 }, whatType: "RelationshipType" });
                schema2.SMO_ChangePropertyType({ Idenifying: "KNOWS", propertyKey: "since", oldTags: tags2, newPropertyType: "date", defaultVal: { default: new Date("2000-01-01") }, whatType: "RelationshipType" });
                bidirectionalSync(doc, doc2);

                const mergedProps = schema.transformToJSONFullSchema().relationshipTypes.KNOWS.properties.since.activeTypes;
                expect(Object.keys(mergedProps).length).toBeGreaterThan(0);
            });
            test("Concurrent Evolution - Change Property Type Concurrently", () => {
                bidirectionalSync(doc, doc2);
                const tags = schema.getPropertyTypeTags("Message", "mood", "NodeType");
                const tags2 = schema2.getPropertyTypeTags("Message", "mood", "NodeType");

                const transformerMap1 = { "happy": "10", "sad": "0" };
                schema.SMO_ChangePropertyType({
                    Idenifying: "Message",
                    propertyKey: "mood",
                    oldTags: tags,
                    newPropertyType: "number",
                    defaultVal: { default: -1, transformerMap: transformerMap1 },
                    whatType: "NodeType"
                });

                const transformerMap2 = { "happy": "true", "sad": "false" };
                schema2.SMO_ChangePropertyType({
                    Idenifying: "Message",
                    propertyKey: "mood",
                    oldTags: tags2,
                    newPropertyType: "boolean",
                    defaultVal: { default: false, transformerMap: transformerMap2 },
                    whatType: "NodeType"
                });

                bidirectionalSync(doc, doc2);

                const activeTypes = schema.transformToJSONFullSchema().nodeTypes.Message.properties.mood.activeTypes;
                const clientIds = Object.keys(activeTypes);

                expect(clientIds.length).toBe(2);
                expect(activeTypes[doc.clientID.toString()].value).toBe("number");
                expect(activeTypes[doc2.clientID.toString()].value).toBe("boolean");
            });
        });
        describe("SPLIT - SPLIT", () => {
            test("Split Label Concurrent (Same Label, different targets)", () => {
                bidirectionalSync(doc, doc2);
                schema.SMO_splitLabel({ oldName: "person", newName1: "person1", newName2: "person2" });
                schema2.SMO_splitLabel({ oldName: "person", newName1: "personA", newName2: "personB" });
                bidirectionalSync(doc, doc2);
                const labels = schema.getNodeTypeJSON("Person").labels;
                expect(labels.person2).toBeDefined();
                expect(labels.personA).toBeDefined();
                expect(labels.personB).toBeDefined();
                expect(labels.person1).toBeUndefined();
                expect(labels.person).toBeUndefined();
            });
        });
        describe("UNION - UNION", () => {
            test("Union Labels Concurrent (Same Labels, different target)", () => {

                bidirectionalSync(doc, doc2);
                schema.SMO_unionLabels({ oldLabel1: "resident", oldLabel2: "citizen", newLabel: "tenant" });
                schema2.SMO_unionLabels({ oldLabel1: "resident", oldLabel2: "citizen", newLabel: "inhabitant" });
                bidirectionalSync(doc, doc2);
                const labels = schema.getNodeTypeJSON("Person").labels;
                expect(labels.tenant).toBeUndefined();
                expect(labels.inhabitant).toBeDefined();
                expect(labels.resident).toBeUndefined();
                expect(labels.citizen).toBeUndefined();
            });
        });
        describe("SPLIT - UNION", () => {
            test("Split Label vs Union Label Concurrent", () => {
                bidirectionalSync(doc, doc2);

                schema.SMO_splitLabel({ oldName: "resident", newName1: "resident_a", newName2: "resident_b" });
                schema2.SMO_unionLabels({ oldLabel1: "resident", oldLabel2: "citizen", newLabel: "tenant" });
                bidirectionalSync(doc, doc2);

                const labels = schema.getNodeTypeJSON("Person").labels;
                expect(labels.resident_a).toBeUndefined();
                expect(labels.resident_b).toBeDefined();
                expect(labels.tenant).toBeDefined();
                expect(labels.resident).toBeUndefined();
                expect(labels.citizen).toBeUndefined();
            });
        });
    });
});