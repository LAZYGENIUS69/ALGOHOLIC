import path from "path";
import { parseFile } from "./parser";

// graph builder optimized
export type NodeKind = "file" | "function";
export type EdgeKind =
  | "IMPORTS"
  | "CALLS"
  | "CONTAINS"
  | "DEFINES"
  | "EXTENDS"
  | "DOCUMENTS";

export type GraphNodeType =
  | "file"
  | "function"
  | "class"
  | "method"
  | "import"
  | "python_function"
  | "python_class"
  | "config"
  | "doc";

export interface GraphNode {
  id: string;
  label: string;
  type: GraphNodeType;
  fileId: string;
  filePath: string;
  startLine?: number;
  endLine?: number;
  centrality: number;
  module: string;
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

let _seq = 0;
function uid(prefix: string): string {
  return `${prefix}_${++_seq}`;
}

function extractModule(filePath: string): string {
  const parts = filePath.replace(/\\/g, "/").split("/");
  if (parts.length > 1) return parts[0];
  return "root";
}

function resolveRelativePythonImport(importerPath: string, specifier: string): string {
  const normalized = specifier.replace(/\.+/g, (dots) => `__DOTS__${dots.length}__`);
  if (!normalized.startsWith("__DOTS__")) return specifier.replace(/\./g, "/");

  const parts = normalized.split("/");
  const first = parts[0];
  const dotCount = Number(first.replace(/[^0-9]/g, "")) || 1;
  const remainder = specifier.slice(dotCount).replace(/\./g, "/");
  const baseParts = path.dirname(importerPath).replace(/\\/g, "/").split("/");
  const keepLength = Math.max(0, baseParts.length - (dotCount - 1));
  const rootPath = baseParts.slice(0, keepLength).join("/");
  return [rootPath, remainder].filter(Boolean).join("/");
}

function resolveImport(importerPath: string, specifier: string, knownPaths: Set<string>): string | null {
  const extensionCandidates = [
    "",
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".py",
    ".json",
    ".yaml",
    ".yml",
    ".md",
    "/index.ts",
    "/index.tsx",
    "/index.js",
    "/index.jsx",
    "/__init__.py",
  ];

  let bases: string[] = [];

  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    const base = path.dirname(importerPath);
    bases = [path.join(base, specifier).replace(/\\/g, "/")];
  } else if (/^\.+[A-Za-z0-9_.-]*$/.test(specifier)) {
    bases = [resolveRelativePythonImport(importerPath, specifier)];
  } else if (specifier.includes(".")) {
    bases = [specifier.replace(/\./g, "/")];
  } else {
    return null;
  }

  for (const baseCandidate of bases) {
    for (const extension of extensionCandidates) {
      const candidate = `${baseCandidate}${extension}`.replace(/\\/g, "/");
      if (knownPaths.has(candidate)) return candidate;
    }
  }

  return null;
}

const CALLABLE_NODE_TYPES = new Set<GraphNodeType>([
  "function",
  "method",
  "python_function",
  "python_class",
]);

const NON_FILE_NODE_TYPES = new Set<GraphNodeType>([
  "function",
  "class",
  "method",
  "import",
  "python_function",
  "python_class",
  "config",
  "doc",
]);

export function buildGraph(files: { path: string; content: string }[]): GraphData {
  _seq = 0;
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const fileNodeMap = new Map<string, string>();
  const knownPaths = new Set(files.map((file) => file.path));
  const parsedFiles = new Map<string, ReturnType<typeof parseFile>>();

  files.forEach((file) => {
    parsedFiles.set(file.path, parseFile(file.path, file.content));
  });

  for (const file of files) {
    const nodeId = uid("file");
    const mod = extractModule(file.path);
    const parsed = parsedFiles.get(file.path);

    fileNodeMap.set(file.path, nodeId);
    nodes.push({
      id: nodeId,
      label: path.basename(file.path),
      type: parsed?.fileNodeType === "doc" ? "doc" : "file",
      fileId: file.path,
      filePath: file.path,
      centrality: 0,
      module: mod,
    });
  }

  const callableNameToIds = new Map<string, string[]>();
  const fileMetadata = new Map<string, { callees: string[]; fileNodeId: string }>();

  for (const file of files) {
    const parsed = parsedFiles.get(file.path);
    if (!parsed) continue;

    const fileNodeId = fileNodeMap.get(file.path)!;
    const fileNode = nodes.find((node) => node.id === fileNodeId);
    const mod = fileNode?.module ?? "root";

    for (const parsedNode of parsed.nodes) {
      const nodeId = uid("node");
      nodes.push({
        id: nodeId,
        label: parsedNode.name,
        type: parsedNode.type,
        fileId: file.path,
        filePath: file.path,
        startLine: parsedNode.startLine,
        endLine: parsedNode.endLine,
        centrality: 0,
        module: mod,
      });

      if (CALLABLE_NODE_TYPES.has(parsedNode.type)) {
        if (!callableNameToIds.has(parsedNode.name)) {
          callableNameToIds.set(parsedNode.name, []);
        }
        callableNameToIds.get(parsedNode.name)!.push(nodeId);
      }

      if (parsedNode.type !== "import") {
        edges.push({
          id: uid("e"),
          source: fileNodeId,
          target: nodeId,
          kind: parsedNode.edgeKind,
        });
      }
    }

    parsed.imports.forEach((specifier) => {
      const targetPath = resolveImport(file.path, specifier, knownPaths);
      if (!targetPath) return;

      const targetId = fileNodeMap.get(targetPath);
      if (!targetId || targetId === fileNodeId) return;

      edges.push({
        id: uid("e"),
        source: fileNodeId,
        target: targetId,
        kind: "IMPORTS",
      });
    });

    fileMetadata.set(file.path, {
      callees: parsed.callees,
      fileNodeId,
    });
  }

  for (const file of files) {
    const metadata = fileMetadata.get(file.path);
    if (!metadata) continue;

    const sourceNodeIds = nodes
      .filter((node) => NON_FILE_NODE_TYPES.has(node.type) && node.type !== "import" && node.filePath === file.path)
      .map((node) => node.id);

    metadata.callees.forEach((callee) => {
      const targetIds = callableNameToIds.get(callee);
      if (!targetIds) return;

      sourceNodeIds.forEach((sourceId) => {
        targetIds.forEach((targetId) => {
          if (sourceId === targetId) return;
          edges.push({
            id: uid("e"),
            source: sourceId,
            target: targetId,
            kind: "CALLS",
          });
        });
      });
    });
  }

  const outDegree = new Map<string, number>();
  nodes.forEach((node) => outDegree.set(node.id, 0));
  edges.forEach((edge) => {
    outDegree.set(edge.source, (outDegree.get(edge.source) ?? 0) + 1);
  });

  const maxDegree = Math.max(1, ...outDegree.values());
  nodes.forEach((node) => {
    node.centrality = (outDegree.get(node.id) ?? 0) / maxDegree;
  });

  const nodeModuleMap = new Map<string, string>();
  nodes.forEach((node) => nodeModuleMap.set(node.id, node.module));

  let crossModuleEdges = 0;
  edges.forEach((edge) => {
    const srcMod = nodeModuleMap.get(edge.source);
    const tgtMod = nodeModuleMap.get(edge.target);
    if (srcMod && tgtMod && srcMod !== tgtMod) {
      crossModuleEdges++;
    }
  });

  return { nodes, edges, crossModuleEdges };
}
