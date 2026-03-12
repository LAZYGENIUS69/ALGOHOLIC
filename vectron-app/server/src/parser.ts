import * as babelParser from "@babel/parser";
import traverse from "@babel/traverse";
import * as t from "@babel/types";

export interface ParsedNode {
  name: string;
  type: "class" | "method" | "function" | "import";
  startLine?: number;
  endLine?: number;
}

export interface ParsedFile {
  /** relative path of the file within the zip */
  filePath: string;
  /** defined nodes (functions, classes, methods, imports) */
  nodes: ParsedNode[];
  /** module specifiers that appear in import declarations */
  imports: string[];
  /** function names that are called inside this file */
  callees: string[];
}

/**
 * Parse a single JS/TS file.
 * Returns null if the file cannot be parsed (syntax error etc.).
 */
// 500 KB — matches the ZIP-entry guard in index.ts.
// If an oversized string somehow reaches this function, bail out immediately
// rather than letting Babel throw "Invalid string length" mid-parse.
const MAX_CONTENT_BYTES = 500 * 1024;

export function parseFile(
  filePath: string,
  content: string,
): ParsedFile | null {
  // Second line of defense: guard against huge strings before Babel touches them.
  if (Buffer.byteLength(content, "utf-8") > MAX_CONTENT_BYTES) {
    return null;
  }

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

    const nodes: ParsedNode[] = [];
    const imports: string[] = [];
    const callees: string[] = [];
    const seen = {
      nodes: new Set<string>(),
      imports: new Set<string>(),
      callees: new Set<string>(),
    };

    const addNode = (n: ParsedNode) => {
      if (!seen.nodes.has(n.name)) {
        seen.nodes.add(n.name);
        nodes.push(n);
      }
    };

    traverse(ast as Parameters<typeof traverse>[0], {
      // --- Import declarations: import x from 'y'  /  import 'y'
      ImportDeclaration({ node }) {
        const src = node.source.value;
        addNode({
          name: src,
          type: "import",
          startLine: node.loc?.start.line,
          endLine: node.loc?.end.line,
        });
        if (!seen.imports.has(src)) {
          seen.imports.add(src);
          imports.push(src);
        }
      },

      // --- Function declarations: function foo() {}
      FunctionDeclaration({ node }) {
        const name = node.id?.name;
        if (name) {
          addNode({
            name,
            type: "function",
            startLine: node.loc?.start.line,
            endLine: node.loc?.end.line,
          });
        }
      },

      // --- Variable declarations with arrow/function expr: const foo = () => {}
      VariableDeclarator({ node }) {
        if (
          t.isIdentifier(node.id) &&
          (t.isArrowFunctionExpression(node.init) ||
            t.isFunctionExpression(node.init))
        ) {
          const name = node.id.name;
          addNode({
            name,
            type: "function",
            startLine: node.loc?.start.line,
            endLine: node.init.loc?.end.line || node.loc?.end.line,
          });
        }
      },

      // --- Class declarations
      ClassDeclaration({ node }) {
        const name = node.id?.name;
        if (name) {
          addNode({
            name,
            type: "class",
            startLine: node.loc?.start.line,
            endLine: node.loc?.end.line,
          });
        }
      },

      // --- Class methods
      ClassMethod({ node }) {
        if (t.isIdentifier(node.key)) {
          const name = node.key.name;
          addNode({
            name,
            type: "method",
            startLine: node.loc?.start.line,
            endLine: node.loc?.end.line,
          });
        }
      },

      // --- Call expressions: foo(), obj.bar()
      CallExpression({ node }) {
        let name: string | null = null;
        if (t.isIdentifier(node.callee)) {
          name = node.callee.name;
        } else if (
          t.isMemberExpression(node.callee) &&
          t.isIdentifier(node.callee.property)
        ) {
          name = node.callee.property.name;
        }
        if (name && !seen.callees.has(name)) {
          seen.callees.add(name);
          callees.push(name);
        }
      },
    });

    return { filePath, nodes, imports, callees };
  } catch {
    return null;
  }
}
