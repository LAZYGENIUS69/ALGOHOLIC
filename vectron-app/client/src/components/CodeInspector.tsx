import { useEffect, useState, useRef } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { fetchFile } from '../lib/api';

interface CodeInspectorProps {
    fileId: string | null;
    startLine?: number;
    endLine?: number;
    isOpen: boolean;
    onClose: () => void;
}

export default function CodeInspector({ fileId, startLine, endLine, isOpen, onClose }: CodeInspectorProps) {
    const [code, setCode] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    // Fetch file content when fileId changes
    useEffect(() => {
        if (!fileId) {
            setCode(null);
            setError(null);
            return;
        }

        let ignore = false;
        async function load() {
            setLoading(true);
            setError(null);
            try {
                const content = await fetchFile(fileId!);
                if (!ignore) setCode(content);
            } catch (err: any) {
                if (!ignore) setError(err.message);
            } finally {
                if (!ignore) setLoading(false);
            }
        }
        load();
        return () => { ignore = true; };
    }, [fileId]);

    // Scroll to startLine when code or startLine changes
    useEffect(() => {
        if (!code || !startLine || !containerRef.current) return;
        setTimeout(() => {
            if (!containerRef.current) return;
            const lines = containerRef.current.querySelectorAll('.code-line');
            if (lines.length > startLine - 1) {
                (lines[startLine - 1] as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }, 50);
    }, [code, startLine]);

    // Escape key to close
    useEffect(() => {
        if (!isOpen) return;
        const handleKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', handleKey);
        return () => window.removeEventListener('keydown', handleKey);
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    const filename = fileId ? fileId.split('/').pop() : null;

    return (
        <>
            {/* Dark overlay */}
            <div
                onClick={onClose}
                style={{
                    position: 'fixed', inset: 0,
                    background: 'rgba(0, 0, 0, 0.7)',
                    zIndex: 999,
                }}
            />

            {/* Modal */}
            <div style={{
                position: 'fixed',
                top: '50%', left: '50%',
                transform: 'translate(-50%, -50%)',
                width: 720, maxWidth: '90vw',
                height: '70vh',
                background: '#0D1117',
                border: '1px solid rgba(0, 217, 255, 0.2)',
                borderRadius: 8,
                zIndex: 1000,
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
                boxShadow: '0 24px 80px rgba(0,0,0,0.8), 0 0 0 1px rgba(0,217,255,0.08)',
            }}>
                {/* Header */}
                <div style={{
                    height: 48, minHeight: 48,
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '0 16px',
                    background: 'rgba(0, 217, 255, 0.05)',
                    borderBottom: '1px solid rgba(0, 217, 255, 0.1)',
                }}>
                    <div style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'flex-start',
                        gap: 4,
                        minWidth: 0,
                        maxWidth: 'calc(100% - 48px)',
                    }}>
                        <div className="code-inspector-back-nav">
                            <button className="back-nav-btn" onClick={onClose}>
                                <span className="back-nav-btn-icon" aria-hidden="true">
                                    &larr;
                                </span>
                                <span className="back-nav-btn-label">Close file</span>
                            </button>
                        </div>
                        <span style={{
                            fontFamily: 'JetBrains Mono, monospace',
                            fontSize: 13,
                            color: '#00d9ff',
                            fontWeight: 500,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            maxWidth: '100%',
                        }}>
                            {filename ?? 'Code Inspector'}
                        </span>
                    </div>

                    {/* Close button */}
                    <button
                        onClick={onClose}
                        title="Close (Esc)"
                        style={{
                            background: 'none',
                            border: 'none',
                            color: 'rgba(255,255,255,0.5)',
                            cursor: 'pointer',
                            fontSize: 20,
                            lineHeight: 1,
                            padding: '4px 8px',
                            borderRadius: 4,
                            transition: 'color 0.15s',
                            flexShrink: 0,
                        }}
                        onMouseEnter={e => (e.currentTarget.style.color = '#fff')}
                        onMouseLeave={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.5)')}
                    >
                        ×
                    </button>
                </div>

                {/* Body — scrollable code */}
                <div
                    ref={containerRef}
                    style={{
                        flex: 1,
                        overflow: 'auto',
                        background: '#0D1117',
                    }}
                >
                    {loading && (
                        <div style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            height: '100%', color: 'rgba(255,255,255,0.35)',
                            fontFamily: 'monospace', fontSize: 13,
                        }}>
                            <div className="spinner" />
                        </div>
                    )}

                    {error && (
                        <div style={{
                            padding: 24,
                            color: '#f87171',
                            fontFamily: 'JetBrains Mono, monospace',
                            fontSize: 12,
                        }}>
                            {error}
                        </div>
                    )}

                    {!fileId && !loading && (
                        <div style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            height: '100%', color: 'rgba(255,255,255,0.25)',
                            fontSize: 13, fontFamily: 'monospace',
                        }}>
                            Select a node to inspect code
                        </div>
                    )}

                    {code && (
                        <SyntaxHighlighter
                            language="typescript"
                            style={vscDarkPlus}
                            showLineNumbers
                            wrapLines
                            lineProps={(line: number) => {
                                const isHighlighted = startLine && endLine && line >= startLine && line <= endLine;
                                return {
                                    className: `code-line ${isHighlighted ? 'highlighted' : ''}`,
                                    style: {
                                        display: 'block',
                                        backgroundColor: isHighlighted
                                            ? 'rgba(0, 217, 255, 0.12)'
                                            : 'transparent',
                                    },
                                };
                            }}
                            customStyle={{
                                margin: 0,
                                padding: '12px 0',
                                background: 'transparent',
                                fontSize: '12px',
                                fontFamily: 'JetBrains Mono, monospace',
                            }}
                        >
                            {code}
                        </SyntaxHighlighter>
                    )}
                </div>
            </div>
        </>
    );
}
