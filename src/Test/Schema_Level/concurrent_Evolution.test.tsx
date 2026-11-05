import * as Y from 'yjs';
import { bon19SchemaDef } from "../../Helper/Schema/Bon19_Schema";
import { Schema_v1 } from "../../Schema_CRDT/SchemaCRDT";
import { SchemaError } from "../../Helper/ErrorDefinition";
import { getDoc } from "../../Helper/helper";
import { bidirectionalSync, trialSync } from "../../Helper/sync";

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

describe("Concurrent Evolution - basic", () => {
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

        describe("CREATE Row", () => {
            describe("CREATE - CREATE", () => {
            // 3 Conflicts
                test("CC_NT", () => {
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
                        expect(schema1FinalJson).toEqual(schema2FinalJson);
                    });
                test("CC_RT", () => {
                        bidirectionalSync(doc, doc2);

                        schema.SMO_addRelationshipType("HATE", "person", "person", { role: "string" });
                        schema2.SMO_addRelationshipType("HATE", "message", "message", { position: "string" });
                        bidirectionalSync(doc, doc2);
                        // the higher clientId LWW should win
                        const schemaTemp = schema.getRelationshipTypeJSON("HATE")
                        expect(schemaTemp).toBeDefined();
                        expect(schemaTemp.sourceNodeLabel).toEqual("message");
                        expect(schemaTemp.targetNodeLabel).toEqual("message");
                        expect(schemaTemp.properties).toEqual(
                            { position: { name: 'position', activeTypes: { '2': { value: 'string', default: undefined } } } });
                        const schema2Temp = schema2.getRelationshipTypeJSON("HATE")
                        expect(schema2Temp).toEqual(schemaTemp);
                });
                test("CC_L", () => {
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
            });
        })
        // 5 conflicts
        describe("CREATE - DROP", () => {
            test("CD_NT", () => {
                    const doc3 = getDoc(0);
                    const schema3 = new Schema_v1({ nodes: [], relationships: [] }, doc3);
                    schema3.SMO_addNodeType("Person", ["citizen"], { name: "string", address: "string" });
                    schema.SMO_dropNodeType("Person");
                    expect(schema3.getNodeTypeJSON("Person")).toBeDefined();
                    expect(() => schema.getNodeTypeJSON("Person")).toThrow();
                    bidirectionalSync(doc3, doc);
                    // even if the higher clientId deletes person is still defined
                    expect(schema.getNodeTypeJSON("Person")).toBeDefined();
                    expect(schema3.getNodeTypeJSON("Person")).toBeDefined();
            });
            test("CD_RT", () => {
                const doc0 = getDoc(0);
                const schema0 = new Schema_v1({ nodes: [], relationships: [] }, doc0);
                schema0.SMO_addRelationshipType("KNOWS", "person", "person", { since: "string" });
                schema.SMO_dropRelationshipType("KNOWS");
                expect(schema0.getRelationshipTypeJSON("KNOWS")).toBeDefined();
                expect(() => schema.getRelationshipTypeJSON("KNOWS")).toThrow();
                bidirectionalSync(doc0, doc);
                // even if the higher clientId deletes person is still defined
                expect(schema.getRelationshipTypeJSON("KNOWS")).toBeDefined();
                expect(schema0.getRelationshipTypeJSON("KNOWS")).toBeDefined();


                const doc3 = getDoc(3);
                const schema3 = new Schema_v1({ nodes: [], relationships: [] }, doc3);
                schema3.SMO_addRelationshipType("KNOWS", "person", "person", { since: "string" });
                schema.SMO_dropRelationshipType("KNOWS");
                expect(schema3.getRelationshipTypeJSON("KNOWS")).toBeDefined();
                expect(() => schema.getRelationshipTypeJSON("KNOWS")).toThrow();
                bidirectionalSync(doc3, doc);
                // even if the higher clientId deletes person is still defined
                expect(() => schema.getRelationshipTypeJSON("KNOWS")).toThrow();
                expect(() => schema3.getRelationshipTypeJSON("KNOWS")).toThrow();
            })
            test("CD_L", () => {
                schema.dropLabel("resident");
                schema2.SMO_createLabel("resident");
                bidirectionalSync(doc, doc2);
                expect(schema.testAccessAllLabels().has("resident")).toBeTruthy();
                expect(schema2.testAccessAllLabels().has("resident")).toBeTruthy();

                // because old instance is deleted -> the old RT are removed
                expect(() => schema.getRelationshipTypeJSON("HAS_CREATOR")).toThrow(SchemaError);
            })
            test("Dep_NTL", () => {
                bidirectionalSync(doc, doc2);
                schema.dropLabel("resident");
                schema2.SMO_addNodeType("TEST", ["resident"], { name: "string", address: "string" });
                bidirectionalSync(doc, doc2);
                expect(schema.testAccessAllLabels().has("resident")).toBeFalsy();
                const nodeType = schema.getNodeTypeJSON("TEST");
                expect(nodeType).toBeDefined();
                expect(nodeType.labels).toEqual({ });
            })
            test("Dep_RTL", () => {
                bidirectionalSync(doc, doc2);
                schema.dropLabel("resident");
                schema2.SMO_addRelationshipType("TEST", "resident", "resident", { name: "string", address: "string" });
                bidirectionalSync(doc, doc2);
                expect(schema.testAccessAllLabels().has("resident")).toBeFalsy();
                expect(() => schema.getRelationshipTypeJSON("TEST")).toThrow(SchemaError);
                expect(() => schema.getRelationshipTypeJSON("HAS_CREATOR")).toThrow(SchemaError);
            })
        });
        // 5 conflicts
        describe("CREATE - RENAME", () => {
            test("CR_NTL", () => {
                bidirectionalSync(doc, doc2);
                schema.SMO_renameLabel("resident", "resident_old");
                schema2.SMO_addNodeType("TEST", ["resident"], { name: "string", address: "string" });

                bidirectionalSync(doc, doc2);

                expect(schema.testAccessAllLabels().has("resident")).toBeFalsy();
                expect(schema.testAccessAllLabels().has("resident_old")).toBeTruthy();
                const nodeType = schema.getNodeTypeJSON("TEST");
                expect(nodeType).toBeDefined();
                expect(nodeType.labels).toEqual({ resident_old: "resident_old" });
            });
            test("CR_RTL", () => {
                bidirectionalSync(doc, doc2);
                schema.SMO_renameLabel("resident", "resident_old");
                schema2.SMO_addRelationshipType("TEST", "resident", "resident", { name: "string", address: "string" });

                bidirectionalSync(doc, doc2);

                expect(schema.testAccessAllLabels().has("resident")).toBeFalsy();
                expect(schema.testAccessAllLabels().has("resident_old")).toBeTruthy();
                const relationshipType = schema.getRelationshipTypeJSON("TEST");
                expect(relationshipType).toBeDefined();
                expect(relationshipType.sourceNodeLabel).toEqual("resident_old");
                expect(relationshipType.targetNodeLabel).toEqual("resident_old");
            });
            test("CR_L", () => {
                schema.SMO_renameLabel("resident", "resident_old");
                schema2.SMO_createLabel("resident");

                bidirectionalSync(doc, doc2);
                expect(schema.testAccessAllLabels().has("resident")).toBeTruthy();
                expect(schema.testAccessAllLabels().has("resident_old")).toBeTruthy();
                // old references are tagged to the old instance
                expect(schema.getNodeTypeJSON("Person").labels).toEqual({ resident_old: "resident_old", person: "person", citizen: "citizen" });
                expect(schema.getRelationshipTypeJSON("HAS_CREATOR").targetNodeLabel).toEqual("resident_old");

                expect(schema.transformToJSONCleanSchema()).toEqual(schema2.transformToJSONCleanSchema());
            });
            test("CR_NT", () => {
                schema.SMO_renamePropertyKey({ Idenifying: "Person", oldPropertyKey: "firstName", newPropertyKey: "givenName", whatType: "NodeType" });
                schema2.SMO_addNodeType("Person", ["resident"], { firstName: "string", lastName: "string" });
                bidirectionalSync(doc, doc2);
                const nodeType = schema.getNodeTypeJSON("Person");
                const nodeType2 = schema2.getNodeTypeJSON("Person");
                expect(nodeType).toBeDefined();
                expect(nodeType).toEqual(nodeType2);


                // clientId flip
                const doc0 = getDoc(0);
                const schema0 = new Schema_v1(undefined, doc0);
                schema2.SMO_renamePropertyKey({ Idenifying: "Person", oldPropertyKey: "lastName", newPropertyKey: "givenName", whatType: "NodeType" });
                schema0.SMO_addNodeType("Person", ["resident"], { firstName: "string", lastName: "string" });
                bidirectionalSync(doc0, doc2);
                const nodeType0 = schema0.getNodeTypeJSON("Person");
                const nodeType2_2 = schema2.getNodeTypeJSON("Person");
                expect(nodeType0).toBeDefined();
                expect(nodeType0).toEqual(nodeType2_2);
            
            });
            test("CR_RT", () => {
                schema.SMO_renamePropertyKey({ Idenifying: "HAS_CREATOR", oldPropertyKey: "username", newPropertyKey: "givenName", whatType: "RelationshipType" });
                schema2.SMO_addRelationshipType("HAS_CREATOR", "resident", "resident", { firstName: "string", lastName: "string" });
                bidirectionalSync(doc, doc2);
                const nodeType = schema.getRelationshipTypeJSON("HAS_CREATOR");
                const nodeType2 = schema2.getRelationshipTypeJSON("HAS_CREATOR");
                expect(nodeType).toBeDefined();
                expect(nodeType).toEqual(nodeType2);

                // clientId flip
                const doc0 = getDoc(0);
                const schema0 = new Schema_v1(undefined, doc0);
                schema2.SMO_renamePropertyKey({ Idenifying: "HAS_CREATOR", oldPropertyKey: "username", newPropertyKey: "givenName", whatType: "RelationshipType" });
                schema0.SMO_addRelationshipType("HAS_CREATOR", "resident", "resident", { firstName: "string", lastName: "string" });
                bidirectionalSync(doc0, doc2);
                const nodeType0 = schema0.getRelationshipTypeJSON("HAS_CREATOR");
                const nodeType2_2 = schema2.getRelationshipTypeJSON("HAS_CREATOR");
                expect(nodeType0).toBeDefined();
                expect(nodeType0).toEqual(nodeType2_2);
            });
        })
        describe("CREATE - CHANGE", () => {
            test("CRCH_NT_AddProp - Create NT concurrent with AddProperty on existing NT", () => {
                bidirectionalSync(doc, doc2);
                schema.SMO_addNodeType("Animal", ["person"], { species: "string" });
                schema2.SMO_AddPropertyType({ Idenifying: "Person", newProperty: { key: "age", value: "number" }, whatType: "NodeType" });
                bidirectionalSync(doc, doc2);

                expect(schema.getNodeTypeJSON("Animal")).toBeDefined();
                const personProps = schema.transformToJSONFullSchema().nodeTypes.Person.properties;
                expect(personProps.age).toBeDefined();
                expect(schema.transformToJSONFullSchema()).toEqual(schema2.transformToJSONFullSchema());
            });
            test("CRCH_NT_DropProp - Create NT concurrent with DropProperty on existing NT", () => {
                bidirectionalSync(doc, doc2);
                schema.SMO_addNodeType("Animal", ["person"], { species: "string" });
                schema2.SMO_DropPropertyType({ Idenifying: "Person", propertyKey: "firstName", whatType: "NodeType" });
                bidirectionalSync(doc, doc2);

                expect(schema.getNodeTypeJSON("Animal")).toBeDefined();
                const personProps = schema.transformToJSONFullSchema().nodeTypes.Person.properties;
                expect(personProps.firstName).toBeUndefined();
                expect(schema.transformToJSONFullSchema()).toEqual(schema2.transformToJSONFullSchema());
            });
            test("CRCH_RT_AddProp - Create RT concurrent with AddProperty on existing RT", () => {
                bidirectionalSync(doc, doc2);
                schema.SMO_addRelationshipType("FOLLOWS", "person", "person", { since: "string" });
                schema2.SMO_AddPropertyType({ Idenifying: "KNOWS", newProperty: { key: "strength", value: "number" }, whatType: "RelationshipType" });
                bidirectionalSync(doc, doc2);

                expect(schema.getRelationshipTypeJSON("FOLLOWS")).toBeDefined();
                const knowsProps = schema.transformToJSONFullSchema().relationshipTypes.KNOWS.properties;
                expect(knowsProps.strength).toBeDefined();
                expect(schema.transformToJSONFullSchema()).toEqual(schema2.transformToJSONFullSchema());
            });
            test("CRCH_RT_DropProp - Create RT concurrent with DropProperty on existing RT", () => {
                bidirectionalSync(doc, doc2);
                schema.SMO_addRelationshipType("FOLLOWS", "person", "person", { since: "string" });
                schema2.SMO_DropPropertyType({ Idenifying: "KNOWS", propertyKey: "since", whatType: "RelationshipType" });
                bidirectionalSync(doc, doc2);

                expect(schema.getRelationshipTypeJSON("FOLLOWS")).toBeDefined();
                const knowsProps = schema.transformToJSONFullSchema().relationshipTypes.KNOWS.properties;
                expect(knowsProps.since).toBeUndefined();
                expect(schema.transformToJSONFullSchema()).toEqual(schema2.transformToJSONFullSchema());
            });
            test("CRCH_L - Create NT with concurrent addLabel on existing NT", () => {
                bidirectionalSync(doc, doc2);
                schema.SMO_addNodeType("Animal", ["person"], { species: "string" });
                schema2.SMO_createLabel("animal");
                schema2.SMO_AddLabelToNodeType("Person", "animal");
                bidirectionalSync(doc, doc2);

                expect(schema.getNodeTypeJSON("Animal")).toBeDefined();
                const labels = schema.testAccessAllLabels();
                expect(labels.has("animal")).toBeTruthy();
                expect(schema.getNodeTypeJSON("Person").labels.animal).toEqual("animal");
                expect(schema.transformToJSONFullSchema()).toEqual(schema2.transformToJSONFullSchema());
            });
            test("CRCH_L - Create NT with concurrent removeLabel on existing NT", () => {
                schema2.SMO_addNodeType("Person", ["extraLabel"], { species: "string" });
                schema.SMO_RemoveLabelFromNodeType("Person", "animal");
                bidirectionalSync(doc, doc2);

                expect(schema.getNodeTypeJSON("Person")).toBeDefined();
                expect(schema.getNodeTypeJSON("Person").labels.animal).toBeUndefined();
                expect(schema.transformToJSONFullSchema()).toEqual(schema2.transformToJSONFullSchema());
            });
            test("CRCH_Retype - Create NT concurrent with ChangePropertyType on existing NT", () => {
                const tags = schema.getPropertyTypeTags("Message", "mood", "NodeType");
                schema2.SMO_addNodeType("Animal", ["person"], { species: "string" });
                schema.SMO_ChangePropertyType({ Idenifying: "Message", propertyKey: "mood", oldTags: tags, newPropertyType: "number", defaultVal: { default: -1, transformerMap: { "happy": "10", "sad": "0", "default": "-1" } }, whatType: "NodeType" });
                bidirectionalSync(doc, doc2);

                expect(schema.getNodeTypeJSON("Animal")).toBeDefined();
                const moodActiveTypes = schema.transformToJSONFullSchema().nodeTypes.Message.properties.mood.activeTypes;
                expect(Object.values(moodActiveTypes).some((v: any) => v.value === "number")).toBeTruthy();
                expect(schema.transformToJSONFullSchema()).toEqual(schema2.transformToJSONFullSchema());
            });
            test("CRCH_Retype - Create NT concurrent with ChangePropertyType on existing RT", () => {
                bidirectionalSync(doc, doc2);
                const tags = schema.getPropertyTypeTags("KNOWS", "since", "RelationshipType");
                schema.SMO_addNodeType("Animal", ["person"], { species: "string" });
                schema2.SMO_ChangePropertyType({ Idenifying: "KNOWS", propertyKey: "since", oldTags: tags, newPropertyType: "number", defaultVal: { default: -1, transformerMap: { "happy": "10", "sad": "0", "default": "-1" } }, whatType: "RelationshipType" });
                bidirectionalSync(doc, doc2);

                expect(schema.getNodeTypeJSON("Animal")).toBeDefined();
                const sinceActiveTypes = schema.transformToJSONFullSchema().relationshipTypes.KNOWS.properties.since.activeTypes;
                expect(Object.values(sinceActiveTypes).some((v: any) => v.value === "number")).toBeTruthy();
                expect(schema.transformToJSONFullSchema()).toEqual(schema2.transformToJSONFullSchema());
            });
        });
        // 5 conflicts
        describe("CREATE - SPLIT", () => {
            test("CS_NT", () => {

                schema.SMO_splitNodeType({
                    legacyType: "Person",
                    splitProperty: "role",
                    mapping: {
                        "Employee": "Employee",
                        "Customer": "Customer"
                    },
                    defaultType: "Customer"
                });

                schema2.SMO_addNodeType("Person", ["TEST"], { yearlyBonus: "number" });


                bidirectionalSync(doc, doc2);
                const mapping = schema.testAccessSchemaMappings();
                expect(mapping.get("Person")).toBeDefined();
                expect(schema.getNodeTypeJSON("Employee")).toBeDefined();
                expect(schema.getNodeTypeJSON("Customer")).toBeDefined();
                console.log(schema.getNodeTypeJSON("Person").properties);
                expect(schema.getNodeTypeJSON("Person").properties).toEqual(    {
      firstName: { name: 'firstName', activeTypes: { '1': {default: undefined, value: 'string'} } },
      lastName: { name: 'lastName', activeTypes: { '1': {default: undefined, value: 'string'} } },
      yearlyBonus: { name: 'yearlyBonus', activeTypes: { '2': {default: undefined, value: 'number'} } }
    });
            });
            test("CS_RT", () => {

                
                schema.SMO_splitRelationshipType({ legacyType: "KNOWS", newType1: "KNOWS_WELL", newType2: "KNOWS_BARELY" });
                schema2.SMO_createLabel("person");
                schema2.SMO_addRelationshipType("KNOWS", "person", "person", { strength: "number" });
                bidirectionalSync(doc, doc2);

                const mapping = schema.testAccessSchemaMappings();
                expect(mapping.get("KNOWS")).toBeDefined();
                expect(mapping.get("KNOWS").kind).toEqual("splitRT");
                expect(schema.getRelationshipTypeJSON("KNOWS_WELL")).toBeDefined();
                expect(schema.getRelationshipTypeJSON("KNOWS_BARELY")).toBeDefined();

                const knowsProps = schema.transformToJSONFullSchema().relationshipTypes.KNOWS.properties;
                expect(knowsProps.strength).toBeDefined();
                expect(schema.transformToJSONFullSchema()).toEqual(schema2.transformToJSONFullSchema());
            });
            test("CS_L", () => {
                schema.SMO_splitLabel({ oldName: "resident", newName1: "resident1", newName2: "resident2" });
                schema2.SMO_createLabel("resident");
                bidirectionalSync(doc, doc2);
                expect(schema.testAccessAllLabels().has("resident")).toBeTruthy();
                expect(schema.testAccessAllLabels().has("resident1")).toBeTruthy();
                expect(schema.testAccessAllLabels().has("resident2")).toBeTruthy();

                bidirectionalSync(doc, doc2);
                expect(schema.testAccessAllLabels().has("resident")).toBeTruthy();
                expect(schema.transformToJSONCleanSchema()).toEqual(schema2.transformToJSONCleanSchema());
            });
            test("CSDep_NTL", () => {
                bidirectionalSync(doc, doc2);
                schema.SMO_splitLabel({ oldName: "resident", newName1: "resident1", newName2: "resident2" });
                schema2.SMO_addNodeType("TEST", ["resident"], { name: "string", address: "string" });

                bidirectionalSync(doc, doc2);

                expect(schema.getNodeTypeJSON("TEST")).toBeDefined();
                expect(schema.getNodeTypeJSON("TEST").labels).toEqual({resident1: "resident1", resident2: "resident2"});
                expect(schema.getNodeTypeJSON("TEST")).toEqual(schema2.getNodeTypeJSON("TEST"));
            });
            test("CSDep_RTL", () => {
                bidirectionalSync(doc, doc2);
                schema.SMO_splitLabel({ oldName: "resident", newName1: "resident1", newName2: "resident2" });
                schema2.SMO_addRelationshipType("TEST", "resident", "resident", { name: "string", address: "string" });

                bidirectionalSync(doc, doc2);

                expect(schema.getRelationshipTypeJSON("TEST")).toBeDefined();
                expect(schema.getRelationshipTypeJSON("TEST").sourceNodeLabel).toEqual("resident1");
                expect(schema.getRelationshipTypeJSON("TEST").targetNodeLabel).toEqual("resident1");
            });
        });
        // 5 conflicts
        describe("CREATE - JOIN", () => {
            test("CU_NT", () => {
                schema.SMO_unionNodeTypes({ newType: "PersonMessage", legacyTypes: ["Person", "Message"], writeDefault: "Person" });
                schema2.SMO_addNodeType("Person", ["blub"], { alive: "string" });
                bidirectionalSync(doc, doc2);

                expect(schema.getNodeTypeJSON("PersonMessage")).toBeDefined();
                expect(schema.getNodeTypeJSON("Person").labels.blub).toBeDefined();  
                expect(schema.getNodeTypeJSON("Person").properties.alive).toBeDefined();
                const mapping = schema.testAccessSchemaMappings();
                expect(mapping.size).toEqual(1);
            });
            test("CU_RT", () => {
                schema.SMO_addRelationshipType("KNOWS2", "person", "person", { since: "date" });
                schema.SMO_unionRelationshipTypes({ newType: "INTERACTS", legacyTypes: ["KNOWS", "KNOWS2"], writeDefault: "KNOWS" });
                schema2.SMO_addRelationshipType("KNOWS", "person", "person", { until: "string" });
                bidirectionalSync(doc, doc2);

                expect(schema.getRelationshipTypeJSON("INTERACTS")).toBeDefined();
                expect(schema.getRelationshipTypeJSON("KNOWS").properties.until).toBeDefined();
                const mapping = schema.testAccessSchemaMappings();
                expect(mapping.get("INTERACTS")).toBeDefined();
                expect(mapping.get("INTERACTS").kind).toEqual("unionRT");
            });
            test("CU_L", () => {
                schema.SMO_unionLabels({ oldLabel1: "resident", oldLabel2: "citizen", newLabel: "tenant" });
                schema2.SMO_createLabel("resident");
                bidirectionalSync(doc, doc2);
                expect(schema.testAccessAllLabels().has("tenant")).toBeTruthy();
                expect(schema.testAccessAllLabels().has("resident")).toBeTruthy();
                expect(schema.testAccessAllLabels().has("citizen")).toBeFalsy();
            });
            test("CUDep_NTL", () => {
                bidirectionalSync(doc, doc2);
                schema.SMO_unionLabels({ oldLabel1: "resident", oldLabel2: "citizen", newLabel: "tenant" });
                schema2.SMO_addNodeType("TEST", ["citizen", "tenant"], { name: "string", address: "string" });

                bidirectionalSync(doc, doc2);

                expect(schema.getNodeTypeJSON("TEST")).toBeDefined();
                expect(schema.getNodeTypeJSON("TEST").labels).toEqual({tenant: "tenant" });
                expect(schema.getNodeTypeJSON("TEST")).toEqual(schema2.getNodeTypeJSON("TEST"));
            });
            test("CUDep_RTL", () => {
                bidirectionalSync(doc, doc2);
                schema.SMO_unionLabels({ oldLabel1: "resident", oldLabel2: "citizen", newLabel: "tenant" });
                schema2.SMO_addRelationshipType("TEST", "resident", "citizen", { name: "string", address: "string" });

                bidirectionalSync(doc, doc2);

                expect(schema.getRelationshipTypeJSON("TEST")).toBeDefined();
                expect(schema.getRelationshipTypeJSON("TEST").sourceNodeLabel).toEqual("tenant");
                expect(schema.getRelationshipTypeJSON("TEST").targetNodeLabel).toEqual("tenant");
            });
        });
    });
    describe("Drop Row", () => {
        describe("DROP - DROP", () => {
            test("DD_I", () => {
                bidirectionalSync(doc, doc2);
                schema.SMO_dropNodeType("Message");
                schema2.SMO_dropNodeType("Message");
                bidirectionalSync(doc, doc2);
                expect(() => schema.getNodeTypeJSON("Message")).toThrow(SchemaError);
                expect(schema2.transformToJSONFullSchema()).toEqual(schema.transformToJSONFullSchema());

                // RT
                bidirectionalSync(doc, doc2);
                schema.SMO_dropRelationshipType("KNOWS");
                schema2.SMO_dropRelationshipType("KNOWS");
                bidirectionalSync(doc, doc2);
                expect(schema.transformToJSONFullSchema().relationshipTypes.KNOWS).toBeUndefined();
                expect(schema2.transformToJSONFullSchema()).toEqual(schema.transformToJSONFullSchema());

                // L
                schema.SMO_dropLabel("resident");
                schema2.SMO_dropLabel("resident");
                bidirectionalSync(doc, doc2);
                expect(schema.testAccessAllLabels().has("resident")).toBeFalsy();
                expect(schema2.transformToJSONFullSchema()).toEqual(schema.transformToJSONFullSchema());

            });
        });
        // 3 conflicts
        describe("DROP - RENAME", () => {
            test("DR_L", () => {
                bidirectionalSync(doc, doc2);
                schema.SMO_dropLabel("citizen");
                schema2.SMO_renameLabel("citizen", "citizen_old");
                bidirectionalSync(doc, doc2);
                expect(schema.testAccessAllLabels().has("citizen")).toBeFalsy();
                expect(schema.testAccessAllLabels().has("citizen_old")).toBeTruthy();

                const doc3 = getDoc(0);
                const schema3 = new Schema_v1(undefined, doc3);
                
                trialSync(doc3, doc, doc2);
                schema3.SMO_dropLabel("person");
                schema2.SMO_renameLabel("person", "person_old");
                bidirectionalSync(doc3, doc2);
                expect(schema3.testAccessAllLabels().has("person")).toBeFalsy();
                expect(schema3.testAccessAllLabels().has("person_old")).toBeTruthy();
            });
            test("DR_NT", () => {
                bidirectionalSync(doc, doc2);
                schema.SMO_dropNodeType("Message");
                schema2.SMO_renamePropertyKey({ Idenifying: "Message", oldPropertyKey: "mood", newPropertyKey: "feeling", whatType: "NodeType" });
                bidirectionalSync(doc, doc2);
                expect(() => schema.getNodeTypeJSON("Message")).toThrow(SchemaError);
            });
            test("DR_RT", () => {
                bidirectionalSync(doc, doc2);
                schema.SMO_dropRelationshipType("KNOWS");
                schema2.SMO_renamePropertyKey({ Idenifying: "KNOWS", oldPropertyKey: "since", newPropertyKey: "after", whatType: "RelationshipType" });
                bidirectionalSync(doc, doc2);
                expect(() => schema.getRelationshipTypeJSON("KNOWS")).toThrow(SchemaError); 
            });
        })
        describe("DROP - CHANGE", () => {
            test("DCH_L - Drop Label vs Change Property Concurrent", () => {
                bidirectionalSync(doc, doc2);
                schema.SMO_dropLabel("note");

                const tags2 = schema2.getPropertyTypeTags("Message", "mood", "NodeType");
                schema2.SMO_ChangePropertyType({ Idenifying: "Message", propertyKey: "mood", oldTags: tags2, newPropertyType: "string", defaultVal: { default: "0" }, whatType: "NodeType" });

                bidirectionalSync(doc, doc2);
                expect(schema.testAccessAllLabels().has("note")).toBeFalsy();
                expect(schema.transformToJSONFullSchema()).toEqual(schema2.transformToJSONFullSchema());
            });
            test("DCH_NT - Drop NodeType vs AddProperty on same NT Concurrent", () => {
                bidirectionalSync(doc, doc2);
                schema.SMO_dropNodeType("Message");
                schema2.SMO_AddPropertyType({ Idenifying: "Message", newProperty: { key: "priority", value: "number" }, whatType: "NodeType" });
                bidirectionalSync(doc, doc2);
                // observe-remove: convergence check
                expect(schema.transformToJSONFullSchema()).toEqual(schema2.transformToJSONFullSchema());
            });
            test("DCH_RT - Drop RelationshipType vs AddProperty on same RT Concurrent", () => {
                bidirectionalSync(doc, doc2);
                schema.SMO_dropRelationshipType("KNOWS");
                schema2.SMO_AddPropertyType({ Idenifying: "KNOWS", newProperty: { key: "strength", value: "number" }, whatType: "RelationshipType" });
                bidirectionalSync(doc, doc2);
                expect(schema.transformToJSONFullSchema()).toEqual(schema2.transformToJSONFullSchema());
            });
            test("DCH_NT_RemP - Drop NodeType vs DropProperty on same NT Concurrent", () => {
                bidirectionalSync(doc, doc2);
                schema.SMO_dropNodeType("Message");
                schema2.SMO_DropPropertyType({ Idenifying: "Message", propertyKey: "mood", whatType: "NodeType" });
                bidirectionalSync(doc, doc2);
                expect(() => schema.getNodeTypeJSON("Message")).toThrow(SchemaError);
                expect(schema.transformToJSONFullSchema()).toEqual(schema2.transformToJSONFullSchema());
            });
            test("DCH_NT_Retype - Drop NodeType vs RetypeProperty on same NT Concurrent", () => {
                bidirectionalSync(doc, doc2);
                const tags2 = schema2.getPropertyTypeTags("Message", "mood", "NodeType");
                schema.SMO_dropNodeType("Message");
                schema2.SMO_ChangePropertyType({ Idenifying: "Message", propertyKey: "mood", oldTags: tags2, newPropertyType: "number", defaultVal: { default: "0" }, whatType: "NodeType" });
                expect(() => schema.getNodeTypeJSON("Message")).toThrow(SchemaError);
                bidirectionalSync(doc, doc2);
                expect(schema.transformToJSONFullSchema()).toEqual(schema2.transformToJSONFullSchema());
            });
            test("DCH_NT_AddL - Drop NodeType vs AddLabel on same NT Concurrent", () => {
                bidirectionalSync(doc, doc2);
                schema.SMO_dropNodeType("Message");
                schema2.SMO_AddLabelToNodeType("Message", "citizen");
                bidirectionalSync(doc, doc2);
                expect(() => schema.getNodeTypeJSON("Message")).toThrow(SchemaError);
                expect(schema.transformToJSONFullSchema()).toEqual(schema2.transformToJSONFullSchema());
            });
            test("DCH_NT_RemL - Drop NodeType vs RemoveLabel on same NT Concurrent", () => {
                bidirectionalSync(doc, doc2);
                schema.SMO_dropNodeType("Message");
                schema2.SMO_RemoveLabelFromNodeType("Message", "note");
                bidirectionalSync(doc, doc2);
                expect(() => schema.getNodeTypeJSON("Message")).toThrow(SchemaError);
                expect(schema.transformToJSONFullSchema()).toEqual(schema2.transformToJSONFullSchema());
            });
            test("Dep_DCh_NTL - Drop Label vs Add same Label to NodeType Concurrent", () => {
                bidirectionalSync(doc, doc2);
                schema.SMO_dropLabel("citizen");
                schema2.SMO_AddLabelToNodeType("Message", "citizen");
                bidirectionalSync(doc, doc2);
                // Drop wins via cascading deletion: the label addition is undone
                expect(schema.testAccessAllLabels().has("citizen")).toBeFalsy();
                const msgLabels = schema.getNodeTypeJSON("Message").labels;
                expect(msgLabels.citizen).toBeUndefined();
                expect(schema.transformToJSONFullSchema()).toEqual(schema2.transformToJSONFullSchema());
            });
        })
        // 5 conflicts
        describe("DROP - SPLIT", () => {
            test("DS_NT", () => {
                bidirectionalSync(doc, doc2);
                schema.SMO_dropNodeType("Person");
                schema2.SMO_splitNodeType({
                    legacyType: "Person",
                    splitProperty: "mood",
                    mapping: {
                        "HappyPerson": "HappyPerson",
                        "SadPerson": "SadPerson"
                    },
                    defaultType: "SadPerson"
                });
                bidirectionalSync(doc, doc2);
                expect(() => schema.getNodeTypeJSON("Person")).toThrow(SchemaError);
                // the mapping is still there but that is okay :D because the underlyign type is gone
                expect(schema.testAccessSchemaMappings().get("Person")).toBeDefined();    
                // with a type readd the mapping will be cleared
                schema.SMO_addNodeType("Person", ["resident"], { firstName: "string", lastName: "string", mood: "string" });
                expect(schema.testAccessSchemaMappings().get("Person")).toBeUndefined();
                expect(schema.getNodeTypeJSON("HappyPerson")).toBeDefined();
                bidirectionalSync(doc, doc2);
                schema2.SMO_splitNodeType({
                    legacyType: "Person",
                    splitProperty: "mood",
                    mapping: {
                        "HappyPerson": "HappyPerson",
                        "SadPerson": "SadPerson"
                    },
                    defaultType: "SadPerson"
                });
                schema2.SMO_dropNodeType("HappyPerson");
            });
            test("DS_RT", () => {
                bidirectionalSync(doc, doc2);
                schema.SMO_dropRelationshipType("HAS_CREATOR");
                schema2.SMO_splitRelationshipType({
                    legacyType: "HAS_CREATOR",
                    newType1: "HAS_CREATOR1",
                    newType2: "HAS_CREATOR2",
                });
                bidirectionalSync(doc, doc2);
                expect(() => schema.getRelationshipTypeJSON("HAS_CREATOR")).toThrow(SchemaError);
                expect(schema.getRelationshipTypeJSON("HAS_CREATOR1")).toBeDefined();
                expect(schema.getRelationshipTypeJSON("HAS_CREATOR2")).toBeDefined();
                expect(schema.testAccessSchemaMappings().get("HAS_CREATOR")).toBeDefined();

                // with a type readd the mapping will be cleared
                schema.SMO_addRelationshipType("HAS_CREATOR", "message", "resident", { username: "string" });
                expect(schema.testAccessSchemaMappings().get("HAS_CREATOR")).toBeUndefined();
            });
            test("DS_L", () => {
                bidirectionalSync(doc, doc2);
                console.log("Before Drop and Split");
                schema.SMO_dropLabel("resident");
                schema2.SMO_splitLabel({ oldName: "resident", newName1: "resident1", newName2: "resident2" });

                bidirectionalSync(doc, doc2);

                expect(schema.testAccessAllLabels().has("resident")).toBeFalsy();
                expect(schema.testAccessAllLabels().has("resident1")).toBeTruthy();
                expect(schema.testAccessAllLabels().has("resident2")).toBeTruthy();

                expect(schema.getNodeTypeJSON("Person").labels).toEqual({ person: "person", citizen: "citizen" });
                expect(schema.getRelationshipTypeJSON("HAS_CREATOR").sourceNodeLabel).toEqual("message");
                expect(schema.getRelationshipTypeJSON("HAS_CREATOR").targetNodeLabel).toEqual("resident1");
            });
            test("DSDep_NTL", () => {
                bidirectionalSync(doc, doc2);
                schema.SMO_dropLabel("resident");
                schema2.SMO_splitNodeType({
                    legacyType: "Person",
                    splitProperty: "mood",
                    mapping: {
                        "HappyPerson": "HappyPerson",
                        "SadPerson": "SadPerson"
                    },
                    defaultType: "SadPerson"
                });

                bidirectionalSync(doc, doc2);

                expect(schema.testAccessAllLabels().has("resident")).toBeFalsy();
                const happyPerson = schema.getNodeTypeJSON("HappyPerson");
                const sadPerson = schema.getNodeTypeJSON("SadPerson");
                expect(happyPerson).toBeDefined();
                expect(sadPerson).toBeDefined();
                expect(sadPerson.labels).toEqual({ person: "person", citizen: "citizen" });
                expect(happyPerson.labels).toEqual({ person: "person", citizen: "citizen" });
            });
            test("DSDep_RTL", () => {
                bidirectionalSync(doc, doc2);
                schema.SMO_dropLabel("resident");
                schema2.SMO_splitRelationshipType({
                    legacyType: "HAS_CREATOR",
                    newType1: "HAS_CREATOR1",
                    newType2: "HAS_CREATOR2",
                });

                bidirectionalSync(doc, doc2);

                expect(() => schema.getRelationshipTypeJSON("HAS_CREATOR")).toThrow(SchemaError);
                expect(() => schema.getRelationshipTypeJSON("HAS_CREATOR1")).toThrow(SchemaError);
                expect(() => schema.getRelationshipTypeJSON("HAS_CREATOR2")).toThrow(SchemaError);

                expect(schema.testAccessAllLabels().has("resident")).toBeFalsy();
            });
        });
        describe("DROP - JOIN", () => {
            test("DJ_NT", () => {
                bidirectionalSync(doc, doc2);
                schema.SMO_dropNodeType("Person");
                schema2.SMO_unionNodeTypes({
                    newType: "PersonMessage",
                    legacyTypes: ["Person", "Message"],
                    writeDefault: "Person"
                });

                bidirectionalSync(doc, doc2);
                expect(() => schema.getNodeTypeJSON("Person")).toThrow(SchemaError);
                // the mapping is still there but that is okay :D because the underlyign type is gone
                expect(schema.testAccessSchemaMappings().get("PersonMessage")).toBeDefined();    
                // with a type readd the mapping will be cleared
                schema.SMO_addNodeType("Person", ["resident"], { firstName: "string", lastName: "string", mood: "string" });
                expect(schema.testAccessSchemaMappings().get("PersonMessage")).toBeUndefined();
            });
            test("DJ_RT", () => {
                schema.SMO_addRelationshipType("KNOWS2", "person", "person", { since: "date" });
                bidirectionalSync(doc, doc2);
                schema.SMO_dropRelationshipType("KNOWS");
                schema2.SMO_unionRelationshipTypes({
                    newType: "ALL_RELATIONS",
                    legacyTypes: ["KNOWS", "KNOWS2"],
                    writeDefault: "KNOWS"
                });
                bidirectionalSync(doc, doc2);
                expect(() => schema.getRelationshipTypeJSON("KNOWS")).toThrow(SchemaError);

                expect(schema.testAccessSchemaMappings().get("ALL_RELATIONS")).toBeDefined();
                expect(schema.getRelationshipTypeJSON("ALL_RELATIONS")).toBeDefined();

                schema.SMO_addRelationshipType("KNOWS", "person", "person", { since: "string" });
                expect(schema.testAccessSchemaMappings().get("ALL_RELATIONS")).toBeUndefined();
            });
            test("DJ_L", () => {
                bidirectionalSync(doc, doc2);
                schema.SMO_dropLabel("resident");
                schema2.SMO_unionLabels({ oldLabel1: "resident", oldLabel2: "citizen", newLabel: "tenant" });

                bidirectionalSync(doc, doc2);

                // The dropped label is removed; the join target persists
                expect(schema.testAccessAllLabels().has("resident")).toBeFalsy();
                expect(schema.testAccessAllLabels().has("tenant")).toBeTruthy();
            });
            test("DJDep_NTL", () => {
                bidirectionalSync(doc, doc2);
                schema.SMO_dropLabel("resident");
                schema2.SMO_unionNodeTypes({
                    newType: "PersonMessage",
                    legacyTypes: ["Person", "Message"],
                    writeDefault: "Person"
                });

                bidirectionalSync(doc, doc2);

                // The dropped label is removed from all types via cascading
                expect(schema.testAccessAllLabels().has("resident")).toBeFalsy();
                const joined = schema.getNodeTypeJSON("PersonMessage");
                expect(joined).toBeDefined();
                // The joined type should NOT contain the dropped label "resident"
                expect(joined.labels.resident).toBeUndefined();
            });
            test("DJDep_RTL", () => {
                schema.SMO_addRelationshipType("KNOWS2", "person", "person", { since: "date" });
                bidirectionalSync(doc, doc2);
                schema.SMO_dropLabel("resident");
                schema2.SMO_unionRelationshipTypes({
                    newType: "ALL_RELATIONS",
                    legacyTypes: ["KNOWS2", "KNOWS"],
                    writeDefault: "KNOWS2"
                });

                bidirectionalSync(doc, doc2);

                expect(schema.testAccessAllLabels().has("resident")).toBeFalsy();
                // The joined RT used "resident" as targetNodeLabel from HAS_CREATOR;
                // after cascading drop, the endpoint reference is invalidated
                expect(schema.testAccessSchemaMappings().get("ALL_RELATIONS")).toBeDefined();
            });
        });
        // 2 conflicts
        describe("RENAME - RENAME", () => {
            test("RR_L", () => {
                bidirectionalSync(doc, doc2);
                schema.SMO_renameLabel("note", "memo");
                schema2.SMO_renameLabel("note", "messageDoc");
                bidirectionalSync(doc, doc2);
                const labels = schema.transformToJSONFullSchema().nodeTypes.Message.labels;
                expect(labels.note).toBeUndefined();
                expect(labels.messageDoc).toBeDefined();
            });
            test("RR_PropKey", () => {
                // NodeType
                bidirectionalSync(doc, doc2);
                schema.SMO_renamePropertyKey({ Idenifying: "Person", oldPropertyKey: "lastName", newPropertyKey: "familyName", whatType: "NodeType" });
                schema2.SMO_renamePropertyKey({ Idenifying: "Person", oldPropertyKey: "lastName", newPropertyKey: "surname", whatType: "NodeType" });
                bidirectionalSync(doc, doc2);
                const props = schema.getNodeTypeJSON("Person").properties
                expect(["surname"]).toContain(props.lastName.name);

                // RelationshipType
                bidirectionalSync(doc, doc2);
                schema.SMO_renamePropertyKey({ Idenifying: "KNOWS", oldPropertyKey: "since", newPropertyKey: "seit", whatType: "RelationshipType" });
                schema2.SMO_renamePropertyKey({ Idenifying: "KNOWS", oldPropertyKey: "since", newPropertyKey: "startDate", whatType: "RelationshipType" });
                bidirectionalSync(doc, doc2);
                const propsR = schema.transformToJSONFullSchema().relationshipTypes.KNOWS.properties;
                expect(["seit", "startDate"]).toContain(propsR.since.name);
            });
        });
        // 5 conflicts
        describe("RENAME - CHANGE", () => {
            test("RCH_AL", () => {
                bidirectionalSync(doc, doc2);
                schema.SMO_renameLabel("note", "NewNote");
                schema2.SMO_AddLabelToNodeType("Message", "note");

                bidirectionalSync(doc, doc2);
                const labels = schema.getNodeTypeJSON("Message").labels;
                console.log("Labels after RCH_AL", labels);
                expect(labels).toEqual({ NewNote: 'NewNote', message: 'message' });
            });
            test("RCH_APK", () => {
                bidirectionalSync(doc, doc2);
                schema.SMO_AddPropertyType({ Idenifying: "Person", newProperty: { key: "age", value: "number" }, whatType: "NodeType" });
                schema.SMO_renamePropertyKey({ Idenifying: "Person", oldPropertyKey: "age", newPropertyKey: "AGE", whatType: "NodeType" });
                schema2.SMO_AddPropertyType({ Idenifying: "Person", newProperty: { key: "age", value: "string" }, whatType: "NodeType" });

                bidirectionalSync(doc, doc2);
                // this is resolved via ClientId -> the higher clientId wins -> the property is renamed to AGE
                expect(schema.getNodeTypeJSON("Person").properties.age.name).toEqual("age");
            });
            test("RCH_RL", () => {
                bidirectionalSync(doc, doc2);
                schema.SMO_renameLabel("note", "memo");
                schema2.SMO_dropLabel("note");

                bidirectionalSync(doc, doc2);
                const labels = schema.getNodeTypeJSON("Message").labels;
                expect(labels).toEqual({ message: 'message' });
            });
            test("RCH_RPK", () => {
                bidirectionalSync(doc, doc2);
                schema.SMO_renamePropertyKey({ Idenifying: "note", oldPropertyKey: "since", newPropertyKey: "startDate", whatType: "NodeType" });
                schema2.SMO_DropPropertyType({ Idenifying: "Message", propertyKey: "since", whatType: "NodeType" });

                bidirectionalSync(doc, doc2);
                expect(schema.getNodeTypeJSON("Message").properties.since).toBeUndefined();
            });
            test("RCH_RTPK - Rename propKey on RT concurrent with retype of same prop", () => {
                bidirectionalSync(doc, doc2);
                schema.SMO_renamePropertyKey({ Idenifying: "KNOWS", oldPropertyKey: "since", newPropertyKey: "startDate", whatType: "RelationshipType" });
                schema2.SMO_ChangePropertyType(
                    { 
                        Idenifying: "KNOWS",
                        propertyKey: "since",
                        newPropertyType: "number",
                        defaultVal: { default: 0 },
                        whatType: "RelationshipType"
                    }    
                );
                bidirectionalSync(doc, doc2);
                // Both operations target the same underlying property via immutable key
                expect(schema.transformToJSONFullSchema()).toEqual(schema2.transformToJSONFullSchema());
            });
        });
        describe("RENAME - SPLIT", () => {
            test("RS_L - Rename label concurrent with split of same label", () => {
                bidirectionalSync(doc, doc2);
                schema.SMO_renameLabel("resident", "inhabitant");
                schema2.SMO_splitLabel({ oldName: "resident", newName1: "resident_a", newName2: "resident_b" });
                bidirectionalSync(doc, doc2);

                const personLabels = schema.getNodeTypeJSON("Person").labels;
                // split should produce new label names; rename may or may not affect the split targets
                expect(personLabels.resident).toBeUndefined();
                expect(schema.transformToJSONFullSchema()).toEqual(schema2.transformToJSONFullSchema());
            });
            test("RS_NT - Rename propKey concurrent with split of node type", () => {
                bidirectionalSync(doc, doc2);
                schema.SMO_renamePropertyKey({ Idenifying: "Person", oldPropertyKey: "firstName", newPropertyKey: "givenName", whatType: "NodeType" });
                schema2.SMO_splitNodeType({
                    legacyType: "Person",
                    splitProperty: "role",
                    mapping: { "Employee": "Employee", "Customer": "Customer" },
                    defaultType: "Customer"
                });
                bidirectionalSync(doc, doc2);

                const mapping = schema.testAccessSchemaMappings();
                expect(mapping.get("Person")).toBeDefined();
                expect(schema.transformToJSONFullSchema()).toEqual(schema2.transformToJSONFullSchema());
            });
            test("RS_RT - Rename propKey on RT concurrent with split of RT", () => {
                bidirectionalSync(doc, doc2);
                schema.SMO_renamePropertyKey({ Idenifying: "KNOWS", oldPropertyKey: "since", newPropertyKey: "sinceDate", whatType: "RelationshipType" });
                schema2.SMO_splitRelationshipType({ legacyType: "KNOWS", newType1: "KNOWS_WELL", newType2: "KNOWS_BARELY" });
                bidirectionalSync(doc, doc2);

                const mapping = schema.testAccessSchemaMappings();
                expect(mapping.get("KNOWS")).toBeDefined();
                expect(schema.transformToJSONFullSchema()).toEqual(schema2.transformToJSONFullSchema());
            });
            test("RSDep_NTL - Rename label concurrent with split of node type", () => {
                bidirectionalSync(doc, doc2);
                schema.SMO_renameLabel("resident", "inhabitant");
                schema2.SMO_splitNodeType({
                    legacyType: "Person",
                    splitProperty: "role",
                    mapping: { "Employee": "Employee", "Customer": "Customer" },
                    defaultType: "Customer"
                });
                bidirectionalSync(doc, doc2);
                const mapping = schema.testAccessSchemaMappings();
                expect(mapping.get("Person")).toBeDefined();
                expect(schema.transformToJSONFullSchema()).toEqual(schema2.transformToJSONFullSchema());

                // verify renamed label cascades to both split target types
                expect(schema.getNodeTypeJSON("Employee").labels).toEqual({ inhabitant: "inhabitant", person: "person", citizen: "citizen" });
                expect(schema.getNodeTypeJSON("Customer").labels).toEqual({ inhabitant: "inhabitant", person: "person", citizen: "citizen" });
            });
            test("RSDep_RTL - Rename label concurrent with split of relationship type", () => {
                bidirectionalSync(doc, doc2);
                schema.SMO_renameLabel("person", "inhabitant");
                schema2.SMO_splitRelationshipType({ legacyType: "KNOWS", newType1: "KNOWS_WELL", newType2: "KNOWS_BARELY" });
                bidirectionalSync(doc, doc2);
                expect(schema.getRelationshipTypeJSON("KNOWS_WELL").sourceNodeLabel).toEqual("inhabitant");
                expect(schema.getRelationshipTypeJSON("KNOWS_WELL").targetNodeLabel).toEqual("inhabitant");
                expect(schema.transformToJSONFullSchema()).toEqual(schema2.transformToJSONFullSchema()); 
            });
        });
        describe("RENAME - JOIN", () => {
            test("RJ_L - Rename label concurrent with union involving same label", () => {
                bidirectionalSync(doc, doc2);
                schema.SMO_renameLabel("resident", "inhabitant");
                schema2.SMO_unionLabels({ oldLabel1: "resident", oldLabel2: "citizen", newLabel: "tenant" });
                bidirectionalSync(doc, doc2);

                const personLabels = schema.getNodeTypeJSON("Person").labels;
                expect(personLabels.resident).toBeUndefined();
                expect(personLabels.citizen).toBeUndefined();
                expect(schema.transformToJSONFullSchema()).toEqual(schema2.transformToJSONFullSchema());
            });
            test("RJ_NT - Rename propKey concurrent with union of node types", () => {
                bidirectionalSync(doc, doc2);
                schema.SMO_renamePropertyKey({ Idenifying: "Person", oldPropertyKey: "lastName", newPropertyKey: "surname", whatType: "NodeType" });
                schema2.SMO_unionNodeTypes({ newType: "PersonMessage", legacyTypes: ["Person", "Message"], writeDefault: "Person" });
                bidirectionalSync(doc, doc2);

                expect(schema.getNodeTypeJSON("PersonMessage")).toBeDefined();
                expect(schema.transformToJSONFullSchema()).toEqual(schema2.transformToJSONFullSchema());
            });
            test("RJ_RT - Rename propKey on RT concurrent with union of RTs", () => {
                schema.SMO_addRelationshipType("KNOWS2", "person", "person", { since: "date" });
                bidirectionalSync(doc, doc2);
                schema.SMO_renamePropertyKey({ Idenifying: "KNOWS", oldPropertyKey: "since", newPropertyKey: "sinceDate", whatType: "RelationshipType" });
                schema2.SMO_unionRelationshipTypes({ newType: "INTERACTS", legacyTypes: ["KNOWS", "KNOWS2"], writeDefault: "KNOWS" });
                bidirectionalSync(doc, doc2);

                expect(schema.getRelationshipTypeJSON("INTERACTS")).toBeDefined();
                expect(schema.transformToJSONFullSchema()).toEqual(schema2.transformToJSONFullSchema());
            });
        });
        describe("CHANGE - CHANGE", () => {
            test("Add Property to NodeType Concurrent", () => {
                schema.SMO_addRelationshipType("KNOWS2", "person", "person", { since: "date" });
                bidirectionalSync(doc, doc2);
                schema.SMO_AddPropertyType({ Idenifying: "Person", newProperty: { key: "age", value: "number" }, whatType: "NodeType" });
                schema2.SMO_AddPropertyType({ Idenifying: "Person", newProperty: { key: "age", value: "string" }, whatType: "NodeType" });
                schema2.SMO_AddPropertyType({ Idenifying: "Person", newProperty: { key: "city", value: "string" }, whatType: "NodeType" });
                bidirectionalSync(doc, doc2);
                const props = schema.transformToJSONFullSchema().nodeTypes.Person.properties;
                expect(props.age).toBeDefined();
                console.log("Props after concurrent add:", props);
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
        describe("CHANGE - SPLIT", () => {
            test("CHS_NT_AddProp - Add property concurrent with split of same node type", () => {
                bidirectionalSync(doc, doc2);
                schema.SMO_AddPropertyType({ Idenifying: "Person", newProperty: { key: "age", value: "number" }, whatType: "NodeType" });
                schema2.SMO_splitNodeType({
                    legacyType: "Person",
                    splitProperty: "role",
                    mapping: { "Employee": "Employee", "Customer": "Customer" },
                    defaultType: "Customer"
                });
                bidirectionalSync(doc, doc2);

                const mapping = schema.testAccessSchemaMappings();
                expect(mapping.get("Person")).toBeDefined();
                // The new property should exist on the legacy type (which feeds into the split targets via LensEngine)
                expect(schema.transformToJSONFullSchema()).toEqual(schema2.transformToJSONFullSchema());
            });
            test("CHS_NT_DropProp - Drop property concurrent with split of same node type", () => {
                bidirectionalSync(doc, doc2);
                schema.SMO_DropPropertyType({ Idenifying: "Person", propertyKey: "firstName", whatType: "NodeType" });
                schema2.SMO_splitNodeType({
                    legacyType: "Person",
                    splitProperty: "role",
                    mapping: { "Employee": "Employee", "Customer": "Customer" },
                    defaultType: "Customer"
                });
                bidirectionalSync(doc, doc2);

                const mapping = schema.testAccessSchemaMappings();
                expect(mapping.get("Person")).toBeDefined();
                expect(schema.transformToJSONFullSchema()).toEqual(schema2.transformToJSONFullSchema());
            });
            test("CHS_NT_Retype - Retype property concurrent with split of same node type", () => {
                bidirectionalSync(doc, doc2);
                const tags = schema.getPropertyTypeTags("Person", "firstName", "NodeType");
                schema.SMO_ChangePropertyType({ Idenifying: "Person", propertyKey: "firstName", oldTags: tags, newPropertyType: "number", defaultVal: { default: 0 }, whatType: "NodeType" });
                schema2.SMO_splitNodeType({
                    legacyType: "Person",
                    splitProperty: "role",
                    mapping: { "Employee": "Employee", "Customer": "Customer" },
                    defaultType: "Customer"
                });
                bidirectionalSync(doc, doc2);

                const mapping = schema.testAccessSchemaMappings();
                expect(mapping.get("Person")).toBeDefined();
                expect(schema.transformToJSONFullSchema()).toEqual(schema2.transformToJSONFullSchema());
            });
            test("CHS_RT - Add property concurrent with split of relationship type", () => {
                bidirectionalSync(doc, doc2);
                schema.SMO_AddPropertyType({ Idenifying: "KNOWS", newProperty: { key: "strength", value: "number" }, whatType: "RelationshipType" });
                schema2.SMO_splitRelationshipType({ legacyType: "KNOWS", newType1: "KNOWS_WELL", newType2: "KNOWS_BARELY" });
                bidirectionalSync(doc, doc2);

                const mapping = schema.testAccessSchemaMappings();
                expect(mapping.get("KNOWS")).toBeDefined();
                expect(mapping.get("KNOWS").kind).toEqual("splitRT");
                expect(schema.transformToJSONFullSchema()).toEqual(schema2.transformToJSONFullSchema());
            });
            test("CHS_L - Add label to NT concurrent with split of that label", () => {
                bidirectionalSync(doc, doc2);
                schema.SMO_AddLabelToNodeType("Message", "resident");
                schema2.SMO_splitLabel({ oldName: "resident", newName1: "resident_a", newName2: "resident_b" });
                bidirectionalSync(doc, doc2);

                const messageLabels = schema.getNodeTypeJSON("Message").labels;
                // The added label should now be split into two
                expect(messageLabels.resident).toBeUndefined();
                expect(schema.transformToJSONFullSchema()).toEqual(schema2.transformToJSONFullSchema());
            });
        });
        describe("CHANGE - UNION", () => {
            test("CHU_NT_AddProp - Add property concurrent with union of node types", () => {
                bidirectionalSync(doc, doc2);
                schema.SMO_AddPropertyType({ Idenifying: "Person", newProperty: { key: "age", value: "number" }, whatType: "NodeType" });
                schema2.SMO_unionNodeTypes({ newType: "PersonMessage", legacyTypes: ["Person", "Message"], writeDefault: "Person" });
                bidirectionalSync(doc, doc2);

                expect(schema.getNodeTypeJSON("PersonMessage")).toBeDefined();
                expect(schema.transformToJSONFullSchema()).toEqual(schema2.transformToJSONFullSchema());
            });
            test("CHU_NT_DropProp - Drop property concurrent with union of node types", () => {
                bidirectionalSync(doc, doc2);
                schema.SMO_DropPropertyType({ Idenifying: "Person", propertyKey: "firstName", whatType: "NodeType" });
                schema2.SMO_unionNodeTypes({ newType: "PersonMessage", legacyTypes: ["Person", "Message"], writeDefault: "Person" });
                bidirectionalSync(doc, doc2);

                expect(schema.getNodeTypeJSON("PersonMessage")).toBeDefined();
                expect(schema.transformToJSONFullSchema()).toEqual(schema2.transformToJSONFullSchema());
            });
            test("CHU_NT_Retype - Retype property concurrent with union of node types", () => {
                bidirectionalSync(doc, doc2);
                const tags = schema.getPropertyTypeTags("Message", "mood", "NodeType");
                schema.SMO_ChangePropertyType({ Idenifying: "Message", propertyKey: "mood", oldTags: tags, newPropertyType: "number", defaultVal: { default: -1, transformerMap: { "happy": "10", "sad": "0", "default": "-1" } }, whatType: "NodeType" });
                schema2.SMO_unionNodeTypes({ newType: "PersonMessage", legacyTypes: ["Person", "Message"], writeDefault: "Person" });
                bidirectionalSync(doc, doc2);

                expect(schema.getNodeTypeJSON("PersonMessage")).toBeDefined();
                expect(schema.transformToJSONFullSchema()).toEqual(schema2.transformToJSONFullSchema());
            });
            test("CHU_RT - Add property concurrent with union of relationship types", () => {
                schema.SMO_addRelationshipType("KNOWS2", "person", "person", { since: "date" });
                bidirectionalSync(doc, doc2);
                schema.SMO_AddPropertyType({ Idenifying: "KNOWS", newProperty: { key: "strength", value: "number" }, whatType: "RelationshipType" });
                schema2.SMO_unionRelationshipTypes({ newType: "INTERACTS", legacyTypes: ["KNOWS", "KNOWS2"], writeDefault: "KNOWS" });
                bidirectionalSync(doc, doc2);

                expect(schema.getRelationshipTypeJSON("INTERACTS")).toBeDefined();
                const mapping = schema.testAccessSchemaMappings();
                expect(mapping.get("INTERACTS")).toBeDefined();
                expect(mapping.get("INTERACTS").kind).toEqual("unionRT");
                expect(schema.transformToJSONFullSchema()).toEqual(schema2.transformToJSONFullSchema());
            });
            test("CHU_L - Add label to NT concurrent with union involving that label", () => {
                bidirectionalSync(doc, doc2);
                schema.SMO_AddLabelToNodeType("Message", "citizen");
                schema2.SMO_unionLabels({ oldLabel1: "resident", oldLabel2: "citizen", newLabel: "tenant" });
                bidirectionalSync(doc, doc2);

                const messageLabels = schema.getNodeTypeJSON("Message").labels;
                // The added label should now be resolved via the union
                expect(messageLabels.citizen).toBeUndefined();
                expect(messageLabels.tenant).toBeDefined();
                expect(schema.transformToJSONFullSchema()).toEqual(schema2.transformToJSONFullSchema());
            });
        });
        describe("SPLIT - SPLIT", () => {
            test("SS_NT", () => {
                bidirectionalSync(doc, doc2);
                schema.SMO_splitNodeType({
                    legacyType: "Person",
                    splitProperty: "mood",
                    mapping: {
                        "happy": "HappyPerson",
                        "sad": "SadPerson"
                    },
                    defaultType: "SadPerson"
                });
                schema2.SMO_splitNodeType({
                    legacyType: "Person",
                    splitProperty: "mood",
                    mapping: {
                        "happy": "SuperPerson",
                        "sad": "CryPerson"
                    },
                    defaultType: "CryPerson"
                });

                bidirectionalSync(doc, doc2);
                const happyPerson = schema.getNodeTypeJSON("HappyPerson");
                const sadPerson = schema.getNodeTypeJSON("SadPerson");
                const superPerson = schema.getNodeTypeJSON("SuperPerson");
                const cryPerson = schema.getNodeTypeJSON("CryPerson");
                expect(happyPerson).toBeDefined();
                expect(sadPerson).toBeDefined();
                expect(superPerson).toBeDefined();
                expect(cryPerson).toBeDefined();
                const mapping = schema.testAccessSchemaMappings();
                expect(mapping).toBeDefined();
                expect(mapping.size).toBe(1);
                const mappingPerson = mapping.get("Person");
                expect(mappingPerson).toBeDefined();
                expect(mappingPerson.mapping).toEqual({
                    "happy": "SuperPerson",
                    "sad": "CryPerson"
                });
                expect(mappingPerson.defaultType).toEqual("CryPerson");

            });
            test("SS_RT", () => {
                bidirectionalSync(doc, doc2);
                schema.SMO_splitRelationshipType({ legacyType: "KNOWS", newType1: "KNOWS_A", newType2: "KNOWS_B" });
                schema2.SMO_splitRelationshipType({ legacyType: "KNOWS", newType1: "KNOWS_X", newType2: "KNOWS_Y" });
                bidirectionalSync(doc, doc2);

                const mapping = schema.testAccessSchemaMappings();
                expect(mapping.get("KNOWS")).toBeDefined();
                expect(mapping.get("KNOWS").kind).toEqual("splitRT");
                // LWW: one split prevails
                expect(schema.transformToJSONFullSchema()).toEqual(schema2.transformToJSONFullSchema());
            });
            test("SS_L", () => {
                bidirectionalSync(doc, doc2);
                schema.SMO_splitLabel({ oldName: "person", newName1: "person1", newName2: "person2" });
                schema2.SMO_splitLabel({ oldName: "person", newName1: "personA", newName2: "personB" });
                bidirectionalSync(doc, doc2);
                const labels = schema.getNodeTypeJSON("Person").labels;

                // four-way split (add-wins resolution!)
                expect(labels.person2).toBeDefined();
                expect(labels.personA).toBeDefined();
                expect(labels.personB).toBeDefined();
                expect(labels.person1).toBeDefined();
                expect(labels.person).toBeUndefined();
            });
        });
        describe("SPLIT - UNION", () => {
            test("SU_L - Split Label vs Union Label Concurrent", () => {
                bidirectionalSync(doc, doc2);

                schema.SMO_splitLabel({ oldName: "resident", newName1: "resident_a", newName2: "resident_b" });
                schema2.SMO_unionLabels({ oldLabel1: "resident", oldLabel2: "citizen", newLabel: "tenant" });
                bidirectionalSync(doc, doc2);

                const labels = schema.getNodeTypeJSON("Person").labels;
                expect(labels.resident_a).toBeDefined();
                expect(labels.resident_b).toBeDefined();
                expect(labels.tenant).toBeDefined();
                expect(labels.resident).toBeUndefined();
                expect(labels.citizen).toBeUndefined();
            });
            test("SU_NT - Split NT vs Union NT Concurrent", () => {
                bidirectionalSync(doc, doc2);
                schema.SMO_splitNodeType({
                    legacyType: "Person",
                    splitProperty: "role",
                    mapping: { "Employee": "Employee", "Customer": "Customer" },
                    defaultType: "Customer"
                });
                schema2.SMO_unionNodeTypes({ newType: "PersonMessage", legacyTypes: ["Person", "Message"], writeDefault: "Person" });
                bidirectionalSync(doc, doc2);

                const mapping = schema.testAccessSchemaMappings();
                // Both structural rules should coexist after sync
                expect(mapping.size).toBeGreaterThanOrEqual(1);
                expect(schema.transformToJSONFullSchema()).toEqual(schema2.transformToJSONFullSchema());
            });
            test("SU_RT - Split RT vs Union RT Concurrent", () => {
                schema.SMO_addRelationshipType("KNOWS2", "person", "person", { since: "date" });
                bidirectionalSync(doc, doc2);
                schema.SMO_splitRelationshipType({ legacyType: "KNOWS", newType1: "KNOWS_WELL", newType2: "KNOWS_BARELY" });
                schema2.SMO_unionRelationshipTypes({ newType: "INTERACTS", legacyTypes: ["KNOWS", "KNOWS2"], writeDefault: "KNOWS" });
                bidirectionalSync(doc, doc2);

                const mapping = schema.testAccessSchemaMappings();
                expect(mapping.size).toBeGreaterThanOrEqual(1);
                expect(schema.transformToJSONFullSchema()).toEqual(schema2.transformToJSONFullSchema());
            });
        });
        describe("UNION - UNION", () => {
            test("UU_L", () => {

                bidirectionalSync(doc, doc2);
                schema.SMO_unionLabels({ oldLabel1: "resident", oldLabel2: "citizen", newLabel: "tenant" });
                schema2.SMO_unionLabels({ oldLabel1: "resident", oldLabel2: "citizen", newLabel: "inhabitant" });
                bidirectionalSync(doc, doc2);
                const labels = schema.getNodeTypeJSON("Person").labels;
                expect(labels.tenant).toBeDefined();
                expect(labels.inhabitant).toBeDefined();
                expect(labels.resident).toBeUndefined();
                expect(labels.citizen).toBeUndefined();

                // Overlapping Union
                const schema3 = new Schema_v1(bon19SchemaDef, getDoc(3));
                const schema4 = new Schema_v1(undefined, getDoc(4));
                bidirectionalSync(schema3.yjsDoc, schema4.yjsDoc);
                schema3.SMO_unionLabels({ oldLabel1: "note", oldLabel2: "person", newLabel: "entity" });
                schema4.SMO_unionLabels({ oldLabel1: "message", oldLabel2: "person", newLabel: "object" });
                bidirectionalSync(schema3.yjsDoc, schema4.yjsDoc);
                const labels2 = schema3.getNodeTypeJSON("Message").labels;
                expect(labels2.entity).toBeDefined();
                expect(labels2.object).toBeDefined();
                expect(labels2.person).toBeUndefined();
                expect(labels2.note).toBeUndefined();
                expect(labels2.message).toBeUndefined();

                const relationships = schema3.transformToJSONFullSchema().relationshipTypes;
                for (const relType in relationships) {
                    const rel = schema3.getRelationshipTypeJSON(relType);
                    if (rel.targetNodeLabel === "resident") continue;
                    expect(["object", "entity"]).toContain(rel.sourceNodeLabel);
                    expect(["object", "entity"]).toContain(rel.targetNodeLabel);
                }
                const personType = schema3.getNodeTypeJSON("Person");
                const messageType = schema3.getNodeTypeJSON("Message");
                expect(personType.labels).toEqual({ resident: 'resident', citizen: 'citizen', object: 'object', entity: 'entity' });
                expect(messageType.labels).toEqual({ entity: 'entity', object: 'object' });

                expect(schema3.transformToJSONFullSchema()).toEqual(schema4.transformToJSONFullSchema());
            });
            test("UU_NT", () => {
                bidirectionalSync(doc, doc2);
                schema.SMO_unionNodeTypes({
                    newType: "PersonMessage",
                    legacyTypes: ["Person", "Message"], 
                    writeDefault: "Person"
                });
                schema2.SMO_unionNodeTypes({
                    newType: "PersonMessage2",
                    legacyTypes: ["Person", "Message"],
                    writeDefault: "Message"
                });
                bidirectionalSync(doc, doc2);

                expect(schema.getNodeTypeJSON("PersonMessage")).toBeDefined();
                expect(schema.getNodeTypeJSON("PersonMessage2")).toBeDefined();
            });
            test("UU_RT", () => {
                schema.SMO_addRelationshipType("KNOWS2", "person", "person", { since: "date" });
                bidirectionalSync(doc, doc2);

                schema.SMO_unionRelationshipTypes({
                    newType: "INTERACTS",
                    legacyTypes: ["KNOWS", "KNOWS2"],
                    writeDefault: "KNOWS"
                });
                schema2.SMO_unionRelationshipTypes({
                    newType: "CONNECTS",
                    legacyTypes: ["KNOWS", "KNOWS2"],
                    writeDefault: "LIKES"
                });
                bidirectionalSync(doc, doc2);

                const mapping = schema.testAccessSchemaMappings();
                // Both union rules coexist (LWW on overlapping keys)
                expect(mapping.size).toBeGreaterThanOrEqual(1);
                expect(schema.transformToJSONFullSchema()).toEqual(schema2.transformToJSONFullSchema());
            });
        });
    });
});