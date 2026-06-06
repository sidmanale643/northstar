-- Migration 001: Replace alpha tables with private schema, projects, and api_keys
-- Removes the destructive drop-and-recreate pattern from the alpha migration.

-- Drop alpha tables (reverse dependency order)
DROP TABLE IF EXISTS tool_calls;
DROP TABLE IF EXISTS traces;
DROP TABLE IF EXISTS sessions;
DROP FUNCTION IF EXISTS get_session_stats();

-- Create private schema (not exposed via Supabase Data API)
CREATE SCHEMA IF NOT EXISTS private;

-- Projects: top-level tenant container
CREATE TABLE private.projects (
    id              UUID PRIMARY KEY,
    name            TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- API keys: one row per project; plaintext returned only at creation or rotation
CREATE TABLE private.api_keys (
    id              UUID PRIMARY KEY,
    project_id      UUID NOT NULL REFERENCES private.projects(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    key_hash        TEXT NOT NULL UNIQUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at      TIMESTAMPTZ
);

CREATE UNIQUE INDEX idx_api_keys_project_id ON private.api_keys(project_id);
