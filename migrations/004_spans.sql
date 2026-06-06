-- Migration 004: Spans table in private schema

CREATE TABLE private.spans (
    id              UUID PRIMARY KEY,
    run_id          UUID NOT NULL REFERENCES private.runs(id) ON DELETE CASCADE,
    project_id      UUID NOT NULL REFERENCES private.projects(id) ON DELETE CASCADE,
    parent_span_id  UUID REFERENCES private.spans(id) ON DELETE SET NULL,
    kind            TEXT NOT NULL CHECK (kind IN ('agent', 'workflow', 'model', 'tool', 'custom')),
    name            TEXT NOT NULL,
    started_at      TIMESTAMPTZ NOT NULL,
    ended_at        TIMESTAMPTZ,
    status          TEXT NOT NULL CHECK (status IN ('running', 'ok', 'error')),
    error           JSONB,
    iteration       INTEGER,
    attributes      JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX idx_spans_run_id ON private.spans(run_id);
CREATE INDEX idx_spans_parent_span_id ON private.spans(parent_span_id);
CREATE INDEX idx_spans_project_id ON private.spans(project_id);
CREATE INDEX idx_spans_started_at ON private.spans(started_at);
CREATE INDEX idx_spans_kind ON private.spans(kind);
