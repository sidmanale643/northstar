-- Migration 018: Allow service-role dashboard RPCs to access eval datasets

ALTER TABLE private.eval_datasets ENABLE ROW LEVEL SECURITY;

GRANT USAGE ON SCHEMA private TO service_role;
GRANT SELECT, INSERT, DELETE ON private.eval_datasets TO service_role;

REVOKE ALL ON TABLE private.eval_datasets FROM anon;
REVOKE ALL ON TABLE private.eval_datasets FROM authenticated;
