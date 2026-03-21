import { useEffect, useRef, useState } from 'react';
import mermaid from 'mermaid';
import { detectProcesses } from '../lib/api';
import type { DetectedProcess, GraphData } from '../types/graph';

mermaid.initialize({
    startOnLoad: false,
    theme: 'dark',
    flowchart: {
        htmlLabels: false,
    },
    themeVariables: {
        primaryColor: '#00D9FF',
        primaryTextColor: '#ffffff',
        lineColor: '#00D9FF',
        background: '#0d1117'
    }
});

const MermaidChart = ({ chart }: { chart: string }) => {
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        let isMounted = true;

        if (ref.current && chart) {
            ref.current.innerHTML = '';
            mermaid.render(`mermaid-${Date.now()}-${Math.random().toString(36).slice(2)}`, chart)
                .then(({ svg }) => {
                    if (ref.current && isMounted) {
                        ref.current.innerHTML = svg;
                    }
                })
                .catch(() => {
                    if (ref.current && isMounted) {
                        ref.current.innerHTML = '<div class="process-empty">Could not render Mermaid diagram.</div>';
                    }
                });
        }

        return () => {
            isMounted = false;
        };
    }, [chart]);

    return <div ref={ref} style={{ background: 'transparent' }} />;
};

interface ProcessPanelProps {
    graph: GraphData;
    selectedNode?: string | null;
}

export default function ProcessPanel({ graph, selectedNode = null }: ProcessPanelProps) {
    const [processes, setProcesses] = useState<DetectedProcess[]>([]);
    const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);
    const chartRef = useRef<HTMLDivElement>(null);

    const selectedProcess = selectedIndex === null ? null : processes[selectedIndex] ?? null;

    useEffect(() => {
        setCopied(false);
    }, [selectedIndex]);

    const runDetection = async (focusNode?: string | null) => {
        setLoading(true);
        setError(null);

        try {
            const detected = await detectProcesses(graph, focusNode);
            setProcesses(detected);
            setSelectedIndex(detected.length > 0 ? 0 : null);
            if (detected.length === 0) {
                setError('No valid processes were detected for this graph.');
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Process detection failed.');
            setProcesses([]);
            setSelectedIndex(null);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (selectedNode) {
            runDetection(selectedNode);
        }
    }, [graph, selectedNode]);

    const sidebarHeader = selectedNode
        ? `Processes involving: ${selectedNode}`
        : 'DETECTED PROCESSES';

    const handleCopyMermaid = async () => {
        if (!selectedProcess) return;

        try {
            await navigator.clipboard.writeText(selectedProcess.mermaid);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
        } catch (err) {
            setError('Could not copy Mermaid syntax to the clipboard.');
        }
    };

    const handleDownloadPng = async () => {
        if (!selectedProcess || !chartRef.current) return;

        const svgElement = chartRef.current.querySelector('svg');
        if (!svgElement) {
            setError('Could not find a rendered Mermaid chart to export.');
            return;
        }

        try {
            const serializer = new XMLSerializer();
            const svgString = serializer.serializeToString(svgElement);
            const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgString)}`;
            const image = new Image();
            image.crossOrigin = 'anonymous';

            await new Promise<void>((resolve, reject) => {
                image.onload = () => resolve();
                image.onerror = () => reject(new Error('Could not load Mermaid SVG for export.'));
                image.src = url;
            });

            const viewBox = svgElement.viewBox.baseVal;
            const width = viewBox?.width || svgElement.clientWidth || 1200;
            const height = viewBox?.height || svgElement.clientHeight || 800;
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;

            const context = canvas.getContext('2d');
            if (!context) {
                throw new Error('Canvas export is not available in this browser.');
            }

            context.fillStyle = '#0d1117';
            context.fillRect(0, 0, canvas.width, canvas.height);
            context.drawImage(image, 0, 0, width, height);

            const link = document.createElement('a');
            const safeName = selectedProcess.name.replace(/[<>:"/\\|?*]+/g, '-');
            link.href = canvas.toDataURL('image/png');
            link.download = `${safeName}.png`;
            link.click();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not export Mermaid diagram as PNG.');
        }
    };

    return (
        <div className="process-panel">
            <aside className="process-sidebar">
                <div className={selectedNode ? 'process-sidebar-focus' : 'process-sidebar-header'}>
                    {sidebarHeader}
                </div>
                <button
                    className="process-detect-btn"
                    onClick={() => runDetection(selectedNode)}
                    disabled={loading}
                >
                    {loading
                        ? 'DETECTING...'
                        : selectedNode
                            ? 'REFRESH FOCUSED PROCESSES'
                            : 'DETECT ALL PROCESSES'}
                </button>

                <div className="process-list">
                    {error && <div className="process-error">{error}</div>}

                    {!error && processes.length === 0 && !loading && (
                        <div className="process-empty">
                            {selectedNode
                                ? 'Processes for the selected node will appear here automatically.'
                                : 'Run detection to generate process flow diagrams from the current graph.'}
                        </div>
                    )}

                    {processes.map((process, index) => (
                        <button
                            key={`${process.name}-${index}`}
                            className={`process-item ${index === selectedIndex ? 'active' : ''}`}
                            onClick={() => setSelectedIndex(index)}
                        >
                            <span className="process-item-name">{process.name}</span>
                            <span className="process-item-meta">{process.steps} steps</span>
                            {selectedNode && (
                                <span className="process-node-highlight">{selectedNode}</span>
                            )}
                        </button>
                    ))}
                </div>
            </aside>

            <section className="process-main">
                {selectedProcess ? (
                    <>
                        <div className="process-main-header">
                            <div>
                                <h2>{selectedProcess.name}</h2>
                                <span>{selectedProcess.steps} steps</span>
                            </div>
                        </div>
                        <div className="process-chart-wrap">
                            <div className="process-chart-actions">
                                <button className="process-chart-btn" onClick={handleCopyMermaid}>
                                    {copied ? 'Copied!' : 'Copy Mermaid'}
                                </button>
                                <button className="process-chart-btn" onClick={handleDownloadPng}>
                                    Download PNG
                                </button>
                            </div>
                            <div ref={chartRef}>
                                <MermaidChart chart={selectedProcess.mermaid} />
                            </div>
                        </div>
                        <div className="process-explanation">
                            {selectedProcess.explanation}
                        </div>
                    </>
                ) : (
                    <div className="process-main-empty">
                        Select a process to inspect
                    </div>
                )}
            </section>
        </div>
    );
}
