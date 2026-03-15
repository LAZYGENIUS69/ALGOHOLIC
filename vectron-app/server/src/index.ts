import dotenv from "dotenv";
dotenv.config();

import express from "express";
import path from "path";
import cors from "cors";
import multer from "multer";
import AdmZip from "adm-zip";
import Cerebras from "@cerebras/cerebras_cloud_sdk";
import Groq from "groq-sdk";
import { buildGraph, GraphData } from "./graph-builder";

const app = express();
const PORT = process.env.PORT || 3001;
const groqClient = new Groq({ apiKey: process.env.GROQ_API_KEY });
const cerebrasClient = new Cerebras({ apiKey: process.env.CEREBRAS_API_KEY });

const MAX_FILE_BYTES = 500 * 1024;
const MAX_SOURCE_FILES = 500;
const fileCache = new Map<string, string>();

interface ProcessDefinition {
  name: string;
  steps: number;
  explanation: string;
  mermaid: string;
}

interface ReportStats {
  totalFiles: number;
  totalFunctions: number;
  mostConnectedComponent: string;
  mostConnectedDegree: number;
  deepestDependencyChain: string;
  deepestDependencyDepth: number;
}

interface LLMProvider {
  name: string;
  isConfigured: boolean;
  call: () => Promise<string>;
}

interface LLMCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
}

function isSmallCodebase(graphData: GraphData): boolean {
  return graphData.nodes.length < 200;
}

function hasValidGroqApiKey(): boolean {
  const apiKey = process.env.GROQ_API_KEY || "";
  return !!apiKey && apiKey !== "PASTE_YOUR_KEY_HERE" && apiKey !== "your_actual_key_here";
}

function hasValidCerebrasApiKey(): boolean {
  const apiKey = process.env.CEREBRAS_API_KEY || "";
  return !!apiKey && apiKey !== "PASTE_YOUR_KEY_HERE" && apiKey !== "your_key_here";
}

async function callLLM(systemPrompt: string, userMessage: string): Promise<string> {
  const providers: LLMProvider[] = [
    {
      name: "Groq",
      isConfigured: hasValidGroqApiKey(),
      call: async () => {
        const res = await groqClient.chat.completions.create({
          model: "llama-3.3-70b-versatile",
          messages: [
            { role: "system" as const, content: systemPrompt },
            { role: "user" as const, content: userMessage },
          ],
          max_tokens: 2048,
          temperature: 0.3,
        });
        return (res as LLMCompletionResponse).choices?.[0]?.message?.content ?? "";
      },
    },
    {
      name: "Cerebras",
      isConfigured: hasValidCerebrasApiKey(),
      call: async () => {
        const res = await cerebrasClient.chat.completions.create({
          model: "llama3.1-8b",
          messages: [
            { role: "system" as const, content: systemPrompt },
            { role: "user" as const, content: userMessage },
          ],
          max_tokens: 2048,
        });
        return (res as LLMCompletionResponse).choices?.[0]?.message?.content ?? "";
      },
    },
  ];
  const failures: string[] = [];

  for (const provider of providers) {
    if (!provider.isConfigured) {
      continue;
    }

    try {
      console.log(`[LLM] Trying ${provider.name}...`);
      const result = (await provider.call()).trim();

      if (!result) {
        console.warn(`[LLM] ${provider.name} returned an empty response`);
        failures.push(`${provider.name}: empty response`);
        continue;
      }

      console.log(`[LLM] Success with ${provider.name}`);
      return result;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      failures.push(`${provider.name}: ${message}`);
      console.warn(`[LLM] ${provider.name} failed: ${message}`);
      continue;
    }
  }

  if (failures.length === 0) {
    throw new Error("All LLM providers are unavailable");
  }

  throw new Error(`All LLM providers failed: ${failures.join(" | ")}`);
}

