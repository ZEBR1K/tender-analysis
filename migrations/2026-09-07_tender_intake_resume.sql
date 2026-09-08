BEGIN;

ALTER TABLE public.tender_analysis_runs
  ADD COLUMN IF NOT EXISTS superseded_at timestamptz;

ALTER TABLE public.tender_analysis_runs
  ADD COLUMN IF NOT EXISTS superseded_reason text;

DO $run_status_contract$
DECLARE
  runs_oid oid;
  status_attnum smallint;
  status_constraint record;
  status_constraint_count integer;
  current_values text[];
  current_allowed_values constant text[] := ARRAY[
    'aggregating',
    'completed',
    'created',
    'failed',
    'processing',
    'ready_for_aggregation'
  ]::text[];
  desired_allowed_values constant text[] := ARRAY[
    'aggregating',
    'completed',
    'created',
    'failed',
    'processing',
    'ready_for_aggregation',
    'superseded'
  ]::text[];
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
      'Run status contract failed: public.tender_analysis_runs is not a table';
  END IF;

  SELECT column_row.attnum
  INTO status_attnum
  FROM pg_catalog.pg_attribute AS column_row
  WHERE column_row.attrelid = runs_oid
    AND column_row.attname = 'status'
    AND column_row.attnum > 0
    AND NOT column_row.attisdropped;

  IF status_attnum IS NULL THEN
    RAISE EXCEPTION
      'Run status contract failed: public.tender_analysis_runs.status is absent';
  END IF;

  SELECT count(*)
  INTO status_constraint_count
  FROM pg_catalog.pg_constraint AS constraint_row
  WHERE constraint_row.conrelid = runs_oid
    AND constraint_row.contype = 'c'
    AND constraint_row.conkey = ARRAY[status_attnum]::smallint[];

  IF status_constraint_count <> 1 THEN
    RAISE EXCEPTION
      'Run status contract failed: expected exactly one status-only CHECK, found %',
      status_constraint_count;
  END IF;

  SELECT
    constraint_row.oid,
    constraint_row.conname,
    constraint_row.convalidated,
    COALESCE(
      (pg_catalog.to_jsonb(constraint_row) ->> 'conenforced')::boolean,
      true
    ) AS conenforced,
    pg_catalog.pg_get_constraintdef(constraint_row.oid, true) AS definition
  INTO status_constraint
  FROM pg_catalog.pg_constraint AS constraint_row
  WHERE constraint_row.conrelid = runs_oid
    AND constraint_row.contype = 'c'
    AND constraint_row.conkey = ARRAY[status_attnum]::smallint[];

  SELECT ARRAY(
    SELECT (captured.value)[1]
    FROM pg_catalog.regexp_matches(
      lower(status_constraint.definition),
      '''([^'']+)''',
      'g'
    ) AS captured(value)
    ORDER BY (captured.value)[1]
  )
  INTO current_values;

  IF NOT status_constraint.convalidated
     OR NOT status_constraint.conenforced
     OR status_constraint.definition
          !~* 'status[[:space:]]*=[[:space:]]*ANY[[:space:]]*[(][[:space:]]*ARRAY'
     OR status_constraint.definition ~* '[[:<:]](AND|OR)[[:>:]]'
     OR current_values NOT IN (current_allowed_values, desired_allowed_values)
  THEN
    RAISE EXCEPTION
      'Run status contract failed: authoritative status CHECK has incompatible semantics';
  END IF;

  IF current_values = current_allowed_values THEN
    EXECUTE format(
      'ALTER TABLE public.tender_analysis_runs DROP CONSTRAINT %I',
      status_constraint.conname
    );
    EXECUTE format(
      'ALTER TABLE public.tender_analysis_runs ADD CONSTRAINT %I CHECK (status IN (%L, %L, %L, %L, %L, %L, %L))',
      status_constraint.conname,
      'created',
      'processing',
      'ready_for_aggregation',
      'aggregating',
      'completed',
      'failed',
      'superseded'
    );
  END IF;
END
$run_status_contract$;

