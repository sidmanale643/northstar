'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Code,
  Database,
  Eye,
  FileJson,
  Info,
  Loader2,
  Plus,
  RotateCcw,
  Save,
  Trash2,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useActiveProject } from '@/components/project-provider';
import type { EvalDatasetSummary, EvalRunSummary } from '@/lib/supabase/types';

interface DatasetRow {
  id: string;
  input: string;
  messages: string;
  expected: string;
  metrics: string;
  metadata: string;
}

interface DatasetDetailResponse {
  dataset: EvalDatasetSummary;
  rows: DatasetRow[];
  runs: EvalRunSummary[];
}

interface DatasetUpdateResponse {
  dataset: EvalDatasetSummary;
  rows: DatasetRow[];
}

interface FieldError {
  rowIndex: number;
  field: string;
  message: string;
}

interface ParsedMessage {
  role: string;
  content: string;
}

const MESSAGE_ROLES = ['system', 'user', 'assistant', 'tool'] as const;

const emptyRow: DatasetRow = {
  id: '',
  input: '',
  messages: '[]',
  expected: '{}',
  metrics: '{}',
  metadata: '{}',
};

export default function DatasetDetailPage({
  params,
}: {
  params: { datasetId: string };
}) {
  const project = useActiveProject();
  const [dataset, setDataset] = useState<EvalDatasetSummary | null>(null);
  const [rows, setRows] = useState<DatasetRow[]>([]);
  const [savedRows, setSavedRows] = useState<DatasetRow[]>([]);
  const [runs, setRuns] = useState<EvalRunSummary[]>([]);
  const [pageError, setPageError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [showSidebar, setShowSidebar] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const [rawContent, setRawContent] = useState<string | null>(null);
  const [isLoadingRaw, setIsLoadingRaw] = useState(false);
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());
  const [dirtyFields, setDirtyFields] = useState<Set<string>>(new Set());
  const [fieldErrors, setFieldErrors] = useState<FieldError[]>([]);
  const editorRef = useRef<HTMLDivElement>(null);

  // Load dataset
  useEffect(() => {
    let isCurrent = true;

    async function loadDataset() {
      setIsLoading(true);
      setPageError(null);

      try {
        const response = await fetch(
          `/api/projects/${project.id}/eval-datasets/${params.datasetId}`,
          { cache: 'no-store' }
        );
        const body: unknown = await response.json().catch(() => null);

        if (!response.ok) throw new Error(readApiError(body));

        const parsed = parseDatasetDetailResponse(body);
        if (!parsed) throw new Error('The server returned an invalid dataset response.');

        if (isCurrent) {
          setDataset(parsed.dataset);
          setRows(parsed.rows);
          setSavedRows(parsed.rows);
          setRuns(parsed.runs);
          // Expand first row by default if there are rows
          if (parsed.rows.length > 0) {
            setExpandedRows(new Set([0]));
          }
        }
      } catch (error) {
        if (isCurrent) {
          setDataset(null);
          setRows([]);
          setSavedRows([]);
          setRuns([]);
          setPageError(error instanceof Error ? error.message : 'Unable to load dataset.');
        }
      } finally {
        if (isCurrent) setIsLoading(false);
      }
    }

    void loadDataset();

    return () => {
      isCurrent = false;
    };
  }, [params.datasetId, project.id]);

  // Load raw content when toggle is enabled
  useEffect(() => {
    if (!showRaw) {
      setRawContent(null);
      return;
    }

    let isCurrent = true;

    async function fetchRaw() {
      setIsLoadingRaw(true);
      try {
        const response = await fetch(
          `/api/projects/${project.id}/eval-datasets/${params.datasetId}?raw=true`,
          { cache: 'no-store' }
        );
        if (!response.ok) throw new Error('Failed to load raw dataset.');
        const text = await response.text();
        if (isCurrent) setRawContent(text);
      } catch (error) {
        if (isCurrent) {
          setRawContent(null);
          setPageError(error instanceof Error ? error.message : 'Unable to load raw dataset.');
        }
      } finally {
        if (isCurrent) setIsLoadingRaw(false);
      }
    }

    void fetchRaw();

    return () => {
      isCurrent = false;
    };
  }, [showRaw, params.datasetId, project.id]);
  useEffect(() => {
    const newDirtyFields = new Set<string>();
    rows.forEach((row, index) => {
      const savedRow = savedRows[index];
      if (!savedRow) return;
      (Object.keys(row) as Array<keyof DatasetRow>).forEach((key) => {
        if (row[key] !== savedRow[key]) {
          newDirtyFields.add(`${index}-${key}`);
        }
      });
    });
    setDirtyFields(newDirtyFields);
  }, [rows, savedRows]);

  // Validate rows and set field errors
  useEffect(() => {
    const errors: FieldError[] = [];
    rows.forEach((row, index) => {
      validateRow(row, index, errors);
    });
    setFieldErrors(errors);
  }, [rows]);

  const isDirty = dirtyFields.size > 0;
  const unsavedCount = useMemo(() => {
    const rowIndices = new Set<number>();
    dirtyFields.forEach((key) => {
      const [rowIndex] = key.split('-');
      rowIndices.add(parseInt(rowIndex, 10));
    });
    return rowIndices.size;
  }, [dirtyFields]);

  // Define callbacks before useEffect that uses them
  const handleRevert = useCallback(() => {
    setRows(savedRows);
    setPageError(null);
  }, [savedRows]);

  const handleSaveCallback = useCallback(async () => {
    if (fieldErrors.length > 0) {
      setPageError('Please fix validation errors before saving.');
      return;
    }

    setIsSaving(true);
    setPageError(null);

    try {
      const response = await fetch(`/api/projects/${project.id}/eval-datasets/${params.datasetId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows }),
      });
      const body: unknown = await response.json().catch(() => null);

      if (!response.ok) throw new Error(readApiError(body));

      const parsed = parseDatasetUpdateResponse(body);
      if (!parsed) throw new Error('The server returned an invalid dataset update.');

      setDataset(parsed.dataset);
      setRows(parsed.rows);
      setSavedRows(parsed.rows);
    } catch (error) {
      setPageError(error instanceof Error ? error.message : 'Unable to save dataset.');
    } finally {
      setIsSaving(false);
    }
  }, [fieldErrors.length, project.id, params.datasetId, rows]);

  // Keyboard shortcuts - must come after callback definitions
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Only trigger when focused in the editor area
      if (!editorRef.current?.contains(document.activeElement)) return;

      if ((event.metaKey || event.ctrlKey) && event.key === 's') {
        event.preventDefault();
        if (isDirty && !isSaving && !isLoading) {
          void handleSaveCallback();
        }
      }

      if ((event.metaKey || event.ctrlKey) && event.key === 'z') {
        event.preventDefault();
        if (isDirty && !isSaving) {
          handleRevert();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isDirty, isSaving, isLoading, handleRevert, handleSaveCallback]);

  const updateCell = (rowIndex: number, key: keyof DatasetRow, value: string) => {
    setRows((current) =>
      current.map((row, index) => (index === rowIndex ? { ...row, [key]: value } : row))
    );
  };

  const toggleRowExpanded = (rowIndex: number) => {
    setExpandedRows((current) => {
      const next = new Set(current);
      if (next.has(rowIndex)) {
        next.delete(rowIndex);
      } else {
        next.add(rowIndex);
      }
      return next;
    });
  };

  const deleteRow = (rowIndex: number) => {
    setRows((current) => current.filter((_, index) => index !== rowIndex));
    setExpandedRows((current) => {
      const next = new Set<number>();
      current.forEach((i) => {
        if (i < rowIndex) next.add(i);
        if (i > rowIndex) next.add(i - 1);
      });
      return next;
    });
  };

  const addRow = () => {
    setRows((current) => [...current, { ...emptyRow }]);
    setExpandedRows((current) => {
      const next = new Set<number>(current);
      next.add(rows.length);
      return next;
    });
  };

  const getFieldError = (rowIndex: number, field: string): string | null => {
    const error = fieldErrors.find((e) => e.rowIndex === rowIndex && e.field === field);
    return error?.message ?? null;
  };

  const isFieldDirty = (rowIndex: number, field: string): boolean => {
    return dirtyFields.has(`${rowIndex}-${field}`);
  };

  return (
    <div className="ns-enter flex min-h-[740px] flex-col overflow-hidden rounded-lg border bg-background">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border px-6 py-4">
        <div className="min-w-0 flex-1">
          <Link
            href={`/projects/${project.id}/datasets`}
            className="mb-2 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Datasets
          </Link>
          <div className="flex items-center gap-2 text-base font-semibold text-foreground">
            <FileJson className="h-5 w-5 text-[#1D9E75]" />
            {dataset?.name ?? 'Dataset'}
          </div>
          <div className="mt-1 truncate font-mono text-xs text-muted-foreground">
            {dataset?.fileName ?? params.datasetId}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Info toggle */}
          <button
            type="button"
            onClick={() => setShowSidebar(!showSidebar)}
            className={`ns-button h-9 ${showSidebar ? 'bg-secondary' : ''}`}
            title="Toggle dataset info"
          >
            <Info className="h-4 w-4" />
            <span className="hidden sm:inline">Info</span>
          </button>

          <button
            type="button"
            onClick={() => setShowRaw(!showRaw)}
            className={`ns-button h-9 ${showRaw ? 'bg-secondary' : ''}`}
            title="View raw file content"
          >
            <Eye className="h-4 w-4" />
            <span className="hidden sm:inline">Raw</span>
          </button>

          <Link
            href={`/projects/${project.id}/evals/${params.datasetId}`}
            className="ns-button h-9"
          >
            Run eval
          </Link>

          <button
            type="button"
            className="ns-button h-9"
            onClick={handleRevert}
            disabled={!isDirty || isSaving}
          >
            <RotateCcw className="h-4 w-4" />
            <span className="hidden sm:inline">Revert</span>
          </button>

          <button
            type="button"
            className="ns-button ns-button-primary h-9"
            onClick={() => void handleSaveCallback()}
            disabled={!isDirty || isSaving || isLoading || fieldErrors.length > 0}
          >
            {isSaving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            {isSaving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      {/* Error banner */}
      {pageError && (
        <div className="border-b border-[#F09595] bg-[#FCEBEB] px-6 py-2.5 text-sm text-[#791F1F]">
          <span className="inline-flex items-center gap-1.5">
            <AlertCircle className="h-4 w-4" />
            {pageError}
          </span>
        </div>
      )}

      {/* Sticky toolbar */}
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-background/95 px-6 py-3 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs text-muted-foreground">
            {rows.length} rows
          </span>
          {isDirty && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
              {unsavedCount} unsaved
            </span>
          )}
          {fieldErrors.length > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">
              <AlertCircle className="h-3 w-3" />
              {fieldErrors.length} errors
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="ns-button ns-button-primary h-8"
            onClick={addRow}
          >
            <Plus className="h-4 w-4" />
            Add row
          </button>
        </div>
      </div>

      {/* Raw content panel */}
      {showRaw && (
        <div className="border-b border-border">
          {isLoadingRaw ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              Loading raw content...
            </div>
          ) : rawContent !== null ? (
            <pre className="max-h-[600px] overflow-auto p-6 font-mono text-xs leading-relaxed text-foreground whitespace-pre-wrap">
              {rawContent}
            </pre>
          ) : null}
        </div>
      )}

      {/* Main content */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Editor */}
        <main
          ref={editorRef}
          className={`min-h-0 flex-1 overflow-y-auto ${showSidebar ? 'border-r border-border' : ''}`}
        >
          {isLoading ? (
            <div className="flex min-h-[420px] items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              Loading dataset...
            </div>
          ) : rows.length === 0 ? (
            <div className="flex min-h-[420px] flex-col items-center justify-center gap-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-secondary">
                <Database className="h-8 w-8 text-muted-foreground" />
              </div>
              <div className="text-center">
                <p className="text-sm font-medium text-foreground">No rows yet</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Add your first row to get started
                </p>
              </div>
              <button
                type="button"
                className="ns-button ns-button-primary"
                onClick={addRow}
              >
                <Plus className="h-4 w-4" />
                Add first row
              </button>
            </div>
          ) : (
            <div className="space-y-3 p-4">
              {rows.map((row, rowIndex) => {
                const isExpanded = expandedRows.has(rowIndex);
                const idError = getFieldError(rowIndex, 'id');
                const messagesError = getFieldError(rowIndex, 'messages');
                const expectedError = getFieldError(rowIndex, 'expected');
                const metricsError = getFieldError(rowIndex, 'metrics');
                const metadataError = getFieldError(rowIndex, 'metadata');
                const hasErrors = idError || messagesError || expectedError || metricsError || metadataError;
                const isRowDirty =
                  isFieldDirty(rowIndex, 'id') ||
                  isFieldDirty(rowIndex, 'input') ||
                  isFieldDirty(rowIndex, 'messages') ||
                  isFieldDirty(rowIndex, 'expected') ||
                  isFieldDirty(rowIndex, 'metrics') ||
                  isFieldDirty(rowIndex, 'metadata');

                return (
                  <div
                    key={rowIndex}
                    className={`overflow-hidden rounded-lg border bg-white transition-all ${
                      isRowDirty ? 'border-l-4 border-l-amber-400' : 'border-l-4 border-l-transparent'
                    } ${hasErrors ? 'border-red-200' : ''}`}
                  >
                    {/* Card header */}
                    <div className="flex items-center justify-between border-b border-border bg-secondary/30 px-4 py-3">
                      <button
                        type="button"
                        onClick={() => toggleRowExpanded(rowIndex)}
                        className="flex items-center gap-2 text-sm font-medium text-foreground hover:text-[#0E7C5C]"
                      >
                        {isExpanded ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}
                        <span className="font-mono text-xs text-muted-foreground">#{rowIndex + 1}</span>
                        <span className="truncate max-w-[200px] sm:max-w-[300px]">
                          {row.id || 'Untitled row'}
                        </span>
                        {hasErrors && (
                          <AlertCircle className="h-4 w-4 text-red-500" />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteRow(rowIndex)}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-red-50 hover:text-red-600"
                        title="Delete row"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>

                    {/* Card body */}
                    {isExpanded && (
                      <div className="space-y-4 p-4">
                        {/* ID field */}
                        <div className="space-y-1.5">
                          <label className="ns-label">ID</label>
                          <input
                            type="text"
                            value={row.id}
                            onChange={(e) => updateCell(rowIndex, 'id', e.target.value)}
                            className={`ns-input h-9 ${
                              idError ? 'border-red-300 focus:border-red-400 focus:ring-red-100' : ''
                            } ${isFieldDirty(rowIndex, 'id') ? 'bg-amber-50/50' : ''}`}
                            placeholder="Row identifier"
                          />
                          {idError && (
                            <p className="text-xs text-red-600">{idError}</p>
                          )}
                        </div>

                        {/* Input field */}
                        <div className="space-y-1.5">
                          <label className="ns-label">Input</label>
                          <input
                            type="text"
                            value={row.input}
                            onChange={(e) => updateCell(rowIndex, 'input', e.target.value)}
                            className={`ns-input h-9 ${
                              isFieldDirty(rowIndex, 'input') ? 'bg-amber-50/50' : ''
                            }`}
                            placeholder="Input text"
                          />
                        </div>

                        {/* JSON fields */}
                        <MessagesEditor
                          value={row.messages}
                          onChange={(value) => updateCell(rowIndex, 'messages', value)}
                          error={messagesError}
                          isDirty={isFieldDirty(rowIndex, 'messages')}
                        />

                        <JsonField
                          label="Expected"
                          value={row.expected}
                          onChange={(value) => updateCell(rowIndex, 'expected', value)}
                          error={expectedError}
                          isDirty={isFieldDirty(rowIndex, 'expected')}
                          placeholder="{}"
                        />

                        <JsonField
                          label="Metrics"
                          value={row.metrics}
                          onChange={(value) => updateCell(rowIndex, 'metrics', value)}
                          error={metricsError}
                          isDirty={isFieldDirty(rowIndex, 'metrics')}
                          placeholder="{}"
                        />

                        <JsonField
                          label="Metadata"
                          value={row.metadata}
                          onChange={(value) => updateCell(rowIndex, 'metadata', value)}
                          error={metadataError}
                          isDirty={isFieldDirty(rowIndex, 'metadata')}
                          placeholder="{}"
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </main>

        {/* Collapsible sidebar */}
        {showSidebar && (
          <aside className="w-80 min-w-0 overflow-y-auto bg-secondary/30 px-4 py-4">
            <div className="space-y-4">
              {/* Dataset info */}
              <div className="rounded-lg border bg-white p-4">
                <div className="mb-3 flex items-center gap-2 text-sm font-medium text-foreground">
                  <Database className="h-4 w-4 text-[#1D9E75]" />
                  Dataset Info
                </div>
                <div className="space-y-3">
                  <MetaItem label="Format" value={dataset?.fileFormat ?? '-'} />
                  <MetaItem label="Cases" value={dataset?.caseCount === null || dataset?.caseCount === undefined ? 'unknown' : String(dataset.caseCount)} />
                  <MetaItem label="Size" value={dataset ? formatBytes(dataset.byteSize) : '-'} />
                  <MetaItem label="Created" value={dataset ? formatDate(dataset.createdAt) : '-'} />
                </div>
              </div>

              {/* Run history */}
              <div className="rounded-lg border bg-white p-4">
                <div className="mb-3 flex items-center gap-2 text-sm font-medium text-foreground">
                  <Code className="h-4 w-4 text-[#1D9E75]" />
                  Run History
                </div>
                {runs.length > 0 ? (
                  <div className="space-y-2">
                    {runs.map((run) => (
                      <Link
                        key={run.id}
                        href={`/projects/${project.id}/evals/${params.datasetId}`}
                        className="block rounded-md border border-border bg-secondary/50 px-3 py-2 transition-colors hover:bg-secondary"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-mono text-xs text-foreground">{run.status}</span>
                          <span className="font-mono text-[10px] text-muted-foreground">
                            {formatDate(run.createdAt)}
                          </span>
                        </div>
                        <div className="mt-1 font-mono text-[10px] text-muted-foreground">
                          {run.passedCases}/{run.evaluatedCases} passed
                        </div>
                      </Link>
                    ))}
                  </div>
                ) : (
                  <div className="py-4 text-center text-xs text-muted-foreground">
                    No eval runs yet
                  </div>
                )}
              </div>

              {/* Keyboard shortcuts */}
              <div className="rounded-lg border bg-white p-4">
                <div className="mb-3 text-sm font-medium text-foreground">Keyboard Shortcuts</div>
                <div className="space-y-2 text-xs text-muted-foreground">
                  <div className="flex items-center justify-between">
                    <span>Save</span>
                    <kbd className="rounded border bg-secondary px-1.5 py-0.5 font-mono">⌘S</kbd>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Revert</span>
                    <kbd className="rounded border bg-secondary px-1.5 py-0.5 font-mono">⌘Z</kbd>
                  </div>
                </div>
              </div>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}

function JsonField({
  label,
  value,
  onChange,
  error,
  isDirty,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error: string | null;
  isDirty: boolean;
  placeholder: string;
}) {
  const [isExpanded, setIsExpanded] = useState(true);

  return (
    <div className="space-y-1.5">
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        {isExpanded ? (
          <ChevronUp className="h-3.5 w-3.5" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5" />
        )}
        {label}
        <Code className="h-3 w-3" />
      </button>
      {isExpanded && (
        <>
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            rows={4}
            className={`ns-input min-h-[80px] resize-y font-mono text-xs leading-relaxed ${
              error ? 'border-red-300 focus:border-red-400 focus:ring-red-100' : ''
            } ${isDirty ? 'bg-amber-50/50' : ''}`}
          />
          {error && <p className="text-xs text-red-600">{error}</p>}
        </>
      )}
    </div>
  );
}

function MessagesEditor({
  value,
  onChange,
  error,
  isDirty,
}: {
  value: string;
  onChange: (value: string) => void;
  error: string | null;
  isDirty: boolean;
}) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [messages, setMessages] = useState<ParsedMessage[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const parsed = JSON.parse(value);
      if (!Array.isArray(parsed) || !parsed.every(isParsedMessage)) {
        setParseError('Messages must be an array of {role, content} objects.');
        setMessages([]);
        return;
      }
      setParseError(null);
      setMessages(parsed);
    } catch {
      setParseError('Invalid JSON.');
      setMessages([]);
    }
  }, [value]);

  const updateMessage = (index: number, field: keyof ParsedMessage, newValue: string) => {
    const updated = messages.map((msg, i) =>
      i === index ? { ...msg, [field]: newValue } : msg
    );
    setMessages(updated);
    onChange(JSON.stringify(updated, null, 2));
  };

  const addMessage = () => {
    const updated = [...messages, { role: 'user', content: '' }];
    setMessages(updated);
    onChange(JSON.stringify(updated, null, 2));
  };

  const deleteMessage = (index: number) => {
    const updated = messages.filter((_, i) => i !== index);
    setMessages(updated);
    onChange(JSON.stringify(updated, null, 2));
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          {isExpanded ? (
            <ChevronUp className="h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          )}
          Messages
          <Code className="h-3 w-3" />
        </button>
      </div>
      {isExpanded && (
        <div className="space-y-2">
          {parseError && (
            <p className="text-xs text-red-600">{parseError}</p>
          )}
          {error && <p className="text-xs text-red-600">{error}</p>}
          {messages.length > 0 ? (
            <div className="space-y-2">
              {messages.map((msg, index) => (
                <div
                  key={index}
                  className={`rounded-md border p-3 ${isDirty ? 'bg-amber-50/50' : ''}`}
                >
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="font-mono text-[11px] text-muted-foreground">
                      Message {index + 1}
                    </span>
                    <button
                      type="button"
                      onClick={() => deleteMessage(index)}
                      className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-red-50 hover:text-red-600"
                      title="Delete message"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                  <div className="mb-2">
                    <select
                      value={msg.role}
                      onChange={(e) => updateMessage(index, 'role', e.target.value)}
                      className="ns-input h-8 font-mono text-xs"
                    >
                      {MESSAGE_ROLES.map((role) => (
                        <option key={role} value={role}>
                          {role}
                        </option>
                      ))}
                    </select>
                  </div>
                  <textarea
                    value={msg.content}
                    onChange={(e) => updateMessage(index, 'content', e.target.value)}
                    placeholder="Message content..."
                    rows={3}
                    className="ns-input min-h-[60px] resize-y font-mono text-xs leading-relaxed"
                  />
                </div>
              ))}
            </div>
          ) : (
            !parseError && (
              <p className="py-2 text-center text-xs text-muted-foreground">
                No messages yet
              </p>
            )
          )}
          <button
            type="button"
            onClick={addMessage}
            className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            <Plus className="h-3 w-3" />
            Add message
          </button>
        </div>
      )}
    </div>
  );
}

function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span className="truncate font-mono text-xs text-foreground" title={value}>
        {value}
      </span>
    </div>
  );
}

function validateRow(row: DatasetRow, rowIndex: number, errors: FieldError[]) {
  if (!row.id.trim()) {
    errors.push({ rowIndex, field: 'id', message: 'ID is required' });
  }
  validateJsonField(row.messages, rowIndex, 'messages', errors, true);
  validateJsonField(row.expected, rowIndex, 'expected', errors, false);
  validateJsonField(row.metrics, rowIndex, 'metrics', errors, false);
  validateJsonField(row.metadata, rowIndex, 'metadata', errors, false);
}

function validateJsonField(
  value: string,
  rowIndex: number,
  field: string,
  errors: FieldError[],
  required: boolean
) {
  if (!value.trim()) {
    if (required) {
      errors.push({ rowIndex, field, message: `${field} is required` });
    }
    return;
  }

  try {
    JSON.parse(value);
  } catch (e) {
    errors.push({
      rowIndex,
      field,
      message: `Invalid JSON: ${e instanceof SyntaxError ? e.message : 'parse failed'}`,
    });
  }
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function parseDatasetDetailResponse(value: unknown): DatasetDetailResponse | null {
  if (!isRecord(value) || !Array.isArray(value.rows) || !Array.isArray(value.runs)) return null;
  const dataset = parseEvalDatasetSummary(value.dataset);
  if (!dataset || !value.rows.every(isDatasetRow)) return null;

  return {
    dataset,
    rows: value.rows,
    runs: value.runs.filter(isEvalRunSummary),
  };
}

function parseDatasetUpdateResponse(value: unknown): DatasetUpdateResponse | null {
  if (!isRecord(value) || !Array.isArray(value.rows)) return null;
  const dataset = parseEvalDatasetSummary(value.dataset);
  if (!dataset || !value.rows.every(isDatasetRow)) return null;
  return { dataset, rows: value.rows };
}

function parseEvalDatasetSummary(value: unknown): EvalDatasetSummary | null {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.name !== 'string' ||
    typeof value.fileName !== 'string' ||
    typeof value.fileFormat !== 'string' ||
    typeof value.byteSize !== 'number' ||
    (value.caseCount !== null && typeof value.caseCount !== 'number') ||
    typeof value.createdAt !== 'string'
  ) {
    return null;
  }

  return {
    id: value.id,
    name: value.name,
    fileName: value.fileName,
    fileFormat: value.fileFormat,
    byteSize: value.byteSize,
    caseCount: value.caseCount,
    createdAt: value.createdAt,
  };
}

function isDatasetRow(value: unknown): value is DatasetRow {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.input === 'string' &&
    typeof value.messages === 'string' &&
    typeof value.expected === 'string' &&
    typeof value.metrics === 'string' &&
    typeof value.metadata === 'string'
  );
}

function isEvalRunSummary(value: unknown): value is EvalRunSummary {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.datasetId === 'string' &&
    typeof value.status === 'string' &&
    typeof value.totalCases === 'number' &&
    typeof value.evaluatedCases === 'number' &&
    typeof value.passedCases === 'number' &&
    typeof value.createdAt === 'string'
  );
}

function readApiError(value: unknown) {
  if (isRecord(value) && typeof value.error === 'string') return value.error;
  return 'Unexpected server response.';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isParsedMessage(value: unknown): value is ParsedMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    'role' in value &&
    'content' in value &&
    typeof (value as ParsedMessage).role === 'string' &&
    typeof (value as ParsedMessage).content === 'string'
  );
}
