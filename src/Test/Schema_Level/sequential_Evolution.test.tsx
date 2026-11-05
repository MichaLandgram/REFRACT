import * as Y from 'yjs';
import { bon19SchemaDef } from "../../Helper/Schema/Bon19_Schema";
import { Schema_v1 } from "../../Schema_CRDT/SchemaCRDT";
import { SchemaError } from "../../Helper/ErrorDefinition";
import { getDoc } from "../../Helper/helper";

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
    expect(schema.getNodeTypeJSON('Person').labels).toEqual({ resident: 'resident', citizen: 'citizen', person: 'person' });
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
    expect(schema.getRelationshipTypeJSON('KNOWS').sourceNodeLabel.toLowerCase()).toEqual('person');
    expect(schema.getRelationshipTypeJSON('KNOWS').targetNodeLabel.toLowerCase()).toEqual('person');
    expect(schema.getRelationshipTypeJSON('KNOWS').properties).toEqual(
        { since: { name: 'since', activeTypes: { '1': { value: 'string', default: undefined } } } });
}
const checkHasCreatorRelationshipType = (schema: Schema_v1) => {
    expect(schema.getRelationshipTypeJSON('HAS_CREATOR')).toBeDefined();
    expect(schema.getRelationshipTypeJSON('HAS_CREATOR').sourceNodeLabel.toLowerCase()).toEqual('message');
    expect(schema.getRelationshipTypeJSON('HAS_CREATOR').targetNodeLabel.toLowerCase()).toEqual('resident');
    expect(schema.getRelationshipTypeJSON('HAS_CREATOR').properties).toEqual(
        { username: { name: 'username', activeTypes: { '1': { value: 'string', default: undefined } } } });
}
const checkLikesRelationshipType = (schema: Schema_v1) => {
    expect(schema.getRelationshipTypeJSON('LIKES')).toBeDefined();
    expect(schema.getRelationshipTypeJSON('LIKES').sourceNodeLabel.toLowerCase()).toEqual('person');
    expect(schema.getRelationshipTypeJSON('LIKES').targetNodeLabel.toLowerCase()).toEqual('message');
    expect(schema.getRelationshipTypeJSON('LIKES').properties).toEqual({
        date: { name: 'date', activeTypes: { '1': { value: 'string', default: undefined } } }
    });
}
const checkReplyOfRelationshipType = (schema: Schema_v1) => {
    expect(schema.getRelationshipTypeJSON('REPLY_OF')).toBeDefined();
    expect(schema.getRelationshipTypeJSON('REPLY_OF').sourceNodeLabel.toLowerCase()).toEqual('message');
    expect(schema.getRelationshipTypeJSON('REPLY_OF').targetNodeLabel.toLowerCase()).toEqual('message');
    expect(schema.getRelationshipTypeJSON('REPLY_OF').properties).toEqual(
        { date: { name: 'date', activeTypes: { '1': { value: 'string', default: undefined } } } });
}

