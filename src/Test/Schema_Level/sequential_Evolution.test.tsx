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
    beforeEach(() => {
        const doc = getDoc(1);
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
        test("Create Label", () => {
            expect(schema.testAccessAllLabels().has("TestLabel")).toBeFalsy();
            schema.SMO_createLabel("TestLabel");
            const allLabels = schema.testAccessAllLabels();
            expect(allLabels.has("TestLabel")).toBeTruthy();
            expect(allLabels.get("TestLabel")?.size).toBe(1);
        });
        test("Create NodeType", () => {
            schema.SMO_addNodeType("Account", ["acc"], { iban: "string", balance: "number", bankID: "string" });
            expect(schema.getNodeTypeJSON("Account")).toEqual({
                labels: { acc: 'acc' },
                properties: {
                    iban: { name: 'iban', activeTypes: { '1': { value: 'string', default: undefined } } },
                    balance: { name: 'balance', activeTypes: { '1': { value: 'number', default: undefined } } },
                    bankID: { name: 'bankID', activeTypes: { '1': { value: 'string', default: undefined } } }
                }
            })

        });
        test("Create RelationshipType", () => {
            schema.SMO_addRelationshipType("OWNED_BY", "resident", "resident", { since: "string" });
            expect(schema.getRelationshipTypeJSON("OWNED_BY")).toBeDefined();
            expect(schema.getRelationshipTypeJSON("OWNED_BY").sourceNodeLabel.toLowerCase()).toEqual("resident");
            expect(schema.getRelationshipTypeJSON("OWNED_BY").targetNodeLabel.toLowerCase()).toEqual("resident");
            expect(schema.getRelationshipTypeJSON("OWNED_BY").properties).toEqual(
                { since: { name: 'since', activeTypes: { '1': { value: 'string', default: undefined } } } });
        });

    });

    describe("DROP", () => {
        test("Drop NodeType", () => {
            expect(schema.getNodeTypeJSON("Person")).toBeDefined();
            schema.SMO_dropNodeType("Person");
            expect(() => schema.getNodeTypeJSON("Person")).toThrow(SchemaError);

        });
        test("Drop RelationshipType", () => {
            expect(schema.getRelationshipTypeJSON("KNOWS")).toBeDefined();
            schema.SMO_dropRelationshipType("KNOWS");
            expect(() => schema.getRelationshipTypeJSON("KNOWS")).toThrow(SchemaError);
        });
        test("Drop Label", () => {
            expect(schema.testAccessAllLabels().has("resident")).toBeTruthy();
            expect(schema.testAccessAllLabels().get("resident")?.size).toBe(1);
            expect(schema.getRelationshipTypeJSON('HAS_CREATOR')).toBeDefined();
            schema.SMO_dropLabel("resident");
            expect(schema.testAccessAllLabels().has("resident")).toBeFalsy();
            expect(schema.getNodeTypeJSON('Person')).toBeDefined();
            expect(schema.getNodeTypeJSON('Person').labels).toEqual({ citizen: 'citizen', person: 'person' });
            expect(() => schema.getRelationshipTypeJSON('HAS_CREATOR')).toThrow(SchemaError);
        });
    });

    describe("Rename", () => {
        test("Rename Property Key of NodeType and Edge", () => {
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
        test("Drop Property from NodeType", () => {
            schema.SMO_DropPropertyType({ Idenifying: "Person", propertyKey: "firstName", whatType: "NodeType" });
            expect(schema.getNodeTypeJSON("Person").properties).toEqual(
                { lastName: { name: 'lastName', activeTypes: { '1': { value: 'string', default: undefined } } } });
        });
        test("Drop Property from RelationshipType", () => {
            schema.SMO_DropPropertyType({ Idenifying: "KNOWS", propertyKey: "since", whatType: "RelationshipType" });
            expect(schema.getRelationshipTypeJSON("KNOWS").properties).toEqual({});
        });
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
            const tags = schema.getPropertyTypeTags("KNOWS", "since", "RelationshipType");
            schema.SMO_ChangePropertyType({ Idenifying: "KNOWS", propertyKey: "since", oldTags: tags, newPropertyType: "number", defaultVal: { default: 2000 }, whatType: "RelationshipType" });
            expect(schema.getRelationshipTypeJSON("KNOWS").properties.since).toEqual({ name: 'since', activeTypes: { '1': { value: 'number', default: 2000, transformerMap: {} } } });
        });
        test("Sequential Cumulative Lens Folding (Change Property Type twice)", () => {
            const tags1 = schema.getPropertyTypeTags("Message", "mood", "NodeType");
            const transformerMap1 = {
                "happy": "10",
                "sad": "0",
                "default": "-1"
            };
            schema.SMO_ChangePropertyType({
                Idenifying: "Message",
                propertyKey: "mood",
                oldTags: tags1,
                newPropertyType: "number",
                defaultVal: { default: -1, transformerMap: transformerMap1 },
                whatType: "NodeType"
            });

            const tags2 = schema.getPropertyTypeTags("Message", "mood", "NodeType");
            const transformerMap2 = {
                "10": "high",
                "0": "low",
                "default": "none"
            };
            schema.SMO_ChangePropertyType({
                Idenifying: "Message",
                propertyKey: "mood",
                oldTags: tags2,
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
        test("Split Label", () => {
            schema.SMO_splitLabel({ oldName: "person", newName1: "person1", newName2: "person2" });
            expect(schema.getNodeTypeJSON("Person").labels).toEqual({ resident: 'resident', citizen: 'citizen', person1: 'person1', person2: 'person2' });
            const knows = schema.getRelationshipTypeJSON("KNOWS")
            expect(knows).toBeDefined();
            expect(knows.sourceNodeLabel).toEqual("person1");
            expect(knows.targetNodeLabel).toEqual("person1");

            const likes = schema.getRelationshipTypeJSON("LIKES");
            expect(likes).toBeDefined();
            expect(likes.sourceNodeLabel).toEqual("person1");
        });
        test("Split RelationshipType", () => {
            // TODO
        });
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

            const engine = new SchemaLensEngine(schema);

            const rawNodes = [
                { id: "1", type: "Person", props: { role: "Employee", firstName: "Alice", lastName: "Smith" } },
                { id: "2", type: "Person", props: { role: "Customer", firstName: "Bob", lastName: "Jones" } },
                { id: "3", type: "Person", props: { firstName: "Charlie", lastName: "Brown" } }
            ];

            const { lensedNodes } = engine.applyLensToGraph(rawNodes, []);
            
            expect(lensedNodes).toHaveLength(3);
            expect(lensedNodes[0].type).toBe("Employee");
            expect(lensedNodes[0].appProps.firstName).toBe("Alice");
            expect(lensedNodes[1].type).toBe("Customer");
            expect(lensedNodes[1].appProps.firstName).toBe("Bob");
            expect(lensedNodes[2].type).toBe("Customer");
            expect(lensedNodes[2].appProps.firstName).toBe("Charlie");

            schema.SMO_AddPropertyType({ Idenifying: "Person", newProperty: { key: "middleName", value: "string" }, whatType: "NodeType" });
            engine.refreshCache();

            const rawNodesWithMiddle = [
                { id: "1", type: "Person", props: { role: "Employee", firstName: "Alice", middleName: "Marie" } }
            ];
            const { lensedNodes: lensedInherited } = engine.applyLensToGraph(rawNodesWithMiddle, []);
            expect(lensedInherited[0].appProps.middleName).toBe("Marie");

            const writeAlice = engine.encodeNodeForGraph("Employee", { firstName: "Alice", middleName: "Marie" });
            expect(writeAlice.dbType).toBe("Person");
            expect(writeAlice.dbProps.role).toEqual({ value: "Employee", writeType: "string" });
            expect(writeAlice.dbProps.firstName).toEqual({ value: "Alice", writeType: "string" });
            expect(writeAlice.dbProps.middleName).toEqual({ value: "Marie", writeType: "string" });

            schema.SMO_AddPropertyType({ Idenifying: "Employee", newProperty: { key: "salary", value: "number" }, whatType: "NodeType" });
            engine.refreshCache();

            const salaryLensEmp = engine.getPropertyLens("Employee", "salary", "NodeType");
            const salaryLensCust = engine.getPropertyLens("Customer", "salary", "NodeType");
            const salaryLensPerson = engine.getPropertyLens("Person", "salary", "NodeType");

            expect(salaryLensEmp).toBeDefined();
            expect(salaryLensEmp?.value).toBe("number");
            expect(salaryLensCust).toBeUndefined();
            expect(salaryLensPerson).toBeUndefined();

            const rawNodesWithSalary = [
                { id: "1", type: "Person", props: { role: "Employee", firstName: "Alice", salary: 75000 } },
                { id: "2", type: "Person", props: { role: "Customer", firstName: "Bob", salary: 100 } }
            ];
            const { lensedNodes: lensedWithSalary } = engine.applyLensToGraph(rawNodesWithSalary, []);
            expect(lensedWithSalary).toHaveLength(2);
            expect(lensedWithSalary[0].type).toBe("Employee");
            expect(lensedWithSalary[0].appProps.salary).toBe(75000);
            expect(lensedWithSalary[1].type).toBe("Customer");
            expect(lensedWithSalary[1].appProps.salary).toBeUndefined();

            const writeEmployeeWithSalary = engine.encodeNodeForGraph("Employee", { firstName: "Alice", salary: 75000 });
            expect(writeEmployeeWithSalary.dbType).toBe("Person");
            expect(writeEmployeeWithSalary.dbProps.role).toEqual({ value: "Employee", writeType: "string" });
            expect(writeEmployeeWithSalary.dbProps.salary).toEqual({ value: "75000", writeType: "number" });
        });
    });

    describe("Union", () => {
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
        test("Union RelationshipTypes", () => {
            // TODO
        });
        test("Union PropertyTypes", () => {
            // TODO
        });
    });
});