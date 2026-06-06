-- Migration 002: Sessions table in private schema

CREATE TABLE private.sessions (
    id              UUID PRIMARY KEY,
    project_id      UUID NOT NULL REFERENCES private.projects(id) ON DELETE CASCADE,
    created_at      TIMESTAMPTZ NOT NULL,
    ended_at        TIMESTAMPTZ,
    metadata        JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX idx_sessions_project_id ON private.sessions(project_id);
CREATE INDEX idx_sessions_created_at ON private.sessions(created_at);
