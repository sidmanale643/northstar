-- Migration 009: Pin the RLS helper search path

ALTER FUNCTION private.request_project_id()
SET search_path = private, pg_temp;
