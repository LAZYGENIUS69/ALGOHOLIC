import dotenv from "dotenv";
dotenv.config();

import express from "express";
import fs from "fs/promises";
import os from "os";
import path from "path";
import cors from "cors";
import multer from "multer";
import AdmZip from "adm-zip";
import Cerebras from "@cerebras/cerebras_cloud_sdk";
import Groq from "groq-sdk";
import fetch from "node-fetch";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { buildGraph, GraphData } from "./graph-builder";
import { getGraph, setGraph } from "./graph-store";
import { startMCPServer } from "./mcp-server";

const app = express();
const PORT = process.env.PORT || 3001;
const groqClient = new Groq({ apiKey: process.env.GROQ_API_KEY });
const cerebrasClient = new Cerebras({ apiKey: process.env.CEREBRAS_API_KEY });

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_SOURCE_FILES = 2500;
const MAX_TOTAL_SOURCE_BYTES = 25 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;
const GITHUB_DOWNLOAD_TIMEOUT_MS = 30_000;
const fileCache = new Map<string, string>();

interface ProcessDefinition {
  name: string;
  steps: number;
  entryPoint: string;
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

type LLMProviderKey = "auto" | "asi1" | "openai" | "anthropic" | "groq" | "cerebras" | "custom";

interface LLMConfigPayload {
  provider: string;
  apiKey: string;
  model: string;
  baseUrl?: string;
}

interface CustomLLMConfig {
  provider: Exclude<LLMProviderKey, "auto">;
  apiKey: string;
  model: string;
  baseUrl?: string;
}

interface LLMCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
}

interface LLMCallResult {
  content: string;
  provider: string;
}

interface LLMCallOptions {
  asi1Temperature?: number;
  asi1Reasoning?: boolean;
  maxTokens?: number;
}

interface SourceFile {
  path: string;
  content: string;
}

class CloneValidationError extends Error {}
class CloneTimeoutError extends Error {}
class CloneAccessError extends Error {}
class CloneTooLargeError extends Error {}

function isSmallCodebase(graphData: GraphData): boolean {
  return graphData.nodes.length < 200;
}

function hasValidGroqApiKey(): boolean {
  const apiKey = process.env.GROQ_API_KEY || "";
  return !!apiKey && apiKey !== "PASTE_YOUR_KEY_HERE" && apiKey !== "your_actual_key_here";
}

function hasValidASI1ApiKey(): boolean {
  const apiKey = process.env.ASI1_API_KEY || "";
  return !!apiKey && apiKey !== "PASTE_YOUR_KEY_HERE" && apiKey !== "your_asi1_key_here";
}

function hasValidCerebrasApiKey(): boolean {
  const apiKey = process.env.CEREBRAS_API_KEY || "";
  return !!apiKey && apiKey !== "PASTE_YOUR_KEY_HERE" && apiKey !== "your_key_here";
}

function isLLMProviderKey(value: string): value is LLMProviderKey {
  return ["auto", "asi1", "openai", "anthropic", "groq", "cerebras", "custom"].includes(value);
}

function formatProviderName(provider: string): string {
  const labels: Record<string, string> = {
    auto: "Auto",
    asi1: "ASI-1",
    openai: "OpenAI",
    anthropic: "Anthropic",
    groq: "Groq",
    cerebras: "Cerebras",
    custom: "Custom",
  };

  return labels[provider] ?? provider;
}

function normalizeLLMConfig(config?: Partial<LLMConfigPayload> | null): CustomLLMConfig | null {
  const providerValue = (config?.provider ?? "").trim().toLowerCase();
  if (!isLLMProviderKey(providerValue) || providerValue === "auto") {
    return null;
  }

  const apiKey = config?.apiKey?.trim() ?? "";
  if (!apiKey) {
    return null;
  }

  const defaultModels: Record<Exclude<LLMProviderKey, "auto" | "custom">, string> = {
    asi1: "asi1",
    openai: "gpt-4o",
    anthropic: "claude-sonnet-4-5",
    groq: "llama-3.3-70b-versatile",
    cerebras: "llama3.1-8b",
  };

  const incomingModel = config?.model?.trim() ?? "";
  const model =
    providerValue === "custom"
      ? incomingModel
      : incomingModel || defaultModels[providerValue];

  if (!model) {
    return null;
  }

  return {
    provider: providerValue,
    apiKey,
    model,
    baseUrl: config?.baseUrl?.trim() || undefined,
  };
}