function buildCompactGraphSummary(graphData: GraphData): string {
  const nodeDegree = new Map<string, number>();
  graphData.edges.forEach((edge) => {
    nodeDegree.set(edge.source, (nodeDegree.get(edge.source) || 0) + 1);
    nodeDegree.set(edge.target, (nodeDegree.get(edge.target) || 0) + 1);
  });

  const isLarge = graphData.nodes.length > 100;
  const filteredNodes = isLarge
    ? graphData.nodes.filter(
        (node) =>
          node.type === "file" ||
          node.type === "class" ||
          (nodeDegree.get(node.id) || 0) > 2,
      )
    : graphData.nodes;

  const filteredNodeIds = new Set(filteredNodes.map((node) => node.id));
  const filteredEdges = graphData.edges.filter(
    (edge) => filteredNodeIds.has(edge.source) && filteredNodeIds.has(edge.target),
  );

  const idToLabel = new Map<string, string>();
  graphData.nodes.forEach((node) => {
    idToLabel.set(node.id, node.label || node.id);
  });

  const nodeSummaries = filteredNodes.map(
    (node) =>
      `id: ${node.id} | label: ${node.label} | type: ${node.type} | file: ${node.filePath}`,
  );
  const edgeSummaries = filteredEdges.map((edge) => {
    const sourceLabel = idToLabel.get(edge.source) || edge.source;
    const targetLabel = idToLabel.get(edge.target) || edge.target;
    return `${sourceLabel} --${edge.kind}--> ${targetLabel}`;
  });

  let summary = "NODES:\n";
  summary += nodeSummaries.length > 0 ? nodeSummaries.join("\n") : "None";
  summary += "\n\nEDGES:\n";
  summary += edgeSummaries.length > 0 ? edgeSummaries.join("\n") : "None";

  if (summary.length > 12000) {
    summary = summary.substring(0, 12000) + "... [truncated]";
  }

  return summary;
}

function extractMermaidLabels(mermaid: string): string[] {
  const matches = mermaid.match(/\[[^\]]+\]/g) || [];
  return matches.map((match) => match.slice(1, -1).trim()).filter(Boolean);
}

function sanitizeProcesses(
  raw: unknown,
  allowedLabels: Set<string>,
  minimumSteps: number,
  focusNode?: string,
): ProcessDefinition[] {
  if (!Array.isArray(raw)) return [];

  return raw
    .map((item) => {
      if (!item || typeof item !== "object") return null;

      const candidate = item as Partial<ProcessDefinition>;
      const name = typeof candidate.name === "string" ? candidate.name.trim() : "";
      const explanation =
        typeof candidate.explanation === "string" ? candidate.explanation.trim() : "";
      const mermaid = typeof candidate.mermaid === "string" ? candidate.mermaid.trim() : "";
      const steps =
        typeof candidate.steps === "number" && Number.isFinite(candidate.steps)
          ? Math.max(0, Math.floor(candidate.steps))
          : 0;

      const labels = extractMermaidLabels(mermaid);
      const hasOnlyKnownLabels =
        labels.length >= minimumSteps && labels.every((label) => allowedLabels.has(label));
      const hasFocusNode = !focusNode || labels.includes(focusNode);

      if (!name || !explanation || !mermaid || steps < minimumSteps || !hasOnlyKnownLabels || !hasFocusNode) {
        return null;
      }

      return { name, steps, explanation, mermaid };
    })
    .filter((process): process is ProcessDefinition => process !== null);
}

