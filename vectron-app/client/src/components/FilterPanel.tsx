import React from 'react';

interface FilterPanelProps {
    nodeFilters: Record<string, boolean>;
    setNodeFilters: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
    edgeFilters: Record<string, boolean>;
    setEdgeFilters: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
    hideHeader?: boolean;
}

const NODE_TYPES: Array<{ ids: string[]; label: string; color: string }> = [
    { ids: ['file'], label: 'File', color: '#FF2D55' },
    { ids: ['function'], label: 'Function', color: '#00C7BE' },
    { ids: ['class'], label: 'Class', color: '#FF9F0A' },
    { ids: ['method'], label: 'Method', color: '#30D158' },
    { ids: ['import'], label: 'Import', color: '#636366' },
    { ids: ['python_function', 'python_class'], label: 'Python', color: '#3572A5' },
    { ids: ['config'], label: 'Config', color: '#FF9F0A' },
    { ids: ['doc'], label: 'Docs', color: '#888888' },
];

const EDGE_TYPES = [
    { id: 'DEFINES', label: 'DEFINES' },
    { id: 'IMPORTS', label: 'IMPORTS' },
    { id: 'CALLS', label: 'CALLS' },
    { id: 'EXTENDS', label: 'EXTENDS' },
    { id: 'CONTAINS', label: 'CONTAINS' },
    { id: 'DOCUMENTS', label: 'DOCUMENTS' },
];

const TerminalSwitch = ({ active, onClick }: { active: boolean, onClick: () => void }) => (
    <button type="button" className="filter-switch" onClick={onClick}>
        <span className={`filter-switch-track ${active ? 'is-on' : 'is-off'}`}>
            <span className="filter-switch-thumb" />
        </span>
        <span className="filter-switch-state">{active ? '[ON]' : '[OFF]'}</span>
    </button>
);

export default function FilterPanel({ nodeFilters, setNodeFilters, edgeFilters, setEdgeFilters, hideHeader = false }: FilterPanelProps) {
    const [isCollapsed, setIsCollapsed] = React.useState(false);

    const toggleNode = (ids: string[]) => {
        setNodeFilters(prev => {
            const nextValue = !ids.every((id) => !!prev[id]);
            const updates = ids.reduce<Record<string, boolean>>((acc, id) => {
                acc[id] = nextValue;
                return acc;
            }, {});
            return { ...prev, ...updates };
        });
    };

    const toggleEdge = (id: string) => {
        setEdgeFilters(prev => ({ ...prev, [id]: !prev[id] }));
    };

    return (
        <div className={`filter-panel ${hideHeader ? 'is-embedded' : ''}`}>
            {!hideHeader && (
                <button
                    type="button"
                    className="filter-panel-header"
                    onClick={() => setIsCollapsed(!isCollapsed)}
                >
                    <span>FILTERS</span>
                    <span className="filter-panel-chevron">{isCollapsed ? '\u203a' : '\u2304'}</span>
                </button>
            )}

            {(!isCollapsed || hideHeader) && (
                <div className="filter-panel-content">
                    <section className="filter-group-card">
                        <div className="filter-group-title">
                            NODE TYPES
                        </div>
                        <div>
                            {NODE_TYPES.map(type => (
                                <div key={type.label} className="filter-row">
                                    <div className="filter-label-wrap">
                                        <div className="filter-color-dot" style={{ background: type.color }} />
                                        <span className="filter-label">{type.label}</span>
                                    </div>
                                    <TerminalSwitch
                                        active={type.ids.every((id) => !!nodeFilters[id])}
                                        onClick={() => toggleNode(type.ids)}
                                    />
                                </div>
                            ))}
                        </div>
                    </section>

                    <section className="filter-group-card filter-group-divider">
                        <div className="filter-group-title">
                            EDGE TYPES
                        </div>
                        <div>
                            {EDGE_TYPES.map(type => (
                                <div key={type.id} className="filter-row">
                                    <div className="filter-label-wrap">
                                        <span className="filter-color-dot filter-color-dot-neutral" />
                                        <span className="filter-label">{type.label}</span>
                                    </div>
                                    <TerminalSwitch
                                        active={!!edgeFilters[type.id]}
                                        onClick={() => toggleEdge(type.id)}
                                    />
                                </div>
                            ))}
                        </div>
                    </section>
                </div>
            )}
        </div>
    );
}
