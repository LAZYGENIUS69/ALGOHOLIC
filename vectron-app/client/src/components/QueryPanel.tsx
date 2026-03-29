import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { GraphData, LLMConfig, LLMProvider } from '../types/graph';
import { queryCodebase } from '../lib/api';
import GraphView2D from './GraphView2D';
import NodeIntelligence from './NodeIntelligence';

interface Message {
    role: 'user' | 'ai';
    content: string;
}

interface QueryPanelProps {
    graph: GraphData;
    onQueryResult: (nodeIds: string[]) => void;
    onClearQuery: () => void;
}

const STORAGE_KEY = 'vectron_llm_config';
const DEFAULT_LLM_CONFIG: LLMConfig = {
    provider: 'auto',
    apiKey: '',
    model: '',
    baseUrl: '',
};

const PROVIDER_OPTIONS: Array<{ value: LLMProvider; label: string }> = [
    { value: 'auto', label: 'Auto (featherless.ai \u2192 Groq \u2192 Cerebras)' },
    { value: 'featherless', label: 'featherless.ai' },
    { value: 'openai', label: 'OpenAI' },
    { value: 'anthropic', label: 'Anthropic' },
    { value: 'groq', label: 'Groq' },
    { value: 'cerebras', label: 'Cerebras' },
    { value: 'custom', label: 'Custom' },
];

const PROVIDER_LABELS: Record<LLMProvider, string> = {
    auto: 'Auto',
    featherless: 'featherless.ai',
    openai: 'OpenAI',
    anthropic: 'Anthropic',
    groq: 'Groq',
    cerebras: 'Cerebras',
    custom: 'Custom',
};

const MODEL_PLACEHOLDERS: Record<LLMProvider, string> = {
    auto: 'mistralai/Mistral-7B-Instruct-v0.3 (default)',
    featherless: 'mistralai/Mistral-7B-Instruct-v0.3',
    openai: 'gpt-4o',
    anthropic: 'claude-sonnet-4-5',
    groq: 'llama-3.3-70b-versatile',
    cerebras: 'llama3.1-8b',
    custom: 'your-model-name',
};

const DEFAULT_MODEL_VALUES: Record<Exclude<LLMProvider, 'auto' | 'custom'>, string> = {
    featherless: 'mistralai/Mistral-7B-Instruct-v0.3',
    openai: 'gpt-4o',
    anthropic: 'claude-sonnet-4-5',
    groq: 'llama-3.3-70b-versatile',
    cerebras: 'llama3.1-8b',
};

function isLLMProvider(value: string): value is LLMProvider {
    return ['auto', 'featherless', 'openai', 'anthropic', 'groq', 'cerebras', 'custom'].includes(value);
}

function normalizeConfig(raw?: Partial<LLMConfig> | null): LLMConfig {
    const provider = isLLMProvider((raw?.provider ?? '').toLowerCase())
        ? (raw?.provider ?? '').toLowerCase() as LLMProvider
        : 'auto';
    const apiKey = raw?.apiKey?.trim() ?? '';
    const baseUrl = raw?.baseUrl?.trim() ?? '';
    const incomingModel = raw?.model?.trim() ?? '';

    if (provider === 'auto') {
        return { ...DEFAULT_LLM_CONFIG };
    }

    const model = provider === 'custom'
        ? incomingModel
        : incomingModel || DEFAULT_MODEL_VALUES[provider];

    return {
        provider,
        apiKey,
        model,
        baseUrl: provider === 'custom' ? baseUrl : '',
    };
}

function isCustomConfigActive(config: LLMConfig) {
    return config.provider !== 'auto' && config.apiKey.trim().length > 0;
}

function getPoweredByText(config: LLMConfig, lastProviderUsed: string) {
    const provider = lastProviderUsed || (!isCustomConfigActive(config) || config.provider === 'auto'
        ? 'featherless.ai'
        : PROVIDER_LABELS[config.provider]);

    if (provider === 'featherless.ai') {
        return 'POWERED BY FEATHERLESS.AI';
    }

    if (!isCustomConfigActive(config) || config.provider === 'auto') {
        return `Powered by: ${provider}`;
    }

    return `Powered by: ${provider} (custom)`;
}

function GearIcon() {
    return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
                d="M19.14 12.94a7.66 7.66 0 0 0 .05-.94 7.66 7.66 0 0 0-.05-.94l2.03-1.58a.5.5 0 0 0 .12-.63l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.02 7.02 0 0 0-1.63-.94l-.36-2.54a.5.5 0 0 0-.49-.42h-3.84a.5.5 0 0 0-.49.42l-.36 2.54c-.58.22-1.12.53-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.7 8.85a.5.5 0 0 0 .12.63l2.03 1.58a7.66 7.66 0 0 0-.05.94c0 .32.02.63.05.94L2.82 14.52a.5.5 0 0 0-.12.63l1.92 3.32a.5.5 0 0 0 .6.22l2.39-.96c.5.4 1.05.72 1.63.94l.36 2.54a.5.5 0 0 0 .49.42h3.84a.5.5 0 0 0 .49-.42l.36-2.54c.58-.22 1.13-.54 1.63-.94l2.39.96a.5.5 0 0 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.63ZM12 15.2A3.2 3.2 0 1 1 12 8.8a3.2 3.2 0 0 1 0 6.4Z"
                fill="currentColor"
            />
        </svg>
    );
}

