-- Migration 005: Events table in private schema

CREATE TABLE private.events (
    id              UUID PRIMARY KEY,
    run_id          UUID NOT NULL REFERENCES private.runs(id) ON DELETE CASCADE,
    span_id         UUID REFERENCES private.spans(id) ON DELETE SET NULL,
    project_id      UUID NOT NULL REFERENCES private.projects(id) ON DELETE CASCADE,
    type            TEXT NOT NULL CHECK (type IN (
                        'user_input', 'system_message', 'assistant_message',
                        'reasoning', 'tool_arguments', 'tool_result',
                        'final_response', 'custom'
                    )),
    created_at      TIMESTAMPTZ NOT NULL,
    content         JSONB NOT NULL,
    attributes      JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX idx_events_run_id ON private.events(run_id);
CREATE INDEX idx_events_span_id ON private.events(span_id);
CREATE INDEX idx_events_project_id ON private.events(project_id);
CREATE INDEX idx_events_type ON private.events(type);
CREATE INDEX idx_events_created_at ON private.events(created_at);
