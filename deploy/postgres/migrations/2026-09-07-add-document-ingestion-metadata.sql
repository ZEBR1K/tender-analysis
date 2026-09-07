BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE public.tender_analysis_documents
  ADD COLUMN IF NOT EXISTS ingestion_metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMIT;