function computeReportStats(graphData: GraphData): ReportStats {
  const fileNodes = graphData.nodes.filter((node) => node.type === "file");
  const functionNodes = graphData.nodes.filter(
    (node) => node.type === "function" || node.type === "method",
  );

  const degreeMap = new Map<string, number>();
  graphData.nodes.forEach((node) => degreeMap.set(node.id, 0));
  graphData.edges.forEach((edge) => {
    degreeMap.set(edge.source, (degreeMap.get(edge.source) ?? 0) + 1);
    degreeMap.set(edge.target, (degreeMap.get(edge.target) ?? 0) + 1);
  });

  let mostConnectedNode = graphData.nodes[0];
  let mostConnectedDegree = mostConnectedNode ? degreeMap.get(mostConnectedNode.id) ?? 0 : 0;
  graphData.nodes.forEach((node) => {
    const degree = degreeMap.get(node.id) ?? 0;
    if (!mostConnectedNode || degree > mostConnectedDegree) {
      mostConnectedNode = node;
      mostConnectedDegree = degree;
    }
  });

  const adjacency = new Map<string, string[]>();
  graphData.nodes.forEach((node) => adjacency.set(node.id, []));
  graphData.edges.forEach((edge) => {
    if (edge.kind === "CALLS" || edge.kind === "IMPORTS" || edge.kind === "DEFINES") {
      adjacency.get(edge.source)?.push(edge.target);
    }
  });

  let deepestStart: string | null = null;
  let deepestEnd: string | null = null;
  let deepestDepth = 0;

  graphData.nodes.forEach((startNode) => {
    const visited = new Set<string>([startNode.id]);
    const queue: Array<{ id: string; depth: number }> = [{ id: startNode.id, depth: 0 }];

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) continue;

      if (current.depth > deepestDepth) {
        deepestDepth = current.depth;
        deepestStart = startNode.label;
        deepestEnd = graphData.nodes.find((node) => node.id === current.id)?.label ?? current.id;
      }

      const neighbors = adjacency.get(current.id) ?? [];
      neighbors.forEach((neighbor) => {
        if (visited.has(neighbor)) return;
        visited.add(neighbor);
        queue.push({ id: neighbor, depth: current.depth + 1 });
      });
    }
  });

  return {
    totalFiles: fileNodes.length,
    totalFunctions: functionNodes.length,
    mostConnectedComponent: mostConnectedNode?.label ?? "None",
    mostConnectedDegree,
    deepestDependencyChain:
      deepestStart && deepestEnd
        ? `${deepestStart} -> ${deepestEnd}`
        : "No dependency chain detected",
    deepestDependencyDepth: deepestDepth,
  };
}

app.use(cors({ origin: "http://localhost:5173" }));
app.use(express.json({ limit: "50mb" }));

