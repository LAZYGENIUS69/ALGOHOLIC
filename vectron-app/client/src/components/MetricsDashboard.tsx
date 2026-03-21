import { useMemo } from 'react';
import type { GraphData, GraphNode } from '../types/graph';

interface MetricsDashboardProps {
    graph: GraphData;
}

interface NodeMetricRow {
    node: GraphNode;
    inDegree: number;
    outDegree: number;
    connections: number;
    weightedConnections: number;
    riskScore: number;
    status: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
}

const TYPE_COLORS: Record<string, string> = {
    file: '#FF2D55',
    function: '#00C7BE',
    class: '#FF9F0A',
    method: '#30D158',
    python_function: '#3572A5',
    python_class: '#FFD43B',
    config: '#FF9F0A',
    doc: '#888888',
};

const TYPE_LABELS: Array<GraphNode['type']> = ['file', 'function', 'class', 'method', 'python_function', 'python_class', 'config', 'doc'];

function truncateLabel(label: string, maxLength: number) {
    return label.length > maxLength ? `${label.slice(0, maxLength - 1)}...` : label;
}

function getBarColor(connections: number) {
    if (connections > 20) return '#FF3B30';
    if (connections > 10) return '#FF9500';
    return '#30D158';
}

function getStatus(score: number): NodeMetricRow['status'] {
    if (score > 75) return 'CRITICAL';
    if (score > 50) return 'HIGH';
    if (score > 25) return 'MEDIUM';
    return 'LOW';
}

