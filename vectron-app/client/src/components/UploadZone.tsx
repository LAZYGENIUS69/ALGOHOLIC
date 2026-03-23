import { useEffect, useRef, useState, useCallback } from 'react';
import { cloneGithubRepo, uploadZip } from '../lib/api';
import type { GraphData } from '../types/graph';

interface UploadZoneProps {
    onGraph: (data: GraphData) => void;
}

type UploadMode = 'zip' | 'github';
type LoadingMode = 'zip' | 'github' | null;

const GITHUB_LOADING_STEPS = [
    'Cloning repository...',
    'Parsing files...',
    'Building graph...',
] as const;

const EXAMPLE_REPOS = [
    'facebook/react',
    'expressjs/express',
    'microsoft/typescript',
] as const;

function buildGithubUrl(example: string) {
    return `https://github.com/${example}`;
}

export default function UploadZone({ onGraph }: UploadZoneProps) {
    const inputRef = useRef<HTMLInputElement>(null);
    const [mode, setMode] = useState<UploadMode>('zip');
    const [dragging, setDragging] = useState(false);
    const [loadingMode, setLoadingMode] = useState<LoadingMode>(null);
    const [loadingStepIndex, setLoadingStepIndex] = useState(0);
    const [githubUrl, setGithubUrl] = useState('');
    const [error, setError] = useState<string | null>(null);

    const isLoading = loadingMode !== null;
    const canAnalyzeGithub = githubUrl.trim().length > 0 && !isLoading;

    useEffect(() => {
        if (loadingMode !== 'github') {
            setLoadingStepIndex(0);
            return;
        }

        const interval = window.setInterval(() => {
            setLoadingStepIndex((current) => {
                if (current >= GITHUB_LOADING_STEPS.length - 1) {
                    return current;
                }
                return current + 1;
            });
        }, 1100);

        return () => window.clearInterval(interval);
    }, [loadingMode]);

    const handleFile = useCallback(async (file: File) => {
        if (!file.name.endsWith('.zip')) {
            setError('Please upload a .zip file.');
            return;
        }

        setError(null);
        setLoadingMode('zip');

        try {
            const graph = await uploadZip(file);
            onGraph(graph);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Upload failed');
        } finally {
            setLoadingMode(null);
        }
    }, [onGraph]);

    const handleGithubAnalyze = useCallback(async () => {
        setError(null);
        setLoadingStepIndex(0);
        setLoadingMode('github');

        try {
            const graph = await cloneGithubRepo(githubUrl.trim());
            onGraph(graph);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Repository analysis failed');
        } finally {
            setLoadingMode(null);
        }
    }, [githubUrl, onGraph]);

    const currentGithubStep = GITHUB_LOADING_STEPS[loadingStepIndex];

    return (
        <div className="upload-overlay">
            <input
                ref={inputRef}
                type="file"
                accept=".zip"
                style={{ display: 'none' }}
                onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleFile(f);
                }}
            />

            <div className={`upload-box ${dragging ? 'drag' : ''} ${mode === 'github' ? 'is-form' : ''}`}>
                <div className="upload-tabs" role="tablist" aria-label="Repository input mode">
                    <button
                        type="button"
                        className={`upload-tab ${mode === 'zip' ? 'active' : ''}`}
                        onClick={() => {
                            setMode('zip');
                            setError(null);
                        }}
                        disabled={isLoading}
                    >
                        Upload ZIP
                    </button>
                    <button
                        type="button"
                        className={`upload-tab ${mode === 'github' ? 'active' : ''}`}
                        onClick={() => {
                            setMode('github');
                            setError(null);
                        }}
                        disabled={isLoading}
                    >
                        GitHub URL
                    </button>
                </div>

                {mode === 'zip' ? (
                    <div
                        className="upload-pane"
                        onClick={() => !isLoading && inputRef.current?.click()}
                        onDragOver={(e) => {
                            e.preventDefault();
                            setDragging(true);
                        }}
                        onDragLeave={() => setDragging(false)}
                        onDrop={(e) => {
                            e.preventDefault();
                            setDragging(false);
                            const f = e.dataTransfer.files[0];
                            if (f) handleFile(f);
                        }}
                    >
                        <div className="upload-icon">
                            {loadingMode === 'zip' ? (
                                <div style={{ display: 'flex', justifyContent: 'center' }}>
                                    <div className="spinner" />
                                </div>
                            ) : '↑'}
                        </div>

                        <div className="upload-title">
                            {loadingMode === 'zip' ? 'Parsing repository...' : 'Upload Repository'}
                        </div>
                        <div className="upload-sub">
                            {loadingMode === 'zip'
                                ? 'Building knowledge graph from AST'
                                : 'Drag & drop a .zip file or click to browse'}
                        </div>
                        <div className="upload-hint">Supports JS · TS · JSX · TSX · PY · JSON · YAML · MD</div>
                    </div>
                ) : (
                    <div className="upload-pane upload-pane-form">
                        <div className="upload-icon">
                            {loadingMode === 'github' ? (
                                <div style={{ display: 'flex', justifyContent: 'center' }}>
                                    <div className="spinner" />
                                </div>
                            ) : '↗'}
                        </div>

                        <div className="upload-title">
                            {loadingMode === 'github' ? currentGithubStep : 'Analyze GitHub Repository'}
                        </div>
                        <div className="upload-sub">
                            {loadingMode === 'github'
                                ? 'Fetching the latest commit snapshot directly from GitHub'
                                : 'Paste a public GitHub repository URL to analyze it instantly'}
                        </div>

                        <input
                            type="url"
                            className="upload-github-input"
                            value={githubUrl}
                            onChange={(event) => setGithubUrl(event.target.value)}
                            placeholder="https://github.com/username/repository"
                            disabled={isLoading}
                        />

                        <button
                            type="button"
                            className="upload-analyze-btn"
                            onClick={handleGithubAnalyze}
                            disabled={!canAnalyzeGithub}
                        >
                            {loadingMode === 'github' ? (
                                <>
                                    <span className="spinner" />
                                    {currentGithubStep}
                                </>
                            ) : (
                                'ANALYZE REPOSITORY →'
                            )}
                        </button>

                        <div className="upload-examples">
                            <span className="upload-examples-label">Try these:</span>
                            <div className="upload-example-list">
                                {EXAMPLE_REPOS.map((example) => (
                                    <button
                                        key={example}
                                        type="button"
                                        className="upload-example-chip"
                                        onClick={() => setGithubUrl(buildGithubUrl(example))}
                                        disabled={isLoading}
                                    >
                                        {example}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                )}

                {error && <div className="upload-error">{error}</div>}
            </div>
        </div>
    );
}
