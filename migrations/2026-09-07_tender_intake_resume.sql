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
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
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

DO $postconditions$
DECLARE
  runs_oid oid;
  ledger_oid oid;
BEGIN
  SELECT table_class.oid
  INTO runs_oid
  FROM pg_catalog.pg_class AS table_class
  JOIN pg_catalog.pg_namespace AS table_namespace
    ON table_namespace.oid = table_class.relnamespace
  WHERE table_namespace.nspname = 'public'
    AND table_class.relname = 'tender_analysis_runs'
    AND table_class.relkind IN ('r', 'p');

  IF runs_oid IS NULL THEN
    RAISE EXCEPTION
      'Migration postcondition failed: public.tender_analysis_runs is not a table';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS index_class
    JOIN pg_catalog.pg_namespace AS index_namespace
      ON index_namespace.oid = index_class.relnamespace
    JOIN pg_catalog.pg_index AS index_metadata
      ON index_metadata.indexrelid = index_class.oid
    JOIN pg_catalog.pg_attribute AS first_key
      ON first_key.attrelid = index_metadata.indrelid
     AND first_key.attnum = index_metadata.indkey[0]
    JOIN pg_catalog.pg_attribute AS second_key
      ON second_key.attrelid = index_metadata.indrelid
     AND second_key.attnum = index_metadata.indkey[1]
    WHERE index_namespace.nspname = 'public'
      AND index_class.relname = 'uq_tender_analysis_runs_one_unfinished'
      AND index_class.relkind = 'i'
      AND index_metadata.indrelid = runs_oid
      AND index_metadata.indisunique
      AND NOT index_metadata.indisprimary
      AND index_metadata.indisvalid
      AND index_metadata.indisready
      AND index_metadata.indnkeyatts = 2
      AND index_metadata.indnatts = 2
      AND first_key.attname = 'source'
      AND second_key.attname = 'tender_id'
      AND pg_catalog.pg_get_indexdef(index_metadata.indexrelid, 1, true) = 'source'
      AND pg_catalog.pg_get_indexdef(index_metadata.indexrelid, 2, true) = 'tender_id'
      AND index_metadata.indpred IS NOT NULL
      AND replace(
        pg_catalog.regexp_replace(
          lower(pg_catalog.pg_get_expr(index_metadata.indpred, index_metadata.indrelid)),
          '[[:space:]()]',
          '',
          'g'
        ),
        '::text',
        ''
      ) = 'status<>''completed'''
  ) THEN
    RAISE EXCEPTION
      'Migration postcondition failed: uq_tender_analysis_runs_one_unfinished has incompatible definition';
  END IF;

  SELECT table_class.oid
  INTO ledger_oid
  FROM pg_catalog.pg_class AS table_class
  JOIN pg_catalog.pg_namespace AS table_namespace
    ON table_namespace.oid = table_class.relnamespace
  WHERE table_namespace.nspname = 'public'
    AND table_class.relname = 'tender_analysis_intake_events'
    AND table_class.relkind = 'r'
    AND table_class.relpersistence = 'p';

  IF ledger_oid IS NULL THEN
    RAISE EXCEPTION
      'Migration postcondition failed: public.tender_analysis_intake_events is not an ordinary persistent table';
  END IF;

  IF (
    SELECT count(*)
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'tender_analysis_intake_events'
  ) <> 17 THEN
    RAISE EXCEPTION
      'Migration postcondition failed: tender_analysis_intake_events must have exactly 17 columns';
  END IF;

  IF EXISTS (
    WITH expected_columns (
      ordinal_position,
      column_name,
      udt_name,
      is_nullable,
      default_kind
    ) AS (
      VALUES
        (1,  'id',                    'uuid',        'NO',  'uuid'),
        (2,  'source',                'text',        'NO',  'tenderplan'),
        (3,  'event_key',             'text',        'NO',  'none'),
        (4,  'event_type',            'text',        'NO',  'none'),
        (5,  'tender_id',             'text',        'NO',  'none'),
        (6,  'observed_at',           'timestamptz', 'YES', 'none'),
        (7,  'trigger_kind',          'text',        'NO',  'none'),
        (8,  'analysis_run_id',       'uuid',        'YES', 'none'),
        (9,  'status',                'text',        'NO',  'processing'),
        (10, 'attempts',              'int4',        'NO',  'zero'),
        (11, 'n8n_execution_id',      'text',        'YES', 'none'),
        (12, 'processing_started_at', 'timestamptz', 'YES', 'none'),
        (13, 'action',                'text',        'YES', 'none'),
        (14, 'error_message',         'text',        'YES', 'none'),
        (15, 'created_at',            'timestamptz', 'NO',  'now'),
        (16, 'processed_at',          'timestamptz', 'YES', 'none'),
        (17, 'updated_at',            'timestamptz', 'NO',  'now')
    ),
    actual_columns AS (
      SELECT
        column_row.ordinal_position,
        column_row.column_name,
        column_row.udt_name,
        column_row.is_nullable,
        column_row.column_default,
        pg_catalog.regexp_replace(
          lower(COALESCE(column_row.column_default, '')),
          '[[:space:]]',
          '',
          'g'
        ) AS normalized_default
      FROM information_schema.columns AS column_row
      WHERE column_row.table_schema = 'public'
        AND column_row.table_name = 'tender_analysis_intake_events'
    )
    SELECT 1
    FROM expected_columns AS expected
    LEFT JOIN actual_columns AS actual
      ON actual.ordinal_position = expected.ordinal_position
    WHERE actual.column_name IS DISTINCT FROM expected.column_name
       OR actual.udt_name IS DISTINCT FROM expected.udt_name
       OR actual.is_nullable IS DISTINCT FROM expected.is_nullable
       OR CASE expected.default_kind
            WHEN 'none' THEN actual.column_default IS NOT NULL
            WHEN 'uuid' THEN
              actual.column_default IS NULL
              OR actual.normalized_default NOT IN (
                'gen_random_uuid()',
                'pg_catalog.gen_random_uuid()'
              )
            WHEN 'tenderplan' THEN
              actual.column_default IS NULL
              OR replace(actual.normalized_default, '::text', '') <> '''tenderplan'''
            WHEN 'processing' THEN
              actual.column_default IS NULL
              OR replace(actual.normalized_default, '::text', '') <> '''processing'''
            WHEN 'zero' THEN
              actual.column_default IS NULL
              OR pg_catalog.btrim(
                replace(actual.normalized_default, '::integer', ''),
                '()'
              ) <> '0'
            WHEN 'now' THEN
              actual.column_default IS NULL
              OR actual.normalized_default NOT IN (
                'now()',
                'pg_catalog.now()',
                'current_timestamp'
              )
            ELSE true
          END
  ) THEN
    RAISE EXCEPTION
      'Migration postcondition failed: tender_analysis_intake_events column contract is incompatible';
  END IF;

  IF (
    SELECT count(*)
    FROM pg_catalog.pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = ledger_oid
      AND constraint_row.contype = 'p'
  ) <> 1 OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS constraint_row
    JOIN pg_catalog.pg_attribute AS id_column
      ON id_column.attrelid = constraint_row.conrelid
     AND id_column.attname = 'id'
    WHERE constraint_row.conrelid = ledger_oid
      AND constraint_row.contype = 'p'
      AND constraint_row.conkey = ARRAY[id_column.attnum]::smallint[]
      AND constraint_row.convalidated
      AND NOT constraint_row.condeferrable
      AND NOT constraint_row.condeferred
  ) THEN
    RAISE EXCEPTION
      'Migration postcondition failed: tender_analysis_intake_events primary key must be (id)';
  END IF;

  IF (
    SELECT count(*)
    FROM pg_catalog.pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = ledger_oid
      AND constraint_row.contype = 'u'
  ) <> 1 OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS constraint_row
    JOIN pg_catalog.pg_attribute AS source_column
      ON source_column.attrelid = constraint_row.conrelid
     AND source_column.attname = 'source'
    JOIN pg_catalog.pg_attribute AS event_key_column
      ON event_key_column.attrelid = constraint_row.conrelid
     AND event_key_column.attname = 'event_key'
    WHERE constraint_row.conrelid = ledger_oid
      AND constraint_row.contype = 'u'
      AND constraint_row.conkey = ARRAY[
        source_column.attnum,
        event_key_column.attnum
      ]::smallint[]
      AND constraint_row.convalidated
      AND NOT constraint_row.condeferrable
      AND NOT constraint_row.condeferred
  ) THEN
    RAISE EXCEPTION
      'Migration postcondition failed: tender_analysis_intake_events unique key must be (source, event_key)';
  END IF;

  IF (
    SELECT count(*)
    FROM pg_catalog.pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = ledger_oid
      AND constraint_row.contype = 'f'
  ) <> 1 OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS constraint_row
    JOIN pg_catalog.pg_attribute AS local_column
      ON local_column.attrelid = constraint_row.conrelid
     AND local_column.attname = 'analysis_run_id'
    JOIN pg_catalog.pg_attribute AS referenced_column
      ON referenced_column.attrelid = constraint_row.confrelid
     AND referenced_column.attname = 'id'
    WHERE constraint_row.conrelid = ledger_oid
      AND constraint_row.contype = 'f'
      AND constraint_row.confrelid = runs_oid
      AND constraint_row.conkey = ARRAY[local_column.attnum]::smallint[]
      AND constraint_row.confkey = ARRAY[referenced_column.attnum]::smallint[]
      AND constraint_row.convalidated
      AND NOT constraint_row.condeferrable
      AND NOT constraint_row.condeferred
      AND constraint_row.confupdtype = 'a'
      AND constraint_row.confdeltype = 'n'
      AND constraint_row.confmatchtype = 's'
  ) THEN
    RAISE EXCEPTION
      'Migration postcondition failed: analysis_run_id FK must reference public.tender_analysis_runs(id) ON DELETE SET NULL';
  END IF;

  IF (
    SELECT count(*)
    FROM pg_catalog.pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = ledger_oid
      AND constraint_row.contype = 'c'
  ) <> 3 THEN
    RAISE EXCEPTION
      'Migration postcondition failed: tender_analysis_intake_events must have exactly three CHECK constraints';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = ledger_oid
      AND constraint_row.contype = 'c'
      AND constraint_row.convalidated
      AND pg_catalog.pg_get_constraintdef(constraint_row.oid, true)
        ~* 'trigger_kind[[:space:]]*=[[:space:]]*ANY[[:space:]]*[(][[:space:]]*ARRAY'
      AND pg_catalog.pg_get_constraintdef(constraint_row.oid, true)
        !~* '[[:<:]](AND|OR)[[:>:]]'
      AND ARRAY(
        SELECT (captured.value)[1]
        FROM pg_catalog.regexp_matches(
          lower(pg_catalog.pg_get_constraintdef(constraint_row.oid, true)),
          '''([^'']+)''',
          'g'
        ) AS captured(value)
        ORDER BY (captured.value)[1]
      ) = ARRAY['manual', 'recovery_scan', 'tenderplan_mark']::text[]
  ) THEN
    RAISE EXCEPTION
      'Migration postcondition failed: trigger_kind CHECK values are incompatible';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = ledger_oid
      AND constraint_row.contype = 'c'
      AND constraint_row.convalidated
      AND pg_catalog.pg_get_constraintdef(constraint_row.oid, true)
        ~* 'status[[:space:]]*=[[:space:]]*ANY[[:space:]]*[(][[:space:]]*ARRAY'
      AND pg_catalog.pg_get_constraintdef(constraint_row.oid, true)
        !~* '[[:<:]](AND|OR)[[:>:]]'
      AND ARRAY(
        SELECT (captured.value)[1]
        FROM pg_catalog.regexp_matches(
          lower(pg_catalog.pg_get_constraintdef(constraint_row.oid, true)),
          '''([^'']+)''',
          'g'
        ) AS captured(value)
        ORDER BY (captured.value)[1]
      ) = ARRAY['completed', 'failed', 'processing']::text[]
  ) THEN
    RAISE EXCEPTION
      'Migration postcondition failed: status CHECK values are incompatible';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = ledger_oid
      AND constraint_row.contype = 'c'
      AND constraint_row.convalidated
      AND replace(
        pg_catalog.regexp_replace(
          lower(pg_catalog.pg_get_constraintdef(constraint_row.oid, true)),
          '[[:space:]()]',
          '',
          'g'
        ),
        '::integer',
        ''
      ) = 'checkattempts>=0'
  ) THEN
    RAISE EXCEPTION
      'Migration postcondition failed: attempts CHECK must enforce attempts >= 0';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS index_class
    JOIN pg_catalog.pg_namespace AS index_namespace
      ON index_namespace.oid = index_class.relnamespace
    JOIN pg_catalog.pg_index AS index_metadata
      ON index_metadata.indexrelid = index_class.oid
    JOIN pg_catalog.pg_attribute AS first_key
      ON first_key.attrelid = index_metadata.indrelid
     AND first_key.attnum = index_metadata.indkey[0]
    WHERE index_namespace.nspname = 'public'
      AND index_class.relname = 'idx_tender_analysis_intake_events_run'
      AND index_class.relkind = 'i'
      AND index_metadata.indrelid = ledger_oid
      AND NOT index_metadata.indisunique
      AND NOT index_metadata.indisprimary
      AND index_metadata.indisvalid
      AND index_metadata.indisready
      AND index_metadata.indnkeyatts = 1
      AND index_metadata.indnatts = 1
      AND index_metadata.indpred IS NULL
      AND first_key.attname = 'analysis_run_id'
      AND pg_catalog.pg_get_indexdef(index_metadata.indexrelid, 1, true) = 'analysis_run_id'
  ) THEN
    RAISE EXCEPTION
      'Migration postcondition failed: idx_tender_analysis_intake_events_run has incompatible definition';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS index_class
    JOIN pg_catalog.pg_namespace AS index_namespace
      ON index_namespace.oid = index_class.relnamespace
    JOIN pg_catalog.pg_index AS index_metadata
      ON index_metadata.indexrelid = index_class.oid
    JOIN pg_catalog.pg_attribute AS first_key
      ON first_key.attrelid = index_metadata.indrelid
     AND first_key.attnum = index_metadata.indkey[0]
    JOIN pg_catalog.pg_attribute AS second_key
      ON second_key.attrelid = index_metadata.indrelid
     AND second_key.attnum = index_metadata.indkey[1]
    WHERE index_namespace.nspname = 'public'
      AND index_class.relname = 'idx_tender_analysis_intake_events_status_started'
      AND index_class.relkind = 'i'
      AND index_metadata.indrelid = ledger_oid
      AND NOT index_metadata.indisunique
      AND NOT index_metadata.indisprimary
      AND index_metadata.indisvalid
      AND index_metadata.indisready
      AND index_metadata.indnkeyatts = 2
      AND index_metadata.indnatts = 2
      AND index_metadata.indpred IS NULL
      AND first_key.attname = 'status'
      AND second_key.attname = 'processing_started_at'
      AND pg_catalog.pg_get_indexdef(index_metadata.indexrelid, 1, true) = 'status'
      AND pg_catalog.pg_get_indexdef(index_metadata.indexrelid, 2, true) = 'processing_started_at'
  ) THEN
    RAISE EXCEPTION
      'Migration postcondition failed: idx_tender_analysis_intake_events_status_started has incompatible definition';
  END IF;
END
$postconditions$;

COMMIT;
