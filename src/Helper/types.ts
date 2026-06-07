// TODO Order a bit
export type NodeId = string;
export type EdgeId = string;
// Policy Types - ONLY OBSERVED_REMOVE is supported here
export type Policy = "ADD_WINS" | "OBSERVED_REMOVE";

 
export type NodeProps = Record<string, any>;
export type EdgeProps = Record<string, any>;

export type PrimitiveData = 'string' | 'number' | 'boolean' | 'date';

export type dataTypes =
    | PrimitiveData

export interface PropertyLensMap {
    value: dataTypes; 
    default: any; 
    transformerMap?: Record<string, string>; 
    // automated mapping dictionary e.g.: { "sad": "0", "happy": "10", "default": "-1" }
}

export type whatType = "NodeType" | "RelationshipType";

export type defaultVal = {
    default: number | string | boolean | Date;
    transformerMap?: Record<string, string>;
}

export type VisibleNode = {
    id: NodeId;
    type: string;
    label?: string[];
    color?: string;
    props: NodeProps;
};

export type VisibleEdge = {
    id: EdgeId;
    type: string;
    sourceId: NodeId;
    targetId: NodeId;
    props: EdgeProps;
};

export type GraphedVisibleNode = VisibleNode & { label: string[]; appProps: Record<string, any> };
export type GraphedVisibleEdge = VisibleEdge & { appProps: Record<string, any> };

export type NodeRow = Record<string, any>;

export type EdgeRow = Record<string, any>;

export type IdLookup = Map<number, string>;


export type FoundUUIDs = Set<string>;

export interface SchemaDefinition {
    nodes: Array<{
        identifyingType: string;
        labels: string[];
        properties: Record<string, string>;
    }>;
    relationships: Array<{
        identifyingEdge: string;
        sourceNodeLabel: string;
        targetNodeLabel: string;
        properties: Record<string, string>;
    }>;
}




