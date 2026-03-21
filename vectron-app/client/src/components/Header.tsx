interface HeaderProps {
    vectronMode: boolean;
    onToggleVectron: () => void;
    fileViewMode: boolean;
    onToggleFileView: () => void;
    onUploadNew: () => void;
    hasGraph: boolean;
    nodeCount: number;
    edgeCount: number;
    activeTab: 'graph' | 'processes' | 'ask-ai' | 'metrics' | 'report';
    onTabChange: (tab: 'graph' | 'processes' | 'ask-ai' | 'metrics' | 'report') => void;
}

export default function Header({
    vectronMode, onToggleVectron, fileViewMode, onToggleFileView, onUploadNew, hasGraph, nodeCount, edgeCount, activeTab, onTabChange,
}: HeaderProps) {
    const tabs: Array<{ id: HeaderProps['activeTab']; label: string; shortLabel: string }> = [
        { id: 'graph', label: 'GRAPH', shortLabel: 'GRAPH' },
        { id: 'processes', label: 'PROCESSES', shortLabel: 'FLOWS' },
        { id: 'ask-ai', label: 'ASK AI', shortLabel: 'AI' },
        { id: 'metrics', label: 'METRICS', shortLabel: 'STATS' },
        { id: 'report', label: 'REPORT', shortLabel: 'DOCS' },
    ];

    return (
        <header className="header">
            <div className="header-section header-section-left">
                <div className="header-brand">
                    <span className="header-brand-dot" />
                    <span className="header-brand-wordmark">VECTRON</span>
                    <span className="header-tagline">dependency propagation engine</span>
                </div>

                {hasGraph && (
                    <div className="graph-badge">
                        <span>{nodeCount} nodes</span>
                        <span className="badge-div">·</span>
                        <span>{edgeCount} edges</span>
                    </div>
                )}
            </div>

            <div className="header-tabs" role="tablist" aria-label="Primary views">
                {tabs.map((tab) => (
                    <button
                        key={tab.id}
                        className={`header-tab ${activeTab === tab.id ? 'active' : ''}`}
                        onClick={() => onTabChange(tab.id)}
                        role="tab"
                        aria-selected={activeTab === tab.id}
                    >
                        <span className="header-tab-label">{tab.label}</span>
                        <span className="header-tab-label-mobile">{tab.shortLabel}</span>
                    </button>
                ))}
            </div>

            <div className="header-section header-section-right">
                {hasGraph && (
                    <>
                        <button
                            className={`btn btn-simulation ${vectronMode ? 'active' : ''}`}
                            onClick={onToggleVectron}
                            title={vectronMode ? 'Disable VECTRON simulation mode' : 'Enable VECTRON simulation mode'}
                        >
                            <span className="btn-dot" />
                            <span className="btn-label">SIMULATION</span>
                            <span className="btn-icon-label" aria-hidden="true">S</span>
                        </button>

                        <button
                            className={`btn btn-file-view ${fileViewMode ? 'cyan-active' : ''}`}
                            onClick={onToggleFileView}
                            title={fileViewMode ? 'Disable automatic code file opening' : 'Enable automatic code file opening'}
                        >
                            <span className="btn-dot" />
                            <span className="btn-label">FILE VIEW</span>
                            <span className="btn-icon-label" aria-hidden="true">F</span>
                        </button>

                        <button className="btn btn-upload" onClick={onUploadNew} title="Upload a new repository">
                            <span className="btn-label">Upload New</span>
                            <span className="btn-icon-label" aria-hidden="true">+</span>
                        </button>
                    </>
                )}
            </div>
        </header>
    );
}
