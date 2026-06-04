'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  Database,
  FileJson,
  Loader2,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useActiveProject } from '@/components/project-provider';
import type { EvalDatasetSummary } from '@/lib/supabase/types';

interface EvalDatasetsResponse {
  datasets: EvalDatasetSummary[];
}

interface EvalDatasetResponse {
  dataset: EvalDatasetSummary;
}

const SUPPORTED_FORMATS = ['JSON', 'JSONL', 'CSV', 'XLSX'];

export default function DatasetsPage() {
  const project = useActiveProject();
  const router = useRouter();
  const [datasets, setDatasets] = useState<EvalDatasetSummary[]>([]);
  const [datasetError, setDatasetError] = useState<string | null>(null);
  const [isLoadingDatasets, setIsLoadingDatasets] = useState(false);
  const [isUploadingDataset, setIsUploadingDataset] = useState(false);
  const [deletingDatasetId, setDeletingDatasetId] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let isCurrent = true;

    async function loadDatasets() {
      setIsLoadingDatasets(true);
      setDatasetError(null);

      try {
        const response = await fetch(`/api/projects/${project.id}/eval-datasets`, {
          cache: 'no-store',
        });
        const body: unknown = await response.json().catch(() => null);

        if (!response.ok) throw new Error(readApiError(body));

        const parsed = parseEvalDatasetsResponse(body);
        if (!parsed) throw new Error('The server returned an invalid dataset list.');

        if (isCurrent) setDatasets(parsed.datasets);
      } catch (error) {
        if (isCurrent) {
          setDatasets([]);
          setDatasetError(error instanceof Error ? error.message : 'Unable to load datasets.');
        }
      } finally {
        if (isCurrent) setIsLoadingDatasets(false);
      }
    }

    loadDatasets();

    return () => {
      isCurrent = false;
    };
  }, [project.id]);

  const filteredDatasets = useMemo(() => {
    if (!searchQuery.trim()) return datasets;
    const query = searchQuery.toLowerCase();
    return datasets.filter(
      (d) =>
        d.name.toLowerCase().includes(query) ||
        d.fileName.toLowerCase().includes(query)
    );
  }, [datasets, searchQuery]);

  const handleFileUpload = async (file: File) => {
    const clientFileError = getClientFileError(file);
    if (clientFileError) {
      setDatasetError(clientFileError);
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    setIsUploadingDataset(true);
    setDatasetError(null);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch(`/api/projects/${project.id}/eval-datasets`, {
        method: 'POST',
        body: formData,
      });
      const body: unknown = await response.json().catch(() => null);

      if (!response.ok) throw new Error(readApiError(body));

      const parsed = parseEvalDatasetResponse(body);
      if (!parsed) throw new Error('The server returned an invalid dataset.');

      setDatasets((current) => [
        parsed.dataset,
        ...current.filter((dataset) => dataset.id !== parsed.dataset.id),
      ]);
      router.push(`/projects/${project.id}/datasets/${parsed.dataset.id}`);
    } catch (error) {
      setDatasetError(error instanceof Error ? error.message : 'Unable to upload dataset.');
    } finally {
      setIsUploadingDataset(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDeleteDataset = async (dataset: EvalDatasetSummary) => {
    setDeletingDatasetId(dataset.id);
    setDatasetError(null);

    try {
      const response = await fetch(`/api/projects/${project.id}/eval-datasets/${dataset.id}`, {
        method: 'DELETE',
      });
      const body: unknown = await response.json().catch(() => null);

      if (!response.ok) throw new Error(readApiError(body));

      setDatasets((current) =>
        current.filter((currentDataset) => currentDataset.id !== dataset.id)
      );
    } catch (error) {
      setDatasetError(error instanceof Error ? error.message : 'Unable to delete dataset.');
    } finally {
      setDeletingDatasetId(null);
    }
  };

  const handleDragOver = (event: React.DragEvent) => {
    event.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (event: React.DragEvent) => {
    event.preventDefault();
    if (event.relatedTarget && dropZoneRef.current?.contains(event.relatedTarget as Node)) {
      return;
    }
    setIsDragging(false);
  };

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault();
    setIsDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) void handleFileUpload(file);
  };

  return (
    <div
      ref={dropZoneRef}
      className="ns-enter relative min-h-[680px] overflow-hidden rounded-lg border bg-background"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Full-page drop overlay */}
      {isDragging && (
        <div className="ns-backdrop-enter absolute inset-0 z-50 flex items-center justify-center bg-white/90 p-8">
          <div className="ns-dialog-enter flex h-full w-full flex-col items-center justify-center rounded-xl border-2 border-dashed border-[#1D9E75] bg-[#E1F5EE]/50">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#1D9E75]/10">
              <Upload className="h-8 w-8 text-[#1D9E75]" />
            </div>
            <p className="mt-4 text-lg font-medium text-[#085041]">Drop your dataset file here</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Supported formats: JSON, JSONL, CSV, XLSX
            </p>
          </div>
        </div>
      )}

      <div className="flex min-h-[680px] flex-col overflow-hidden">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border px-6 py-5">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-base font-semibold text-foreground">
              <Database className="h-5 w-5 text-[#1D9E75]" />
              Datasets
            </div>
            <div className="mt-1 text-sm text-muted-foreground">
              EvalCase datasets for eval runs, stored as JSON, JSONL, CSV, or XLSX
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search datasets..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="ns-input h-9 w-48 pl-9 text-sm"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {/* Upload button */}
            <button
              type="button"
              className="ns-button ns-button-primary h-9"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploadingDataset}
            >
              {isUploadingDataset ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
              {isUploadingDataset ? 'Uploading...' : 'Upload dataset'}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,.jsonl,.csv,.xlsx,application/json,application/x-ndjson,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="hidden"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                if (file) void handleFileUpload(file);
              }}
            />
          </div>
        </div>

        {/* Error banner */}
        {datasetError && (
          <div className="border-b border-[#F09595] bg-[#FCEBEB] px-6 py-2.5 text-sm text-[#791F1F]">
            <span className="inline-flex items-center gap-1.5">
              <AlertCircle className="h-4 w-4" />
              {datasetError}
            </span>
          </div>
        )}

        {/* Content */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {isLoadingDatasets ? (
            <div className="flex min-h-[400px] flex-col items-center justify-center gap-3">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Loading datasets...</span>
            </div>
          ) : filteredDatasets.length === 0 ? (
            /* Empty state */
            <div className="flex min-h-[480px] flex-col items-center justify-center gap-6 px-6">
              <div className="flex h-20 w-20 items-center justify-center rounded-full bg-[#E1F5EE]">
                <Database className="h-10 w-10 text-[#1D9E75]" />
              </div>
              <div className="text-center">
                <h3 className="text-lg font-semibold text-foreground">
                  {searchQuery ? 'No datasets found' : 'No datasets yet'}
                </h3>
                <p className="mt-2 max-w-md text-sm text-muted-foreground">
                  {searchQuery
                    ? 'No datasets match your search. Try a different query.'
                    : 'Upload JSON, JSONL, CSV, or XLSX files with EvalCase-compatible fields to get started.'}
                </p>
              </div>
              {!searchQuery && (
                <>
                  <button
                    type="button"
                    className="ns-button ns-button-primary"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Upload className="h-4 w-4" />
                    Upload your first dataset
                  </button>
                  <div className="flex items-center gap-2">
                    {SUPPORTED_FORMATS.map((format) => (
                      <span
                        key={format}
                        className="rounded-full border border-border bg-secondary px-2.5 py-1 font-mono text-[11px] text-muted-foreground"
                      >
                        {format}
                      </span>
                    ))}
                  </div>
                </>
              )}
            </div>
          ) : (
            /* Dataset cards */
            <div className="divide-y divide-border">
              {filteredDatasets.map((dataset) => {
                const isDeleting = deletingDatasetId === dataset.id;

                return (
                  <div
                    key={dataset.id}
                    className="group flex items-center gap-4 px-6 py-4 transition-colors hover:bg-secondary/50"
                  >
                    {/* Icon + Name */}
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg border bg-white">
                        <FileJson className="h-5 w-5 text-[#1D9E75]" />
                      </div>
                      <div className="min-w-0">
                        <Link
                          href={`/projects/${project.id}/datasets/${dataset.id}`}
                          className="block truncate text-sm font-medium text-foreground hover:text-[#0E7C5C]"
                          title={dataset.name}
                        >
                          {dataset.name}
                        </Link>
                        <div
                          className="truncate font-mono text-xs text-muted-foreground"
                          title={dataset.fileName}
                        >
                          {dataset.fileName}
                        </div>
                      </div>
                    </div>

                    {/* Stats */}
                    <div className="hidden items-center gap-2 sm:flex">
                      <span className="inline-flex items-center rounded-full border bg-white px-2.5 py-1 font-mono text-[11px] text-muted-foreground">
                        {dataset.fileFormat}
                      </span>
                      <span className="inline-flex items-center gap-1 rounded-full border bg-white px-2.5 py-1 font-mono text-[11px] text-muted-foreground">
                        {formatCaseCount(dataset.caseCount)} cases
                      </span>
                      <span className="inline-flex items-center gap-1 rounded-full border bg-white px-2.5 py-1 font-mono text-[11px] text-muted-foreground">
                        {formatBytes(dataset.byteSize)}
                      </span>
                      <span className="inline-flex items-center gap-1 rounded-full border bg-white px-2.5 py-1 font-mono text-[11px] text-muted-foreground">
                        {formatDate(dataset.createdAt)}
                      </span>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/projects/${project.id}/evals/${dataset.id}`}
                        className="ns-button h-8"
                      >
                        Run eval
                      </Link>
                      <Link
                        href={`/projects/${project.id}/datasets/${dataset.id}`}
                        className="ns-button h-8 gap-1"
                      >
                        Open
                        <ArrowRight className="h-3.5 w-3.5" />
                      </Link>
                      <button
                        type="button"
                        className="inline-flex h-8 w-8 items-center justify-center rounded-md border bg-white text-muted-foreground transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-60"
                        onClick={() => void handleDeleteDataset(dataset)}
                        disabled={isDeleting}
                        title="Delete dataset"
                      >
                        {isDeleting ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer stats */}
        {!isLoadingDatasets && datasets.length > 0 && (
          <div className="border-t border-border bg-secondary/30 px-6 py-3">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                {filteredDatasets.length} of {datasets.length} datasets
                {searchQuery && ` matching "${searchQuery}"`}
              </span>
              <span className="hidden sm:inline">Drag and drop files anywhere to upload</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function getClientFileError(file: File) {
  const lowerName = file.name.toLowerCase();
  if (!/\.(json|jsonl|csv|xlsx)$/.test(lowerName)) {
    return 'Unsupported dataset format. Use JSON, JSONL, CSV, or XLSX.';
  }
  if (file.size <= 0) return 'Dataset file is empty.';
  if (file.size > 10 * 1024 * 1024) return 'Dataset file must be 10 MB or smaller.';
  return null;
}

function formatCaseCount(caseCount: number | null) {
  return caseCount === null ? 'unknown' : String(caseCount);
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

function parseEvalDatasetsResponse(value: unknown): EvalDatasetsResponse | null {
  if (!isRecord(value) || !Array.isArray(value.datasets)) return null;

  const datasets = value.datasets.map(parseEvalDatasetSummary);
  if (datasets.some((dataset) => dataset === null)) return null;

  return {
    datasets: datasets.filter((dataset): dataset is EvalDatasetSummary => dataset !== null),
  };
}

function parseEvalDatasetResponse(value: unknown): EvalDatasetResponse | null {
  if (!isRecord(value)) return null;
  const dataset = parseEvalDatasetSummary(value.dataset);
  return dataset ? { dataset } : null;
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

function readApiError(value: unknown) {
  if (isRecord(value) && typeof value.error === 'string') return value.error;
  return 'Unexpected server response.';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