export async function callLLM(
  systemPrompt: string,
  userMessage: string,
  options: LLMCallOptions = {},
): Promise<LLMCallResult> {
  const providers: LLMProvider[] = [
    {
      name: "ASI-1",
      isConfigured: hasValidASI1ApiKey(),
      call: async () => {
        const client = new OpenAI({
          apiKey: process.env.ASI1_API_KEY,
          baseURL: "https://api.asi1.ai/v1",
        });
        const request = {
          model: "asi1",
          messages: [
            { role: "system" as const, content: systemPrompt },
            { role: "user" as const, content: userMessage },
          ],
          max_tokens: options.maxTokens ?? 2048,
          ...(typeof options.asi1Temperature === "number"
            ? { temperature: options.asi1Temperature }
            : {}),
          ...(options.asi1Reasoning ? { reasoning: true } : {}),
        };
        const res = await client.chat.completions.create(request);
        return res.choices[0]?.message?.content ?? "";
      },
    },
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
          max_tokens: options.maxTokens ?? 2048,
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
          max_tokens: options.maxTokens ?? 2048,
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
      return {
        content: result,
        provider: provider.name,
      };
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

async function callLLMWithConfig(
  systemPrompt: string,
  userMessage: string,
  config: CustomLLMConfig,
  options: LLMCallOptions = {},
): Promise<LLMCallResult> {
  if (config.provider === "asi1") {
    const client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl || "https://api.asi1.ai/v1",
    });
    const request = {
      model: config.model,
      messages: [
        { role: "system" as const, content: systemPrompt },
        { role: "user" as const, content: userMessage },
      ],
      max_tokens: options.maxTokens ?? 1024,
      ...(typeof options.asi1Temperature === "number"
        ? { temperature: options.asi1Temperature }
        : {}),
      ...(options.asi1Reasoning ? { reasoning: true } : {}),
    };
    const res = await client.chat.completions.create(request);
    return {
      content: res.choices[0]?.message?.content ?? "",
      provider: "ASI-1",
    };
  }

  if (config.provider === "openai" || config.provider === "custom") {
    const client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl || "https://api.openai.com/v1",
    });
    const res = await client.chat.completions.create({
      model: config.model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      max_tokens: options.maxTokens ?? 1024,
    });
    return {
      content: res.choices[0]?.message?.content ?? "",
      provider: formatProviderName(config.provider),
    };
  }

  if (config.provider === "anthropic") {
    const client = new Anthropic({ apiKey: config.apiKey });
    const res = await client.messages.create({
      model: config.model,
      max_tokens: 1024,
      ...(typeof options.maxTokens === "number" ? { max_tokens: options.maxTokens } : {}),
      messages: [{ role: "user", content: userMessage }],
      system: systemPrompt,
    });
    return {
      content: (res.content[0] as { text?: string } | undefined)?.text ?? "",
      provider: "Anthropic",
    };
  }

  if (config.provider === "groq") {
    const client = new Groq({ apiKey: config.apiKey });
    const res = await client.chat.completions.create({
      model: config.model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      max_tokens: options.maxTokens ?? 1024,
    });
    return {
      content: (res as LLMCompletionResponse).choices?.[0]?.message?.content ?? "",
      provider: "Groq",
    };
  }

  if (config.provider === "cerebras") {
    const client = new Cerebras({ apiKey: config.apiKey });
    const res = await client.chat.completions.create({
      model: config.model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      max_tokens: options.maxTokens ?? 1024,
    });
    return {
      content: (res as LLMCompletionResponse).choices?.[0]?.message?.content ?? "",
      provider: "Cerebras",
    };
  }

  throw new Error(`Unknown provider: ${config.provider}`);
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
          node.type === "doc" ||
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
      const entryPoint =
        typeof candidate.entryPoint === "string" ? candidate.entryPoint.trim() : "";
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

      if (
        !name ||
        !explanation ||
        !mermaid ||
        steps < minimumSteps ||
        !hasOnlyKnownLabels ||
        !hasFocusNode
      ) {
        return null;
      }

      return {
        name,
        steps,
        entryPoint: entryPoint || labels[0] || name,
        explanation,
        mermaid,
      };
    })
    .filter((process): process is ProcessDefinition => process !== null);
}

