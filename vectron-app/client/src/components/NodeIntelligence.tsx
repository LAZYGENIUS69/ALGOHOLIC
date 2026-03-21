import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchNodeSummary } from '../lib/api';
import type { GraphData, GraphNode } from '../types/graph';

interface NodeIntelligenceProps {
    selectedNode: GraphNode | null;
    graph: GraphData;
}

type RiskStatus = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

const NODE_TYPE_COLORS: Record<GraphNode['type'], string> = {
    file: '#FF2D55',
    function: '#00C7BE',
    class: '#FF9F0A',
    method: '#30D158',
    import: '#636366',
};

const DEPENDENCY_EDGE_KINDS = new Set(['CALLS', 'IMPORTS', 'EXTENDS']);
const RISK_COLORS: Record<RiskStatus, string> = {
    LOW: '#30D158',
    MEDIUM: '#FFD600',
    HIGH: '#FF9500',
    CRITICAL: '#FF3B30',
};

function getRiskStatus(score: number): RiskStatus {
    if (score > 75) return 'CRITICAL';
    if (score > 50) return 'HIGH';
    if (score > 25) return 'MEDIUM';
    return 'LOW';
}

function uniqueNodes(nodes: GraphNode[]) {
    const seen = new Set<string>();
    return nodes.filter((node) => {
        if (seen.has(node.id)) return false;
        seen.add(node.id);
        return true;
    });
}

