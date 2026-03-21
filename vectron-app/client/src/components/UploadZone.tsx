import { useRef, useState, useCallback } from 'react';
import { uploadZip } from '../lib/api';
import type { GraphData } from '../types/graph';

interface UploadZoneProps {
    onGraph: (data: GraphData) => void;
}

export default function UploadZone({ onGraph }: UploadZoneProps) {
    const inputRef = useRef<HTMLInputElement>(null);
    const [dragging, setDragging] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleFile = useCallback(async (file: File) => {
        if (!file.name.endsWith('.zip')) {
            setError('Please upload a .zip file.');
            return;
        }
        setError(null);
        setLoading(true);
        try {
            const graph = await uploadZip(file);
            onGraph(graph);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Upload failed');
        } finally {
            setLoading(false);
        }
    }, [onGraph]);

    return (
        <div className="upload-overlay">
            <input
                ref={inputRef}
                type="file"
                accept=".zip"
                style={{ display: 'none' }}
                onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
            />

            <div
                className={`upload-box ${dragging ? 'drag' : ''}`}
                onClick={() => !loading && inputRef.current?.click()}
                onDragOver={e => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={e => {
                    e.preventDefault();
                    setDragging(false);
                    const f = e.dataTransfer.files[0];
                    if (f) handleFile(f);
                }}
            >
                <div className="upload-icon">
                    {loading ? (
                        <div style={{ display: 'flex', justifyContent: 'center' }}>
                            <div className="spinner" />
                        </div>
                    ) : '⬆'}
                </div>

                <div className="upload-title">
                    {loading ? 'Parsing repository…' : 'Upload Repository'}
                </div>
                <div className="upload-sub">
                    {loading
                        ? 'Building knowledge graph from AST'
                        : 'Drag & drop a .zip file or click to browse'}
                </div>
                <div className="upload-hint">Supports JS · TS · JSX · TSX · PY · JSON · YAML · MD</div>

                {error && <div className="upload-error">{error}</div>}
            </div>
        </div>
    );
}
