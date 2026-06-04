'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Bug,
  Database,
  FileJson,
  Loader2,
  Play,
} from 'lucide-react';
import Link from 'next/link';
import { useActiveProject } from '@/components/project-provider';
import type { EvalRunStatus } from '@/lib/supabase/types';
import type { EvalDatasetWithLatestRun } from '@/lib/eval-types';

interface EvalDatasetsResponse {
  datasets: EvalDatasetWithLatestRun[];
}

export default function EvalsPage() {
  const project = useActiveProject();
  const [datasets, setDatasets] = useState<EvalDatasetWithLatestRun[]>([]);
  const [pageError, setPageError] = useState<string | null>(null);
  const [isLoadingDatasets, setIsLoadingDatasets] = useState(false);

  useEffect(() => {
    let isCurrent = true;

    async function loadDatasets() {
      setIsLoadingDatasets(true);
      setPageError(null);

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
          setPageError(error instanceof Error ? error.message : 'Unable to load datasets.');
        }
      } finally {
        if (isCurrent) setIsLoadingDatasets(false);
      }
    }

    void loadDatasets();

    return () => {
      isCurrent = false;
    };
  }, [project.id]);

  const summaryStats = useMemo(() => {
    const datasetsWithRuns = datasets.filter((d) => d.latestRun !== null);
    const avgPassRate =
      datasetsWithRuns.length > 0
        ? datasetsWithRuns.reduce((sum, d) => sum + d.latestRun!.passRate, 0) / datasetsWithRuns.length
        : null;

    const lastRunTimestamps = datasetsWithRuns
      .map((d) => new Date(d.latestRun!.createdAt).getTime())
      .filter((t) => !Number.isNaN(t));

    const latestRun =
      lastRunTimestamps.length > 0
        ? new Date(Math.max(...lastRunTimestamps))
        : null;

    return {
      datasetCount: datasets.length,
      latestRun,
      avgPassRate,
    };
  }, [datasets]);

  const passRateColor =
    summaryStats.avgPassRate === null
      ? 'text-muted-foreground'
      : summaryStats.avgPassRate >= 0.8
        ? 'text-[#085041]'
        : summaryStats.avgPassRate >= 0.5
          ? 'text-[#6C4B00]'
          : 'text-[#791F1F]';

  return (
    <div className="ns-enter flex h-full flex-col bg-background">
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="flex flex-wrap items-start gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-[15px] font-medium text-foreground">
              <Bug className="h-4 w-4 text-[#1D9E75]" />
              Evals
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              Run graders against a dataset and inspect persisted EvalResult history
            </div>
          </div>

          <Link
            href={`/projects/${project.id}/datasets`}
            className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md border bg-background px-3 text-xs font-medium text-foreground transition-colors hover:bg-secondary"
          >
            <Database className="h-3.5 w-3.5" />
            Manage datasets
          </Link>
        </div>

        {pageError && (
          <div className="border-b border-[#F09595] bg-[#FCEBEB] px-5 py-2 text-[11px] text-[#791F1F]">
            <span className="inline-flex items-center gap-1.5">
              <AlertCircle className="h-3.5 w-3.5" />
              {pageError}
            </span>
          </div>
        )}

        {!isLoadingDatasets && datasets.length > 0 && (
          <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
            <div className="flex items-center gap-6">
              <div className="text-xs text-muted-foreground">
                <span className="font-mono text-foreground">{summaryStats.datasetCount}</span>{' '}
                dataset{summaryStats.datasetCount !== 1 ? 's' : ''}
              </div>
              <div className="text-xs text-muted-foreground">
                Last run{' '}
                <span className="font-mono text-foreground">
                  {summaryStats.latestRun ? formatRelativeTime(summaryStats.latestRun) : '—'}
                </span>
              </div>
              <div className="text-xs text-muted-foreground">
                Avg pass rate{' '}
                <span className={`font-mono font-semibold ${passRateColor}`}>
                  {summaryStats.avgPassRate !== null ? formatPercent(summaryStats.avgPassRate) : '—'}
                </span>
              </div>
            </div>
            {isLoadingDatasets && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto">
          {isLoadingDatasets ? (
            <div className="flex min-h-[400px] items-center justify-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading datasets
            </div>
          ) : datasets.length === 0 ? (
            <div className="flex min-h-[400px] flex-col items-center justify-center gap-6 px-6 text-center">
              <div className="flex h-20 w-20 items-center justify-center rounded-full bg-[#E1F5EE]">
                <FileJson className="h-10 w-10 text-[#1D9E75]" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-foreground">No datasets to run</h3>
                <p className="mt-2 max-w-md text-sm text-muted-foreground">
                  Add a dataset before starting an eval run.
                </p>
              </div>
              <Link
                href={`/projects/${project.id}/datasets`}
                className="ns-button ns-button-primary"
              >
                Open datasets
              </Link>
            </div>
          ) : (
            <div className="space-y-3 px-5 py-4">
              {datasets.map((dataset) => (
                <DatasetEvalCard
                  key={dataset.id}
                  dataset={dataset}
                  projectId={project.id}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DatasetEvalCard({
  dataset,
  projectId,
}: {
  dataset: EvalDatasetWithLatestRun;
  projectId: string;
}) {
  const latestRun = dataset.latestRun;

  const passRatePill = latestRun
    ? (() => {
        const isPassing = latestRun.status === 'passed' || latestRun.passRate >= 0.8;
        const isWarning = latestRun.passRate >= 0.5 && latestRun.passRate < 0.8;
        if (isPassing) {
          return {
            bg: 'bg-[#E1F5EE]',
            text: 'text-[#085041]',
            label: `${formatPercent(latestRun.passRate)}`,
          };
        }
        if (isWarning) {
          return {
            bg: 'bg-[#FFF7DD]',
            text: 'text-[#6C4B00]',
            label: `${formatPercent(latestRun.passRate)}`,
          };
        }
        return {
          bg: 'bg-[#FCEBEB]',
          text: 'text-[#791F1F]',
          label: `${formatPercent(latestRun.passRate)}`,
        };
      })()
    : null;

  return (
    <div className="rounded-lg border bg-white p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md border bg-white">
            <FileJson className="h-4 w-4 text-[#1D9E75]" />
          </div>
          <div className="min-w-0">
            <Link
              href={`/projects/${projectId}/evals/${dataset.id}`}
              className="block truncate text-sm font-medium text-foreground hover:text-[#0E7C5C]"
              title={dataset.name}
            >
              {dataset.name}
            </Link>
            <div className="truncate font-mono text-[10.5px] text-muted-foreground" title={dataset.fileName}>
              {dataset.fileName}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="inline-flex items-center rounded-full border bg-white px-2.5 py-1 font-mono text-[11px] text-muted-foreground">
            {dataset.fileFormat}
          </span>
          <span className="inline-flex items-center rounded-full border bg-white px-2.5 py-1 font-mono text-[11px] text-muted-foreground">
            {dataset.caseCount !== null ? `${dataset.caseCount} cases` : 'unknown'}
          </span>

          {latestRun ? (
            <div className="flex items-center gap-2">
              <span className={`inline-flex items-center rounded-full border px-2.5 py-1 font-mono text-[11px] font-semibold ${passRatePill!.bg} ${passRatePill!.text}`}>
                {passRatePill!.label}
              </span>
              <span className="text-[10.5px] text-muted-foreground">
                {formatRelativeTime(new Date(latestRun.createdAt))}
              </span>
            </div>
          ) : (
            <span className="inline-flex items-center rounded-full border border-border bg-secondary px-2.5 py-1 font-mono text-[11px] text-muted-foreground">
              —
            </span>
          )}
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <Link
          href={`/projects/${projectId}/evals/${dataset.id}`}
          className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-[#158B67] bg-[#1D9E75] px-3 text-xs font-medium text-white transition-colors hover:bg-[#158B67]"
        >
          <Play className="h-3.5 w-3.5" />
          Run eval
        </Link>
        <Link
          href={`/projects/${projectId}/datasets/${dataset.id}`}
          className="inline-flex h-8 items-center justify-center rounded-md border bg-white px-3 text-xs font-medium text-foreground transition-colors hover:bg-secondary"
        >
          Edit dataset
        </Link>
      </div>
    </div>
  );
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function formatRelativeTime(date: Date) {
  const now = Date.now();
  const diff = now - date.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;

  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
  }).format(date);
}

function parseEvalDatasetsResponse(value: unknown): EvalDatasetsResponse | null {
  if (!isRecord(value) || !Array.isArray(value.datasets)) return null;
  const datasets = value.datasets.map(parseEvalDatasetWithLatestRun);
  if (datasets.some((dataset) => dataset === null)) return null;
  return {
    datasets: datasets.filter((dataset): dataset is EvalDatasetWithLatestRun => dataset !== null),
  };
}

function parseEvalDatasetWithLatestRun(value: unknown): EvalDatasetWithLatestRun | null {
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

  let latestRun: EvalDatasetWithLatestRun['latestRun'] = null;
  if (value.latestRun !== null && value.latestRun !== undefined) {
    if (
      isRecord(value.latestRun) &&
      typeof value.latestRun.status === 'string' &&
      typeof value.latestRun.passRate === 'number' &&
      typeof value.latestRun.createdAt === 'string'
    ) {
      latestRun = {
        status: value.latestRun.status as EvalRunStatus,
        passRate: value.latestRun.passRate,
        createdAt: value.latestRun.createdAt,
      };
    }
  }

  return {
    id: value.id,
    name: value.name,
    fileName: value.fileName,
    fileFormat: value.fileFormat,
    byteSize: value.byteSize,
    caseCount: value.caseCount,
    createdAt: value.createdAt,
    latestRun,
  };
}

function readApiError(value: unknown) {
  if (isRecord(value) && typeof value.error === 'string') return value.error;
  return 'Unexpected server response.';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