export default function NodeIntelligence({ selectedNode, graph }: NodeIntelligenceProps) {
    const summaryCacheRef = useRef(new Map<string, string>());
    const [summary, setSummary] = useState('');
    const [loadingSummary, setLoadingSummary] = useState(false);

    const intelligence = useMemo(() => {
        if (!selectedNode) return null;

        const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
        const incomingEdges = graph.edges.filter((edge) => edge.target === selectedNode.id);
        const outgoingEdges = graph.edges.filter((edge) => edge.source === selectedNode.id);
        const dependencyOutgoing = uniqueNodes(
            outgoingEdges
                .filter((edge) => DEPENDENCY_EDGE_KINDS.has(edge.kind))
                .map((edge) => nodeById.get(edge.target))
                .filter((node): node is GraphNode => !!node),
        );
        const dependencyIncoming = uniqueNodes(
            incomingEdges
                .filter((edge) => DEPENDENCY_EDGE_KINDS.has(edge.kind))
                .map((edge) => nodeById.get(edge.source))
                .filter((node): node is GraphNode => !!node),
        );

        const degreeMap = new Map<string, number>();
        graph.nodes.forEach((node) => degreeMap.set(node.id, 0));
        graph.edges.forEach((edge) => {
            degreeMap.set(edge.source, (degreeMap.get(edge.source) ?? 0) + 1);
            degreeMap.set(edge.target, (degreeMap.get(edge.target) ?? 0) + 1);
        });

        const maxDegreeInGraph = Math.max(1, ...Array.from(degreeMap.values()));
        const score = Number((((incomingEdges.length * 2 + outgoingEdges.length) / maxDegreeInGraph) * 100).toFixed(0));
        const riskStatus = getRiskStatus(score);

        return {
            incomingEdges,
            outgoingEdges,
            dependencyOutgoing,
            dependencyIncoming,
            score,
            riskStatus,
            typeColor: NODE_TYPE_COLORS[selectedNode.type],
        };
    }, [graph, selectedNode]);

    useEffect(() => {
        if (!selectedNode) {
            setSummary('');
            setLoadingSummary(false);
            return;
        }

        const cached = summaryCacheRef.current.get(selectedNode.id);
        if (cached) {
            setSummary(cached);
            setLoadingSummary(false);
            return;
        }

        let ignore = false;
        setSummary('');
        setLoadingSummary(true);

        fetchNodeSummary(graph, selectedNode.id, selectedNode.label, selectedNode.type)
            .then((result) => {
                if (ignore) return;
                const nextSummary = result.trim() || 'Summary unavailable.';
                summaryCacheRef.current.set(selectedNode.id, nextSummary);
                setSummary(nextSummary);
            })
            .catch(() => {
                if (ignore) return;
                setSummary('Could not generate node summary.');
            })
            .finally(() => {
                if (!ignore) {
                    setLoadingSummary(false);
                }
            });

        return () => {
            ignore = true;
        };
    }, [graph, selectedNode]);

    const renderPills = (nodes: GraphNode[]) => {
        const visibleNodes = nodes.slice(0, 4);
        const hiddenCount = Math.max(0, nodes.length - visibleNodes.length);

        if (nodes.length === 0) {
            return <span className="node-intel-empty-inline">None</span>;
        }

        return (
            <div className="node-intel-pill-row">
                {visibleNodes.map((node) => (
                    <span key={node.id} className="node-intel-pill">
                        <span
                            className="node-intel-pill-dot"
                            style={{ backgroundColor: NODE_TYPE_COLORS[node.type] }}
                            aria-hidden="true"
                        />
                        {node.label}
                    </span>
                ))}
                {hiddenCount > 0 && (
                    <span className="node-intel-pill node-intel-pill-more">
                        +{hiddenCount} more
                    </span>
                )}
            </div>
        );
    };

    if (!selectedNode || !intelligence) {
        return (
            <section className="node-intelligence">
                <div className="node-intel-empty">
                    Click any node to inspect
                </div>
            </section>
        );
    }

    const riskColor = RISK_COLORS[intelligence.riskStatus];

    return (
        <section className="node-intelligence">
            <div className="node-intel-header">
                <div className="node-intel-title-wrap">
                    <span
                        className="node-intel-node-dot"
                        style={{ backgroundColor: intelligence.typeColor }}
                        aria-hidden="true"
                    />
                    <span className="node-intel-title">{selectedNode.label}</span>
                </div>
                <span className={`node-intel-type node-intel-type-${selectedNode.type}`}>
                    {selectedNode.type.toUpperCase()}
                </span>
            </div>

            <div className="node-intel-block">
                <div className="node-intel-label">RISK SCORE</div>
                <div className="node-intel-risk-track">
                    <div
                        className="node-intel-risk-fill"
                        style={{ width: `${Math.min(100, intelligence.score)}%`, backgroundColor: riskColor }}
                    />
                </div>
                <div className="node-intel-risk-meta">
                    <span className="node-intel-risk-value">{intelligence.score}%</span>
                    <span className={`node-intel-risk-status node-intel-risk-status-${intelligence.riskStatus.toLowerCase()}`}>
                        {intelligence.riskStatus}
                    </span>
                </div>
            </div>

            <div className="node-intel-stats-row">
                <div className="node-intel-stat-card">
                    <span className="node-intel-stat-label">CALLERS</span>
                    <strong className="node-intel-stat-value">{intelligence.incomingEdges.length}</strong>
                </div>
                <div className="node-intel-stat-card">
                    <span className="node-intel-stat-label">CALLEES</span>
                    <strong className="node-intel-stat-value">{intelligence.outgoingEdges.length}</strong>
                </div>
            </div>

            <div className="node-intel-block">
                <div className="node-intel-label">DEPENDS ON</div>
                {renderPills(intelligence.dependencyOutgoing)}
            </div>

            <div className="node-intel-block">
                <div className="node-intel-label">CALLED BY</div>
                {renderPills(intelligence.dependencyIncoming)}
            </div>

            <div className="node-intel-summary-block">
                <div className="node-intel-label">AI SUMMARY</div>
                {loadingSummary ? (
                    <div className="node-intel-summary-loading">
                        <span className="spinner" />
                    </div>
                ) : (
                    <p className="node-intel-summary">"{summary}"</p>
                )}
            </div>
        </section>
    );
}
