// Shared types used by both client components and (mirrored from) server.

export type NodeKind = 'file' | 'function';
export type EdgeKind = 'IMPORTS' | 'CALLS' | 'CONTAINS' | 'DEFINES' | 'EXTENDS' | 'DOCUMENTS';

export interface GraphNode {
    id: string;
    label: string;
    type: 'file' | 'function' | 'class' | 'method' | 'import' | 'python_function' | 'python_class' | 'config' | 'doc';
    fileId: string;
    filePath: string;
    startLine?: number;
    endLine?: number;
    centrality: number;   // degree centrality 0–1
    module: string;       // top-level folder for color grouping
}

export interface GraphEdge {
    id: string;
    source: string;
    target: string;
    kind: EdgeKind;
}

export interface GraphData {
    nodes: GraphNode[];
    edges: GraphEdge[];
    crossModuleEdges: number;
}

export interface DetectedProcess {
    name: string;
    steps: number;
    explanation: string;
    mermaid: string;
}

export type LLMProvider = 'auto' | 'openai' | 'anthropic' | 'groq' | 'cerebras' | 'custom';

export interface LLMConfig {
    provider: LLMProvider;
    apiKey: string;
    model: string;
    baseUrl?: string;
}

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface BlastMetrics {
    impactedNodes: number;
    impactedFiles: number;
    cascadeDepth: number;
    riskLevel: RiskLevel;
    riskScore: number;          // numeric: nodes*0.5 + depth*0.3 + crossModule*0.2
    crossModuleEdges: number;   // cross-module blast edges
    nodeIds: Set<string>;
    depthMap: Map<string, number>; // nodeId → BFS depth (for animation)
}
