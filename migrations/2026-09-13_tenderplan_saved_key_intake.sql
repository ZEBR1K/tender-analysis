BEGIN;

DO $migration$
DECLARE
  ledger_oid oid;
  trigger_attnum smallint;
  check_count integer;
  trigger_check record;
  current_values text[];
BEGIN
  SELECT table_row.oid, column_row.attnum
  INTO ledger_oid, trigger_attnum
  FROM pg_catalog.pg_class AS table_row
  JOIN pg_catalog.pg_namespace AS namespace_row
    ON namespace_row.oid = table_row.relnamespace
  JOIN pg_catalog.pg_attribute AS column_row
    ON column_row.attrelid = table_row.oid
   AND column_row.attname = 'trigger_kind'
   AND NOT column_row.attisdropped
  WHERE namespace_row.nspname = 'public'
    AND table_row.relname = 'tender_analysis_intake_events'
    AND table_row.relkind = 'r';

  IF ledger_oid IS NULL OR trigger_attnum IS NULL THEN
    RAISE EXCEPTION 'Saved-key intake migration requires public.tender_analysis_intake_events.trigger_kind';
  END IF;

  SELECT count(*)
  INTO check_count
  FROM pg_catalog.pg_constraint AS constraint_row
  WHERE constraint_row.conrelid = ledger_oid
    AND constraint_row.contype = 'c'
    AND constraint_row.conkey = ARRAY[trigger_attnum]::smallint[];

  IF check_count <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one trigger_kind-only CHECK, found %', check_count;
  END IF;

  SELECT
    constraint_row.conname,
    constraint_row.convalidated,
    COALESCE((pg_catalog.to_jsonb(constraint_row) ->> 'conenforced')::boolean, true) AS conenforced,
    pg_catalog.pg_get_constraintdef(constraint_row.oid, true) AS definition
  INTO trigger_check
  FROM pg_catalog.pg_constraint AS constraint_row
  WHERE constraint_row.conrelid = ledger_oid
    AND constraint_row.contype = 'c'
    AND constraint_row.conkey = ARRAY[trigger_attnum]::smallint[];

  SELECT ARRAY(
    SELECT (captured.value)[1]
    FROM pg_catalog.regexp_matches(lower(trigger_check.definition), '''([^'']+)''', 'g') AS captured(value)
    ORDER BY (captured.value)[1]
  ) INTO current_values;

  IF NOT trigger_check.convalidated
     OR NOT trigger_check.conenforced
     OR trigger_check.definition ~* '[[:<:]](AND|OR)[[:>:]]'
     OR (
       current_values <> ARRAY['manual', 'recovery_scan', 'tenderplan_mark']::text[]
       AND current_values <> ARRAY['manual', 'recovery_scan', 'tenderplan_key', 'tenderplan_mark']::text[]
     )
  THEN
    RAISE EXCEPTION 'Existing trigger_kind CHECK has unknown semantics: %', trigger_check.definition;
  END IF;

  IF current_values = ARRAY['manual', 'recovery_scan', 'tenderplan_mark']::text[] THEN
    EXECUTE format(
      'ALTER TABLE public.tender_analysis_intake_events DROP CONSTRAINT %I',
      trigger_check.conname
    );
    EXECUTE format(
      'ALTER TABLE public.tender_analysis_intake_events ADD CONSTRAINT %I CHECK (trigger_kind IN (%L, %L, %L, %L))',
      trigger_check.conname,
      'tenderplan_mark',
      'tenderplan_key',
      'recovery_scan',
      'manual'
    );
  END IF;
END
$migration$;

DO $postcondition$
DECLARE
  actual_values text[];
BEGIN
  SELECT ARRAY(
    SELECT (captured.value)[1]
    FROM pg_catalog.pg_constraint AS constraint_row
    JOIN pg_catalog.pg_class AS table_row
      ON table_row.oid = constraint_row.conrelid
    JOIN pg_catalog.pg_namespace AS namespace_row
      ON namespace_row.oid = table_row.relnamespace
    CROSS JOIN LATERAL pg_catalog.regexp_matches(
      lower(pg_catalog.pg_get_constraintdef(constraint_row.oid, true)),
      '''([^'']+)''',
      'g'
    ) AS captured(value)
    WHERE namespace_row.nspname = 'public'
      AND table_row.relname = 'tender_analysis_intake_events'
      AND constraint_row.contype = 'c'
      AND pg_catalog.pg_get_constraintdef(constraint_row.oid, true) ~* 'trigger_kind'
    ORDER BY (captured.value)[1]
  ) INTO actual_values;

  IF actual_values <> ARRAY['manual', 'recovery_scan', 'tenderplan_key', 'tenderplan_mark']::text[] THEN
    RAISE EXCEPTION 'Saved-key intake migration postcondition failed: %', actual_values;
  END IF;
END
$postcondition$;

COMMIT;