DO $active_run_index_upgrade$
DECLARE
  runs_oid oid;
  existing_object_oid oid;
  existing_index_schema text;
  existing_index_name text;
  normalized_predicate text;
  index_definition_kind text;
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
      'Active-run index upgrade failed: public.tender_analysis_runs is not a table';
  END IF;

  SELECT
    existing_object.oid,
    existing_namespace.nspname,
    existing_object.relname
  INTO
    existing_object_oid,
    existing_index_schema,
    existing_index_name
  FROM pg_catalog.pg_class AS existing_object
  JOIN pg_catalog.pg_namespace AS existing_namespace
    ON existing_namespace.oid = existing_object.relnamespace
  WHERE existing_namespace.nspname = 'public'
    AND existing_object.relname = 'uq_tender_analysis_runs_one_unfinished';

  IF existing_object_oid IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_class AS index_class
      JOIN pg_catalog.pg_namespace AS index_namespace
        ON index_namespace.oid = index_class.relnamespace
      JOIN pg_catalog.pg_index AS index_metadata
        ON index_metadata.indexrelid = index_class.oid
      JOIN pg_catalog.pg_am AS index_method
        ON index_method.oid = index_class.relam
      JOIN pg_catalog.pg_attribute AS first_key
        ON first_key.attrelid = index_metadata.indrelid
       AND first_key.attnum = index_metadata.indkey[0]
      JOIN pg_catalog.pg_attribute AS second_key
        ON second_key.attrelid = index_metadata.indrelid
       AND second_key.attnum = index_metadata.indkey[1]
      WHERE index_class.oid = existing_object_oid
        AND index_namespace.nspname = 'public'
        AND index_class.relname = 'uq_tender_analysis_runs_one_unfinished'
        AND index_class.relkind = 'i'
        AND index_class.relpersistence = 'p'
        AND index_method.amname = 'btree'
        AND index_metadata.indrelid = runs_oid
        AND index_metadata.indisunique
        AND NOT index_metadata.indisprimary
        AND NOT index_metadata.indisexclusion
        AND index_metadata.indisvalid
        AND index_metadata.indisready
        AND index_metadata.indislive
        AND index_metadata.indnkeyatts = 2
        AND index_metadata.indnatts = 2
        AND COALESCE(
          (
            pg_catalog.to_jsonb(index_metadata)
              ->> 'indnullsnotdistinct'
          )::boolean,
          false
        ) = false
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
        ) IN (
          'status<>''completed''',
          'status<>allarray[''completed'',''superseded'']'
        )
    ) THEN
      RAISE EXCEPTION
        'Active-run index upgrade failed: uq_tender_analysis_runs_one_unfinished has incompatible definition';
    END IF;

    SELECT replace(
      pg_catalog.regexp_replace(
        lower(pg_catalog.pg_get_expr(index_metadata.indpred, index_metadata.indrelid)),
        '[[:space:]()]',
        '',
        'g'
      ),
      '::text',
      ''
    )
    INTO normalized_predicate
    FROM pg_catalog.pg_index AS index_metadata
    WHERE index_metadata.indexrelid = existing_object_oid;

    IF normalized_predicate = 'status<>''completed''' THEN
      index_definition_kind := 'legacy';
    ELSIF normalized_predicate = 'status<>allarray[''completed'',''superseded'']' THEN
      index_definition_kind := 'current';
    ELSE
      RAISE EXCEPTION
        'Active-run index upgrade failed: uq_tender_analysis_runs_one_unfinished has incompatible definition';
    END IF;

    IF index_definition_kind = 'legacy' THEN
      EXECUTE format(
        'DROP INDEX %I.%I',
        existing_index_schema,
        existing_index_name
      );
    END IF;
  END IF;
END
$active_run_index_upgrade$;

DO $legacy_reconciliation$
DECLARE
  duplicate_group_count integer;
  changed_count integer;
BEGIN
  SELECT count(*)
  INTO duplicate_group_count
  FROM (
    SELECT source, tender_id
    FROM public.tender_analysis_runs
    WHERE status NOT IN ('completed', 'superseded')
    GROUP BY source, tender_id
    HAVING count(*) > 1
  ) AS duplicate_groups;

  IF duplicate_group_count > 0 THEN
    IF EXISTS (
      WITH approved_groups (source, tender_id) AS (
        VALUES
          ('manual_test'::text, 'manual-calibration-167-26-ZO'::text),
          ('tenderplan'::text, '6a7af04c3951804ff31b66a6'::text),
          ('tenderplan'::text, '6a7ef6ac3951804ff32da751'::text)
      ),
      active_duplicate_groups AS (
        SELECT source, tender_id
        FROM public.tender_analysis_runs
        WHERE status NOT IN ('completed', 'superseded')
        GROUP BY source, tender_id
        HAVING count(*) > 1
      )
      SELECT 1
      FROM active_duplicate_groups AS actual
      LEFT JOIN approved_groups AS approved
        USING (source, tender_id)
      WHERE approved.source IS NULL
    ) THEN
      RAISE EXCEPTION
        'Legacy reconciliation aborted: an unexpected active duplicate group exists';
    END IF;

    IF EXISTS (
      WITH approved_groups (source, tender_id, expected_count, cutoff) AS (
        VALUES
          (
            'manual_test'::text,
            'manual-calibration-167-26-ZO'::text,
            24::bigint,
            '2026-09-07T05:59:14.629399+00:00'::timestamptz
          ),
          (
            'tenderplan'::text,
            '6a7af04c3951804ff31b66a6'::text,
            50::bigint,
            '2026-08-17T18:50:41.678699+00:00'::timestamptz
          ),
          (
            'tenderplan'::text,
            '6a7ef6ac3951804ff32da751'::text,
            12::bigint,
            '2026-08-23T16:29:52.779826+00:00'::timestamptz
          )
      )
      SELECT 1
      FROM approved_groups AS approved
      CROSS JOIN LATERAL (
        SELECT
          count(*) AS eligible_count,
          max(run.created_at) AS eligible_max_created_at
        FROM public.tender_analysis_runs AS run
        WHERE run.source = approved.source
          AND run.tender_id = approved.tender_id
          AND run.created_at <= approved.cutoff
          AND run.status NOT IN ('completed', 'superseded')
      ) AS actual
      WHERE actual.eligible_count <> approved.expected_count
         OR actual.eligible_max_created_at <> approved.cutoff
    ) THEN
      RAISE EXCEPTION
        'Legacy reconciliation aborted: bounded group counts or cutoffs do not match the approved shape';
    END IF;

    WITH approved_groups (source, tender_id, cutoff) AS (
      VALUES
        (
          'manual_test'::text,
          'manual-calibration-167-26-ZO'::text,
          '2026-09-07T05:59:14.629399+00:00'::timestamptz
        ),
        (
          'tenderplan'::text,
          '6a7af04c3951804ff31b66a6'::text,
          '2026-08-17T18:50:41.678699+00:00'::timestamptz
        ),
        (
          'tenderplan'::text,
          '6a7ef6ac3951804ff32da751'::text,
          '2026-08-23T16:29:52.779826+00:00'::timestamptz
        )
    )
    UPDATE public.tender_analysis_runs AS run
    SET
      status = 'superseded',
      superseded_at = NOW(),
      superseded_reason = 'legacy_duplicate_reconciliation_approved_2026-09-08',
      updated_at = NOW()
    FROM approved_groups AS approved
    WHERE run.source = approved.source
      AND run.tender_id = approved.tender_id
      AND run.created_at <= approved.cutoff
      AND run.status NOT IN ('completed', 'superseded');

    GET DIAGNOSTICS changed_count = ROW_COUNT;

    IF changed_count <> 86 THEN
      RAISE EXCEPTION
        'Legacy reconciliation aborted: expected 86 changed rows, changed %',
        changed_count;
    END IF;
  END IF;
