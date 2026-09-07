BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.tender_analysis_runs
    WHERE status <> 'completed'
    GROUP BY source, tender_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Cannot enforce one unfinished run: duplicate (source, tender_id) rows exist';
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_tender_analysis_runs_one_unfinished
  ON public.tender_analysis_runs (source, tender_id)
  WHERE status <> 'completed';

CREATE TABLE IF NOT EXISTS public.tender_analysis_intake_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL DEFAULT 'tenderplan',
  event_key text NOT NULL,
  event_type text NOT NULL,
  tender_id text NOT NULL,
  observed_at timestamptz,
  trigger_kind text NOT NULL CHECK (
    trigger_kind IN ('tenderplan_mark', 'recovery_scan', 'manual')
  ),
  analysis_run_id uuid REFERENCES public.tender_analysis_runs(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'processing' CHECK (
    status IN ('processing', 'completed', 'failed')
  ),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  n8n_execution_id text,
  processing_started_at timestamptz,
  action text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, event_key)
);

CREATE INDEX IF NOT EXISTS idx_tender_analysis_intake_events_run
  ON public.tender_analysis_intake_events (analysis_run_id);

CREATE INDEX IF NOT EXISTS idx_tender_analysis_intake_events_status_started
  ON public.tender_analysis_intake_events (status, processing_started_at);

COMMIT;
