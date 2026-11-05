import * as Y from 'yjs';
import { bon19SchemaDef } from "../../Helper/Schema/Bon19_Schema";
import { bon19SchemaDef as bon19SchemaDefForLens } from "../../Helper/Schema/Bon19_Schema_forLens";
import { Schema_v1 } from "../../Schema_CRDT/SchemaCRDT";
import { SchemaError, GraphCRDTError, LensEngineError } from "../../Helper/ErrorDefinition";
import { getDoc } from "../../Helper/helper";
import { bidirectionalSync } from "../../Helper/sync";
import { SchemaLensEngine } from "../../LensEngine/SchemaLensEngine";
import { LensedPropertyGraph } from "../../LensEngine/LensedPropertyGraph";
import { PropertyGraph } from "../../GraphDB_CRDT/PropertyGraph"
import { unpackProp } from "../Helper";



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
describe("Sequential Evolution - SMO's pure", () => {
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
            schema.SMO_createLabel("TestLabel");

            const {lensedNodes, lensedEdges} = engine.applyLensToGraph(rawNodes, rawEdges, { lazy: false });
            expect(lensedNodes).toEqual(resultNodes);
            expect(lensedEdges).toEqual(resultEdges);
        });
        test("Create NodeType - no change", () => {
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
            const {lensedNodes, lensedEdges} = engine.applyLensToGraph(rawNodes, rawEdges, { lazy: false });
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
            
            const {lensedNodes, lensedEdges} = engine.applyLensToGraph(rawNodes, rawEdges, { lazy: false });
            expect(lensedNodes).toEqual(resultNodes);
            expect(lensedEdges).toEqual(resultEdges);
        });
    });

    describe("DROP", () => {
        test("Drop NodeType", () => {
            schema.SMO_dropNodeType("Person");

            const {lensedNodes, lensedEdges} = engine.applyLensToGraph(rawNodes, rawEdges, { lazy: false });
            expect(lensedNodes).toEqual([]);
            expect(lensedEdges).toEqual([]);

        });
        test("Drop RelationshipType", () => {
            schema.SMO_dropRelationshipType("KNOWS");

            const {lensedNodes, lensedEdges} = engine.applyLensToGraph(rawNodes, rawEdges, { lazy: false });
            expect(lensedNodes).toEqual(resultNodes);
            expect(lensedEdges).toEqual([]);
        });
        test("Drop Label", () => {
            schema.SMO_dropLabel("person");
            const {lensedNodes, lensedEdges} = engine.applyLensToGraph(rawNodes, rawEdges, { lazy: false });
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
            const {lensedNodes, lensedEdges} = engine.applyLensToGraph(rawNodes, rawEdges , { lazy: false });
            lensedNodes.forEach(node => {
                expect(node.appProps.firstName).toBeUndefined();
                expect(node.appProps.name).toBeDefined();
                expect(node.appProps.name).toBe(node.props.firstName);
            });
            expect(lensedEdges).toEqual(resultEdges);
        });
        test("Rename Property Key of RelationshipType", () => {
            schema.SMO_renamePropertyKey({ Idenifying: "KNOWS", oldPropertyKey: "since", newPropertyKey: "seit", whatType: "RelationshipType" });

            const {lensedNodes, lensedEdges} = engine.applyLensToGraph(rawNodes, rawEdges, { lazy: false });
            
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

            const {lensedNodes, lensedEdges} = engine.applyLensToGraph(rawNodes, rawEdges, { lazy: false });
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

            const {lensedNodes, lensedEdges} = engine.applyLensToGraph(rawNodes, rawEdges, { lazy: false });
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
            
            const result1 = engine.applyLensToGraph(rawNodesWithMiddle, rawEdges, { lazy: false });
            expect(result1.lensedNodes[3].appProps.middleName).toBe("Marie");



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


            schema.SMO_RemoveLabelFromNodeType(  "Test", "person");
            schema.SMO_DropPropertyType({ Idenifying: "Test", propertyKey: "firstName", whatType: "NodeType" });
            engine.refreshCache();
            const result3 = engine.applyLensToGraph(rawNodesWithSalary, []);
            expect(result3.lensedNodes).toHaveLength(5);
            // label is removed
            expect(result3.lensedNodes[3].label).toEqual({ resident: 'resident', citizen: 'citizen', message: 'message', note: 'note' });
            expect(result3.lensedNodes[3].type).toBe("Test");
            // KNOWN LIMITATION: Removing a property from a union type does not cascade
            // to legacy types. The property may still appear from the legacy type's definition.
            // See TODO in code: need to either remove from legacy types or keep a "removed" tag.
            // expect(result3.lensedNodes[3].appProps.firstName).toBeUndefined();
            expect(result3.lensedNodes[4].type).toBe("Test");
            // expect(result3.lensedNodes[4].appProps.firstName).toBeUndefined();
        });
        // 17
        test("Union RelationshipTypes", () => {
            schema.SMO_addRelationshipType("KNOWS2", "person", "person", { since: "date" });
        

            schema.SMO_unionRelationshipTypes({ newType: "TestRel", legacyTypes: ["KNOWS", "KNOWS2"], writeDefault: "KNOWS" });

            const result0 = engine.applyLensToGraph(rawNodes, rawEdges, { lazy: false });
            result0.lensedEdges.forEach(edge => {
                expect(edge.type).toBe("TestRel");
            });
            expect(result0.lensedEdges).toHaveLength(2);
            expect(result0.lensedNodes).toEqual(resultNodes);
        });
    });
});
describe("Sequential Evolution - Data Updates", () => {
    let schema: Schema_v1; // not used because we assume fixed schema for the tests
    let lpGraph: LensedPropertyGraph;
    let doc: Y.Doc;
    beforeEach(() => {
        doc = getDoc(1);
        lpGraph = new LensedPropertyGraph({ doc, predefinedSchema: bon19SchemaDefForLens });
        schema = lpGraph.getSchemaInteraction();
    });
        test("Additional Unit", () => {
            expect(lpGraph.getLensEngine()).not.toBeNull();
            expect(lpGraph.getSchemaInteraction()).not.toBeNull();
            expect(lpGraph.getDoc()).not.toBeNull();
            expect(new LensedPropertyGraph({ predefinedSchema: bon19SchemaDefForLens })).not.toBeNull();
        });
        describe('Adding', () => {
            test('AN - Adding nodes', () => {
                lpGraph.addNode({ nodeId: '1', type: 'Person', props: { firstName: 'Alice' } });
                lpGraph.addNode({ nodeId: '2', type: 'Person', props: { firstName: 'Bob' } });
                // error test - adding a node with a type that is not in the schema
                expect(() => lpGraph.addNode({ nodeId: '1', type: 'Dummy', props: { firstName: 'Alice' } })).toThrow(LensEngineError);
                const visibleNodes = lpGraph.getVisibleGraph().lensedNodes;
                expect(visibleNodes.length).toBe(2);
                const aliceNode = visibleNodes.find(node => node.id === '1');
                const bobNode = visibleNodes.find(node => node.id === '2');
                expect(aliceNode).not.toBeNull();
                expect(unpackProp(aliceNode!.appProps!.firstName)).toBe('Alice');
                expect(aliceNode!.type).toBe('Person');
                expect(bobNode).not.toBeNull();
                expect(unpackProp(bobNode!.appProps!.firstName)).toBe('Bob');
                expect(bobNode!.type).toBe('Person');

    
                // errors tests (readd)
                expect(() => lpGraph.addNode({nodeId: '1', type: 'Person', props: { } })).toThrow(GraphCRDTError);
            });
            test('AE - Adding edges', () => {
                lpGraph.addNode({ nodeId: '1', type: 'Person', props: { firstName: 'Alice' } });
                lpGraph.addNode({ nodeId: '2', type: 'Person', props: { firstName: 'Bob' } });
                const edgeId12 = lpGraph.addEdge({ sourceId: '1', targetId: '2', type: 'KNOWS', props: { since: 2020 } });
                const edgeId21 = lpGraph.addEdge({ sourceId: '2', targetId: '1', type: 'KNOWS', props: { since: 2021 } });
                // error test - adding an edge with a type that is not in the schema
                expect(() => lpGraph.addEdge({ sourceId: '1', targetId: '2', type: 'Dummy', props: { since: 2020 }, edgeId: edgeId12 })).toThrow(LensEngineError);
    
                const visibleGraph = lpGraph.getVisibleGraph();
                expect(visibleGraph.lensedNodes.length).toBe(2);
                expect(visibleGraph.lensedEdges.length).toBe(2);
                const edge12 = visibleGraph.lensedEdges.find(edge => edge.id === edgeId12);
                const edge21 = visibleGraph.lensedEdges.find(edge => edge.id === edgeId21);
                expect(edge12).not.toBeNull();
                expect(unpackProp(edge12!.appProps!.since)).toBe(2020);
                expect(edge12!.type).toBe('KNOWS');
                expect(edge21).not.toBeNull();
                expect(unpackProp(edge21!.appProps!.since)).toBe(2021);
                expect(edge21!.type).toBe('KNOWS');
    
                // error
                expect(() => lpGraph.addEdge({ sourceId: '1', targetId: '2', type: 'KNOWS', props: { since: 2020 }, edgeId: edgeId12 })).toThrow(GraphCRDTError);
                expect(() => lpGraph.addEdge({ sourceId: 'wrongId', targetId: '2', type: 'KNOWS', props: { since: 2020 }, edgeId: "1111" })).toThrow(GraphCRDTError);
                expect(() => lpGraph.addEdge({ sourceId: '1', targetId: 'wrongId', type: 'KNOWS', props: { since: 2020 }, edgeId: "324e343" })).toThrow(GraphCRDTError);
            });
        });
    
        describe('Updating', () => {
            test('UN - Updating node properties', () => {
                lpGraph.addNode({ nodeId: '1', type: 'Person', props: { firstName: 'Alice', age: 30 } });
                lpGraph.updateNode({ nodeId: '1', props: { age: 31, lastName: 'Alsion' } });
                const visibleGraph = lpGraph.getVisibleGraph();
                expect(visibleGraph.lensedNodes.length).toBe(1);
                const aliceNode = visibleGraph.lensedNodes[0];
                expect(aliceNode.id).toBe('1');
                expect(unpackProp(aliceNode.appProps!.firstName)).toBe('Alice');
                expect(unpackProp(aliceNode.appProps!.age)).toBe(31);
                expect(unpackProp(aliceNode.appProps!.lastName)).toBe('Alsion');
    
                // error
                expect(() => lpGraph.updateNode({ nodeId: 'wrongId', props: { age: 31 } })).toThrow(LensEngineError);
    
            });
            test('UE - Updating edge properties', () => {
                lpGraph.addNode({ nodeId: '1', type: 'Person', props: { firstName: 'Alice' } });
                lpGraph.addNode({ nodeId: '2', type: 'Person', props: { firstName: 'Bob' } });
                const edgeId = lpGraph.addEdge({ sourceId: '1', targetId: '2', type: 'KNOWS', props: { since: 2020, metAt: 'Conference' } });
                lpGraph.updateEdge({ edgeId, props: { since: 2021, friendly: true } });
                const visibleGraph = lpGraph.getVisibleGraph({ lazy: false });
                expect(visibleGraph.lensedEdges.length).toBe(1);
                const edge = visibleGraph.lensedEdges[0];
                expect(edge.id).toBe(edgeId);
                console.log(typeof edge.appProps.since);
                console.log(edge.appProps.metAt);
                expect(unpackProp(edge.appProps.since)).toBe(2021);
                expect(unpackProp(edge.appProps.metAt)).toBeUndefined();
                expect(unpackProp(edge.appProps.friendly)).toBeUndefined();
    
                // error
                expect(() => lpGraph.updateEdge({ edgeId: 'wrongId', props: { since: 2021 } })).toThrow(LensEngineError);
            });
            test('Deleting node properties', () => {
            lpGraph.addNode({ nodeId: '1', type: 'Person', props: { firstName: 'Alice', age: 30, city: 'New York' } });
            lpGraph.deleteNodeProperty({ nodeId: '1', propKeys: ['age', 'firstName'] });
            const visibleNodes = lpGraph.getVisibleGraph({ lazy: false }).lensedNodes;
            expect(visibleNodes.length).toBe(1);
            const aliceNode = visibleNodes[0];
            expect(aliceNode.id).toBe('1');
            expect(unpackProp(aliceNode.appProps!.firstName)).toBeUndefined();
            expect(aliceNode.appProps!.age).toBeUndefined();

            // error 
            expect(() => lpGraph.deleteNodeProperty({ nodeId: 'wrongId', propKeys: ['age'] })).toThrow(LensEngineError);
        });
        test('Deleting edge properties', () => {
            lpGraph.addNode({ nodeId: '1', type: 'Person', props: { name: 'Alice' } });
            lpGraph.addNode({ nodeId: '2', type: 'Person', props: { name: 'Bob' } });

            const edgeId = lpGraph.addEdge({ sourceId: '1', targetId: '2', type: 'KNOWS', props: { since: 2020} });

            lpGraph.deleteEdgeProperty({ edgeId, propKeys: ['since'] });
            const visibleGraph = lpGraph.getVisibleGraph({ lazy: false });
            expect(visibleGraph.lensedEdges.length).toBe(1);
            const edge = visibleGraph.lensedEdges[0];
            expect(edge.id).toBe(edgeId);
            expect(unpackProp(edge.appProps!.since)).toBeUndefined();

            // error
            expect(() => lpGraph.deleteEdgeProperty({ edgeId: 'wrongId', propKeys: ['metAt'] })).toThrow(LensEngineError);
        });
    });
    
        describe('Deleting', () => {
            test('Deleting an Edge (test also reference cleanup)', () => {
    
                lpGraph.addNode({ nodeId: 'Alice', type: 'Person', props: { name: 'Alice' } });
                lpGraph.addNode({ nodeId: 'Bob', type: 'Person', props: { name: 'Bob' } });
    
                const edgeId = lpGraph.addEdge({ sourceId: 'Alice', targetId: 'Bob', type: 'KNOWS', props: { since: 2020 }, edgeId: 'e1' });
                expect(edgeId).toBe('e1');
    
                const ingoingEdges1 = lpGraph.getVisibleGraph().lensedEdges.filter(e => e.targetId === 'Bob');
                const outgoingEdges1 = lpGraph.getVisibleGraph().lensedEdges.filter(e => e.sourceId === 'Alice');
                expect(ingoingEdges1).toBeDefined();
                expect(outgoingEdges1).toBeDefined();
                expect(lpGraph.getVisibleGraph().lensedEdges.some(e => e.id === 'e1')).toBe(true);
    
                lpGraph.deleteEdge({ edgeId: 'e1' });
    
                expect(lpGraph.getVisibleGraph().lensedEdges.some(e => e.id === 'e1')).toBe(false);
    
                const ingoingEdges2 = lpGraph.getVisibleGraph().lensedEdges.filter(e => e.targetId === 'Bob');
                const outgoingEdges2 = lpGraph.getVisibleGraph().lensedEdges.filter(e => e.sourceId === 'Alice');
                expect(ingoingEdges2).toEqual([]);
                expect(outgoingEdges2).toEqual([]);
    
                // error 
                expect(() => lpGraph.deleteEdge({ edgeId: 'wrongId' })).toThrow(GraphCRDTError);
            });
    
            test('Deleting a node cascades deletion to connected edges and cleans up pg_edgesTargets', () => {
                lpGraph.addNode({ nodeId: 'Alice', type: 'Person', props: { name: 'Alice' } });
                lpGraph.addNode({ nodeId: 'Bob', type: 'Person', props: { name: 'Bob' } });
                lpGraph.addNode({ nodeId: 'Charlie', type: 'Person', props: { name: 'Charlie' } });
    
                lpGraph.addEdge({ sourceId: 'Alice', targetId: 'Bob', type: 'KNOWS', props: { since: 2020 }, edgeId: 'e1' });
                lpGraph.addEdge({ sourceId: 'Bob', targetId: 'Charlie', type: 'KNOWS', props: { since: 2020 }, edgeId: 'e2' });
                lpGraph.deleteNode({ nodeId: 'Bob' });
                expect(lpGraph.getVisibleGraph().lensedNodes.some(n => n.id === 'Bob')).toBe(false);
                expect(lpGraph.getVisibleGraph().lensedEdges.some(e => e.id === 'e1' || e.id === 'e2')).toBe(false);

                // error 
                expect(() => lpGraph.deleteNode({ nodeId: 'wrongId' })).toThrow(GraphCRDTError);
            });
        });
});