function EyeIcon({ hidden }: { hidden: boolean }) {
    return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
                d="M12 6.5c5.08 0 9.27 3.11 10.5 5.5-1.23 2.39-5.42 5.5-10.5 5.5S2.73 14.39 1.5 12C2.73 9.61 6.92 6.5 12 6.5Zm0 2A3.5 3.5 0 1 0 12 15.5a3.5 3.5 0 0 0 0-7Z"
                fill="currentColor"
            />
            {hidden && (
                <path
                    d="M4 4.7 19.3 20l-1.4 1.4L2.6 6.1 4 4.7Z"
                    fill="currentColor"
                />
            )}
        </svg>
    );
}

function formatAiMessage(content: string) {
    const lines = content.split('\n');
    const callChainIndex = lines.findIndex((line) => /call chain/i.test(line));

    if (callChainIndex === -1) {
        return {
            callChain: null,
            body: content,
        };
    }

    return {
        callChain: lines[callChainIndex],
        body: lines.filter((_, index) => index !== callChainIndex).join('\n').trim(),
    };
}

export default function QueryPanel({
    graph,
    onQueryResult,
    onClearQuery,
}: QueryPanelProps) {
    const [question, setQuestion] = useState('');
    const [history, setHistory] = useState<Message[]>([]);
    const [loading, setLoading] = useState(false);
    const [hasResult, setHasResult] = useState(false);
    const [highlightedNodeIds, setHighlightedNodeIds] = useState<string[]>([]);
    const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [showApiKey, setShowApiKey] = useState(false);
    const [savedConfig, setSavedConfig] = useState<LLMConfig>(DEFAULT_LLM_CONFIG);
    const [draftConfig, setDraftConfig] = useState<LLMConfig>(DEFAULT_LLM_CONFIG);
    const [lastProviderUsed, setLastProviderUsed] = useState('');
    const scrollRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    const allNodeFilters = useMemo(() => ({
        file: true,
        function: true,
        class: true,
        method: true,
        import: true,
        python_function: true,
        python_class: true,
        config: true,
        doc: true,
    }), []);
    const allEdgeFilters = useMemo(() => ({
        DEFINES: true,
        IMPORTS: true,
        CALLS: true,
        EXTENDS: true,
        CONTAINS: true,
        DOCUMENTS: true,
    }), []);
    const highlightedSet = useMemo(() => new Set(highlightedNodeIds), [highlightedNodeIds]);
    const selectedNode = useMemo(
        () => (selectedNodeId ? graph.nodes.find((node) => node.id === selectedNodeId) ?? null : null),
        [graph.nodes, selectedNodeId],
    );
    const customConfigActive = useMemo(() => isCustomConfigActive(savedConfig), [savedConfig]);
    const canSaveConfig = useMemo(() => {
        if (draftConfig.provider === 'auto') return false;
        if (!draftConfig.apiKey.trim()) return false;
        if (draftConfig.provider === 'custom' && !draftConfig.model.trim()) return false;
        return true;
    }, [draftConfig]);
    const poweredByLabel = useMemo(
        () => getPoweredByText(savedConfig, lastProviderUsed),
        [lastProviderUsed, savedConfig],
    );

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [history, loading]);

    useEffect(() => {
        const timer = window.setTimeout(() => textareaRef.current?.focus(), 80);
        return () => window.clearTimeout(timer);
    }, []);

    useEffect(() => {
        try {
            const stored = window.localStorage.getItem(STORAGE_KEY);
            if (!stored) return;
            const parsed = normalizeConfig(JSON.parse(stored) as Partial<LLMConfig>);
            setSavedConfig(parsed);
            setDraftConfig(parsed);
        } catch {
            window.localStorage.removeItem(STORAGE_KEY);
        }
    }, []);

    useEffect(() => () => onClearQuery(), [onClearQuery]);

    const handleSubmit = async (event?: React.FormEvent) => {
        if (event) event.preventDefault();
        if (!question.trim() || loading) return;

        const userQuestion = question.trim();
        setQuestion('');
        setHistory((prev) => [...prev, { role: 'user', content: userQuestion }]);
        setLoading(true);
        setHasResult(false);
        setHighlightedNodeIds([]);
        onClearQuery();

        try {
            const data = await queryCodebase(graph, userQuestion, savedConfig);
            setLastProviderUsed(data.provider || '');
            setHistory((prev) => [...prev, { role: 'ai', content: data.explanation }]);

            if (data.relevantNodes.length > 0) {
                setHighlightedNodeIds(data.relevantNodes);
                onQueryResult(data.relevantNodes);
                setHasResult(true);
            }
        } catch (error) {
            setHistory((prev) => [
                ...prev,
                { role: 'ai', content: 'ERROR: Could not analyze codebase. Ensure the backend is running.' },
            ]);
        } finally {
            setLoading(false);
            window.setTimeout(() => textareaRef.current?.focus(), 40);
        }
    };

    const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            handleSubmit();
        }
    };

    const handleDraftChange = (field: keyof LLMConfig, value: string) => {
        setDraftConfig((prev) => ({
            ...prev,
            [field]: value,
        }));
    };

    const handleSaveConfig = () => {
        const nextConfig = normalizeConfig(draftConfig);
        setSavedConfig(nextConfig);
        setDraftConfig(nextConfig);
        setLastProviderUsed('');
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
            provider: nextConfig.provider,
            apiKey: nextConfig.apiKey,
            model: nextConfig.model,
            ...(nextConfig.baseUrl ? { baseUrl: nextConfig.baseUrl } : {}),
        }));
        window.setTimeout(() => textareaRef.current?.focus(), 40);
    };

    const handleClearConfig = () => {
        setSavedConfig(DEFAULT_LLM_CONFIG);
        setDraftConfig(DEFAULT_LLM_CONFIG);
        setLastProviderUsed('');
        setShowApiKey(false);
        window.localStorage.removeItem(STORAGE_KEY);
        window.setTimeout(() => textareaRef.current?.focus(), 40);
    };

    const emptyState = useMemo(() => (
        <div className="query-empty-state">
            {"// SYSTEM READY..."}
            <br />
            Ask a structural question to inspect call chains, dependencies, and impact paths.
        </div>
    ), []);

    return (
        <div className="ask-ai-page">
            <section className="ask-ai-chat-pane">
                <div className="ask-ai-pane-header">
                    <div className="ask-ai-header-copy">
                        <h2 className="ask-ai-title">ASK YOUR CODEBASE</h2>
                        <p className={`ask-ai-provider-line ${poweredByLabel.includes('FEATHERLESS.AI') ? 'ask-ai-provider-line-asi' : ''}`}>{poweredByLabel}</p>
                    </div>
                    <div className="ask-ai-header-actions">
                        {hasResult && (
                            <button
                                className="ask-ai-clear-btn"
                                onClick={() => {
                                    setHighlightedNodeIds([]);
                                    setHasResult(false);
                                    onClearQuery();
                                }}
                            >
                                Clear Highlights
                            </button>
                        )}
                        <button
                            type="button"
                            className={`ask-ai-settings-btn ${settingsOpen ? 'open' : ''}`}
                            onClick={() => setSettingsOpen((value) => !value)}
                            aria-label="Toggle LLM configuration"
                            aria-expanded={settingsOpen}
                        >
                            <span className={`ask-ai-settings-dot ${customConfigActive ? 'active' : ''}`} />
                            <GearIcon />
                        </button>
                    </div>
                </div>

                {settingsOpen && (
                    <div className="ask-ai-settings-drawer">
                        <div className="ask-ai-settings-title">LLM CONFIGURATION</div>

                        <label className="ask-ai-settings-field">
                            <span>Provider</span>
                            <select
                                value={draftConfig.provider}
                                onChange={(event) => handleDraftChange('provider', event.target.value)}
                                className="ask-ai-settings-input"
                            >
                                {PROVIDER_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>
                                        {option.label}
                                    </option>
                                ))}
                            </select>
                        </label>

                        {draftConfig.provider === 'featherless' && (
                            <p className="ask-ai-subtitle">Primary provider - featherless.ai inference enabled</p>
                        )}

                        <label className="ask-ai-settings-field">
                            <span>API Key</span>
                            <div className="ask-ai-password-wrap">
                                <input
                                    type={showApiKey ? 'text' : 'password'}
                                    value={draftConfig.apiKey}
                                    onChange={(event) => handleDraftChange('apiKey', event.target.value)}
                                    placeholder="Enter your API key..."
                                    className="ask-ai-settings-input"
                                />
                                <button
                                    type="button"
                                    className="ask-ai-visibility-btn"
                                    aria-label={showApiKey ? 'Hide API key' : 'Show API key'}
                                    onClick={() => setShowApiKey((value) => !value)}
                                >
                                    <EyeIcon hidden={!showApiKey} />
                                </button>
                            </div>
                        </label>

                        <label className="ask-ai-settings-field">
                            <span>Model</span>
                            <input
                                type="text"
                                value={draftConfig.model}
                                onChange={(event) => handleDraftChange('model', event.target.value)}
                                placeholder={MODEL_PLACEHOLDERS[draftConfig.provider]}
                                className="ask-ai-settings-input"
                            />
                        </label>

                        {draftConfig.provider === 'featherless' && (
                            <label className="ask-ai-settings-field">
                                <span>Base URL</span>
                                <input
                                    type="text"
                                    value="https://api.featherless.ai/v1"
                                    readOnly
                                    className="ask-ai-settings-input"
                                />
                            </label>
                        )}

                        {draftConfig.provider === 'custom' && (
                            <label className="ask-ai-settings-field">
                                <span>Base URL</span>
                                <input
                                    type="text"
                                    value={draftConfig.baseUrl ?? ''}
                                    onChange={(event) => handleDraftChange('baseUrl', event.target.value)}
                                    placeholder="https://api.openai.com/v1"
                                    className="ask-ai-settings-input"
                                />
                            </label>
                        )}

                        <button
                            type="button"
                            className={`ask-ai-save-btn ${canSaveConfig ? 'filled' : 'empty'}`}
                            onClick={handleSaveConfig}
                            disabled={!canSaveConfig}
                        >
                            SAVE CONFIGURATION
                        </button>
                        <button
                            type="button"
                            className="ask-ai-reset-btn"
                            onClick={handleClearConfig}
                        >
                            Clear &amp; Use Default
                        </button>
                    </div>
                )}

                <div ref={scrollRef} className="ask-ai-history">
                    {history.length === 0 && !loading && emptyState}

                    {history.map((message, index) => {
                        const formatted = message.role === 'ai'
                            ? formatAiMessage(message.content)
                            : null;

                        return (
                            <div
                                key={`${message.role}-${index}`}
                                className={`query-message ${message.role === 'user' ? 'user' : 'ai'}`}
                            >
                                {message.role === 'user' ? (
                                    <div className="query-message-body">{message.content}</div>
                                ) : (
                                    <div className="query-ai-content ask-ai-mono">
                                        {formatted?.callChain && (
                                            <div className="query-call-chain">{formatted.callChain}</div>
                                        )}
                                        {formatted?.body && (
                                            <div className="query-message-body">{formatted.body}</div>
                                        )}
                                        {!formatted?.body && !formatted?.callChain && (
                                            <div className="query-message-body">{message.content}</div>
                                        )}
                                    </div>
                                )}
                            </div>
                        );
                    })}

                    {loading && (
                        <div className="query-loading">
                            <span className="query-loading-label">ANALYZING...</span>
                            <span className="query-loading-dots" aria-hidden="true">
                                <span />
                                <span />
                                <span />
                            </span>
                        </div>
                    )}
                </div>

                <div className="ask-ai-composer">
                    <form className="query-input-row" onSubmit={handleSubmit}>
                        <textarea
                            ref={textareaRef}
                            rows={3}
                            value={question}
                            onChange={(event) => setQuestion(event.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder="Ask anything about your codebase..."
                            className="query-input ask-ai-input"
                        />
                        <button
                            type="submit"
                            className="query-send-btn ask-ai-send-btn"
                            disabled={loading || !question.trim()}
                        >
                            &rarr;
                        </button>
                    </form>
                </div>
            </section>

            <section className="ask-ai-graph-pane">
                <div className="ask-ai-pane-header ask-ai-graph-header">
                    <div>
                        <h3 className="ask-ai-graph-title">RELEVANT STRUCTURE</h3>
                        <p className="ask-ai-subtitle">
                            {selectedNode
                                ? `Selected node: ${selectedNode.label}`
                                : 'AI-highlighted nodes appear in white for quick visual verification.'}
                        </p>
                    </div>
                </div>
                <div className="ask-ai-graph-pane-body">
                    <div className="ask-ai-mini-graph">
                        <GraphView2D
                            data={graph}
                            vectronMode={false}
                            fileViewMode={false}
                            blastIds={new Set<string>()}
                            depthMap={new Map<string, number>()}
                            selectedId={selectedNodeId}
                            focusedFileId={null}
                            onNodeClick={(id) => setSelectedNodeId(id || null)}
                            onFileView={() => undefined}
                            nodeFilters={allNodeFilters}
                            edgeFilters={allEdgeFilters}
                            queryIds={highlightedSet}
                            interactive
                            hideEdgesOnMove={false}
                            allowInvalidContainer={false}
                            renderEdgeLabels={false}
                            enableEdgeEvents={false}
                        />
                    </div>

                    <div className="ask-ai-node-intel-shell">
                        <NodeIntelligence
                            selectedNode={selectedNode}
                            graph={graph}
                        />
                    </div>
                </div>
            </section>
        </div>
    );
}