END
$legacy_reconciliation$;

DO $duplicate_preflight$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.tender_analysis_runs
    WHERE status NOT IN ('completed', 'superseded')
    GROUP BY source, tender_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Cannot enforce one unfinished run: duplicate (source, tender_id) rows exist';
  END IF;
END
$duplicate_preflight$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_tender_analysis_runs_one_unfinished
  ON public.tender_analysis_runs (source, tender_id)
  WHERE status NOT IN ('completed', 'superseded');

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
  run_status_attnum smallint;
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

  IF EXISTS (
    WITH expected_columns (column_name, udt_name, is_nullable) AS (
      VALUES
        ('superseded_at'::text, 'timestamptz'::text, 'YES'::text),
        ('superseded_reason'::text, 'text'::text, 'YES'::text)
    )
    SELECT 1
    FROM expected_columns AS expected
    LEFT JOIN information_schema.columns AS actual
      ON actual.table_schema = 'public'
     AND actual.table_name = 'tender_analysis_runs'
     AND actual.column_name = expected.column_name
    WHERE actual.column_name IS NULL
       OR actual.udt_name IS DISTINCT FROM expected.udt_name
       OR actual.is_nullable IS DISTINCT FROM expected.is_nullable
       OR actual.column_default IS NOT NULL
  ) THEN
    RAISE EXCEPTION
      'Migration postcondition failed: tender_analysis_runs superseded audit columns are incompatible';
  END IF;

  SELECT column_row.attnum
  INTO run_status_attnum
  FROM pg_catalog.pg_attribute AS column_row
  WHERE column_row.attrelid = runs_oid
    AND column_row.attname = 'status'
    AND column_row.attnum > 0
    AND NOT column_row.attisdropped;

  IF run_status_attnum IS NULL OR (
    SELECT count(*)
    FROM pg_catalog.pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = runs_oid
      AND constraint_row.contype = 'c'
      AND constraint_row.conkey = ARRAY[run_status_attnum]::smallint[]
  ) <> 1 OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = runs_oid
      AND constraint_row.contype = 'c'
      AND constraint_row.conkey = ARRAY[run_status_attnum]::smallint[]
      AND constraint_row.convalidated
      AND COALESCE(
        (
          pg_catalog.to_jsonb(constraint_row)
            ->> 'conenforced'
        )::boolean,
        true
      )
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
      ) = ARRAY[
        'aggregating',
        'completed',
        'created',
        'failed',
        'processing',
        'ready_for_aggregation',
        'superseded'
      ]::text[]
  ) THEN
    RAISE EXCEPTION
      'Migration postcondition failed: tender_analysis_runs status CHECK is incompatible';
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
      ) = 'status<>allarray[''completed'',''superseded'']'
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
      AND COALESCE(
        (
          pg_catalog.to_jsonb(constraint_row)
            ->> 'conenforced'
        )::boolean,
        true
      )
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
      AND COALESCE(
        (
          pg_catalog.to_jsonb(constraint_row)
            ->> 'conenforced'
        )::boolean,
        true
      )
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
      AND COALESCE(
        (
          pg_catalog.to_jsonb(constraint_row)
            ->> 'conenforced'
        )::boolean,
        true
      )
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
      AND COALESCE(
        (
          pg_catalog.to_jsonb(constraint_row)
            ->> 'conenforced'
        )::boolean,
        true
      )
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
