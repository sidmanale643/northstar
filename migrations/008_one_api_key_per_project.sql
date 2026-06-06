-- Migration 008: Enforce one API key row per project
-- Rotation updates the existing row in place. If an existing database has
-- duplicate rows for a project, this migration fails instead of choosing one.

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_class index_relation
        JOIN pg_namespace index_schema
          ON index_schema.oid = index_relation.relnamespace
        JOIN pg_index index_definition
          ON index_definition.indexrelid = index_relation.oid
        WHERE index_schema.nspname = 'private'
          AND index_relation.relname = 'idx_api_keys_project_id'
          AND NOT index_definition.indisunique
    ) THEN
        DROP INDEX private.idx_api_keys_project_id;
    END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_api_keys_project_id
ON private.api_keys(project_id);
