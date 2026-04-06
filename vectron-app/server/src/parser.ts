import path from "path";
import * as babelParser from "@babel/parser";
import traverse from "@babel/traverse";
import * as t from "@babel/types";

// babel AST parser optimized
export type ParsedNodeType =
  | "class"
  | "method"
  | "function"
  | "import"
  | "python_function"
  | "python_class"
  | "config"
  | "doc";

export type ParsedNodeEdgeKind = "DEFINES" | "CONTAINS" | "DOCUMENTS";
export type ParsedFileNodeType = "file" | "doc";

export interface ParsedNode {
  name: string;
  type: ParsedNodeType;
  edgeKind: ParsedNodeEdgeKind;
  startLine?: number;
  endLine?: number;
}

export interface ParsedFile {
  filePath: string;
  fileNodeType: ParsedFileNodeType;
  nodes: ParsedNode[];
  imports: string[];
  callees: string[];
}

const MAX_CONTENT_BYTES = 500 * 1024;
const PYTHON_CALL_IGNORE = new Set([
  "and",
  "class",
  "def",
  "elif",
  "except",
  "False",
  "for",
  "from",
  "if",
  "import",
  "in",
  "is",
  "lambda",
  "None",
  "not",
  "or",
  "print",
  "raise",
  "return",
  "True",
  "while",
  "with",
  "yield",
]);

function createEmptyParsedFile(filePath: string, fileNodeType: ParsedFileNodeType = "file"): ParsedFile {
  return {
    filePath,
    fileNodeType,
    nodes: [],
    imports: [],
    callees: [],
  };
}

function addUnique(items: string[], seen: Set<string>, value: string) {
  const trimmed = value.trim();
  if (!trimmed || seen.has(trimmed)) return;
  seen.add(trimmed);
  items.push(trimmed);
}

function parseJavaScriptLikeFile(filePath: string, content: string): ParsedFile | null {
  try {
    const ast = babelParser.parse(content, {
      sourceType: "module",
      plugins: [
        "typescript",
        "jsx",
        "decorators-legacy",
        "dynamicImport",
        "optionalChaining",
        "nullishCoalescingOperator",
      ],
      errorRecovery: true,
    });

    const parsed = createEmptyParsedFile(filePath);
    const seenNodes = new Set<string>();
    const seenImports = new Set<string>();
    const seenCallees = new Set<string>();

    const addNode = (node: ParsedNode) => {
      const key = `${node.type}:${node.name}`;
      if (seenNodes.has(key)) return;
      seenNodes.add(key);
      parsed.nodes.push(node);
    };

    traverse(ast as Parameters<typeof traverse>[0], {
      ImportDeclaration({ node }) {
        const src = node.source.value;
        addNode({
          name: src,
          type: "import",
          edgeKind: "DEFINES",
          startLine: node.loc?.start.line,
          endLine: node.loc?.end.line,
        });
        addUnique(parsed.imports, seenImports, src);
      },

      FunctionDeclaration({ node }) {
        const name = node.id?.name;
        if (!name) return;
        addNode({
          name,
          type: "function",
          edgeKind: "DEFINES",
          startLine: node.loc?.start.line,
          endLine: node.loc?.end.line,
        });
      },

      VariableDeclarator({ node }) {
        if (
          t.isIdentifier(node.id) &&
          (t.isArrowFunctionExpression(node.init) || t.isFunctionExpression(node.init))
        ) {
          addNode({
            name: node.id.name,
            type: "function",
            edgeKind: "DEFINES",
            startLine: node.loc?.start.line,
            endLine: node.init.loc?.end.line || node.loc?.end.line,
          });
        }
      },

      ClassDeclaration({ node }) {
        const name = node.id?.name;
        if (!name) return;
        addNode({
          name,
          type: "class",
          edgeKind: "DEFINES",
          startLine: node.loc?.start.line,
          endLine: node.loc?.end.line,
        });
      },

      ClassMethod({ node }) {
        if (!t.isIdentifier(node.key)) return;
        addNode({
          name: node.key.name,
          type: "method",
          edgeKind: "DEFINES",
          startLine: node.loc?.start.line,
          endLine: node.loc?.end.line,
        });
      },

      CallExpression({ node }) {
        let name: string | null = null;
        if (t.isIdentifier(node.callee)) {
          name = node.callee.name;
        } else if (t.isMemberExpression(node.callee) && t.isIdentifier(node.callee.property)) {
          name = node.callee.property.name;
        }

        if (name) {
          addUnique(parsed.callees, seenCallees, name);
        }
      },
    });

    return parsed;
  } catch {
    return null;
  }
}