app.post("/api/query", async (req, res) => {
  console.log("Query received:", req.body.question);

  const { question, graphData } = req.body as { question: string; graphData: GraphData };

  if (!question || !graphData) {
    res.status(400).json({ error: "Missing question or graphData" });
    return;
  }

  try {
    const summary = buildCompactGraphSummary(graphData);

    const systemPrompt = `You are an expert software architect analyzing a real codebase.
You have been given the actual nodes and edges of a dependency graph.

When answering questions, you MUST follow this exact format:

CALL CHAIN (always first):
ComponentA.tsx -> functionB() -> api.ts -> /endpoint -> parser.ts -> output

EXPLANATION (2-3 sentences after the chain):
Explain WHY each step happens, what data is passed between them,
and what the key logic is at each step. Be specific about function
names and file names. Write like a senior engineer explaining to
a colleague, not like documentation.

RULES:
- Only reference files and functions that exist in the provided node list
- Never say 'it appears' or 'seems to' - be direct and confident
- Always show the arrow chain first before any explanation
- If multiple call chains exist show all of them
- Be technical and specific, not generic

You MUST respond with ONLY valid JSON, no markdown, no backticks:
{
  "explanation": "CALL CHAIN:\\nA -> B -> C\\n\\nEXPLANATION:\\nyour text here",
  "relevantNodes": ["nodeId1", "nodeId2", "nodeId3"]
}`;

    const text = await callLLM(systemPrompt, `GRAPH DATA:\n${summary}\n\nUSER QUESTION:\n${question}`);

    try {
      const jsonStr = text.replace(/```json\n?|```/g, "").trim();
      const parsed = JSON.parse(jsonStr);
      res.json({
        explanation: parsed.explanation || "No explanation provided.",
        relevantNodes: parsed.relevantNodes || [],
      });
    } catch (parseErr) {
      console.error("[VECTRON] AI Parse error:", parseErr, "Raw text:", text);
      res.json({
        explanation: "Could not analyze codebase response. Please try again.",
        relevantNodes: [],
      });
    }
  } catch (err: unknown) {
    console.error("[LLM] Query error:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ explanation: `Query failed: ${message}`, relevantNodes: [] });
  }
});

app.post("/api/node-summary", async (req, res) => {
  const { graphData, nodeId, label, type } = req.body as {
    graphData: GraphData;
    nodeId: string;
    label: string;
    type: string;
  };

  if (!graphData || !nodeId || !label || !type) {
    res.status(400).json({ error: "Missing graphData, nodeId, label, or type", summary: "" });
    return;
  }

  const node = graphData.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) {
    res.status(404).json({ error: "Node not found in graphData", summary: "" });
    return;
  }

  const incoming = graphData.edges
    .filter((edge) => edge.target === nodeId)
    .map((edge) => graphData.nodes.find((candidate) => candidate.id === edge.source)?.label ?? edge.source);
  const outgoing = graphData.edges
    .filter((edge) => edge.source === nodeId)
    .map((edge) => graphData.nodes.find((candidate) => candidate.id === edge.target)?.label ?? edge.target);

  try {
    const systemPrompt = `Given this node '${label}' of type '${type}' in a codebase, write exactly one sentence describing what it likely does based on its name and connections.`;
    const userMessage = `NODE LABEL: ${label}
NODE TYPE: ${type}
FILE PATH: ${node.filePath}
INCOMING CONNECTIONS (${incoming.length}): ${incoming.length > 0 ? incoming.join(", ") : "None"}
OUTGOING CONNECTIONS (${outgoing.length}): ${outgoing.length > 0 ? outgoing.join(", ") : "None"}

Return exactly one sentence with no markdown and no bullets.`;
    const summary = await callLLM(systemPrompt, userMessage);
    const normalized = summary.replace(/\s+/g, " ").trim();
    const sentence = normalized.split(/(?<=[.!?])\s+/)[0] ?? normalized;

    res.json({ summary: sentence.trim() });
  } catch (err: unknown) {
    console.error("[LLM] Node summary error:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: `Node summary failed: ${message}`, summary: "" });
  }
});

app.post("/api/processes", async (req, res) => {
  const { graphData, focusNode } = req.body as { graphData: GraphData; focusNode?: string };

  if (!graphData) {
    res.status(400).json({ error: "Missing graphData" });
    return;
  }

  try {
    const summary = buildCompactGraphSummary(graphData);
    const smallCodebase = isSmallCodebase(graphData);
    const allowedLabels = new Set(graphData.nodes.map((node) => node.label));
    const systemPrompt = `You are an expert software architect. You have been given a dependency graph of a real codebase as nodes and edges.

Analyze the graph and detect all meaningful processes - a process is a complete flow from a trigger point (user action, API call, event) through to an output or side effect.

For each process generate a Mermaid flowchart diagram.

If the codebase is small (under 200 nodes), still detect 3-5 processes even if they are simple. A process can be as small as 2-3 steps.
For small codebases prioritize: the main data flow, the render cycle, and any user interaction handler.
Never return an empty processes array - always return at least 3 processes.
${focusNode ? `Focus specifically on processes that involve the node '${focusNode}'.
Only return processes where this node appears as a step.` : ""}

You MUST respond with ONLY valid JSON, no markdown, no backticks:
{
  "processes": [
    {
      "name": "File Upload Flow",
      "steps": 5,
      "explanation": "plain english description of what this process does",
      "mermaid": "graph TD\\n  A[UploadZone] --> B[api.ts]\\n  B --> C[/api/upload]\\n  C --> D[parser.ts]\\n  D --> E[GraphView2D]"
    }
  ]
}

Rules:
- Detect 5-10 most important processes only
- Only reference nodes that exist in the provided graph
- Mermaid syntax must be valid - use graph TD format
- Each process must have at least ${smallCodebase ? "2" : "3"} steps
- Process names must be human readable like 'File Upload Flow'
- Never invent nodes that dont exist in the graph`;

    const text = await callLLM(systemPrompt, `GRAPH DATA:\n${summary}`);

    try {
      const jsonStr = text.replace(/```json\n?|```/g, "").trim();
      const parsed = JSON.parse(jsonStr);
      const processes = sanitizeProcesses(
        parsed.processes,
        allowedLabels,
        smallCodebase ? 2 : 3,
        focusNode,
      );
      console.log("Processes detected:", processes.length);
      res.json({ processes });
    } catch (parseErr) {
      console.error("[VECTRON] Process Parse error:", parseErr, "Raw text:", text);
      res.json({ processes: [] });
    }
  } catch (err: unknown) {
    console.error("[LLM] Process detection error:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: `Process detection failed: ${message}`, processes: [] });
  }
});

app.post("/api/report", async (req, res) => {
  const { graphData } = req.body as { graphData: GraphData };

  if (!graphData) {
    res.status(400).json({ error: "Missing graphData" });
    return;
  }

  try {
    const summary = buildCompactGraphSummary(graphData);
    const stats = computeReportStats(graphData);
    const systemPrompt = `You are a senior software architect. Analyze this codebase knowledge graph and generate a comprehensive intelligence report.

Respond in clean markdown format with these exact sections:

# Codebase Intelligence Report

## Executive Summary
2-3 sentences describing what this project does and its overall architecture.

## Architecture Overview
Describe the main architectural pattern, key layers, and how they interact.
Reference specific files and their roles.

## Component Breakdown
For each major file/component: what it does, what it depends on,
what depends on it.

## Dependency Hotspots
Top 5 most connected nodes - these are the riskiest to change.
Format as: **filename** - N connections - why it matters

## Risk Assessment
Which parts of the codebase are most fragile? What would cause
the most damage if changed? Be specific with file names.

## Onboarding Guide
If a new developer joined today, what 5 files should they read first
and in what order? Why?

## Quick Stats
- Total files parsed
- Total functions detected
- Most connected component
- Deepest dependency chain

Only reference nodes that actually exist in the provided graph.
Be specific, technical, and useful. Write like a senior engineer.`;

    const text = await callLLM(
      systemPrompt,
      `GRAPH DATA:\n${summary}\n\nEXACT STATS:\n- Total files parsed: ${stats.totalFiles}\n- Total functions detected: ${stats.totalFunctions}\n- Most connected component: ${stats.mostConnectedComponent} (${stats.mostConnectedDegree} connections)\n- Deepest dependency chain: ${stats.deepestDependencyChain} (${stats.deepestDependencyDepth} hops)`,
    );

    res.json({ report: text.trim() });
  } catch (err: unknown) {
    console.error("Report generation error:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: `Report generation failed: ${message}`, report: "" });
  }
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === "application/zip" || file.originalname.endsWith(".zip")) {
      cb(null, true);
    } else {
      cb(new Error("Only .zip files are accepted"));
    }
  },
});

app.post("/api/upload", upload.single("file"), (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }

  try {
    const zip = new AdmZip(req.file.buffer);
    const entries = zip.getEntries();

    const sourceFiles: { path: string; content: string }[] = [];
    let skippedOversized = 0;
    let skippedUnreadable = 0;

    for (const entry of entries) {
      if (sourceFiles.length >= MAX_SOURCE_FILES) break;
      if (entry.isDirectory) continue;

      const entryPath = entry.entryName;

      if (/(node_modules|\.git|dist|build|\.next|coverage)\//.test(entryPath)) continue;
      if (!/\.(js|jsx|ts|tsx)$/.test(entryPath)) continue;

      if (entry.header.size > MAX_FILE_BYTES) {
        skippedOversized++;
        continue;
      }

      try {
        const content = entry.getData().toString("utf-8");
        sourceFiles.push({ path: entryPath, content });
      } catch {
        skippedUnreadable++;
      }
    }

    if (skippedOversized > 0 || skippedUnreadable > 0) {
      console.warn(
        `[VECTRON] ZIP sampled: skipped ${skippedOversized} oversized file(s) ` +
          `(>${MAX_FILE_BYTES / 1024}KB) and ${skippedUnreadable} unreadable file(s). ` +
          `Processing ${sourceFiles.length} of eligible source files.`,
      );
    } else {
      console.log(`[VECTRON] Processing ${sourceFiles.length} source file(s).`);
    }

    fileCache.clear();
    for (const file of sourceFiles) {
      fileCache.set(file.path, file.content);
    }

    if (sourceFiles.length === 0) {
      res.status(422).json({ error: "No parseable JS/TS files found in the zip" });
      return;
    }

    const graph = buildGraph(sourceFiles);
    res.json(graph);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[VECTRON] Upload error:", message);
    res.status(500).json({ error: `Processing failed: ${message}` });
  }
});

app.get("/api/file", (req, res) => {
  const filePath = req.query.path as string;
  if (!filePath) {
    res.status(400).json({ error: "Missing path parameter" });
    return;
  }

  const content = fileCache.get(filePath);
  if (content === undefined) {
    res.status(404).json({ error: "File not found in cache" });
    return;
  }

  res.json({ path: filePath, content });
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "VECTRON Server" });
});

app.use(express.static(path.join(__dirname, "../../client/dist")));
app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "../../client/dist/index.html"));
});

app.listen(PORT, () => {
  console.log(`VECTRON server listening on http://localhost:${PORT}`);
});
