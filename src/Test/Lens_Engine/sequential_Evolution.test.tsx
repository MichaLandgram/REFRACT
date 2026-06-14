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
    let engine: SchemaLensEngine;
    let rawNodes: any[];
    let rawEdges: any[];
    let resultNodes: any[];
    let resultEdges: any[];
    beforeEach(() => {
        const doc = getDoc(1);
        schema = new Schema_v1(bon19SchemaDef, doc);
        engine = new SchemaLensEngine(schema);
        rawNodes = [
                { id: "Alice", type: "Person", props: { firstName: "Alice", lastName: "Smith" } },
                { id: "Bob", type: "Person", props: { firstName: "Bob", lastName: "Jones" } },
                { id: "Charlie", type: "Person", props: { firstName: "Charlie", lastName: "Brown" } },
            ];
        rawEdges = [
                { id: "e1", type: "KNOWS", sourceId: "Alice", targetId: "Bob", props: { since: "2020" } },
                { id: "e2", type: "KNOWS", sourceId: "Bob", targetId: "Charlie", props: { since: "2021" } },
            ];
        resultNodes = [
        {
          id: 'Alice',
          type: 'Person',
          props: { firstName: 'Alice', lastName: 'Smith' },
          label: { resident: 'resident', citizen: 'citizen', person: 'person' },
          appProps: { firstName: 'Alice', lastName: 'Smith' }
        },
        {
          id: 'Bob',
          type: 'Person',
          props: { firstName: 'Bob', lastName: 'Jones' },
          label: { resident: 'resident', citizen: 'citizen', person: 'person' },
          appProps: { firstName: 'Bob', lastName: 'Jones' }
        },
        {
          id: 'Charlie',
          type: 'Person',
          props: { firstName: 'Charlie', lastName: 'Brown' },
          label: { resident: 'resident', citizen: 'citizen', person: 'person' },
          appProps: { firstName: 'Charlie', lastName: 'Brown' }
        }
      ]
      resultEdges = [
        {
          id: 'e1',
          type: 'KNOWS',
          sourceId: 'Alice',
          targetId: 'Bob',
          props: { since: '2020' },
          appProps: { since: '2020' }
        },
        {
          id: 'e2',
          type: 'KNOWS',
          sourceId: 'Bob',
          targetId: 'Charlie',
          props: { since: '2021' },
          appProps: { since: '2021' }
        }
      ] 
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

            const {lensedNodes, lensedEdges} = engine.applyLensToGraph(rawNodes, rawEdges);
            expect(lensedNodes).toEqual(resultNodes);
            expect(lensedEdges).toEqual(resultEdges);
        });
        test("Create Label - no change", () => {
            expect(schema.testAccessAllLabels().has("TestLabel")).toBeFalsy();
            schema.SMO_createLabel("TestLabel");
            const allLabels = schema.testAccessAllLabels();
            expect(allLabels.has("TestLabel")).toBeTruthy();
            expect(allLabels.get("TestLabel")?.size).toBe(1);

            const {lensedNodes, lensedEdges} = engine.applyLensToGraph(rawNodes, rawEdges);
            expect(lensedNodes).toEqual(resultNodes);
            expect(lensedEdges).toEqual(resultEdges);
        });
        test("Create NodeType - no change", () => {
            expect(schema.testAccessAllLabels().has("acc")).toBeFalsy();
            expect(() => schema.getNodeTypeJSON("Account")).toThrow(SchemaError);

            schema.SMO_addNodeType("Account", ["acc"], { iban: "string", balance: "number", bankID: "string" });
            expect(schema.getNodeTypeJSON("Account")).toEqual({
                labels: { acc: 'acc' },
                properties: {
                    iban: { name: 'iban', activeTypes: { '1': { value: 'string', default: undefined } } },
                    balance: { name: 'balance', activeTypes: { '1': { value: 'number', default: undefined } } },
                    bankID: { name: 'bankID', activeTypes: { '1': { value: 'string', default: undefined } } }
                }
            });
            expect(schema.testAccessAllLabels().has("acc")).toBeTruthy();

            const {lensedNodes, lensedEdges} = engine.applyLensToGraph(rawNodes, rawEdges);
            expect(lensedNodes).toEqual(resultNodes);
            expect(lensedEdges).toEqual(resultEdges);
        });
        test("Create RelationshipType - no change", () => {
            schema.SMO_addRelationshipType("OWNED_BY", "resident", "resident", { since: "string" });
            expect(schema.getRelationshipTypeJSON("OWNED_BY")).toBeDefined();
            expect(schema.getRelationshipTypeJSON("OWNED_BY").sourceNodeLabel.toLowerCase()).toEqual("resident");
            expect(schema.getRelationshipTypeJSON("OWNED_BY").targetNodeLabel.toLowerCase()).toEqual("resident");
            expect(schema.getRelationshipTypeJSON("OWNED_BY").properties).toEqual(
                { since: { name: 'since', activeTypes: { '1': { value: 'string', default: undefined } } } });
            
            const {lensedNodes, lensedEdges} = engine.applyLensToGraph(rawNodes, rawEdges);
            expect(lensedNodes).toEqual(resultNodes);
            expect(lensedEdges).toEqual(resultEdges);
        });
    


    });

    describe("DROP", () => {
        test("Drop NodeType", () => {
            expect(schema.getNodeTypeJSON("Person")).toBeDefined();
            schema.SMO_dropNodeType("Person");
            expect(() => schema.getNodeTypeJSON("Person")).toThrow(SchemaError);

            const {lensedNodes, lensedEdges} = engine.applyLensToGraph(rawNodes, rawEdges);
            expect(lensedNodes).toEqual([]);
            expect(lensedEdges).toEqual([]);

        });
        test("Drop RelationshipType", () => {
            expect(schema.getRelationshipTypeJSON("KNOWS")).toBeDefined();
            schema.SMO_dropRelationshipType("KNOWS");
            expect(() => schema.getRelationshipTypeJSON("KNOWS")).toThrow(SchemaError);

            const {lensedNodes, lensedEdges} = engine.applyLensToGraph(rawNodes, rawEdges);

            expect(lensedNodes).toEqual(resultNodes);
            expect(lensedEdges).toEqual([]);
        });
        test("Drop Label", () => {
            expect(schema.testAccessAllLabels().has("person")).toBeTruthy();
            schema.SMO_dropLabel("person");
            expect(schema.testAccessAllLabels().has("person")).toBeFalsy();
            const {lensedNodes, lensedEdges} = engine.applyLensToGraph(rawNodes, rawEdges);
            
            resultNodes.forEach(node => {
                node.label = { resident: 'resident', citizen: 'citizen' }
            });

            expect(lensedNodes).toEqual(resultNodes);
            expect(lensedEdges).toEqual([]);
        });
    });

    describe("Rename", () => {
        test("Rename Property Key of NodeType", () => {
            schema.SMO_renamePropertyKey({ Idenifying: "Person", oldPropertyKey: "firstName", newPropertyKey: "name", whatType: "NodeType" });

            expect(schema.getNodeTypeJSON("Person").properties).toEqual(
                {
                    firstName: { name: 'name', activeTypes: { '1': { value: 'string', default: undefined } } },
                    lastName: { name: 'lastName', activeTypes: { '1': { value: 'string', default: undefined } } }
                });
            const {lensedNodes, lensedEdges} = engine.applyLensToGraph(rawNodes, rawEdges);
            // because of proxy must be accessed via appProps
            lensedNodes.forEach(node => {
                expect(node.appProps.firstName).toBeUndefined();
                expect(node.appProps.name).toBeDefined();
                expect(node.appProps.name).toBe(node.props.firstName);
            });
            expect(lensedEdges).toEqual(resultEdges);
        });
        test("Rename Property Key of RelationshipType", () => {
            schema.SMO_renamePropertyKey({ Idenifying: "KNOWS", oldPropertyKey: "since", newPropertyKey: "seit", whatType: "RelationshipType" });
            expect(schema.getRelationshipTypeJSON("KNOWS").properties).toEqual(
                { since: { name: 'seit', activeTypes: { '1': { value: 'string', default: undefined } } } });

            const {lensedNodes, lensedEdges} = engine.applyLensToGraph(rawNodes, rawEdges);
            
            expect(lensedNodes).toEqual(resultNodes);
            lensedEdges.forEach(edge => {
                expect(edge.appProps.since).toBeUndefined();
                expect(edge.appProps.seit).toBeDefined();
                expect(edge.appProps.seit).toBe(edge.props.since);
            });
        });
        test("Rename a NodeType label", () => {
            const storeForCompare = new Set(schema.testAccessAllLabels().get("resident"));
            schema.SMO_renameLabel("resident", "resident_old");
            expect(schema.getNodeTypeJSON("Person").labels).toEqual({ citizen: 'citizen', resident_old: 'resident_old', person: 'person' });
            expect(schema.testAccessAllLabels().get("resident_old")).toEqual(storeForCompare);

            expect(schema.testAccessAllLabels().get("resident")).toBeUndefined();

            const {lensedNodes, lensedEdges} = engine.applyLensToGraph(rawNodes, rawEdges);
            resultNodes.forEach(node => {
                node.label = { resident_old: 'resident_old', citizen: 'citizen', person: 'person' }
            });
            expect(lensedNodes).toEqual(resultNodes);
            expect(lensedEdges).toEqual(resultEdges);
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

            const {lensedNodes, lensedEdges} = engine.applyLensToGraph(rawNodes, rawEdges);
            resultNodes.forEach(node => {
                node.label = { resident: 'resident', citizen: 'citizen', human: 'human' }
            });
            expect(lensedNodes).toEqual(resultNodes);
            expect(lensedEdges).toEqual(resultEdges);
        });
    });

    describe("Change", () => {
        test("Add Property to NodeType - no change", () => {
            schema.SMO_AddPropertyType({ Idenifying: "Person", newProperty: { key: "age", value: "number" }, whatType: "NodeType" });
            expect(schema.getNodeTypeJSON("Person").properties).toEqual(
                {
                    firstName: { name: 'firstName', activeTypes: { '1': { value: 'string', default: undefined } } },
                    lastName: { name: 'lastName', activeTypes: { '1': { value: 'string', default: undefined } } },
                    age: { name: 'age', activeTypes: { '1': { value: 'number', default: undefined } } }
                });
            
            const {lensedNodes, lensedEdges} = engine.applyLensToGraph(rawNodes, rawEdges);
            expect(lensedNodes).toEqual(resultNodes);
            expect(lensedEdges).toEqual(resultEdges);
        });
        test("Add Property to RelationshipType - no change", () => {
            schema.SMO_AddPropertyType({ Idenifying: "LIKES", newProperty: { key: "since", value: "string" }, whatType: "RelationshipType" });
            expect(schema.getRelationshipTypeJSON("LIKES").properties).toEqual(
                {
                    date: { name: 'date', activeTypes: { '1': { value: 'string', default: undefined } } },
                    since: { name: 'since', activeTypes: { '1': { value: 'string', default: undefined } } }
                });
            const {lensedNodes, lensedEdges} = engine.applyLensToGraph(rawNodes, rawEdges);
            expect(lensedNodes).toEqual(resultNodes);
            expect(lensedEdges).toEqual(resultEdges);
        });
        test("Drop Property from NodeType", () => {
            schema.SMO_DropPropertyType({ Idenifying: "Person", propertyKey: "firstName", whatType: "NodeType" });
            expect(schema.getNodeTypeJSON("Person").properties).toEqual(
                { lastName: { name: 'lastName', activeTypes: { '1': { value: 'string', default: undefined } } } });
            
            const {lensedNodes, lensedEdges} = engine.applyLensToGraph(rawNodes, rawEdges);
            lensedNodes.forEach(node => {
                expect(node.appProps.firstName).toBeUndefined();
                expect(node.appProps.lastName).toBeDefined();
                expect(node.appProps.lastName).toBe(node.props.lastName);
            });
            expect(lensedEdges).toEqual(resultEdges);
        });
        test("Drop Property from RelationshipType", () => {
            schema.SMO_DropPropertyType({ Idenifying: "KNOWS", propertyKey: "since", whatType: "RelationshipType" });
            expect(schema.getRelationshipTypeJSON("KNOWS").properties).toEqual({});
            const {lensedNodes, lensedEdges} = engine.applyLensToGraph(rawNodes, rawEdges);
            expect(lensedNodes).toEqual(resultNodes);
            lensedEdges.forEach(edge => {
                expect(edge.appProps.since).toBeUndefined();
            });
        });
        test("Change Property Type of NodeType", () => {
            const localrawNodes = [ 
                ...rawNodes,
                { id: "M1", type: "Message", props: { mood: "happy" } },
                { id: "M2", type: "Message", props: { mood: "sad" } },
            ];
            const localLensedResultNodes = [
                ...resultNodes,
                { id: 'M1', type: 'Message', props: { mood: "happy" }, label: { note: 'note', message: 'message' }, appProps: { mood: 10 } },
                { id: 'M2', type: 'Message', props: { mood: "sad" }, label: { note: 'note', message: 'message' }, appProps: { mood: 0 } },
            ];
            const tags = schema.getPropertyTypeTags("Message", "mood", "NodeType");
            const transformerMap = {
                "happy": "10",
                "sad": "0",
                "neutral": "5",
                "default": "-1"
            }
            schema.SMO_ChangePropertyType({ Idenifying: "Message", propertyKey: "mood", oldTags: tags, newPropertyType: "number", defaultVal: { default: -1, transformerMap: transformerMap }, whatType: "NodeType" });
            expect(schema.getNodeTypeJSON("Message").properties.mood).toEqual({ name: 'mood', activeTypes: { '1': { value: 'number', default: -1, transformerMap: transformerMap } } });

            console.log(rawEdges);
            const {lensedNodes, lensedEdges} = engine.applyLensToGraph(localrawNodes, rawEdges, { lazy: false });
            expect(lensedNodes).toEqual(localLensedResultNodes);
            expect(lensedEdges).toEqual(resultEdges);
        });
        test("Change Property Type of RelationshipType", () => {

            const transformerMap = {
                "2020": "20",
                "2021": "21",
                "default": "2000"
            }
            schema.SMO_ChangePropertyType({ Idenifying: "KNOWS", propertyKey: "since", newPropertyType: "number", defaultVal: { default: 2000, transformerMap: transformerMap }, whatType: "RelationshipType" });
            expect(schema.getRelationshipTypeJSON("KNOWS").properties.since).toEqual({ name: 'since', activeTypes: { '1': { value: 'number', default: 2000, transformerMap: transformerMap } } });

            const {lensedNodes, lensedEdges} = engine.applyLensToGraph(rawNodes, rawEdges, { lazy: false });
            expect(lensedNodes).toEqual(resultNodes);
            lensedEdges.forEach(edge => {
                expect(edge.appProps.since).toBeDefined();
                const map = edge.props.since === "2020" ? "2020" : edge.props.since === "2021" ? "2021" : "default";
                expect(edge.appProps.since).toBe(Number(transformerMap[map]));
            });

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

            const { lensedNodes, lensedEdges } = engine.applyLensToGraph(rawNodes, rawEdges);
            resultNodes.forEach(node => {
                node.label = { resident: 'resident', citizen: 'citizen', person1: 'person1', person2: 'person2' }
            });
            expect(lensedNodes).toEqual(resultNodes);
            expect(lensedEdges).toEqual(resultEdges);
        });
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

            const { lensedNodes, lensedEdges } = engine.applyLensToGraph(rawNodes, rawEdges);
            expect(lensedNodes).toEqual(resultNodes);
            lensedEdges.forEach(edge => {
                expect(edge.type === "KNOWS_CLOSE").toBeTruthy();
                expect(edge.type === "KNOWS_ACQUAINTANCE").toBeFalsy();
                expect(edge.type === "KNOWS").toBeFalsy(); 
                expect(edge.appProps.since).toBe(edge.props.since);
             });
        });
        test("Split NodeType", () => {
            schema.SMO_splitNodeType({ legacyType: "Person", splitProperty: "role",
                mapping: {
                    "Employee": "Employee",
                    "Customer": "Customer"
                }, defaultType: "Customer"
            });

            const result0 = engine.applyLensToGraph(rawNodes, rawEdges);
            result0.lensedNodes.forEach(node => {
                expect(node.type).toBe("Customer");
                expect(node.appProps.role).toBeUndefined();
            });

            schema.SMO_AddPropertyType({ Idenifying: "Person", newProperty: { key: "middleName", value: "string" }, whatType: "NodeType" });
            engine.refreshCache();

            const rawNodesWithMiddle = [
                ...rawNodes,
                { id: "1", type: "Person", props: { role: "Employee", firstName: "Alice", middleName: "Marie" } }
            ];
            
            // rawNodes = [...rawNodes, ...rawNodesWithMiddle];
            const result1 = engine.applyLensToGraph(rawNodesWithMiddle, rawEdges, { lazy: false });
            expect(result1.lensedNodes[3].appProps.middleName).toBe("Marie");

            // const writeFail = engine.encodeNodeForGraph("Person", { firstName: "Alice" });
            // console.log(writeFail);

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
                ...rawNodes,
                { id: "1", type: "Person", props: { role: "Employee", firstName: "Alice", salary: 75000 } },
                { id: "2", type: "Person", props: { role: "Customer", firstName: "Bob", salary: 100 } }
            ];
            const result2 = engine.applyLensToGraph(rawNodesWithSalary, []);
            console.log(result2.lensedNodes);
            expect(result2.lensedNodes).toHaveLength(5);
            expect(result2.lensedNodes[3].type).toBe("Employee");
            expect(result2.lensedNodes[3].appProps.salary).toBe(75000);
            expect(result2.lensedNodes[4].type).toBe("Customer");
            expect(result2.lensedNodes[4].appProps.salary).toBeUndefined();

            const writeEmployeeWithSalary = engine.encodeNodeForGraph("Employee", { firstName: "Alice", salary: 75000 });
            expect(writeEmployeeWithSalary.dbType).toBe("Person");
            expect(writeEmployeeWithSalary.dbProps.role).toEqual({ value: "Employee", writeType: "string" });
            expect(writeEmployeeWithSalary.dbProps.salary).toEqual({ value: "75000", writeType: "number" });
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
        test("Union NodeTypes", () => {
            schema.SMO_unionNodeTypes({ newType: "Test", legacyTypes: ["Person", "Message"], writeDefault: "Person" });

            const result0 = engine.applyLensToGraph(rawNodes, rawEdges);
            result0.lensedNodes.forEach(node => {
                expect(node.type).toBe("Test");
            });
            expect(result0.lensedEdges).toEqual(resultEdges);

            schema.SMO_AddPropertyType({ Idenifying: "Person", newProperty: { key: "middleName", value: "string" }, whatType: "NodeType" });
            engine.refreshCache();

            const rawNodesWithMiddle = [
                ...rawNodes,
                { id: "1", type: "Person", props: { firstName: "Alice", middleName: "Marie" } }
            ];
            
            const result1 = engine.applyLensToGraph(rawNodesWithMiddle, rawEdges, { lazy: false });
            expect(result1.lensedNodes[3].appProps.middleName).toBe("Marie");

            const writeAlice = engine.encodeNodeForGraph("Test", { firstName: "Alice", middleName: "Marie" });
            expect(writeAlice.dbType).toBe("Person");
            expect(writeAlice.dbProps.firstName).toEqual({ value: "Alice", writeType: "string" });
            expect(writeAlice.dbProps.middleName).toEqual({ value: "Marie", writeType: "string" });

            schema.SMO_AddPropertyType({ Idenifying: "Test", newProperty: { key: "salary", value: "number" }, whatType: "NodeType" });
            engine.refreshCache();

            const salaryLensEmp = engine.getPropertyLens("Test", "salary", "NodeType");
            const salaryLensCust = engine.getPropertyLens("Message", "salary", "NodeType");
            const salaryLensPerson = engine.getPropertyLens("Person", "salary", "NodeType");

            expect(salaryLensEmp).toBeDefined();
            expect(salaryLensEmp?.value).toBe("number");
            expect(salaryLensCust).toBeUndefined();
            expect(salaryLensPerson).toBeUndefined();

            const rawNodesWithSalary = [
                ...rawNodes,
                { id: "1", type: "Person", props: { firstName: "Alice", salary: 75000 } },
                { id: "2", type: "Person", props: { firstName: "Bob", salary: 100 } }
            ];
            const result2 = engine.applyLensToGraph(rawNodesWithSalary, []);
            expect(result2.lensedNodes).toHaveLength(5);
            expect(result2.lensedNodes[3].type).toBe("Test");
            expect(result2.lensedNodes[3].appProps.salary).toBe(75000);
            expect(result2.lensedNodes[4].type).toBe("Test");
            expect(result2.lensedNodes[4].appProps.salary).toBe(100);

            const writeEmployeeWithSalary = engine.encodeNodeForGraph("Test", { firstName: "Alice", salary: 75000 });
            expect(writeEmployeeWithSalary.dbType).toBe("Person");
            expect(writeEmployeeWithSalary.dbProps.salary).toEqual({ value: "75000", writeType: "number" });
        });
        // 17
        test("Union RelationshipTypes", () => {
            schema.SMO_unionRelationshipTypes({ newType: "TestRel", legacyTypes: ["KNOWS", "LIKES"], writeDefault: "KNOWS" });

            const result0 = engine.applyLensToGraph(rawNodes, rawEdges, { lazy: false });
            result0.lensedEdges.forEach(edge => {
                expect(edge.type).toBe("TestRel");
            });
            expect(result0.lensedNodes).toEqual(resultNodes);
        });
    });
});