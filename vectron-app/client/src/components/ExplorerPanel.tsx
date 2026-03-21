import { useMemo, useState } from 'react';
import type { GraphNode } from '../types/graph';

interface ExplorerDir {
    type: 'dir';
    name: string;
    path: string;
    children: (ExplorerDir | ExplorerFile)[];
}

interface ExplorerFile {
    type: 'file';
    name: string;
    path: string;
    node: GraphNode;
}

interface ExplorerPanelProps {
    nodes: GraphNode[];
    focusedFileId: string | null;
    onFileClick: (fileId: string) => void;
}

type GitStatusCode = 'M' | 'U' | null;

function buildTree(fileNodes: GraphNode[]): ExplorerDir {
    const root: ExplorerDir = { type: 'dir', name: 'root', path: '', children: [] };

    for (const node of fileNodes) {
        const parts = node.filePath.replace(/\\/g, '/').split('/');
        let current = root;

        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            const isFile = i === parts.length - 1;
            const currentPath = parts.slice(0, i + 1).join('/');

            if (isFile) {
                current.children.push({
                    type: 'file',
                    name: part,
                    path: currentPath,
                    node
                });
            } else {
                let nextDir = current.children.find(
                    (child) => child.type === 'dir' && child.name === part
                ) as ExplorerDir | undefined;

                if (!nextDir) {
                    nextDir = { type: 'dir', name: part, path: currentPath, children: [] };
                    current.children.push(nextDir);
                }

                current = nextDir;
            }
        }
    }

    const sortDir = (dir: ExplorerDir) => {
        dir.children.sort((a, b) => {
            if (a.type === b.type) return a.name.localeCompare(b.name);
            return a.type === 'dir' ? -1 : 1;
        });

        dir.children.forEach((child) => {
            if (child.type === 'dir') sortDir(child);
        });
    };

    sortDir(root);
    return root;
}

function filterTree(dir: ExplorerDir, query: string): ExplorerDir {
    if (!query) return dir;

    const filteredChildren = dir.children.reduce<(ExplorerDir | ExplorerFile)[]>((result, child) => {
        if (child.type === 'file') {
            if (child.path.toLowerCase().includes(query)) {
                result.push(child);
            }
            return result;
        }

        const filteredDir = filterTree(child, query);
        if (filteredDir.children.length > 0 || child.path.toLowerCase().includes(query)) {
            result.push({ ...child, children: filteredDir.children });
        }

        return result;
    }, []);

    return {
        ...dir,
        children: filteredChildren
    };
}

function getFileColor(name: string) {
    const lower = name.toLowerCase();

    if (lower.endsWith('.tsx') || lower.endsWith('.jsx')) return '#4ec9ff';
    if (lower.endsWith('.ts') || lower.endsWith('.js')) return '#a0ff76';
    if (lower.endsWith('.css')) return '#6aa8ff';
    if (lower.endsWith('.json')) return '#ffcb6b';
    if (lower.endsWith('.md')) return '#8f93b2';
    return '#5e6ad2';
}

function getFileLabel(name: string) {
    const lower = name.toLowerCase();

    if (lower.endsWith('.tsx')) return 'TSX';
    if (lower.endsWith('.ts')) return 'TS';
    if (lower.endsWith('.jsx')) return 'JSX';
    if (lower.endsWith('.js')) return 'JS';
    if (lower.endsWith('.css')) return 'CSS';
    if (lower.endsWith('.json')) return '{}';
    if (lower.endsWith('.md')) return 'MD';
    return name.slice(0, 1).toUpperCase();
}

function getGitStatus(node: GraphNode): GitStatusCode {
    const rawNode = node as GraphNode & {
        gitStatus?: string;
        git?: string;
        status?: string;
        git_state?: string;
    };

    const value = (rawNode.gitStatus ?? rawNode.git ?? rawNode.status ?? rawNode.git_state ?? '').toUpperCase();

    if (value === 'M' || value.startsWith('MOD')) return 'M';
    if (value === 'U' || value === '??' || value.startsWith('UNTRACK')) return 'U';
    return null;
}

