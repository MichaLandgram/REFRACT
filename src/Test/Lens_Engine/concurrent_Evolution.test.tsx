import * as Y from 'yjs';
import { bon19SchemaDef } from "../../Helper/Schema/Bon19_Schema_forLens";
import { Schema_v1 } from "../../Schema_CRDT/SchemaCRDT";
import { getDoc } from "../../Helper/creator";
import { bidirectionalSync } from "../../Helper/sync";
import { SchemaLensEngine } from "../../LensEngine/SchemaLensEngine";
import { LensedPropertyGraph } from '../../LensEngine/LensedPropertyGraph';
import { PropertyGraph } from '../../GraphDB_CRDT/PropertyGraph';

describe("Sequential Evolution - basic", () => {
    let schema: Schema_v1;
    let schema2: Schema_v1;
    let pGraph: PropertyGraph;
    let pGraph2: PropertyGraph;
    let lpGraph: LensedPropertyGraph;
    let lpGraph2: LensedPropertyGraph;
    let doc: Y.Doc;
    let doc2: Y.Doc;
    beforeEach(() => {
        doc = getDoc(1);
        doc2 = getDoc(2);
        schema = new Schema_v1(bon19SchemaDef, doc);
        schema2 = new Schema_v1(undefined, doc2);
        pGraph = new PropertyGraph();
        pGraph2 = new PropertyGraph();
        lpGraph = new LensedPropertyGraph(doc, pGraph, new SchemaLensEngine(schema));
        lpGraph2 = new LensedPropertyGraph(doc2, pGraph2, new SchemaLensEngine(schema2));
    })

    test("Scenario from the Figure 1 (Split vs Change Add Property)", () => {
        lpGraph.addNode("message-1", "Message", { imageFile: "POST" });
        bidirectionalSync(doc, doc2);
        const visible_t0 = lpGraph.getVisibleGraph({ lazy: false }).lensedNodes[0];
        const visible2_t0 = lpGraph2.getVisibleGraph({ lazy: false }).lensedNodes[0];
        expect(visible_t0.type).toBe("Message");
        expect(visible_t0.appProps.imageFile).toBe("POST");
        expect(visible_t0.appProps.edited).not.toBeDefined();

        expect(visible2_t0.type).toBe("Message");
        expect(visible2_t0.appProps.imageFile).toBe("POST");
        expect(visible2_t0.appProps.edited).not.toBeDefined();


        schema.SMO_splitNodeType({ legacyType: "Message", splitProperty: "mood", mapping: { happy: "Post", sad: "Comment" }, defaultType: "Post" });

        schema2.SMO_AddPropertyType({ Idenifying: "Message", newProperty: { key: "edited", value: "boolean" }, defa: "false", whatType: "NodeType" });
        lpGraph2.updateNode("message-1", { edited: false });

        const visible_t1 = lpGraph.getVisibleGraph({ lazy: false }).lensedNodes[0];
        const visible2_t1 = lpGraph2.getVisibleGraph({ lazy: false }).lensedNodes[0];
        
        expect(visible_t1.type).toBe("Post");
        expect(visible_t1.appProps.imageFile).toBe("POST");
        expect(visible_t1.appProps.edited).not.toBeDefined();

        expect(visible2_t1.type).toBe("Message");
        expect(visible2_t1.appProps.imageFile).toBe("POST");
        expect(visible2_t1.appProps.edited).toBe(false);

        bidirectionalSync(doc, doc2);

        const visible_t2 = lpGraph.getVisibleGraph({ lazy: false }).lensedNodes[0];
        const visible2_t2 = lpGraph2.getVisibleGraph({ lazy: false }).lensedNodes[0];

        expect(visible_t2.type).toBe("Post");
        expect(visible_t2.appProps.imageFile).toBe("POST");
        expect(visible_t2.appProps.edited).toBe(false);

        expect(visible2_t2.type).toBe("Post");
        expect(visible2_t2.appProps.imageFile).toBe("POST");
        expect(visible2_t2.appProps.edited).toBe(false);


    });

    test("Scenario from the Figure 3 (Rename vs Rename and Retype vs Retype)", () => {
        lpGraph.addNode("person-1", "Person", { lastName: "Hacker", age: 24 });
        bidirectionalSync(doc, doc2);

        const visible_t0 = lpGraph.getVisibleGraph({ lazy: false }).lensedNodes[0];
        const visible2_t0 = lpGraph2.getVisibleGraph({ lazy: false }).lensedNodes[0];
        expect(visible_t0.appProps.lastName).toBe("Hacker");
        expect(visible_t0.appProps.age).toBe(24);
        expect(visible2_t0.appProps.lastName).toBe("Hacker");
        expect(visible2_t0.appProps.age).toBe(24);

        schema2.SMO_renamePropertyKey({ Idenifying: "Person", oldPropertyKey: "lastName", newPropertyKey: "familyName", whatType: "NodeType" });
        schema2.SMO_ChangePropertyType({ Idenifying: "Person", propertyKey: "age", newPropertyType: "boolean", defaultVal: { default: false }, whatType: "NodeType" });

        schema.SMO_renamePropertyKey({ Idenifying: "Person", oldPropertyKey: "lastName", newPropertyKey: "name", whatType: "NodeType" });
        schema.SMO_ChangePropertyType({ Idenifying: "Person", propertyKey: "age", newPropertyType: "string", defaultVal: { default: "" }, whatType: "NodeType" });

        const visible_t1 = lpGraph.getVisibleGraph({ lazy: false }).lensedNodes[0];
        const visible2_t1 = lpGraph2.getVisibleGraph({ lazy: false }).lensedNodes[0];
        
        expect(visible_t1.appProps.name).toBe("Hacker");
        expect(visible_t1.appProps.age).toBe("24");
        expect(visible2_t1.appProps.familyName).toBe("Hacker");
        expect(visible2_t1.appProps.age).toBe(true);


        lpGraph.updateNode("person-1", { name: "Anon", age: "25" });
        lpGraph2.updateNode("person-1", { familyName: "Coder", age: false });

        const visible_t2 = lpGraph.getVisibleGraph({ lazy: false }).lensedNodes[0];
        const visible2_t2 = lpGraph2.getVisibleGraph({ lazy: false }).lensedNodes[0];
        
        expect(visible_t2.appProps.name).toBe("Anon");
        expect(visible_t2.appProps.age).toBe("25");
        expect(visible2_t2.appProps.familyName).toBe("Coder");
        expect(visible2_t2.appProps.age).toBe(false);

        bidirectionalSync(doc, doc2);

        const visible_t3 = lpGraph.getVisibleGraph({ lazy: false }).lensedNodes[0];
        const visible2_t3 = lpGraph2.getVisibleGraph({ lazy: false }).lensedNodes[0];

        expect(schema.transformToJSONCleanSchema().nodeTypes.Person.properties.lastName.name).toBe("familyName");
        expect(schema2.transformToJSONCleanSchema().nodeTypes.Person.properties.lastName.name).toBe("familyName");

        expect(visible_t3.appProps.familyName).toBe("Coder");
        expect(visible_t3.appProps.age).toBe("25");

        expect(visible2_t3.appProps.familyName).toBe("Coder");
        expect(visible2_t3.appProps.age).toBe("25");
    });


    // Additionally Tests
    describe("LENS MAPPINGS (SPLIT & UNION) CONCURRENT EVOLUTION", () => {
            test("Split-Split Conflict: Key Collision on same Legacy NodeType", () => {
                bidirectionalSync(doc, doc2);

                schema.SMO_splitNodeType({
                    legacyType: "Person",
                    splitProperty: "role",
                    mapping: {
                        "Employee": "Employee",
                        "Customer": "Customer"
                    },
                    defaultType: "Customer"
                });

                schema2.SMO_splitNodeType({
                    legacyType: "Person",
                    splitProperty: "status",
                    mapping: {
                        "Active": "ActiveUser",
                        "Inactive": "InactiveUser"
                    },
                    defaultType: "InactiveUser"
                });

                bidirectionalSync(doc, doc2);

                const engine1 = new SchemaLensEngine(schema);
                const engine2 = new SchemaLensEngine(schema2);

                expect(engine1.resolveActiveType("Person", { role: "Employee", status: "Active" }))
                    .toEqual(engine2.resolveActiveType("Person", { role: "Employee", status: "Active" }));
                
                const testWrite = engine1.encodeNodeForGraph("Employee", { firstName: "Alice" });
                const testWrite2 = engine2.encodeNodeForGraph("Employee", { firstName: "Alice" });
                expect(testWrite).toEqual(testWrite2);
            });

            test("Union-Union Conflict: Key Collision on same target NodeType", () => {
                bidirectionalSync(doc, doc2);

                schema.SMO_unionNodeTypes({
                    newType: "Tenant",
                    legacyTypes: ["ResidentNode", "CitizenNode"],
                    writeDefault: "ResidentNode"
                });

                schema2.SMO_unionNodeTypes({
                    newType: "Tenant",
                    legacyTypes: ["GuestNode", "OccupantNode"],
                    writeDefault: "GuestNode"
                });

                bidirectionalSync(doc, doc2);

                const engine1 = new SchemaLensEngine(schema);
                const engine2 = new SchemaLensEngine(schema2);

                expect(engine1.resolveActiveType("ResidentNode", {})).toEqual(engine2.resolveActiveType("ResidentNode", {}));
                expect(engine1.resolveActiveType("GuestNode", {})).toEqual(engine2.resolveActiveType("GuestNode", {}));

                const writeTenant1 = engine1.encodeNodeForGraph("Tenant", { prop: "value" });
                const writeTenant2 = engine2.encodeNodeForGraph("Tenant", { prop: "value" });
                expect(writeTenant1).toEqual(writeTenant2);
            });

            test("Concurrent Split & Union (Specialization vs Generalization priority)", () => {
                bidirectionalSync(doc, doc2);

                schema.SMO_splitNodeType({
                    legacyType: "Person",
                    splitProperty: "role",
                    mapping: {
                        "Employee": "Employee",
                        "Customer": "Customer"
                    },
                    defaultType: "Customer"
                });

                schema2.SMO_unionNodeTypes({
                    newType: "LegalEntity",
                    legacyTypes: ["Person", "Company"],
                    writeDefault: "Person"
                });

                bidirectionalSync(doc, doc2);

                const engine1 = new SchemaLensEngine(schema);
                const engine2 = new SchemaLensEngine(schema2);

                const resolvedA = engine1.resolveActiveType("Person", { role: "Employee" });
                const resolvedB = engine2.resolveActiveType("Person", { role: "Employee" });
                
                expect(resolvedA).toBe("Employee");
                expect(resolvedB).toBe("Employee");

                const resolvedCompA = engine1.resolveActiveType("Company", {});
                const resolvedCompB = engine2.resolveActiveType("Company", {});
                expect(resolvedCompA).toBe("LegalEntity");
                expect(resolvedCompB).toBe("LegalEntity");
            });

            test("Concurrent Property Addition on Legacy Type", () => {
                bidirectionalSync(doc, doc2);

                schema.SMO_splitNodeType({
                    legacyType: "Person",
                    splitProperty: "role",
                    mapping: {
                        "Employee": "Employee",
                        "Customer": "Customer"
                    },
                    defaultType: "Customer"
                });

                schema2.SMO_AddPropertyType({ Idenifying: "Person",
                    newProperty: { key: "yearlyBonus", value: "number" },
                    whatType: "NodeType"
                });

                bidirectionalSync(doc, doc2);

                const engine1 = new SchemaLensEngine(schema);
                const engine2 = new SchemaLensEngine(schema2);

                const propLens1 = engine1.getPropertyLens("Employee", "yearlyBonus", "NodeType");
                const propLens2 = engine2.getPropertyLens("Employee", "yearlyBonus", "NodeType");

                expect(propLens1).toBeDefined();
                expect(propLens2).toBeDefined();
                expect(propLens1?.value).toBe("number");
                expect(propLens2?.value).toBe("number");
                
                const rawNodes = [
                    { id: "1", type: "Person", props: { role: "Employee", firstName: "Alice", yearlyBonus: 5000 } }
                ];
                const { lensedNodes: lensed1 } = engine1.applyLensToGraph(rawNodes, []);
                const { lensedNodes: lensed2 } = engine2.applyLensToGraph(rawNodes, []);

                expect(lensed1[0].appProps.yearlyBonus).toBe(5000);
                expect(lensed2[0].appProps.yearlyBonus).toBe(5000);
            });
                    test("Union NodeType", () => {
            schema.SMO_addNodeType("ResidentNode", ["res"], { residentId: "string" });
            schema.SMO_addNodeType("CitizenNode", ["cit"], { passportId: "string" });

            schema.SMO_unionNodeTypes({
                newType: "TenantNode",
                legacyTypes: ["ResidentNode", "CitizenNode"],
                writeDefault: "ResidentNode"
            });

            const engine = new SchemaLensEngine(schema);

            const rawNodes = [
                { id: "1", type: "ResidentNode", props: { residentId: "R123" } },
                { id: "2", type: "CitizenNode", props: { passportId: "C456" } }
            ];
            const { lensedNodes } = engine.applyLensToGraph(rawNodes, []);
            expect(lensedNodes).toHaveLength(2);
            expect(lensedNodes[0].type).toBe("TenantNode");
            expect(lensedNodes[0].appProps.residentId).toBe("R123");
            expect(lensedNodes[1].type).toBe("TenantNode");
            expect(lensedNodes[1].appProps.passportId).toBe("C456");

            const writeTenant = engine.encodeNodeForGraph("TenantNode", { residentId: "R123" });
            expect(writeTenant.dbType).toBe("ResidentNode");
            expect(writeTenant.dbProps.residentId).toEqual({ value: "R123", writeType: "string" });
        });
        test("Precedence: Split prioritized over Union", () => {
            schema.SMO_addNodeType("BaseNode", ["base"], { typeKey: "string", sharedProp: "string" });

            schema.SMO_splitNodeType({
                legacyType: "BaseNode",
                splitProperty: "typeKey",
                mapping: {
                    "SpecialA": "SpecialA",
                    "SpecialB": "SpecialB"
                },
                defaultType: "SpecialA"
            });

            schema.SMO_unionNodeTypes({
                newType: "GeneralNode",
                legacyTypes: ["BaseNode"],
                writeDefault: "BaseNode"
            });

            const engine = new SchemaLensEngine(schema);

            const rawNodes = [
                { id: "1", type: "BaseNode", props: { typeKey: "SpecialB", sharedProp: "hello" } }
            ];
            const { lensedNodes } = engine.applyLensToGraph(rawNodes, []);
            expect(lensedNodes).toHaveLength(1);
            expect(lensedNodes[0].type).toBe("SpecialB");
            expect(lensedNodes[0].appProps.sharedProp).toBe("hello");
        });
        });
});