export default function MetricsDashboard({ graph }: MetricsDashboardProps) {
    const metrics = useMemo(() => {
        const incoming = new Map<string, number>();
        const outgoing = new Map<string, number>();

        graph.nodes.forEach((node) => {
            incoming.set(node.id, 0);
            outgoing.set(node.id, 0);
        });

        graph.edges.forEach((edge) => {
            outgoing.set(edge.source, (outgoing.get(edge.source) ?? 0) + 1);
            incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1);
        });

        const baseRows = graph.nodes.map((node) => {
            const inDegree = incoming.get(node.id) ?? 0;
            const outDegree = outgoing.get(node.id) ?? 0;
            const connections = inDegree + outDegree;
            const weightedConnections = inDegree * 2 + outDegree;

            return {
                node,
                inDegree,
                outDegree,
                connections,
                weightedConnections,
            };
        });

        const maxDegree = Math.max(1, ...baseRows.map((row) => row.connections));

        const riskRows: NodeMetricRow[] = baseRows
            .map((row) => {
                const riskScore = Number(((row.weightedConnections / maxDegree) * 100).toFixed(1));
                return {
                    ...row,
                    riskScore,
                    status: getStatus(riskScore),
                };
            })
            .sort((a, b) => b.riskScore - a.riskScore || b.connections - a.connections);

        const topConnected = [...riskRows].sort((a, b) => b.connections - a.connections);
        const totalConnections = riskRows.reduce((sum, row) => sum + row.connections, 0);
        const typeDistribution = TYPE_LABELS.map((type) => ({
            type,
            label: type.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()),
            value: graph.nodes.filter((node) => node.type === type).length,
            color: TYPE_COLORS[type],
        }));

        return {
            mostConnected: topConnected[0] ?? null,
            averageConnections: graph.nodes.length === 0 ? 0 : totalConnections / graph.nodes.length,
            topConnected: topConnected.slice(0, 10),
            typeDistribution,
            riskRows: riskRows.slice(0, 20),
        };
    }, [graph]);

    const maxConnections = Math.max(1, ...metrics.topConnected.map((row) => row.connections));
    const donutTotal = Math.max(1, metrics.typeDistribution.reduce((sum, item) => sum + item.value, 0));
    const donutRadius = 56;
    const donutCircumference = 2 * Math.PI * donutRadius;
    let donutOffset = 0;

    return (
        <div className="metrics-dashboard">
            <div className="metrics-dashboard-grid">
                <section className="metrics-card stats-card">
                    <span className="metrics-card-label">TOTAL NODES</span>
                    <strong className="metrics-card-value">{graph.nodes.length}</strong>
                    <span className="metrics-card-meta">Graph entities in memory</span>
                </section>
                <section className="metrics-card stats-card">
                    <span className="metrics-card-label">TOTAL EDGES</span>
                    <strong className="metrics-card-value">{graph.edges.length}</strong>
                    <span className="metrics-card-meta">Relationships currently indexed</span>
                </section>
                <section className="metrics-card stats-card">
                    <span className="metrics-card-label">MOST CONNECTED NODE</span>
                    <strong className="metrics-card-detail">
                        {metrics.mostConnected ? truncateLabel(metrics.mostConnected.node.label, 26) : 'None'}
                    </strong>
                    <span className="metrics-card-meta">
                        {metrics.mostConnected ? `${metrics.mostConnected.connections} total connections` : '0 connections'}
                    </span>
                </section>
                <section className="metrics-card stats-card">
                    <span className="metrics-card-label">AVERAGE CONNECTIONS</span>
                    <strong className="metrics-card-value">{metrics.averageConnections.toFixed(1)}</strong>
                    <span className="metrics-card-meta">Per node across the graph</span>
                </section>
            </div>

            <div className="metrics-dashboard-row">
                <section className="metrics-panel-card metrics-chart-card">
                    <div className="metrics-section-header">
                        <h3>TOP 10 MOST CONNECTED NODES</h3>
                    </div>
                    <div className="metrics-bar-chart" role="img" aria-label="Top connected nodes">
                        {metrics.topConnected.map((row, index) => (
                            <div key={row.node.id} className="metrics-bar-row" style={{ animationDelay: `${index * 40}ms` }}>
                                <div className="metrics-bar-meta">
                                    <div className="metrics-bar-name">{truncateLabel(row.node.label, 22)}</div>
                                    <div className="metrics-bar-type">{row.node.type}</div>
                                </div>
                                <div className="metrics-bar-track">
                                    <div
                                        className="metrics-bar-fill"
                                        style={{
                                            width: `${(row.connections / maxConnections) * 100}%`,
                                            background: getBarColor(row.connections),
                                        }}
                                    />
                                </div>
                                <div className="metrics-bar-count">{row.connections}</div>
                            </div>
                        ))}
                    </div>
                </section>

                <section className="metrics-panel-card metrics-chart-card metrics-donut-card">
                    <div className="metrics-section-header">
                        <h3>NODE TYPE DISTRIBUTION</h3>
                    </div>
                    <div className="metrics-donut-wrap">
                        <svg className="metrics-donut-chart" viewBox="24 24 152 152" role="img" aria-label="Node type distribution">
                            <circle
                                cx="100"
                                cy="100"
                                r={donutRadius}
                                stroke="rgba(255,255,255,0.08)"
                                strokeWidth="20"
                                fill="none"
                            />
                            {metrics.typeDistribution.map((slice) => {
                                const sliceLength = (slice.value / donutTotal) * donutCircumference;
                                const circle = (
                                    <circle
                                        key={slice.type}
                                        cx="100"
                                        cy="100"
                                        r={donutRadius}
                                        stroke={slice.color}
                                        strokeWidth="20"
                                        fill="none"
                                        strokeDasharray={`${sliceLength} ${donutCircumference - sliceLength}`}
                                        strokeDashoffset={-donutOffset}
                                        strokeLinecap="butt"
                                        transform="rotate(-90 100 100)"
                                    />
                                );
                                donutOffset += sliceLength;
                                return circle;
                            })}
                            <text x="100" y="103" textAnchor="middle" fill="#ffffff" fontSize="16" fontFamily="var(--font-mono)">
                                {graph.nodes.length}
                            </text>
                        </svg>

                        <div className="metrics-donut-legend">
                            {metrics.typeDistribution.map((slice) => (
                                <div key={slice.type} className="metrics-legend-item">
                                    <span className="metrics-legend-dot" style={{ background: slice.color }} />
                                    <span>{slice.label}</span>
                                    <strong>{slice.value}</strong>
                                </div>
                            ))}
                        </div>
                    </div>
                </section>
            </div>

            <section className="metrics-panel-card metrics-risk-card">
                <div className="metrics-section-header">
                    <h3>RISK TABLE</h3>
                </div>

                <div className="metrics-risk-table-wrap">
                    <table className="metrics-risk-table">
                        <thead>
                            <tr>
                                <th>NODE</th>
                                <th>TYPE</th>
                                <th>CONNECTIONS</th>
                                <th>RISK SCORE</th>
                                <th>STATUS</th>
                            </tr>
                        </thead>
                        <tbody>
                            {metrics.riskRows.map((row) => (
                                <tr key={row.node.id}>
                                    <td title={row.node.label} className="metrics-risk-node-cell">
                                        {truncateLabel(row.node.label, 38)}
                                    </td>
                                    <td>
                                        <span className={`metrics-type-pill metrics-type-${row.node.type}`}>
                                            {row.node.type.toUpperCase()}
                                        </span>
                                    </td>
                                    <td className="metrics-risk-number">{row.connections}</td>
                                    <td>
                                        <div className="metrics-risk-score-cell">
                                            <span className="metrics-risk-number">{row.riskScore.toFixed(1)}%</span>
                                            <span className="metrics-risk-mini-track">
                                                <span
                                                    className="metrics-risk-mini-fill"
                                                    style={{
                                                        width: `${row.riskScore}%`,
                                                        background: getBarColor(row.connections),
                                                    }}
                                                />
                                            </span>
                                        </div>
                                    </td>
                                    <td>
                                        <span className={`metrics-status-pill status-${row.status.toLowerCase()}`}>
                                            {row.status}
                                        </span>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </section>
        </div>
    );
}
