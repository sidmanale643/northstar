-- Migration 003: Runs table in private schema

CREATE TABLE private.runs (
    id              UUID PRIMARY KEY,
    session_id      UUID NOT NULL REFERENCES private.sessions(id) ON DELETE CASCADE,
    project_id      UUID NOT NULL REFERENCES private.projects(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    started_at      TIMESTAMPTZ NOT NULL,
    ended_at        TIMESTAMPTZ,
    status          TEXT NOT NULL CHECK (status IN ('running', 'ok', 'error')),
    error           JSONB,
    metadata        JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX idx_runs_session_id ON private.runs(session_id);
CREATE INDEX idx_runs_project_id ON private.runs(project_id);
CREATE INDEX idx_runs_started_at ON private.runs(started_at);