const PROCESS_EDGE_KINDS = new Set(["CALLS", "IMPORTS", "DEFINES"]);
const PROCESS_KEYWORDS = [
  "app",
  "main",
  "index",
  "start",
  "init",
  "load",
  "fetch",
  "query",
  "route",
  "api",
  "render",
  "view",
  "page",
  "screen",
  "upload",
  "create",
  "update",
  "handle",
  "submit",
];

function sanitizeMermaidLabel(label: string): string {
  return label.replace(/[[\]"]/g, "").trim() || "Unknown";
}

function detectHeuristicProcesses(
  graphData: GraphData,
  minimumSteps: number,
  focusNode?: string,
): ProcessDefinition[] {
  const nodeById = new Map(graphData.nodes.map((node) => [node.id, node]));
  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();

  graphData.nodes.forEach((node) => {
    outgoing.set(node.id, []);
    incoming.set(node.id, []);
  });

  graphData.edges.forEach((edge) => {
    if (!PROCESS_EDGE_KINDS.has(edge.kind)) return;
    outgoing.get(edge.source)?.push(edge.target);
    incoming.get(edge.target)?.push(edge.source);
  });

  const scoreNode = (nodeId: string): number => {
    const node = nodeById.get(nodeId);
    if (!node) return 0;
    const label = node.label.toLowerCase();
    const keywordScore = PROCESS_KEYWORDS.reduce(
      (sum, keyword) => sum + (label.includes(keyword) ? 6 : 0),
      0,
    );
    const typeScore = node.type === "file" ? 8 : node.type === "function" || node.type === "method" ? 5 : 3;
    return (
      keywordScore +
      typeScore +
      (outgoing.get(nodeId)?.length ?? 0) * 3 +
      (incoming.get(nodeId)?.length ?? 0)
    );
  };

  const extendForward = (startId: string, maxSteps = 5): string[] => {
    const visited = new Set<string>([startId]);
    const path = [startId];
    let currentId = startId;

    while (path.length < maxSteps) {
      const nextCandidates = (outgoing.get(currentId) ?? [])
        .filter((candidateId) => !visited.has(candidateId))
        .sort((a, b) => scoreNode(b) - scoreNode(a));

      const nextId = nextCandidates[0];
      if (!nextId) break;

      path.push(nextId);
      visited.add(nextId);
      currentId = nextId;
    }

    return path;
  };

  const buildFocusedPath = (focusId: string, maxSteps = 5): string[] => {
    const prefixCandidates = (incoming.get(focusId) ?? []).sort((a, b) => scoreNode(b) - scoreNode(a));
    const prefix = prefixCandidates[0] ? [prefixCandidates[0]] : [];
    const suffix = extendForward(focusId, maxSteps - prefix.length);
    const combined = [...prefix, ...suffix];
    return Array.from(new Set(combined)).slice(0, maxSteps);
  };

  const candidateIds = focusNode
    ? graphData.nodes
        .filter((node) => node.label === focusNode)
        .map((node) => node.id)
    : graphData.nodes
        .filter((node) =>
          ["file", "function", "method", "class", "python_function", "python_class"].includes(node.type),
        )
        .sort((a, b) => scoreNode(b.id) - scoreNode(a.id))
        .slice(0, 12)
        .map((node) => node.id);

  const processes: ProcessDefinition[] = [];
  const seenSignatures = new Set<string>();

  for (const candidateId of candidateIds) {
    const pathIds = focusNode ? buildFocusedPath(candidateId) : extendForward(candidateId);
    if (pathIds.length < minimumSteps) continue;

    const pathNodes = pathIds
      .map((nodeId) => nodeById.get(nodeId))
      .filter((node): node is NonNullable<typeof node> => !!node);

    if (pathNodes.length < minimumSteps) continue;
    if (focusNode && !pathNodes.some((node) => node.label === focusNode)) continue;

    const signature = pathNodes.map((node) => node.label).join(">");
    if (seenSignatures.has(signature)) continue;
    seenSignatures.add(signature);

    const startNode = pathNodes[0];
    const mermaidLines = ["graph TD"];
    pathNodes.forEach((node, index) => {
      mermaidLines.push(`  N${index}[${sanitizeMermaidLabel(node.label)}]`);
      if (index > 0) {
        mermaidLines.push(`  N${index - 1} --> N${index}`);
      }
    });

    processes.push({
      name: `${sanitizeMermaidLabel(startNode.label)} Flow`,
      steps: pathNodes.length,
      entryPoint: startNode.label,
      explanation: `Heuristic flow beginning at ${startNode.label} and following the strongest reachable dependencies in the current graph.`,
      mermaid: mermaidLines.join("\n"),
    });

    if (processes.length >= 6) break;
  }

  return processes;
}

function computeReportStats(graphData: GraphData): ReportStats {
  const fileNodes = graphData.nodes.filter((node) => node.type === "file" || node.type === "doc");
  const functionNodes = graphData.nodes.filter(
    (node) =>
      node.type === "function" ||
      node.type === "method" ||
      node.type === "python_function" ||
      node.type === "python_class",
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

function resolveGraphData(fallbackGraph?: GraphData | null): GraphData | null {
  return getGraph() || fallbackGraph || null;
}

app.use(cors({ origin: "http://localhost:5173" }));
app.use(express.json({ limit: "500mb" }));
app.use(express.urlencoded({ limit: "500mb", extended: true }));

app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

app.post("/api/query", async (req, res) => {
  console.log("Query received:", req.body.question);

  const { question, graphData: requestGraphData, llmConfig } = req.body as {
    question: string;
    graphData?: GraphData;
    llmConfig?: LLMConfigPayload;
  };
  const graphData = resolveGraphData(requestGraphData);

  if (!question || !graphData) {
    res.status(400).json({ error: "No graph loaded" });
    return;
  }

  try {
    const summary = buildCompactGraphSummary(graphData);

    const systemPrompt = `You are an expert software architect analyzing a real codebase.
You are powered by ASI:One - an intelligent AI that combines reasoning and analysis capabilities.
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

    const userMessage = `GRAPH DATA:\n${summary}\n\nUSER QUESTION:\n${question}`;
    const customConfig = normalizeLLMConfig(llmConfig);

    let text: string;
    let provider = "Unknown";
    if (customConfig) {
      try {
        const result = await callLLMWithConfig(systemPrompt, userMessage, customConfig);
        text = result.content;
        provider = result.provider;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Unknown error";
        res.json({
          explanation: `Your ${formatProviderName(customConfig.provider)} key returned an error: ${message}`,
          relevantNodes: [],
          provider: formatProviderName(customConfig.provider),
        });
        return;
      }
    } else {
      const result = await callLLM(systemPrompt, userMessage);
      text = result.content;
      provider = result.provider;
    }

    try {
      const jsonStr = text.replace(/```json\n?|```/g, "").trim();
      const parsed = JSON.parse(jsonStr);
      res.json({
        explanation: parsed.explanation || "No explanation provided.",
        relevantNodes: parsed.relevantNodes || [],
        provider,
      });
    } catch (parseErr) {
      console.error("[VECTRON] AI Parse error:", parseErr, "Raw text:", text);
      res.json({
        explanation: "Could not analyze codebase response. Please try again.",
        relevantNodes: [],
        provider,
      });
    }
  } catch (err: unknown) {
    console.error("[LLM] Query error:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ explanation: `Query failed: ${message}`, relevantNodes: [], provider: "Unknown" });
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
    const normalized = summary.content.replace(/\s+/g, " ").trim();
    const sentence = normalized.split(/(?<=[.!?])\s+/)[0] ?? normalized;

    res.json({ summary: sentence.trim() });
  } catch (err: unknown) {
    console.error("[LLM] Node summary error:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: `Node summary failed: ${message}`, summary: "" });
  }
});

app.post("/api/processes", async (req, res) => {
  const { graphData: requestGraphData, focusNode } = req.body as { graphData?: GraphData; focusNode?: string };
  const graphData = resolveGraphData(requestGraphData);
  const minimumSteps = 3;

  if (!graphData) {
    res.status(400).json({ error: "No graph loaded" });
    return;
  }

  try {
    const summary = buildCompactGraphSummary(graphData);
    const allowedLabels = new Set(graphData.nodes.map((node) => node.label));
    const systemPrompt = `You are an expert software architect with deep reasoning capabilities.
You have been given a complete dependency graph of a real codebase.

Your task is to detect ALL meaningful processes in this codebase.
A process is a complete execution flow from a trigger point 
(user action, API call, event handler, entry point) through 
every function call, all the way to a final output or side effect.

Think step by step:

STEP 1 - Find all entry points:
Look for nodes that have zero or few incoming edges but many 
outgoing edges. These are likely entry points:
- Event handlers (onClick, onSubmit, handleX)
- API endpoints (/api/*)
- Main functions
- React component mount effects

STEP 2 - Trace each entry point:
For each entry point, follow the outgoing edges through the graph.
Map the complete execution chain until you reach leaf nodes.

STEP 3 - Name each process:
Give each process a human readable name describing what it does
from a user perspective. Example: 'File Upload Flow' not 'handleUpload chain'

STEP 4 - Generate Mermaid diagram:
For each process create a valid Mermaid flowchart showing
every step in the execution chain.

RETURN strictly valid JSON only:
{
  'processes': [
    {
      'name': 'human readable process name',
      'steps': number of nodes in the chain,
      'entryPoint': 'the starting node label',
      'explanation': 'plain english description of what this process does and why it matters',
      'mermaid': 'graph TD\n  A[entryPoint] --> B[step2]\n  B --> C[step3]...'
    }
  ]
}

${focusNode ? `Focus specifically on processes that involve the node '${focusNode}'.
Only return processes where this node appears as a step.` : ""}

Rules:
- Detect minimum 5 processes, maximum 15
- Each process must have at least ${minimumSteps} steps
- Only use node labels that actually exist in the provided graph
- Never return empty processes array
- Mermaid syntax must be valid graph TD format`;

    const text = await callLLM(systemPrompt, `GRAPH DATA:\n${summary}`, {
      asi1Reasoning: true,
      maxTokens: 4096,
    });

    try {
      const jsonStr = text.content.replace(/```json\n?|```/g, "").trim();
      const parsed = JSON.parse(jsonStr);
      const processes = sanitizeProcesses(
        parsed.processes,
        allowedLabels,
        minimumSteps,
        focusNode,
      );
      const finalProcesses =
        processes.length > 0 ? processes : detectHeuristicProcesses(graphData, minimumSteps, focusNode);
      console.log("Processes detected:", finalProcesses.length);
      res.json({ processes: finalProcesses });
    } catch (parseErr) {
      console.error("[VECTRON] Process Parse error:", parseErr, "Raw text:", text.content);
      const fallbackProcesses = detectHeuristicProcesses(graphData, minimumSteps, focusNode);
      res.json({ processes: fallbackProcesses });
    }
  } catch (err: unknown) {
    console.error("[LLM] Process detection error:", err);
    try {
      const fallbackProcesses = detectHeuristicProcesses(graphData, minimumSteps, focusNode);
      if (fallbackProcesses.length > 0) {
        res.json({ processes: fallbackProcesses });
        return;
      }
    } catch (fallbackErr) {
      console.error("[VECTRON] Heuristic process fallback failed:", fallbackErr);
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: `Process detection failed: ${message}`, processes: [] });
  }
});

app.post("/api/report", async (req, res) => {
  const { graphData: requestGraphData } = req.body as { graphData?: GraphData };
  const graphData = resolveGraphData(requestGraphData);

  if (!graphData) {
    res.status(400).json({ error: "No graph loaded" });
    return;
  }

  try {
    const summary = buildCompactGraphSummary(graphData);
    const stats = computeReportStats(graphData);
    const systemPrompt = `You are a senior software architect. Analyze this codebase knowledge graph and generate a comprehensive intelligence report.
Use extended reasoning to deeply analyze this codebase.
Think step by step before writing each section.

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
      {
        asi1Temperature: 0.2,
        asi1Reasoning: true,
      },
    );

    res.json({ report: text.content.trim() });
  } catch (err: unknown) {
    console.error("Report generation error:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: `Report generation failed: ${message}`, report: "" });
  }
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === "application/zip" || file.originalname.endsWith(".zip")) {
      cb(null, true);
    } else {
      cb(new Error("Only .zip files are accepted"));
    }
  },
});

function isIgnoredSourcePath(entryPath: string): boolean {
  return /(node_modules|\.git|dist|build|\.next|coverage|vendor|target|__pycache__)\//.test(entryPath);
}

function isSupportedSourceFile(entryPath: string): boolean {
  if (isIgnoredSourcePath(entryPath)) {
    return false;
  }

  if (
    /(^|\/)(package-lock\.json|package\.json|pnpm-lock\.yaml|yarn\.lock|poetry\.lock|Cargo\.lock)$/i.test(entryPath)
  ) {
    return false;
  }

  return /\.(js|jsx|ts|tsx|py|json|ya?ml|md)$/i.test(entryPath);
}

function normalizeRepoPath(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/^\.\//, "");
}

function parseGitHubRepo(input: string): { owner: string; repo: string } {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new CloneValidationError("Please enter a valid GitHub URL");
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new CloneValidationError("Please enter a valid GitHub URL");
  }

  const hostname = parsed.hostname.toLowerCase();
  const pathParts = parsed.pathname.replace(/\/+$/, "").split("/").filter(Boolean);

  if (
    parsed.protocol !== "https:" ||
    !["github.com", "www.github.com"].includes(hostname) ||
    pathParts.length < 2
  ) {
    throw new CloneValidationError("Please enter a valid GitHub URL");
  }

  return {
    owner: pathParts[0],
    repo: pathParts[1].replace(/\.git$/i, ""),
  };
}

function buildGithubZipUrls(owner: string, repo: string): string[] {
  return [
    `https://github.com/${owner}/${repo}/archive/refs/heads/main.zip`,
    `https://github.com/${owner}/${repo}/archive/refs/heads/master.zip`,
  ];
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new CloneTimeoutError("Clone timed out")), timeoutMs);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

function processSourceFiles(sourceFiles: SourceFile[]): GraphData {
  fileCache.clear();
  for (const file of sourceFiles) {
    fileCache.set(file.path, file.content);
  }

  const graphData = buildGraph(sourceFiles);
  setGraph(graphData);
  return graphData;
}

function collectSourceFilesFromZip(zip: AdmZip): SourceFile[] {
  const entries = zip.getEntries();
  const sourceFiles: SourceFile[] = [];
  let skippedOversized = 0;
  let skippedUnreadable = 0;
  let skippedByBudget = 0;
  let totalSourceBytes = 0;

  for (const entry of entries) {
    if (sourceFiles.length >= MAX_SOURCE_FILES) break;
    if (entry.isDirectory) continue;

    const entryPath = normalizeRepoPath(entry.entryName);
    if (!isSupportedSourceFile(entryPath)) continue;

    if (entry.header.size > MAX_FILE_BYTES) {
      skippedOversized++;
      continue;
    }

    if (totalSourceBytes + entry.header.size > MAX_TOTAL_SOURCE_BYTES) {
      skippedByBudget++;
      continue;
    }

    try {
      const content = entry.getData().toString("utf-8");
      sourceFiles.push({ path: entryPath, content });
      totalSourceBytes += entry.header.size;
    } catch {
      skippedUnreadable++;
    }
  }

  if (skippedOversized > 0 || skippedUnreadable > 0 || skippedByBudget > 0) {
    console.warn(
      `[VECTRON] ZIP sampled: skipped ${skippedOversized} oversized file(s) ` +
        `(>${MAX_FILE_BYTES / 1024}KB), ${skippedUnreadable} unreadable file(s), and ${skippedByBudget} file(s) due to the parser budget. ` +
        `Processing ${sourceFiles.length} of eligible source files.`,
    );
  } else {
    console.log(`[VECTRON] Processing ${sourceFiles.length} source file(s).`);
  }

  return sourceFiles;
}

async function downloadGithubZip(owner: string, repo: string, tempZipPath: string): Promise<void> {
  const zipUrls = buildGithubZipUrls(owner, repo);

  for (const zipUrl of zipUrls) {
    try {
      const response = await withTimeout(fetch(zipUrl), GITHUB_DOWNLOAD_TIMEOUT_MS);

      if (!response.ok) {
        if (response.status === 404) {
          continue;
        }

        if (response.status === 403 || response.status === 401) {
          throw new CloneAccessError("Repository not found or is private");
        }

        throw new Error(`GitHub ZIP download failed with status ${response.status}`);
      }

      const arrayBuffer = await withTimeout(response.arrayBuffer(), GITHUB_DOWNLOAD_TIMEOUT_MS);
      const buffer = Buffer.from(arrayBuffer);
      await fs.writeFile(tempZipPath, buffer);
      return;
    } catch (error) {
      if (error instanceof CloneTimeoutError) {
        throw new CloneTooLargeError("Repository too large, try ZIP upload instead");
      }

      if (error instanceof CloneAccessError) {
        throw error;
      }

      const message = error instanceof Error ? error.message.toLowerCase() : "";
      if (message.includes("aborted") || message.includes("timeout")) {
        throw new CloneTooLargeError("Repository too large, try ZIP upload instead");
      }
    }
  }

  throw new CloneAccessError("Repository not found or is private");
}

async function collectSourceFilesFromDirectory(rootDir: string): Promise<SourceFile[]> {
  const sourceFiles: SourceFile[] = [];
  let totalSourceBytes = 0;

  async function walk(currentDir: string): Promise<void> {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const absolutePath = path.join(currentDir, entry.name);
      const relativePath = normalizeRepoPath(path.relative(rootDir, absolutePath));

      if (entry.isDirectory()) {
        if (relativePath && isIgnoredSourcePath(`${relativePath}/`)) {
          continue;
        }
        await walk(absolutePath);
        continue;
      }

      if (!isSupportedSourceFile(relativePath)) continue;

      const stats = await fs.stat(absolutePath);
      if (stats.size > MAX_FILE_BYTES) {
        throw new CloneTooLargeError("Repository too large, please use ZIP upload");
      }

      if (sourceFiles.length >= MAX_SOURCE_FILES || totalSourceBytes + stats.size > MAX_TOTAL_SOURCE_BYTES) {
        throw new CloneTooLargeError("Repository too large, please use ZIP upload");
      }

      const content = await fs.readFile(absolutePath, "utf-8");
      sourceFiles.push({ path: relativePath, content });
      totalSourceBytes += stats.size;
    }
  }

  await walk(rootDir);
  console.log(`[VECTRON] Processing ${sourceFiles.length} cloned source file(s).`);
  return sourceFiles;
}

async function cloneGithubRepository(githubUrl: string): Promise<GraphData> {
  const { owner, repo } = parseGitHubRepo(githubUrl);
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "vectron-zip-"));
  const tempZipPath = path.join(tempDir, `${repo}.zip`);

  try {
    await downloadGithubZip(owner, repo, tempZipPath);
    const zipBuffer = await fs.readFile(tempZipPath);
    const sourceFiles = collectSourceFilesFromZip(new AdmZip(zipBuffer));

    if (sourceFiles.length === 0) {
      throw new CloneValidationError(
        "No supported JS, TS, Python, JSON, YAML, or Markdown files found in the repository",
      );
    }

    return processSourceFiles(sourceFiles);
  } catch (error) {
    if (
      error instanceof CloneValidationError ||
      error instanceof CloneTimeoutError ||
      error instanceof CloneTooLargeError
    ) {
      throw error;
    }

    const message = error instanceof Error ? error.message.toLowerCase() : "";
    if (
      message.includes("repository not found") ||
      message.includes("authentication failed") ||
      message.includes("could not read username") ||
      message.includes("access denied") ||
      message.includes("not found")
    ) {
      throw new CloneAccessError("Repository is private or not found");
    }

    throw error;
  } finally {
    await fs.unlink(tempZipPath).catch(() => undefined);
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

app.post("/api/upload", (req, res) => {
  upload.single("file")(req, res, (uploadError: unknown) => {
    if (uploadError instanceof multer.MulterError) {
      if (uploadError.code === "LIMIT_FILE_SIZE") {
        res.status(413).json({
          error: `ZIP file is too large. Upload a file smaller than ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))}MB.`,
        });
        return;
      }

      res.status(400).json({ error: `Upload failed: ${uploadError.message}` });
      return;
    }

    if (uploadError instanceof Error) {
      res.status(400).json({ error: uploadError.message });
      return;
    }

    if (!req.file) {
      res.status(400).json({ error: "No file uploaded" });
      return;
    }

    try {
      const sourceFiles = collectSourceFilesFromZip(new AdmZip(req.file.buffer));

      if (sourceFiles.length === 0) {
        res.status(422).json({
          error: "No supported JS, TS, Python, JSON, YAML, or Markdown files found in the zip",
        });
        return;
      }

      res.json(processSourceFiles(sourceFiles));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error("[VECTRON] Upload error:", message);
      res.status(500).json({ error: `Processing failed: ${message}` });
    }
  });
});

app.post("/api/clone", async (req, res) => {
  const { githubUrl } = req.body as { githubUrl?: string };

  try {
    const graphData = await cloneGithubRepository(githubUrl ?? "");
    res.json(graphData);
  } catch (error) {
    if (error instanceof CloneValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }

    if (error instanceof CloneAccessError) {
      res.status(404).json({ error: error.message });
      return;
    }

    if (error instanceof CloneTooLargeError) {
      res.status(413).json({ error: error.message });
      return;
    }

    if (error instanceof CloneTimeoutError) {
      res.status(408).json({ error: "Repository too large, try ZIP upload instead" });
      return;
    }

    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[VECTRON] Clone error:", message);
    res.status(500).json({ error: `Processing failed: ${message}` });
  }
});

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      res.status(413).json({
        error: `ZIP file is too large. Upload a file smaller than ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))}MB.`,
      });
      return;
    }

    res.status(400).json({ error: `Upload failed: ${err.message}` });
    return;
  }

  const message = err instanceof Error ? err.message : "Unknown upload error";
  console.error("[VECTRON] Unhandled server error:", message);
  res.status(500).json({ error: `Processing failed: ${message}` });
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

app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "landing.html"));
});

app.use("/app", express.static(path.join(__dirname, "../../client/dist")));
app.get("/app/*", (_req, res) => {
  res.sendFile(path.join(__dirname, "../../client/dist/index.html"));
});

app.listen(PORT, () => {
  console.log(`VECTRON server listening on port ${PORT}`);
});

startMCPServer();