function DirNode({
    dir,
    level,
    query,
    focusedFileId,
    onFileClick
}: {
    dir: ExplorerDir;
    level: number;
    query: string;
    focusedFileId: string | null;
    onFileClick: (fileId: string) => void;
}) {
    const [expanded, setExpanded] = useState(level < 2 || query.length > 0);
    const isExpanded = query.length > 0 ? true : expanded;

    return (
        <div className="explorer-node">
            <button
                type="button"
                className="explorer-entry explorer-entry-folder"
                style={{ paddingLeft: 16 + level * 14 }}
                onClick={() => setExpanded((value) => !value)}
                title={dir.path || dir.name}
            >
                <span className="explorer-chevron" aria-hidden="true">
                    {isExpanded ? '\u2304' : '\u203a'}
                </span>
                <span className="explorer-folder-icon" aria-hidden="true" />
                <span className="explorer-entry-name">{dir.name}</span>
            </button>

            {isExpanded && (
                <div className="explorer-children">
                    {dir.children.map((child) =>
                        child.type === 'dir' ? (
                            <DirNode
                                key={child.path}
                                dir={child}
                                level={level + 1}
                                query={query}
                                focusedFileId={focusedFileId}
                                onFileClick={onFileClick}
                            />
                        ) : (
                            <FileNode
                                key={child.path}
                                file={child}
                                level={level + 1}
                                focusedFileId={focusedFileId}
                                onFileClick={onFileClick}
                            />
                        )
                    )}
                </div>
            )}
        </div>
    );
}

function FileNode({
    file,
    level,
    focusedFileId,
    onFileClick
}: {
    file: ExplorerFile;
    level: number;
    focusedFileId: string | null;
    onFileClick: (fileId: string) => void;
}) {
    const isFocused = focusedFileId === file.node.fileId;
    const gitStatus = getGitStatus(file.node);
    const label = getFileLabel(file.name);

    return (
        <button
            type="button"
            className={`explorer-entry explorer-entry-file ${isFocused ? 'is-selected' : ''}`}
            style={{ paddingLeft: 16 + level * 14 }}
            onClick={() => onFileClick(file.node.fileId)}
            title={file.path}
        >
            <span className="explorer-chevron explorer-chevron-placeholder" aria-hidden="true" />
            <span
                className="explorer-file-icon"
                style={{ color: getFileColor(file.name) }}
                aria-hidden="true"
            >
                {label}
            </span>
            <span className="explorer-entry-name">{file.name}</span>
            {gitStatus && (
                <span className={`explorer-git-badge ${gitStatus === 'M' ? 'is-modified' : 'is-untracked'}`}>
                    {gitStatus}
                </span>
            )}
        </button>
    );
}

export default function ExplorerPanel({ nodes, focusedFileId, onFileClick }: ExplorerPanelProps) {
    const [query, setQuery] = useState('');

    const fileNodes = useMemo(() => nodes.filter((node) => node.type === 'file' || node.type === 'doc'), [nodes]);
    const tree = useMemo(() => buildTree(fileNodes), [fileNodes]);
    const normalizedQuery = query.trim().toLowerCase();
    const filteredTree = useMemo(() => filterTree(tree, normalizedQuery), [tree, normalizedQuery]);

    return (
        <div className="explorer-tree-container">
            <div className="explorer-search-shell">
                <label className="explorer-search">
                    <span className="explorer-search-icon" aria-hidden="true">
                        ⌕
                    </span>
                    <input
                        type="text"
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder="Search files..."
                        className="explorer-search-input"
                    />
                </label>
            </div>

            <div className="explorer-tree">
                {filteredTree.children.length > 0 ? (
                    filteredTree.children.map((child) =>
                        child.type === 'dir' ? (
                            <DirNode
                                key={child.path}
                                dir={child}
                                level={0}
                                query={normalizedQuery}
                                focusedFileId={focusedFileId}
                                onFileClick={onFileClick}
                            />
                        ) : (
                            <FileNode
                                key={child.path}
                                file={child}
                                level={0}
                                focusedFileId={focusedFileId}
                                onFileClick={onFileClick}
                            />
                        )
                    )
                ) : (
                    <div className="explorer-empty-state">No files match this search.</div>
                )}
            </div>
        </div>
    );
}