describe("Sequential Evolution - basic", () => {
    let schema: Schema_v1;
    let doc: Y.Doc;
    beforeEach(() => {
        doc = getDoc(1);
        schema = new Schema_v1(bon19SchemaDef, doc);
    })
    /* CREATE */
    describe("CREATE_AUTOLOADED", () => {
        test("Autoloading", () => {
            checkPreloadLabels(schema);
            checkPersonNodeType(schema);
            checkMessageNodeType(schema);
            checkKnowsRelationshipType(schema);
            checkHasCreatorRelationshipType(schema);
            checkLikesRelationshipType(schema);
            checkReplyOfRelationshipType(schema);
        });
        // 1
        test("Create Label", () => {
            expect(schema.testAccessAllLabels().has("TestLabel")).toBeFalsy();
            schema.SMO_createLabel("TestLabel");
            const allLabels = schema.testAccessAllLabels();
            expect(allLabels.has("TestLabel")).toBeTruthy();
            expect(allLabels.get("TestLabel")?.size).toBe(1);

            expect(() => schema.SMO_createLabel("TestLabel")).toThrow(SchemaError);
        });
        // 2
        test("Create NodeType", () => {
            schema.SMO_addNodeType("Account", ["acc"], { iban: "string", balance: "number", bankID: "string" });
            expect(schema.getNodeTypeJSON("Account")).toEqual({
                // the '1' here is the corresponding clientId
                labels: { acc: 'acc' },
                properties: {
                    iban: { name: 'iban', activeTypes: { '1': { value: 'string', default: undefined } } },
                    balance: { name: 'balance', activeTypes: { '1': { value: 'number', default: undefined } } },
                    bankID: { name: 'bankID', activeTypes: { '1': { value: 'string', default: undefined } } }
                }
            })

            expect(() => schema.SMO_addNodeType("Account", ["acc"], { iban: "string", balance: "number", bankID: "string" })).toThrow(SchemaError);

        });
        // 3
        test("Create RelationshipType", () => {
            schema.SMO_addRelationshipType("OWNED_BY", "resident", "resident", { since: "string" });
            expect(schema.getRelationshipTypeJSON("OWNED_BY")).toBeDefined();
            expect(schema.getRelationshipTypeJSON("OWNED_BY").sourceNodeLabel.toLowerCase()).toEqual("resident");
            expect(schema.getRelationshipTypeJSON("OWNED_BY").targetNodeLabel.toLowerCase()).toEqual("resident");
            expect(schema.getRelationshipTypeJSON("OWNED_BY").properties).toEqual(
                // the '1' here is the corresponding clientId
                { since: { name: 'since', activeTypes: { '1': { value: 'string', default: undefined } } } });

            expect(() => schema.SMO_addRelationshipType("OWNED_BY", "resident", "resident", { since: "string" })).toThrow(SchemaError);
        });

    });

    describe("DROP", () => {
        // 4
        test("Drop NodeType", () => {
            expect(schema.getNodeTypeJSON("Person")).toBeDefined();
            schema.SMO_dropNodeType("Person");
            expect(() => schema.getNodeTypeJSON("Person")).toThrow(SchemaError);

            expect(() => schema.SMO_dropNodeType("Person")).toThrow(SchemaError);

        });
        // 5
        test("Drop RelationshipType", () => {
            expect(schema.getRelationshipTypeJSON("KNOWS")).toBeDefined();
            schema.SMO_dropRelationshipType("KNOWS");
            expect(() => schema.getRelationshipTypeJSON("KNOWS")).toThrow(SchemaError);

            expect(() => schema.SMO_dropRelationshipType("KNOWS")).toThrow(SchemaError);
        });
        // 6
        test("Drop Label", () => {
            expect(schema.testAccessAllLabels().has("resident")).toBeTruthy();
            expect(schema.testAccessAllLabels().get("resident")?.size).toBe(1);
            expect(schema.getRelationshipTypeJSON('HAS_CREATOR')).toBeDefined();
            schema.SMO_dropLabel("resident");
            expect(schema.testAccessAllLabels().has("resident")).toBeFalsy();
            // label should be removed from the label set it is used in
            expect(schema.getNodeTypeJSON('Person')).toBeDefined();
            expect(schema.getNodeTypeJSON('Person').labels).toEqual({ citizen: 'citizen', person: 'person' });
            // edges that reference the label as source or target should be removed
            expect(() => schema.getRelationshipTypeJSON('HAS_CREATOR')).toThrow(SchemaError);

            expect(() => schema.SMO_dropLabel("resident")).toThrow(SchemaError);
        });
    });

    describe("Rename", () => {
        // 7
        test("Rename Property Key of NodeType", () => {
            schema.SMO_renamePropertyKey({ Idenifying: "Person", oldPropertyKey: "firstName", newPropertyKey: "name", whatType: "NodeType" });
            expect(schema.getNodeTypeJSON("Person").properties).toEqual(
                {
                    firstName: { name: 'name', activeTypes: { '1': { value: 'string', default: undefined } } },
                    lastName: { name: 'lastName', activeTypes: { '1': { value: 'string', default: undefined } } }
                });
        });
        test("Rename Property Key of RelationshipType", () => {
            schema.SMO_renamePropertyKey({ Idenifying: "KNOWS", oldPropertyKey: "since", newPropertyKey: "seit", whatType: "RelationshipType" });
            expect(schema.getRelationshipTypeJSON("KNOWS").properties).toEqual(
                { since: { name: 'seit', activeTypes: { '1': { value: 'string', default: undefined } } } });
        });
        // 8
        test("Rename a NodeType label (citizen to citizen_old)", () => {
            const storeForCompare = new Set(schema.testAccessAllLabels().get("citizen"));
            schema.SMO_renameLabel("citizen", "citizen_old");
            expect(schema.getNodeTypeJSON("Person").labels).toEqual({ resident: 'resident', citizen_old: 'citizen_old', person: 'person' });
            expect(schema.testAccessAllLabels().get("citizen_old")).toEqual(storeForCompare);

            expect(schema.testAccessAllLabels().get("citizen")).toBeUndefined();
        });
        test("Rename a RelationshipType label (the person label to human => all relationships with person as source/target label are renamed)", () => {
            const storeForCompare = new Set(schema.testAccessAllLabels().get("person"));
            schema.SMO_renameLabel("person", "human");

            expect(schema.getRelationshipTypeJSON("KNOWS")).toBeDefined();
            expect(schema.getRelationshipTypeJSON("KNOWS").sourceNodeLabel.toLowerCase()).toEqual("human");
            expect(schema.getRelationshipTypeJSON("KNOWS").targetNodeLabel.toLowerCase()).toEqual("human");
            expect(schema.getRelationshipTypeJSON("LIKES")).toBeDefined();
            expect(schema.getRelationshipTypeJSON("LIKES").sourceNodeLabel.toLowerCase()).toEqual("human");
            expect(schema.getRelationshipTypeJSON("LIKES").targetNodeLabel.toLowerCase()).toEqual("message");

            expect(schema.testAccessAllLabels().get("human")).toEqual(storeForCompare);
            expect(schema.testAccessAllLabels().get("person")).toBeUndefined();
        });
    });

    describe("Change", () => {
        // 9
        test("Add Property to NodeType", () => {
            schema.SMO_AddPropertyType({ Idenifying: "Person", newProperty: { key: "age", value: "number" }, whatType: "NodeType" });
            expect(schema.getNodeTypeJSON("Person").properties).toEqual(
                {
                    firstName: { name: 'firstName', activeTypes: { '1': { value: 'string', default: undefined } } },
                    lastName: { name: 'lastName', activeTypes: { '1': { value: 'string', default: undefined } } },
                    age: { name: 'age', activeTypes: { '1': { value: 'number', default: undefined } } }
                });
        });
        test("Add Property to RelationshipType", () => {
            schema.SMO_AddPropertyType({ Idenifying: "LIKES", newProperty: { key: "since", value: "string" }, whatType: "RelationshipType" });
            expect(schema.getRelationshipTypeJSON("LIKES").properties).toEqual(
                {
                    date: { name: 'date', activeTypes: { '1': { value: 'string', default: undefined } } },
                    since: { name: 'since', activeTypes: { '1': { value: 'string', default: undefined } } }
                });
        });
        // 10
        test("Drop Property from NodeType", () => {
            schema.SMO_DropPropertyType({ Idenifying: "Person", propertyKey: "firstName", whatType: "NodeType" });
            expect(schema.getNodeTypeJSON("Person").properties).toEqual(
                { lastName: { name: 'lastName', activeTypes: { '1': { value: 'string', default: undefined } } } });
        });
        test("Drop Property from RelationshipType", () => {
            schema.SMO_DropPropertyType({ Idenifying: "KNOWS", propertyKey: "since", whatType: "RelationshipType" });
            expect(schema.getRelationshipTypeJSON("KNOWS").properties).toEqual({});
        });
        // 11
        test("Change Property Type of NodeType", () => {
            const tags = schema.getPropertyTypeTags("Message", "mood", "NodeType");
            const transformerMap = {
                "happy": "10",
                "sad": "0",
                "neutral": "5",
                "default": "-1"
            }
            schema.SMO_ChangePropertyType({ Idenifying: "Message", propertyKey: "mood", oldTags: tags, newPropertyType: "number", defaultVal: { default: -1, transformerMap: transformerMap }, whatType: "NodeType" });
            expect(schema.getNodeTypeJSON("Message").properties.mood).toEqual({ name: 'mood', activeTypes: { '1': { value: 'number', default: -1, transformerMap: transformerMap } } });
        });
        test("Change Property Type of RelationshipType", () => {
            schema.SMO_ChangePropertyType({ Idenifying: "KNOWS", propertyKey: "since", newPropertyType: "number", defaultVal: { default: 2000 }, whatType: "RelationshipType" });
            expect(schema.getRelationshipTypeJSON("KNOWS").properties.since).toEqual({ name: 'since', activeTypes: { '1': { value: 'number', default: 2000, transformerMap: {} } } });
        });
        test("Add Label to NodeType", () => {
            schema.SMO_AddLabelToNodeType("Person", "Employee" );
            expect(schema.getNodeTypeJSON("Person").labels).toEqual({"Employee": "Employee", "citizen": "citizen", "person": "person", "resident": "resident"});
        });
        test("Remove Label from NodeType", () => {
            schema.SMO_RemoveLabelFromNodeType("Person", "resident" );
            expect(schema.getNodeTypeJSON("Person").labels).toEqual({ citizen: 'citizen', person: 'person' });
        });
        test.skip("Sequential Cumulative Lens Folding (Change Property Type twice)", () => {
            const transformerMap1 = {
                "happy": "10",
                "sad": "0",
                "default": "-1"
            };
            schema.SMO_ChangePropertyType({
                Idenifying: "Message",
                propertyKey: "mood",
                newPropertyType: "number",
                defaultVal: { default: -1, transformerMap: transformerMap1 },
                whatType: "NodeType"
            });

            const transformerMap2 = {
                "10": "high",
                "0": "low",
                "default": "none"
            };
            schema.SMO_ChangePropertyType({
                Idenifying: "Message",
                propertyKey: "mood",
                newPropertyType: "string",
                defaultVal: { default: "none", transformerMap: transformerMap2 },
                whatType: "NodeType"
            });

            const finalProp = schema.getNodeTypeJSON("Message").properties.mood;
            const clientActive = Object.values(finalProp.activeTypes)[0] as any;
            
            expect(clientActive.value).toBe("string");
            expect(clientActive.transformerMap).toEqual({
                "happy": "high",
                "sad": "low",
                "10": "high",
                "0": "low",
                "default": "none"
            });
        });
    });

    describe("Split", () => {
        // 12
        test("Split Label", () => {
            schema.SMO_splitLabel({ oldName: "person", newName1: "person1", newName2: "person2" });

            // old label does not exsist anymore.
            expect(schema.testAccessAllLabels().has("person")).toBeFalsy();
            // the two new labels exist now
            expect(schema.testAccessAllLabels().has("person1")).toBeTruthy();
            expect(schema.testAccessAllLabels().has("person2")).toBeTruthy();

            // the label was split in the person node type
            expect(schema.getNodeTypeJSON("Person").labels).toEqual({ resident: 'resident', citizen: 'citizen', person1: 'person1', person2: 'person2' });

            // edges that source or target the old label should now source/target the new label
            const knows = schema.getRelationshipTypeJSON("KNOWS")
            expect(knows).toBeDefined();
            expect(knows.sourceNodeLabel).toEqual("person1");
            expect(knows.targetNodeLabel).toEqual("person1");

            const likes = schema.getRelationshipTypeJSON("LIKES");
            expect(likes).toBeDefined();
            expect(likes.sourceNodeLabel).toEqual("person1");

        });
        // 13
        test("Split RelationshipType", () => {
            schema.SMO_splitRelationshipType({
                legacyType: "KNOWS",
                newType1: "KNOWS_CLOSE",
                newType2: "KNOWS_ACQUAINTANCE"
                });


            const knowsClose = schema.getRelationshipTypeJSON("KNOWS_CLOSE");
            expect(knowsClose).toBeDefined();
            expect(knowsClose.sourceNodeLabel).toEqual("person");
            expect(knowsClose.targetNodeLabel).toEqual("person");
            expect(knowsClose.properties).toEqual(
                { since: { name: 'since', activeTypes: { '1': { value: 'string', default: undefined } } } });
            const knowsAcquaintance = schema.getRelationshipTypeJSON("KNOWS_ACQUAINTANCE");
            expect(knowsAcquaintance).toBeDefined();
            expect(knowsAcquaintance.sourceNodeLabel).toEqual("person");
            expect(knowsAcquaintance.targetNodeLabel).toEqual("person");
            expect(knowsAcquaintance.properties).toEqual(
                { since: { name: 'since', activeTypes: { '1': { value: 'string', default: undefined } } } });
                
            expect(() => schema.SMO_splitRelationshipType({
                legacyType: "KNOWS",
                newType1: "KNOWS_CLOSE",
                newType2: "KNOWS_ACQUAINTANCE"
                })).toThrow();
            
                
        });
        // 14
        test("Split NodeType", () => {
            schema.SMO_splitNodeType({
                legacyType: "Person",
                splitProperty: "role",
                mapping: {
                    "Employee": "Employee",
                    "Customer": "Customer"
                },
                defaultType: "Customer"
            });
            expect(schema.getNodeTypeJSON("Employee")).toBeDefined();
            expect(schema.getNodeTypeJSON("Employee").labels).toEqual({ resident: 'resident', citizen: 'citizen', person: 'person' });
            expect(schema.getNodeTypeJSON("Employee").properties).toEqual(
                {
                    firstName: { name: 'firstName', activeTypes: { '1': { value: 'string', default: undefined } } },
                    lastName: { name: 'lastName', activeTypes: { '1': { value: 'string', default: undefined } } }
                });
            expect(schema.getNodeTypeJSON("Customer")).toBeDefined();
            expect(schema.getNodeTypeJSON("Customer").labels).toEqual({ resident: 'resident', citizen: 'citizen', person: 'person' });
            expect(schema.getNodeTypeJSON("Customer").properties).toEqual(
                {
                    firstName: { name: 'firstName', activeTypes: { '1': { value: 'string', default: undefined } } },
                    lastName: { name: 'lastName', activeTypes: { '1': { value: 'string', default: undefined } } }
                });

            const mapping = schema.testAccessSchemaMappings();
            expect(mapping.size).toBe(1);
            const mapForPerson = mapping.get("Person");
            expect(mapForPerson).toBeDefined();
            expect(mapForPerson?.kind).toBe("split");
            expect(mapForPerson?.mapping).toEqual({ "Employee": "Employee", "Customer": "Customer" });
            expect(mapForPerson?.splitProperty).toBe("role");
            
            // split after split :D 
            schema.SMO_splitNodeType({
                legacyType: "Employee",
                splitProperty: "department",
                mapping: {
                    "HR": "HR",
                    "IT": "IT"
                },
                defaultType: "IT"
            });

            expect(schema.getNodeTypeJSON("HR")).toBeDefined();
            expect(schema.getNodeTypeJSON("HR").labels).toEqual({ resident: 'resident', citizen: 'citizen', person: 'person' });
            expect(schema.getNodeTypeJSON("HR").properties).toEqual(
                {
                    firstName: { name: 'firstName', activeTypes: { '1': { value: 'string', default: undefined } } },
                    lastName: { name: 'lastName', activeTypes: { '1': { value: 'string', default: undefined } } }
                });
            expect(schema.getNodeTypeJSON("IT")).toBeDefined();
            expect(schema.getNodeTypeJSON("IT").labels).toEqual({ resident: 'resident', citizen: 'citizen', person: 'person' });
            expect(schema.getNodeTypeJSON("IT").properties).toEqual(
                {
                    firstName: { name: 'firstName', activeTypes: { '1': { value: 'string', default: undefined } } },
                    lastName: { name: 'lastName', activeTypes: { '1': { value: 'string', default: undefined } } }
                });

            const mapping1 = schema.testAccessSchemaMappings();
            expect(mapping1.size).toBe(2);
            const mapForPerson1 = mapping1.get("Person");
            expect(mapForPerson1).toBeDefined();
            expect(mapForPerson1?.kind).toBe("split");
            expect(mapForPerson1?.mapping).toEqual({ "Employee": "Employee", "Customer": "Customer" });
            expect(mapForPerson1?.splitProperty).toBe("role");
        });
    });

    describe("Union", () => {
        // 15
        test("Union Labels", () => {
            schema.SMO_unionLabels({ oldLabel1: "resident", oldLabel2: "citizen", newLabel: "tannant" });
            expect(schema.getNodeTypeJSON("Person").labels).toEqual({ tannant: 'tannant', person: 'person' });
            const has_creator = schema.getRelationshipTypeJSON("HAS_CREATOR")
            expect(has_creator).toBeDefined();
            expect(has_creator.sourceNodeLabel).toEqual("message");
            expect(has_creator.targetNodeLabel).toEqual("tannant");

            const likes = schema.getRelationshipTypeJSON("LIKES");
            expect(likes).toBeDefined();
            expect(likes.sourceNodeLabel).toEqual("person");
        });
        // 16 
        test("Union RelationshipTypes", () => {
            schema.SMO_splitRelationshipType({
                legacyType: "KNOWS",
                newType1: "KNOWS_CLOSE",
                newType2: "KNOWS_ACQUAINTANCE"
                });

                expect(schema.getRelationshipTypeJSON("KNOWS_CLOSE")).toBeDefined();
                expect(schema.getRelationshipTypeJSON("KNOWS_ACQUAINTANCE")).toBeDefined();
        });
        // 17
        test("Union NodeTypes", () => {
            // TODO
        });
    });
});