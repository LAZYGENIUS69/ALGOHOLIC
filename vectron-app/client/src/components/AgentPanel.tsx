import { useMemo, useState } from 'react';
import { generateAgentAnalysis } from '../lib/api';
import type { AgentAnalysisResponse, GraphData } from '../types/graph';

interface AgentPanelProps {
    graph: GraphData;
}

type AgentKey = keyof AgentAnalysisResponse['agents'];

const AGENT_ORDER: AgentKey[] = ['security', 'architecture', 'performance', 'quality', 'onboarding'];

const AGENT_ACCENTS: Record<AgentKey, string> = {
    security: '#FF3B30',
    architecture: '#00D9FF',
    performance: '#FFD600',
    quality: '#30D158',
    onboarding: '#818cf8',
};

const LOADING_AGENTS = [
    { key: 'security', title: 'Security Analysis', icon: '🔴' },
    { key: 'architecture', title: 'Architecture Review', icon: '🔵' },
    { key: 'performance', title: 'Performance Audit', icon: '🟡' },
    { key: 'quality', title: 'Code Quality', icon: '🟢' },
    { key: 'onboarding', title: 'Onboarding Guide', icon: '⚡' },
] as const;

function extractBadge(content: string) {
    const match = content.match(/(?:RISK LEVEL|ARCHITECTURE SCORE|PERFORMANCE SCORE|QUALITY SCORE):\s*([^\n]+)/i);
    return match?.[1]?.trim() ?? '';
}

function renderFormattedContent(content: string) {
    const highlighted = content.split(/(\b(?:HIGH|MEDIUM|LOW|FINDINGS|RECOMMENDATIONS|HOT PATHS|BOTTLENECKS|ISSUES FOUND|DEAD CODE CANDIDATES|START HERE|CORE DATA FLOW|LEARNING PATH|RISK LEVEL|ARCHITECTURE SCORE|PERFORMANCE SCORE|QUALITY SCORE)\b)/g);

    return highlighted.map((part, index) => {
        if (/^(HIGH|MEDIUM|LOW|FINDINGS|RECOMMENDATIONS|HOT PATHS|BOTTLENECKS|ISSUES FOUND|DEAD CODE CANDIDATES|START HERE|CORE DATA FLOW|LEARNING PATH|RISK LEVEL|ARCHITECTURE SCORE|PERFORMANCE SCORE|QUALITY SCORE)$/i.test(part)) {
            return <span key={`${part}-${index}`} className="agent-highlight">{part}</span>;
        }

        return <span key={`${part}-${index}`}>{part}</span>;
    });
}

export default function AgentPanel({ graph }: AgentPanelProps) {
    const [loading, setLoading] = useState(false);
    const [analysis, setAnalysis] = useState<AgentAnalysisResponse | null>(null);
    const [error, setError] = useState<string | null>(null);

    const orderedAgents = useMemo(() => {
        if (!analysis) return [];
        return AGENT_ORDER.map((key) => ({
            key,
            accent: AGENT_ACCENTS[key],
            badge: extractBadge(analysis.agents[key].content),
            ...analysis.agents[key],
        }));
    }, [analysis]);

    const handleLaunch = async () => {
        setLoading(true);
        setError(null);

        try {
            const nextAnalysis = await generateAgentAnalysis(graph);
            setAnalysis(nextAnalysis);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Agent analysis failed.');
        } finally {
            setLoading(false);
        }
    };

    if (loading) {
        return (
            <div className="agent-panel">
                <div className="agent-panel-shell">
                    <div className="agent-panel-header">
                        <div className="agent-panel-title">MULTI-AGENT ANALYSIS</div>
                        <div className="agent-panel-subtitle">POWERED BY FEATHERLESS.AI</div>
                        <div className="agent-badge">⚡ featherless.ai</div>
                    </div>
                    <div className="agent-grid">
                        {LOADING_AGENTS.map((agent) => (
                            <div key={agent.key} className={`agent-card agent-card-loading agent-card-${agent.key}`}>
                                <div className="agent-card-header">
                                    <div className="agent-card-title-wrap">
                                        <span className="agent-card-icon">{agent.icon}</span>
                                        <span className="agent-card-title">{agent.title}</span>
                                    </div>
                                </div>
                                <div className="agent-card-loading-text">Analyzing...</div>
                            </div>
                        ))}
                    </div>
                    <div className="agent-status-line">featherless.ai agents running in parallel...</div>
                </div>
            </div>
        );
    }

    if (analysis) {
        return (
            <div className="agent-panel">
                <div className="agent-panel-shell">
                    <div className="agent-grid agent-grid-results">
                        {orderedAgents.map((agent) => (
                            <article
                                key={agent.key}
                                className={`agent-card agent-card-${agent.key} ${agent.key === 'onboarding' ? 'agent-card-wide' : ''}`}
                                style={{ borderLeft: `3px solid ${agent.accent}` }}
                            >
                                <div className="agent-card-header">
                                    <div className="agent-card-title-wrap">
                                        <span className="agent-card-icon">{agent.icon}</span>
                                        <span className="agent-card-title">{agent.title}</span>
                                    </div>
                                    {agent.badge && <span className="agent-score-badge">{agent.badge}</span>}
                                </div>
                                <div className="agent-card-content">
                                    {agent.content.split('\n').map((line, index) => (
                                        <p key={`${agent.key}-${index}`}>{renderFormattedContent(line)}</p>
                                    ))}
                                </div>
                            </article>
                        ))}
                    </div>

                    <div className="agent-bottom-bar">
                        <span>Generated by featherless.ai Multi-Agent System</span>
                        <span>{new Date(analysis.generatedAt).toLocaleString()}</span>
                        <button type="button" className="agent-regenerate-btn" onClick={handleLaunch}>
                            Regenerate
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="agent-panel">
            <div className="agent-panel-shell agent-panel-empty">
                <div className="agent-panel-title">MULTI-AGENT ANALYSIS</div>
                <div className="agent-panel-subtitle">POWERED BY FEATHERLESS.AI</div>
                <div className="agent-badge">⚡ featherless.ai</div>
                <p className="agent-panel-copy">
                    5 specialized AI agents analyze your codebase simultaneously.
                    Security, Architecture, Performance, Code Quality, and Onboarding
                    — each powered by featherless.ai&apos;s extended reasoning.
                </p>
                <button type="button" className="agent-launch-btn" onClick={handleLaunch}>
                    LAUNCH AGENT ANALYSIS
                </button>
                {error && <div className="agent-error">{error}</div>}
            </div>
        </div>
    );
}