function parsePythonFile(filePath: string, content: string): ParsedFile {
  const parsed = createEmptyParsedFile(filePath);
  const seenNodes = new Set<string>();
  const seenImports = new Set<string>();
  const seenCallees = new Set<string>();
  const lines = content.split(/\r?\n/);

  const addNode = (node: ParsedNode) => {
    const key = `${node.type}:${node.name}`;
    if (seenNodes.has(key)) return;
    seenNodes.add(key);
    parsed.nodes.push(node);
  };

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;

    const importMatch = trimmed.match(/^import\s+(.+)$/);
    if (importMatch) {
      importMatch[1]
        .split(",")
        .map((part) => part.trim().split(/\s+as\s+/i)[0]?.trim())
        .filter(Boolean)
        .forEach((moduleName) => {
          addNode({
            name: moduleName,
            type: "import",
            edgeKind: "DEFINES",
            startLine: lineNumber,
            endLine: lineNumber,
          });
          addUnique(parsed.imports, seenImports, moduleName);
        });
    }

    const fromImportMatch = trimmed.match(/^from\s+([.\w]+)\s+import\s+(.+)$/);
    if (fromImportMatch) {
      addNode({
        name: fromImportMatch[1],
        type: "import",
        edgeKind: "DEFINES",
        startLine: lineNumber,
        endLine: lineNumber,
      });
      addUnique(parsed.imports, seenImports, fromImportMatch[1]);
    }

    const functionMatch = trimmed.match(/^def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/);
    if (functionMatch) {
      addNode({
        name: functionMatch[1],
        type: "python_function",
        edgeKind: "DEFINES",
        startLine: lineNumber,
        endLine: lineNumber,
      });
    }

    const classMatch = trimmed.match(/^class\s+([A-Za-z_][A-Za-z0-9_]*)\b/);
    if (classMatch) {
      addNode({
        name: classMatch[1],
        type: "python_class",
        edgeKind: "DEFINES",
        startLine: lineNumber,
        endLine: lineNumber,
      });
    }

    if (/^(def|class|from|import)\b/.test(trimmed)) return;

    const callPattern = /\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
    for (const match of trimmed.matchAll(callPattern)) {
      const callee = match[1];
      if (PYTHON_CALL_IGNORE.has(callee)) continue;
      addUnique(parsed.callees, seenCallees, callee);
    }
  });

  return parsed;
}

function parseJsonFile(filePath: string, content: string): ParsedFile {
  const parsed = createEmptyParsedFile(filePath);

  try {
    const value = JSON.parse(content) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return parsed;
    }

    Object.keys(value).forEach((key) => {
      parsed.nodes.push({
        name: key,
        type: "config",
        edgeKind: "CONTAINS",
      });
    });
  } catch {
    return parsed;
  }

  return parsed;
}

function parseYamlFile(filePath: string, content: string): ParsedFile {
  const parsed = createEmptyParsedFile(filePath);
  const seenKeys = new Set<string>();

  for (const line of content.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    if (/^\s/.test(line)) continue;

    const keyMatch = line.match(/^([A-Za-z0-9_.-]+)\s*:/);
    if (!keyMatch) continue;
    seenKeys.add(keyMatch[1]);
  }

  seenKeys.forEach((key) => {
    parsed.nodes.push({
      name: key,
      type: "config",
      edgeKind: "CONTAINS",
    });
  });

  return parsed;
}

function parseMarkdownFile(filePath: string, content: string): ParsedFile {
  const parsed = createEmptyParsedFile(filePath, "doc");
  const seenHeadings = new Set<string>();

  content.split(/\r?\n/).forEach((line, index) => {
    const headingMatch = line.match(/^(#{1,2})\s+(.+?)\s*$/);
    if (!headingMatch) return;

    const heading = headingMatch[2].trim();
    if (!heading || seenHeadings.has(heading)) return;
    seenHeadings.add(heading);
    parsed.nodes.push({
      name: heading,
      type: "doc",
      edgeKind: "DOCUMENTS",
      startLine: index + 1,
      endLine: index + 1,
    });
  });

  return parsed;
}

export function parseFile(filePath: string, content: string): ParsedFile | null {
  if (Buffer.byteLength(content, "utf-8") > MAX_CONTENT_BYTES) {
    return null;
  }

  const ext = path.extname(filePath).toLowerCase();

  try {
    if ([".js", ".jsx", ".ts", ".tsx"].includes(ext)) {
      return parseJavaScriptLikeFile(filePath, content);
    }

    if (ext === ".py") {
      return parsePythonFile(filePath, content);
    }

    if (ext === ".json") {
      return parseJsonFile(filePath, content);
    }

    if (ext === ".yaml" || ext === ".yml") {
      return parseYamlFile(filePath, content);
    }

    if (ext === ".md") {
      return parseMarkdownFile(filePath, content);
    }

    return null;
  } catch {
    return createEmptyParsedFile(filePath, ext === ".md" ? "doc" : "file");
  }
}
