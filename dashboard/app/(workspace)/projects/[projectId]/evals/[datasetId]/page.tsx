'use client';

import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  FileJson,
  Loader2,
  Play,
} from 'lucide-react';
import Link from 'next/link';
import { useActiveProject } from '@/components/project-provider';
import { EvalResultsTab } from '@/components/eval-results-tab';
import { EvalConfigureTab } from '@/components/eval-configure-tab';
import { EvalRunHistory } from '@/components/eval-run-history';
import type {
  EvalDatasetSummary,
  EvalRunDetail,
  EvalRunSummary,
} from '@/lib/supabase/types';
import {
  DEFAULT_RUBRIC_JUDGE_MODEL,
  type EvalGraderDraft,
  type EvalGraderRunConfig,
  type EvalRunRequest,
} from '@/lib/eval-types';

interface DatasetDetailResponse {
  dataset: EvalDatasetSummary;
  runs: EvalRunSummary[];
  latestRun: EvalRunDetail | null;
}

interface EvalRunResponse {
  run: EvalRunDetail;
}

type TabName = 'results' | 'configure' | 'history';

export default function EvalDatasetPage({
  params,
}: {
  params: { datasetId: string };
}) {
  const project = useActiveProject();
  const [dataset, setDataset] = useState<EvalDatasetSummary | null>(null);
  const [runs, setRuns] = useState<EvalRunSummary[]>([]);
  const [activeRun, setActiveRun] = useState<EvalRunDetail | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRunning, setIsRunning] = useState(false);
  const [loadingRunId, setLoadingRunId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabName>('results');

  const [graders, setGraders] = useState<EvalGraderDraft[]>(() => [
    {
      id: 'rubric-judge-initial',
      type: 'rubric',
      name: 'rubric_judge_1',
      model: DEFAULT_RUBRIC_JUDGE_MODEL,
      rubric: '',
      scoringMode: 'numeric',
      minScore: '0',
      maxScore: '5',
      passingScore: '4',
      temperature: '0',
    },
  ]);

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

        if (!response.ok) {
          throw new Error(readApiError(body));
        }

        const parsed = parseDatasetDetailResponse(body);
        if (!parsed) {
          throw new Error('The server returned an invalid eval dataset response.');
        }

        if (isCurrent) {
          setDataset(parsed.dataset);
          setRuns(parsed.runs);
          setActiveRun(parsed.latestRun);
        }
      } catch (error) {
        if (isCurrent) {
          setDataset(null);
          setRuns([]);
          setActiveRun(null);
          setPageError(error instanceof Error ? error.message : 'Unable to load eval dataset.');
        }
      } finally {
        if (isCurrent) setIsLoading(false);
      }
    }

    loadDataset();

    return () => {
      isCurrent = false;
    };
  }, [params.datasetId, project.id]);

  const handleRunDataset = async () => {
    const runConfig = buildRunConfig({
      graders,
    });
    if (!runConfig.ok) {
      setPageError(runConfig.error);
      return;
    }

    setIsRunning(true);
    setPageError(null);

    try {
      const response = await fetch(
        `/api/projects/${project.id}/eval-datasets/${params.datasetId}/runs`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(runConfig.request),
        }
      );
      const body: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(readApiError(body));
      }

      const parsed = parseEvalRunResponse(body);
      if (!parsed) {
        throw new Error('The server returned an invalid eval run.');
      }

      setActiveRun(parsed.run);
      setRuns((current) => [
        toEvalRunSummary(parsed.run),
        ...current.filter((run) => run.id !== parsed.run.id),
      ]);
      setActiveTab('results');
    } catch (error) {
      setPageError(error instanceof Error ? error.message : 'Unable to run eval dataset.');
    } finally {
      setIsRunning(false);
    }
  };

  const handleSelectRun = async (run: EvalRunSummary) => {
    if (activeRun?.id === run.id) {
      setActiveTab('results');
      return;
    }

    setLoadingRunId(run.id);
    setPageError(null);

    try {
      const response = await fetch(
        `/api/projects/${project.id}/eval-datasets/${params.datasetId}/runs/${run.id}`,
        { cache: 'no-store' }
      );
      const body: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(readApiError(body));
      }

      const parsed = parseEvalRunResponse(body);
      if (!parsed) {
        throw new Error('The server returned an invalid eval run.');
      }

      setActiveRun(parsed.run);
      setActiveTab('results');
    } catch (error) {
      setPageError(error instanceof Error ? error.message : 'Unable to load eval run.');
    } finally {
      setLoadingRunId(null);
    }
  };

  const tabs: { id: TabName; label: string }[] = [
    { id: 'results', label: 'Results' },
    { id: 'configure', label: 'Configure' },
    { id: 'history', label: 'Run History' },
  ];

  return (
    <div className="ns-enter flex h-full flex-col bg-background">
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="flex flex-wrap items-start gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0 flex-1">
            <Link
              href={`/projects/${project.id}/evals`}
              className="mb-2 inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Evals
            </Link>
            <div className="flex items-center gap-2 text-[15px] font-medium text-foreground">
              <FileJson className="h-4 w-4 text-[#1D9E75]" />
              {dataset?.name ?? 'Loading...'}
            </div>
            <div className="mt-1 truncate font-mono text-xs text-muted-foreground">
              {dataset?.fileName ?? params.datasetId}
            </div>
          </div>

          <Link
            href={`/projects/${project.id}/datasets/${params.datasetId}`}
            className="inline-flex h-9 items-center justify-center rounded-md border bg-background px-3 text-xs font-medium text-foreground transition-colors hover:bg-secondary"
          >
            Edit dataset
          </Link>
          <button
            type="button"
            className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-[#158B67] bg-[#1D9E75] px-3 text-xs font-medium text-white transition-colors hover:bg-[#158B67] disabled:cursor-not-allowed disabled:opacity-60"
            onClick={handleRunDataset}
            disabled={isRunning || isLoading || dataset === null}
          >
            {isRunning ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Play className="h-3.5 w-3.5" />
            )}
            {isRunning ? 'Running' : 'Run dataset'}
          </button>
        </div>

        {pageError && (
          <div className="border-b border-[#F09595] bg-[#FCEBEB] px-5 py-2 text-[11px] text-[#791F1F]">
            <span className="inline-flex items-center gap-1.5">
              <AlertCircle className="h-3.5 w-3.5" />
              {pageError}
            </span>
          </div>
        )}

        <div className="flex items-center gap-1 border-b border-border px-5 py-0">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`relative border-b-2 px-3 py-2.5 text-xs font-medium transition-colors ${
                activeTab === tab.id
                  ? 'border-[#1D9E75] text-[#1D9E75]'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {activeTab === 'results' && (
            <EvalResultsTab
              activeRun={activeRun}
              isLoading={isLoading}
            />
          )}

          {activeTab === 'configure' && (
            <EvalConfigureTab
              graders={graders}
              setGraders={setGraders}
              isRunning={isRunning}
            />
          )}

          {activeTab === 'history' && (
            <EvalRunHistory
              runs={runs}
              activeRunId={activeRun?.id ?? null}
              onSelectRun={handleSelectRun}
              loadingRunId={loadingRunId}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function buildRunConfig(input: {
  graders: EvalGraderDraft[];
}): { ok: true; request: EvalRunRequest } | { ok: false; error: string } {
  if (input.graders.length === 0) {
    return { ok: true, request: { graders: [] } };
  }

  const seenNames = new Set<string>();
  const graders: EvalGraderRunConfig[] = [];
  for (let index = 0; index < input.graders.length; index += 1) {
    const grader = input.graders[index];
    const label = `Grader ${index + 1}`;
    const name = grader.name.trim();

    if (!name) return { ok: false, error: `${label} name is required.` };
    if (seenNames.has(name)) return { ok: false, error: `Grader name "${name}" is duplicated.` };
    seenNames.add(name);

    if (grader.type === 'python' || grader.type === 'typescript') {
      const code = grader.code.trim();
      const timeoutMs = parseFiniteInteger(grader.timeoutMs);
      if (!code) return { ok: false, error: `${label} code is required.` };
      if (timeoutMs === null || timeoutMs <= 0 || timeoutMs > 5000) {
        return { ok: false, error: `${label} timeout must be between 1 and 5000ms.` };
      }
      graders.push({
        type: grader.type,
        name,
        code,
        timeout_ms: timeoutMs,
      });
      continue;
    }

    if (grader.type === 'regex') {
      const pattern = grader.pattern.trim();
      const target = grader.target.trim() || 'final_response';
      if (!pattern) return { ok: false, error: `${label} regex pattern is required.` };
      graders.push({
        type: 'regex',
        name,
        pattern,
        target,
        flags: grader.flags,
      });
      continue;
    }

    const model = grader.model.trim();
    const rubric = grader.rubric.trim();
    const temperature = parseFiniteNumber(grader.temperature);

    if (!model) return { ok: false, error: `${label} model is required.` };
    if (!rubric) return { ok: false, error: `${label} rubric is required.` };
    if (temperature === null || temperature < 0 || temperature > 2) {
      return { ok: false, error: `${label} temperature must be between 0 and 2.` };
    }

    if (grader.scoringMode === 'binary') {
      graders.push({
        type: 'rubric',
        name,
        model,
        rubric,
        temperature,
        scoring: { mode: 'binary' },
      });
      continue;
    }

    const minScore = parseFiniteNumber(grader.minScore);
    const maxScore = parseFiniteNumber(grader.maxScore);
    const passingScore = parseFiniteNumber(grader.passingScore);
    if (minScore === null || maxScore === null || passingScore === null) {
      return { ok: false, error: `${label} numeric scoring fields must be valid numbers.` };
    }
    if (maxScore <= minScore) {
      return { ok: false, error: `${label} max score must be greater than min score.` };
    }
    if (passingScore < minScore || passingScore > maxScore) {
      return { ok: false, error: `${label} passing score must be within the score range.` };
    }

    graders.push({
      type: 'rubric',
      name,
      model,
      rubric,
      temperature,
      scoring: {
        mode: 'numeric',
        min_score: minScore,
        max_score: maxScore,
        passing_score: passingScore,
      },
    });
  }

  return { ok: true, request: { graders } };
}

function parseFiniteNumber(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseFiniteInteger(value: string) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

function toEvalRunSummary(run: EvalRunDetail): EvalRunSummary {
  return {
    id: run.id,
    datasetId: run.datasetId,
    status: run.status,
    totalCases: run.totalCases,
    evaluatedCases: run.evaluatedCases,
    notEvaluatedCases: run.notEvaluatedCases,
    passedCases: run.passedCases,
    failedCases: run.failedCases,
    passRate: run.passRate,
    skippedGrades: run.skippedGrades,
    createdAt: run.createdAt,
  };
}

function parseDatasetDetailResponse(value: unknown): DatasetDetailResponse | null {
  if (!isRecord(value) || !Array.isArray(value.runs)) return null;

  const dataset = parseEvalDatasetSummary(value.dataset);
  const runs = value.runs.map(parseEvalRunSummary);
  const latestRun = value.latestRun === null ? null : parseEvalRunDetail(value.latestRun);

  if (!dataset || runs.some((run) => run === null) || (latestRun === null && value.latestRun !== null)) {
    return null;
  }

  return {
    dataset,
    runs: runs.filter((run): run is EvalRunSummary => run !== null),
    latestRun,
  };
}

function parseEvalRunResponse(value: unknown): EvalRunResponse | null {
  if (!isRecord(value)) return null;

  const run = parseEvalRunDetail(value.run);
  return run ? { run } : null;
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

function parseEvalRunSummary(value: unknown): EvalRunSummary | null {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.datasetId !== 'string' ||
    !isEvalRunStatus(value.status) ||
    !isNonNegativeInteger(value.totalCases) ||
    !isNonNegativeInteger(value.evaluatedCases) ||
    !isNonNegativeInteger(value.notEvaluatedCases) ||
    !isNonNegativeInteger(value.passedCases) ||
    !isNonNegativeInteger(value.failedCases) ||
    typeof value.passRate !== 'number' ||
    !Number.isFinite(value.passRate) ||
    !isNonNegativeInteger(value.skippedGrades) ||
    typeof value.createdAt !== 'string'
  ) {
    return null;
  }

  return {
    id: value.id,
    datasetId: value.datasetId,
    status: value.status,
    totalCases: value.totalCases,
    evaluatedCases: value.evaluatedCases,
    notEvaluatedCases: value.notEvaluatedCases,
    passedCases: value.passedCases,
    failedCases: value.failedCases,
    passRate: value.passRate,
    skippedGrades: value.skippedGrades,
    createdAt: value.createdAt,
  };
}

function parseEvalRunDetail(value: unknown): EvalRunDetail | null {
  if (!isRecord(value)) return null;

  const summary = parseEvalRunSummary(value);
  if (!summary || !isJson(value.result) || !isJson(value.error)) return null;

  return {
    ...summary,
    result: value.result,
    error: value.error,
  };
}

function isEvalRunStatus(value: unknown): value is EvalRunDetail['status'] {
  return value === 'passed' || value === 'failed' || value === 'not_evaluated' || value === 'error';
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isJson(value: unknown): value is EvalRunDetail['result'] {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return true;
  }
  if (Array.isArray(value)) return value.every(isJson);
  if (!isRecord(value)) return false;
  return Object.values(value).every((entry) => entry === undefined || isJson(entry));
}

function readApiError(value: unknown) {
  if (isRecord(value) && typeof value.error === 'string') return value.error;
  return 'Unexpected server response.';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
