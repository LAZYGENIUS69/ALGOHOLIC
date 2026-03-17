# VECTRON
**dependency propagation engine**

> "ChatGPT can tell you what a function does.  
> VECTRON shows you what breaks when you change it."

[![Live Demo](https://img.shields.io/badge/Live%20Demo-vectron--production.up.railway.app-00D9FF?style=flat-square)](https://vectron-production.up.railway.app)
[![GitHub](https://img.shields.io/badge/GitHub-LAZYGENIUS69%2FVECTRON-white?style=flat-square&logo=github)](https://github.com/LAZYGENIUS69/VECTRON)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow?style=flat-square)](LICENSE)

---

## What is VECTRON?

VECTRON is an AI-powered codebase dependency explorer. Upload any JavaScript or TypeScript repository as a ZIP and instantly get an interactive knowledge graph of every file, function, class and their relationships.

The average developer spends **58% of their time understanding code, not writing it.** VECTRON eliminates that.

---

## Live Demo

🔗 **[vectron-production.up.railway.app](https://vectron-production.up.railway.app)**

Upload any JS/TS repo as a ZIP. No signup. No setup.

---

## Features

### 🔴 Blast Radius Simulation
Click any node in the graph. VECTRON instantly runs a BFS propagation to show every downstream dependency that breaks if you change it. Color-coded by impact depth — red is direct, orange is one hop, yellow is two hops.

### 🤖 AI Codebase Query
Ask anything about your codebase in plain English. VECTRON sends a compressed graph summary to Groq (Llama 3.3 70B) and returns a precise answer with a call chain — while simultaneously highlighting the relevant nodes on the graph.

### 📊 Metrics Dashboard
Risk scores, dependency hotspots, node type distribution, top 10 most connected nodes. Instantly identifies your most fragile code.

### 🔀 Process Flow Detection
Automatically detects all execution flows in the codebase and generates Mermaid flowcharts for each one. Click any process to see the complete call chain visualized.

### 🔍 Node Intelligence
Click any node to instantly see its complete intelligence profile:
- **Risk Score** — calculated from connection density
- **Callers & Callees** — exact count of incoming and outgoing dependencies  
- **Depends On** — direct dependencies as visual pills
- **Called By** — everything that depends on this node
- **AI Summary** — one-line AI description of what the node does

### 🔗 Process Tracing
Select any two nodes and VECTRON traces the exact execution path between them through the dependency graph. See how data flows from a user action all the way through to the output — every hop, every function call, every file transition visualized as a Mermaid flowchart.

### 📄 Codebase Intelligence Report
One click generates a full architecture document — executive summary, component breakdown, risk assessment, onboarding guide. Powered by Groq + Cerebras fallback.

### 🔧 Custom LLM Support
Bring your own API key. Configure OpenAI, Anthropic, Groq, Cerebras, or any custom OpenAI-compatible endpoint directly in the UI.

### 🧠 MCP Server — AI-Native Codebase Context
**This is where VECTRON becomes truly powerful.**

VECTRON runs as an MCP (Model Context Protocol) server on port 3002. Connect it to Claude Code, Cursor, or Antigravity and your AI coding assistant gets full dependency context while you code.

```
# Add to your MCP client
Name: VECTRON
URL:  http://localhost:3002/sse
```

**Available MCP Tools:**

| Tool | Description |
|------|-------------|
| `vectron_status` | Check if a graph is loaded |
| `vectron_blast_radius(node, depth?)` | What breaks if I change this? |
| `vectron_get_callers(node)` | What calls this function? |
| `vectron_get_dependencies(node)` | What does this depend on? |
| `vectron_query(question)` | Ask anything about the codebase |

**Example:**
```
You: "I want to refactor handleUpload. Use VECTRON to check what will break."

AI (with VECTRON MCP):
→ calls vectron_blast_radius("handleUpload")
→ finds 8 affected files
→ calls vectron_get_callers("handleUpload")  
→ returns exact line numbers
→ "Update these 8 files in this order..."

AI (without VECTRON):
→ misses 5 files
→ your build breaks
```

---

## Quick Start

### Web (Instant)
Visit **[vectron-production.up.railway.app](https://vectron-production.up.railway.app)** and upload a ZIP.

### Local + MCP Setup
```bash
git clone https://github.com/LAZYGENIUS69/VECTRON
cd VECTRON/vectron-app
npm install --prefix client && npm install --prefix server
cp .env.example server/.env
# Add your API keys to server/.env
npm run dev
```

Open `http://localhost:5173` — upload a ZIP — then connect MCP:
```
http://localhost:3002/sse
```

### Environment Variables
```env
GROQ_API_KEY=your_groq_key_here
CEREBRAS_API_KEY=your_cerebras_key_here
PORT=3001
```

Get free API keys:
- Groq: [console.groq.com](https://console.groq.com)
- Cerebras: [inference.cerebras.ai](https://inference.cerebras.ai)

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React + TypeScript + Vite |
| Graph Rendering | Sigma.js + Graphology + ForceAtlas2 |
| Backend | Express.js + Node.js |
| AST Parsing | Babel (JS/TS/JSX/TSX) |
| AI Primary | Groq — Llama 3.3 70B Versatile |
| AI Fallback | Cerebras — Llama 3.1 8B |
| Process Diagrams | Mermaid.js |
| MCP Protocol | @modelcontextprotocol/sdk |
| Deployment | Railway |

---

## Architecture

```mermaid
graph TD
    A[🗂️ ZIP Upload] --> B[Babel AST Parser]
    B --> C[Graph Builder]
    C --> D[(Graph Store\nIn Memory)]

    D --> E[Sigma.js Renderer]
    E --> F[ForceAtlas2 Layout]
    F --> G[🔴 Interactive Graph]

    D --> H[Blast Radius BFS]
    H --> I[Risk Scoring]
    I --> G

    D --> J[Groq LLM\nLlama 3.3 70B]
    J --> K[AI Query]
    J --> L[Process Detection]
    J --> M[Intelligence Report]
    K --> G

    D --> N[MCP Server\nPort 3002]
    N --> O[Claude Code]
    N --> P[Cursor]
    N --> Q[Antigravity]

    style A fill:#1a1a2e,stroke:#00D9FF,color:#fff
    style G fill:#1a1a2e,stroke:#FF2D55,color:#fff
    style D fill:#1a1a2e,stroke:#00D9FF,color:#fff
    style N fill:#1a1a2e,stroke:#7B61FF,color:#fff
    style J fill:#1a1a2e,stroke:#FF9F0A,color:#fff
```

---

*Made with obsession by [@LAZYGENIUS69](https://github.com/LAZYGENIUS69)*
