BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $canonical_preconditions$
DECLARE
  table_contract record;
  table_oid oid;
  actual_columns text[];
  actual_primary_key text[];
  primary_key_count integer;
  optional_count integer;
BEGIN
  IF EXISTS (
    WITH expected(table_name) AS (
      VALUES
        ('tender_analysis_runs'::text),
        ('tender_analysis_documents'::text),
        ('tender_analysis_units'::text),
        ('tender_analysis_facts'::text),
        ('tender_analysis_field_results'::text)
    )
    SELECT 1
    FROM expected
    LEFT JOIN pg_catalog.pg_namespace AS table_namespace
      ON table_namespace.nspname = 'public'
    LEFT JOIN pg_catalog.pg_class AS table_class
      ON table_class.relnamespace = table_namespace.oid
     AND table_class.relname = expected.table_name
    WHERE table_class.oid IS NULL
       OR table_class.relkind NOT IN ('r', 'p')
       OR table_class.relpersistence <> 'p'
  ) THEN
    RAISE EXCEPTION
      'Canonical parent contract failed: all five public tender analysis objects must be permanent tables';
  END IF;

  FOR table_contract IN
    SELECT *
    FROM (
      VALUES
        (
          'tender_analysis_runs'::text,
          ARRAY[
            'id:uuid:NO', 'source:text:NO', 'tender_id:text:NO',
            'tender_number:text:YES', 'tender_external_id:text:YES', 'status:text:NO',
            'documents_total:int4:NO', 'tender_meta:jsonb:NO', 'error_message:text:YES',
            'created_at:timestamptz:NO', 'started_at:timestamptz:NO',
            'updated_at:timestamptz:NO', 'ready_at:timestamptz:YES',
            'aggregation_started_at:timestamptz:YES', 'completed_at:timestamptz:YES'
          ]::text[],
          ARRAY['superseded_at:timestamptz:YES', 'superseded_reason:text:YES']::text[],
          ARRAY['id']::text[]
        ),
        (
          'tender_analysis_documents'::text,
          ARRAY[
            'id:uuid:NO', 'analysis_run_id:uuid:NO', 'document_index:int4:NO',
            'file_name:text:YES', 'file_extension:text:YES', 'display_name:text:YES',
            'download_url:text:YES', 'publication_at:timestamptz:YES',
            'source_size:int8:YES', 'mime_type:text:YES', 'file_size:int8:YES',
            'status:text:NO', 'attempts:int4:NO', 'n8n_execution_id:text:YES',
            'units_total:int4:YES', 'facts_count:int4:YES', 'error_message:text:YES',
            'created_at:timestamptz:NO', 'updated_at:timestamptz:NO',
            'started_at:timestamptz:YES', 'completed_at:timestamptz:YES'
          ]::text[],
          ARRAY['ingestion_metadata:jsonb:NO']::text[],
          ARRAY['id']::text[]
        ),
        (
          'tender_analysis_units'::text,
          ARRAY[
            'id:uuid:NO', 'analysis_run_id:uuid:NO', 'document_id:uuid:NO',
            'analysis_unit_id:text:NO', 'unit_index:int4:YES', 'units_total:int4:YES',
            'section_id:text:YES', 'section_title:text:YES', 'section_kind:text:YES',
            'part_index:int4:YES', 'parts_total:int4:YES', 'source_pages:jsonb:NO',
            'analysis_unit:jsonb:NO', 'ai_segments:jsonb:NO', 'provenance:jsonb:NO',
            'created_at:timestamptz:NO', 'updated_at:timestamptz:NO'
          ]::text[],
          ARRAY[]::text[],
          ARRAY['id']::text[]
        ),
        (
          'tender_analysis_facts'::text,
          ARRAY[
            'id:uuid:NO', 'analysis_run_id:uuid:NO', 'document_id:uuid:NO',
            'analysis_unit_id:text:NO', 'fact_index:int4:NO',
            'field_catalog_version:text:NO', 'field_key:text:NO', 'value_text:text:NO',
            'extractor_status:text:NO', 'extractor_confidence:float8:NO',
            'extractor_review_reason_code:text:YES', 'extractor_review_note:text:YES',
            'validator_verdict:text:NO', 'validator_confidence:float8:NO',
            'validator_reason_code:text:YES', 'validator_reason_note:text:YES',
            'evidence:jsonb:NO', 'extractor_meta:jsonb:NO', 'validator_meta:jsonb:NO',
            'created_at:timestamptz:NO', 'updated_at:timestamptz:NO'
          ]::text[],
          ARRAY[]::text[],
          ARRAY['id']::text[]
        ),
        (
          'tender_analysis_field_results'::text,
          ARRAY[
            'analysis_run_id:uuid:NO', 'field_catalog_version:text:NO',
            'result_contract_version:text:NO', 'field_index:int2:NO',
            'field_key:text:NO', 'status:text:NO', 'value_text:text:YES',
            'confidence:numeric:YES', 'requires_human_review:bool:NO',
            'resolution_method:text:NO', 'result_json:jsonb:NO',
            'created_at:timestamptz:NO', 'updated_at:timestamptz:NO'
          ]::text[],
          ARRAY[]::text[],
          ARRAY['analysis_run_id', 'field_key']::text[]
        )
    ) AS contracts(table_name, required_columns, optional_columns, primary_key_columns)
  LOOP
    SELECT table_class.oid
    INTO table_oid
    FROM pg_catalog.pg_class AS table_class
    JOIN pg_catalog.pg_namespace AS table_namespace
      ON table_namespace.oid = table_class.relnamespace
    WHERE table_namespace.nspname = 'public'
      AND table_class.relname = table_contract.table_name
      AND table_class.relkind IN ('r', 'p')
      AND table_class.relpersistence = 'p';

    SELECT array_agg(
      column_row.column_name || ':' || column_row.udt_name || ':' || column_row.is_nullable
      ORDER BY column_row.ordinal_position
    )
    INTO actual_columns
    FROM information_schema.columns AS column_row
    WHERE column_row.table_schema = 'public'
      AND column_row.table_name = table_contract.table_name;

    IF EXISTS (
      (SELECT unnest(table_contract.required_columns)
       EXCEPT
       SELECT unnest(actual_columns))
      UNION ALL
      (SELECT unnest(actual_columns)
       EXCEPT
       SELECT unnest(table_contract.required_columns || table_contract.optional_columns))
    ) THEN
      RAISE EXCEPTION
        'Canonical parent contract failed: %.columns differ from the documented inventory',
        table_contract.table_name;
    END IF;

    SELECT count(*)
    INTO primary_key_count
    FROM pg_catalog.pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = table_oid
      AND constraint_row.contype = 'p';

    SELECT array_agg(attribute_row.attname ORDER BY key_column.ordinality)
    INTO actual_primary_key
    FROM pg_catalog.pg_constraint AS constraint_row
    CROSS JOIN LATERAL unnest(constraint_row.conkey)
      WITH ORDINALITY AS key_column(attnum, ordinality)
    JOIN pg_catalog.pg_attribute AS attribute_row
      ON attribute_row.attrelid = constraint_row.conrelid
     AND attribute_row.attnum = key_column.attnum
    WHERE constraint_row.conrelid = table_oid
      AND constraint_row.contype = 'p'
      AND constraint_row.convalidated
      AND NOT constraint_row.condeferrable
      AND NOT constraint_row.condeferred
      AND COALESCE(
        (pg_catalog.to_jsonb(constraint_row) ->> 'conenforced')::boolean,
        true
      );

    IF primary_key_count <> 1 OR actual_primary_key IS DISTINCT FROM table_contract.primary_key_columns THEN
      RAISE EXCEPTION
        'Canonical PRIMARY KEY contract failed for public.%',
        table_contract.table_name;
    END IF;
  END LOOP;

  SELECT count(*)
  INTO optional_count
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'tender_analysis_runs'
    AND column_name IN ('superseded_at', 'superseded_reason');

  IF optional_count NOT IN (0, 2) THEN
    RAISE EXCEPTION
      'Canonical parent contract failed: superseded audit columns must both be absent or both be present';
  END IF;
END
$canonical_preconditions$;

CREATE TABLE IF NOT EXISTS public.tender_agentic_jobs (
  id uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  analysis_run_id uuid NOT NULL,
  pipeline_version text NOT NULL,
  replicate_index smallint NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'created',
  model text NOT NULL,
  reasoning_effort text NOT NULL,
  field_catalog_version text NOT NULL,
  field_catalog_sha256 text NOT NULL,
  input_manifest_sha256 text,
  expected_documents integer NOT NULL,
  staged_documents integer NOT NULL DEFAULT 0,
  attempts smallint NOT NULL DEFAULT 0,
  dispatch_execution_id text,
  poll_owner_execution_id text,
  poll_claimed_at timestamptz,
  runner_started_at timestamptz,
  heartbeat_at timestamptz,
  completed_at timestamptz,
  input_tokens bigint,
  cached_input_tokens bigint,
  output_tokens bigint,
  reasoning_output_tokens bigint,
  artifacts jsonb NOT NULL DEFAULT '{}'::jsonb,
  validation_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_code text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tender_agentic_jobs_pkey PRIMARY KEY (id),
  CONSTRAINT tender_agentic_jobs_analysis_run_fk
    FOREIGN KEY (analysis_run_id)
    REFERENCES public.tender_analysis_runs (id)
    ON DELETE CASCADE,
  CONSTRAINT tender_agentic_jobs_run_pipeline_replicate_key
    UNIQUE (analysis_run_id, pipeline_version, replicate_index),
  CONSTRAINT tender_agentic_jobs_replicate_index_check CHECK (replicate_index >= 1),
  CONSTRAINT tender_agentic_jobs_status_check CHECK (
    status IN ('created', 'staging', 'ready', 'running', 'validating', 'completed', 'failed', 'canceled')
  ),
  CONSTRAINT tender_agentic_jobs_expected_documents_check CHECK (expected_documents >= 0),
  CONSTRAINT tender_agentic_jobs_staged_documents_check CHECK (staged_documents >= 0),
  CONSTRAINT tender_agentic_jobs_attempts_check CHECK (attempts BETWEEN 0 AND 2)
);

CREATE TABLE IF NOT EXISTS public.tender_agentic_documents (
  job_id uuid NOT NULL,
  source_document_id uuid NOT NULL,
  artifact_key text NOT NULL,
  document_index integer NOT NULL,
  file_name text,
  mime_type text,
  source_sha256 text,
  staged_sha256 text,
  byte_size bigint,
  status text NOT NULL DEFAULT 'pending',
  runner_storage_key text,
  error_code text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tender_agentic_documents_pkey PRIMARY KEY (job_id, source_document_id),
  CONSTRAINT tender_agentic_documents_job_fk
    FOREIGN KEY (job_id)
    REFERENCES public.tender_agentic_jobs (id)
    ON DELETE CASCADE,
  CONSTRAINT tender_agentic_documents_source_document_fk
    FOREIGN KEY (source_document_id)
    REFERENCES public.tender_analysis_documents (id)
    ON DELETE CASCADE,
  CONSTRAINT tender_agentic_documents_artifact_key_key UNIQUE (job_id, artifact_key),
  CONSTRAINT tender_agentic_documents_document_index_key UNIQUE (job_id, document_index),
  CONSTRAINT tender_agentic_documents_status_check CHECK (
    status IN ('pending', 'uploading', 'staged', 'failed')
  )
);

CREATE TABLE IF NOT EXISTS public.tender_agentic_field_results (
  job_id uuid NOT NULL,
  analysis_run_id uuid NOT NULL,
  field_catalog_version text NOT NULL,
  field_index smallint NOT NULL,
  field_key text NOT NULL,
  reported_status text NOT NULL,
  effective_status text NOT NULL,
  reported_value_text text,
  effective_value_text text,
  requires_human_review boolean NOT NULL,
  validation_level text NOT NULL,
  result_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tender_agentic_field_results_pkey PRIMARY KEY (job_id, field_key),
  CONSTRAINT tender_agentic_field_results_job_fk
    FOREIGN KEY (job_id)
    REFERENCES public.tender_agentic_jobs (id)
    ON DELETE CASCADE,
  CONSTRAINT tender_agentic_field_results_analysis_run_fk
    FOREIGN KEY (analysis_run_id)
    REFERENCES public.tender_analysis_runs (id)
    ON DELETE CASCADE,
  CONSTRAINT tender_agentic_field_results_field_index_key UNIQUE (job_id, field_index),
  CONSTRAINT tender_agentic_field_results_field_index_check CHECK (field_index BETWEEN 1 AND 27),
  CONSTRAINT tender_agentic_field_results_reported_status_check CHECK (
    reported_status IN ('resolved', 'requires_review', 'not_found')
  ),
  CONSTRAINT tender_agentic_field_results_effective_status_check CHECK (
    effective_status IN ('resolved', 'requires_review', 'not_found')
  ),
  CONSTRAINT tender_agentic_field_results_validation_level_check CHECK (
    validation_level IN ('pass', 'warning', 'downgraded')
  )
);

CREATE INDEX IF NOT EXISTS idx_tender_agentic_jobs_status_heartbeat
  ON public.tender_agentic_jobs (status, heartbeat_at);

CREATE INDEX IF NOT EXISTS idx_tender_agentic_jobs_poll_claimed
  ON public.tender_agentic_jobs (poll_claimed_at);

CREATE INDEX IF NOT EXISTS idx_tender_agentic_jobs_analysis_run
  ON public.tender_agentic_jobs (analysis_run_id);

DO $agentic_postconditions$
DECLARE
  table_contract record;
  table_oid oid;
  actual_columns text[];
  key_contract record;
  actual_key_columns text[];
  foreign_key_contract record;
  actual_referenced_columns text[];
  status_contract record;
  actual_status_values text[];
  sorted_expected_status_values text[];
  status_definition text;
  index_contract record;
  actual_index_columns text[];
BEGIN
  IF EXISTS (
    WITH expected(table_name) AS (
      VALUES
        ('tender_agentic_jobs'::text),
        ('tender_agentic_documents'::text),
        ('tender_agentic_field_results'::text)
    )
    SELECT 1
    FROM expected
    LEFT JOIN pg_catalog.pg_namespace AS table_namespace
      ON table_namespace.nspname = 'public'
    LEFT JOIN pg_catalog.pg_class AS table_class
      ON table_class.relnamespace = table_namespace.oid
     AND table_class.relname = expected.table_name
    WHERE table_class.oid IS NULL
       OR table_class.relkind NOT IN ('r', 'p')
       OR table_class.relpersistence <> 'p'
  ) THEN
    RAISE EXCEPTION
      'Agentic migration postcondition failed: all three shadow objects must be permanent tables';
  END IF;

  IF (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'tender_agentic_jobs') <> 29 THEN
    RAISE EXCEPTION 'Agentic migration postcondition failed: tender_agentic_jobs must have 29 columns';
  END IF;
  IF (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'tender_agentic_documents') <> 15 THEN
    RAISE EXCEPTION 'Agentic migration postcondition failed: tender_agentic_documents must have 15 columns';
  END IF;
  IF (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'tender_agentic_field_results') <> 14 THEN
    RAISE EXCEPTION 'Agentic migration postcondition failed: tender_agentic_field_results must have 14 columns';
  END IF;

  FOR table_contract IN
    SELECT *
    FROM (
      VALUES
        (
          'tender_agentic_jobs'::text,
          ARRAY[
            'id:uuid:NO:default', 'analysis_run_id:uuid:NO:none',
            'pipeline_version:text:NO:none', 'replicate_index:int2:NO:default',
            'status:text:NO:default', 'model:text:NO:none',
            'reasoning_effort:text:NO:none', 'field_catalog_version:text:NO:none',
            'field_catalog_sha256:text:NO:none', 'input_manifest_sha256:text:YES:none',
            'expected_documents:int4:NO:none', 'staged_documents:int4:NO:default',
            'attempts:int2:NO:default', 'dispatch_execution_id:text:YES:none',
            'poll_owner_execution_id:text:YES:none', 'poll_claimed_at:timestamptz:YES:none',
            'runner_started_at:timestamptz:YES:none', 'heartbeat_at:timestamptz:YES:none',
            'completed_at:timestamptz:YES:none', 'input_tokens:int8:YES:none',
            'cached_input_tokens:int8:YES:none', 'output_tokens:int8:YES:none',
            'reasoning_output_tokens:int8:YES:none', 'artifacts:jsonb:NO:default',
            'validation_summary:jsonb:NO:default', 'error_code:text:YES:none',
            'error_message:text:YES:none', 'created_at:timestamptz:NO:default',
            'updated_at:timestamptz:NO:default'
          ]::text[]
        ),
        (
          'tender_agentic_documents'::text,
          ARRAY[
            'job_id:uuid:NO:none', 'source_document_id:uuid:NO:none',
            'artifact_key:text:NO:none', 'document_index:int4:NO:none',
            'file_name:text:YES:none', 'mime_type:text:YES:none',
            'source_sha256:text:YES:none', 'staged_sha256:text:YES:none',
            'byte_size:int8:YES:none', 'status:text:NO:default',
            'runner_storage_key:text:YES:none', 'error_code:text:YES:none',
            'error_message:text:YES:none', 'created_at:timestamptz:NO:default',
            'updated_at:timestamptz:NO:default'
          ]::text[]
        ),
        (
          'tender_agentic_field_results'::text,
          ARRAY[
            'job_id:uuid:NO:none', 'analysis_run_id:uuid:NO:none',
            'field_catalog_version:text:NO:none', 'field_index:int2:NO:none',
            'field_key:text:NO:none', 'reported_status:text:NO:none',
            'effective_status:text:NO:none', 'reported_value_text:text:YES:none',
            'effective_value_text:text:YES:none', 'requires_human_review:bool:NO:none',
            'validation_level:text:NO:none', 'result_json:jsonb:NO:none',
            'created_at:timestamptz:NO:default', 'updated_at:timestamptz:NO:default'
          ]::text[]
        )
    ) AS contracts(table_name, expected_columns)
  LOOP
    SELECT array_agg(
      column_row.column_name || ':' || column_row.udt_name || ':' || column_row.is_nullable || ':' ||
      CASE WHEN column_row.column_default IS NULL THEN 'none' ELSE 'default' END
      ORDER BY column_row.ordinal_position
    )
    INTO actual_columns
    FROM information_schema.columns AS column_row
    WHERE column_row.table_schema = 'public'
      AND column_row.table_name = table_contract.table_name;

    IF actual_columns IS DISTINCT FROM table_contract.expected_columns THEN
      RAISE EXCEPTION
        'Agentic migration postcondition failed: %.columns differ from the planned contract',
        table_contract.table_name;
    END IF;
  END LOOP;

  IF EXISTS (
    WITH expected(table_name, column_name, allowed_defaults) AS (
      VALUES
        ('tender_agentic_jobs'::text, 'id'::text, ARRAY['gen_random_uuid()', 'pg_catalog.gen_random_uuid()']::text[]),
        ('tender_agentic_jobs', 'replicate_index', ARRAY['1', '1::smallint']::text[]),
        ('tender_agentic_jobs', 'status', ARRAY['''created''::text']::text[]),
        ('tender_agentic_jobs', 'staged_documents', ARRAY['0', '0::integer']::text[]),
        ('tender_agentic_jobs', 'attempts', ARRAY['0', '0::smallint']::text[]),
        ('tender_agentic_jobs', 'artifacts', ARRAY['''{}''::jsonb']::text[]),
        ('tender_agentic_jobs', 'validation_summary', ARRAY['''{}''::jsonb']::text[]),
        ('tender_agentic_jobs', 'created_at', ARRAY['now()']::text[]),
        ('tender_agentic_jobs', 'updated_at', ARRAY['now()']::text[]),
        ('tender_agentic_documents', 'status', ARRAY['''pending''::text']::text[]),
        ('tender_agentic_documents', 'created_at', ARRAY['now()']::text[]),
        ('tender_agentic_documents', 'updated_at', ARRAY['now()']::text[]),
        ('tender_agentic_field_results', 'created_at', ARRAY['now()']::text[]),
        ('tender_agentic_field_results', 'updated_at', ARRAY['now()']::text[])
    )
    SELECT 1
    FROM expected
    JOIN information_schema.columns AS actual
      ON actual.table_schema = 'public'
     AND actual.table_name = expected.table_name
     AND actual.column_name = expected.column_name
    WHERE pg_catalog.regexp_replace(lower(actual.column_default), '[[:space:]]', '', 'g')
          <> ALL (expected.allowed_defaults)
  ) THEN
    RAISE EXCEPTION
      'Agentic migration postcondition failed: one or more column defaults differ from the planned contract';
  END IF;

  IF EXISTS (
    WITH expected(table_name, constraint_name, constraint_type) AS (
      VALUES
        ('tender_agentic_jobs'::text, 'tender_agentic_jobs_pkey'::text, 'p'::text),
        ('tender_agentic_jobs', 'tender_agentic_jobs_analysis_run_fk', 'f'),
        ('tender_agentic_jobs', 'tender_agentic_jobs_run_pipeline_replicate_key', 'u'),
        ('tender_agentic_jobs', 'tender_agentic_jobs_replicate_index_check', 'c'),
        ('tender_agentic_jobs', 'tender_agentic_jobs_status_check', 'c'),
        ('tender_agentic_jobs', 'tender_agentic_jobs_expected_documents_check', 'c'),
        ('tender_agentic_jobs', 'tender_agentic_jobs_staged_documents_check', 'c'),
        ('tender_agentic_jobs', 'tender_agentic_jobs_attempts_check', 'c'),
        ('tender_agentic_documents', 'tender_agentic_documents_pkey', 'p'),
        ('tender_agentic_documents', 'tender_agentic_documents_job_fk', 'f'),
        ('tender_agentic_documents', 'tender_agentic_documents_source_document_fk', 'f'),
        ('tender_agentic_documents', 'tender_agentic_documents_artifact_key_key', 'u'),
        ('tender_agentic_documents', 'tender_agentic_documents_document_index_key', 'u'),
        ('tender_agentic_documents', 'tender_agentic_documents_status_check', 'c'),
        ('tender_agentic_field_results', 'tender_agentic_field_results_pkey', 'p'),
        ('tender_agentic_field_results', 'tender_agentic_field_results_job_fk', 'f'),
        ('tender_agentic_field_results', 'tender_agentic_field_results_analysis_run_fk', 'f'),
        ('tender_agentic_field_results', 'tender_agentic_field_results_field_index_key', 'u'),
        ('tender_agentic_field_results', 'tender_agentic_field_results_field_index_check', 'c'),
        ('tender_agentic_field_results', 'tender_agentic_field_results_reported_status_check', 'c'),
        ('tender_agentic_field_results', 'tender_agentic_field_results_effective_status_check', 'c'),
        ('tender_agentic_field_results', 'tender_agentic_field_results_validation_level_check', 'c')
    ),
    actual AS (
      SELECT table_class.relname, constraint_row.conname, constraint_row.contype::text
      FROM pg_catalog.pg_constraint AS constraint_row
      JOIN pg_catalog.pg_class AS table_class
        ON table_class.oid = constraint_row.conrelid
      JOIN pg_catalog.pg_namespace AS table_namespace
        ON table_namespace.oid = table_class.relnamespace
      WHERE table_namespace.nspname = 'public'
        AND table_class.relname IN (
          'tender_agentic_jobs',
          'tender_agentic_documents',
          'tender_agentic_field_results'
        )
    )
    (SELECT * FROM expected EXCEPT SELECT * FROM actual)
    UNION ALL
    (SELECT * FROM actual EXCEPT SELECT * FROM expected)
  ) THEN
    RAISE EXCEPTION
      'Agentic migration postcondition failed: constraint inventory differs from the planned contract';
  END IF;

  FOR key_contract IN
    SELECT *
    FROM (
      VALUES
        ('tender_agentic_jobs'::text, 'tender_agentic_jobs_pkey'::text, 'p'::text, ARRAY['id']::text[]),
        ('tender_agentic_jobs', 'tender_agentic_jobs_run_pipeline_replicate_key', 'u', ARRAY['analysis_run_id', 'pipeline_version', 'replicate_index']::text[]),
        ('tender_agentic_documents', 'tender_agentic_documents_pkey', 'p', ARRAY['job_id', 'source_document_id']::text[]),
        ('tender_agentic_documents', 'tender_agentic_documents_artifact_key_key', 'u', ARRAY['job_id', 'artifact_key']::text[]),
        ('tender_agentic_documents', 'tender_agentic_documents_document_index_key', 'u', ARRAY['job_id', 'document_index']::text[]),
        ('tender_agentic_field_results', 'tender_agentic_field_results_pkey', 'p', ARRAY['job_id', 'field_key']::text[]),
        ('tender_agentic_field_results', 'tender_agentic_field_results_field_index_key', 'u', ARRAY['job_id', 'field_index']::text[])
    ) AS keys(table_name, constraint_name, constraint_type, expected_columns)
  LOOP
    SELECT table_class.oid
    INTO table_oid
    FROM pg_catalog.pg_class AS table_class
    JOIN pg_catalog.pg_namespace AS table_namespace
      ON table_namespace.oid = table_class.relnamespace
    WHERE table_namespace.nspname = 'public'
      AND table_class.relname = key_contract.table_name;

    SELECT array_agg(attribute_row.attname ORDER BY key_column.ordinality)
    INTO actual_key_columns
    FROM pg_catalog.pg_constraint AS constraint_row
    CROSS JOIN LATERAL unnest(constraint_row.conkey)
      WITH ORDINALITY AS key_column(attnum, ordinality)
    JOIN pg_catalog.pg_attribute AS attribute_row
      ON attribute_row.attrelid = constraint_row.conrelid
     AND attribute_row.attnum = key_column.attnum
    WHERE constraint_row.conrelid = table_oid
      AND constraint_row.conname = key_contract.constraint_name
      AND constraint_row.contype::text = key_contract.constraint_type
      AND constraint_row.convalidated
      AND NOT constraint_row.condeferrable
      AND NOT constraint_row.condeferred
      AND COALESCE(
        (pg_catalog.to_jsonb(constraint_row) ->> 'conenforced')::boolean,
        true
      );

    IF actual_key_columns IS DISTINCT FROM key_contract.expected_columns THEN
      RAISE EXCEPTION
        'Agentic migration postcondition failed: key constraint % differs from the planned contract',
        key_contract.constraint_name;
    END IF;
  END LOOP;

  FOR foreign_key_contract IN
    SELECT *
    FROM (
      VALUES
        ('tender_agentic_jobs'::text, 'tender_agentic_jobs_analysis_run_fk'::text, ARRAY['analysis_run_id']::text[], 'tender_analysis_runs'::text, ARRAY['id']::text[]),
        ('tender_agentic_documents', 'tender_agentic_documents_job_fk', ARRAY['job_id']::text[], 'tender_agentic_jobs', ARRAY['id']::text[]),
        ('tender_agentic_documents', 'tender_agentic_documents_source_document_fk', ARRAY['source_document_id']::text[], 'tender_analysis_documents', ARRAY['id']::text[]),
        ('tender_agentic_field_results', 'tender_agentic_field_results_job_fk', ARRAY['job_id']::text[], 'tender_agentic_jobs', ARRAY['id']::text[]),
        ('tender_agentic_field_results', 'tender_agentic_field_results_analysis_run_fk', ARRAY['analysis_run_id']::text[], 'tender_analysis_runs', ARRAY['id']::text[])
    ) AS foreign_keys(table_name, constraint_name, expected_columns, referenced_table, expected_referenced_columns)
  LOOP
    SELECT
      array_agg(source_attribute.attname ORDER BY source_key.ordinality),
      array_agg(referenced_attribute.attname ORDER BY source_key.ordinality)
    INTO actual_key_columns, actual_referenced_columns
    FROM pg_catalog.pg_constraint AS constraint_row
    JOIN pg_catalog.pg_class AS source_table
      ON source_table.oid = constraint_row.conrelid
    JOIN pg_catalog.pg_namespace AS source_namespace
      ON source_namespace.oid = source_table.relnamespace
    JOIN pg_catalog.pg_class AS referenced_table
      ON referenced_table.oid = constraint_row.confrelid
    JOIN pg_catalog.pg_namespace AS referenced_namespace
      ON referenced_namespace.oid = referenced_table.relnamespace
    CROSS JOIN LATERAL unnest(constraint_row.conkey, constraint_row.confkey)
      WITH ORDINALITY AS source_key(source_attnum, referenced_attnum, ordinality)
    JOIN pg_catalog.pg_attribute AS source_attribute
      ON source_attribute.attrelid = source_table.oid
     AND source_attribute.attnum = source_key.source_attnum
    JOIN pg_catalog.pg_attribute AS referenced_attribute
      ON referenced_attribute.attrelid = referenced_table.oid
     AND referenced_attribute.attnum = source_key.referenced_attnum
    WHERE source_namespace.nspname = 'public'
      AND source_table.relname = foreign_key_contract.table_name
      AND constraint_row.conname = foreign_key_contract.constraint_name
      AND constraint_row.contype = 'f'
      AND referenced_namespace.nspname = 'public'
      AND referenced_table.relname = foreign_key_contract.referenced_table
      AND constraint_row.confupdtype = 'a'
      AND constraint_row.confdeltype = 'c'
      AND constraint_row.confmatchtype = 's'
      AND constraint_row.convalidated
      AND NOT constraint_row.condeferrable
      AND NOT constraint_row.condeferred
      AND COALESCE(
        (pg_catalog.to_jsonb(constraint_row) ->> 'conenforced')::boolean,
        true
      );

    IF actual_key_columns IS DISTINCT FROM foreign_key_contract.expected_columns
       OR actual_referenced_columns IS DISTINCT FROM foreign_key_contract.expected_referenced_columns
    THEN
      RAISE EXCEPTION
        'Agentic migration postcondition failed: foreign key % differs from the planned contract',
        foreign_key_contract.constraint_name;
    END IF;
  END LOOP;

  FOR status_contract IN
    SELECT *
    FROM (
      VALUES
        ('tender_agentic_jobs'::text, 'tender_agentic_jobs_status_check'::text, 'status'::text, ARRAY['created', 'staging', 'ready', 'running', 'validating', 'completed', 'failed', 'canceled']::text[]),
        ('tender_agentic_documents', 'tender_agentic_documents_status_check', 'status', ARRAY['pending', 'uploading', 'staged', 'failed']::text[]),
        ('tender_agentic_field_results', 'tender_agentic_field_results_reported_status_check', 'reported_status', ARRAY['resolved', 'requires_review', 'not_found']::text[]),
        ('tender_agentic_field_results', 'tender_agentic_field_results_effective_status_check', 'effective_status', ARRAY['resolved', 'requires_review', 'not_found']::text[]),
        ('tender_agentic_field_results', 'tender_agentic_field_results_validation_level_check', 'validation_level', ARRAY['pass', 'warning', 'downgraded']::text[])
    ) AS status_checks(table_name, constraint_name, column_name, expected_values)
  LOOP
    SELECT
      pg_catalog.pg_get_constraintdef(constraint_row.oid, true),
      ARRAY(
        SELECT DISTINCT (captured.value)[1]
        FROM pg_catalog.regexp_matches(
          lower(pg_catalog.pg_get_constraintdef(constraint_row.oid, true)),
          '''([^'']+)''',
          'g'
        ) AS captured(value)
        ORDER BY (captured.value)[1]
      )
    INTO status_definition, actual_status_values
    FROM pg_catalog.pg_constraint AS constraint_row
    JOIN pg_catalog.pg_class AS table_class
      ON table_class.oid = constraint_row.conrelid
    JOIN pg_catalog.pg_namespace AS table_namespace
      ON table_namespace.oid = table_class.relnamespace
    JOIN pg_catalog.pg_attribute AS checked_attribute
      ON checked_attribute.attrelid = constraint_row.conrelid
     AND checked_attribute.attname = status_contract.column_name
     AND checked_attribute.attnum > 0
     AND NOT checked_attribute.attisdropped
    WHERE table_namespace.nspname = 'public'
      AND table_class.relname = status_contract.table_name
      AND constraint_row.conname = status_contract.constraint_name
      AND constraint_row.contype = 'c'
      AND constraint_row.conkey = ARRAY[checked_attribute.attnum]::smallint[]
      AND constraint_row.convalidated
      AND COALESCE(
        (pg_catalog.to_jsonb(constraint_row) ->> 'conenforced')::boolean,
        true
      );

    SELECT array_agg(value ORDER BY value)
    INTO sorted_expected_status_values
    FROM unnest(status_contract.expected_values) AS value;

    IF actual_status_values IS DISTINCT FROM sorted_expected_status_values
       OR status_definition !~* '(=[[:space:]]*ANY[[:space:]]*[(][[:space:]]*ARRAY|[[:space:]]IN[[:space:]]*[(])'
       OR status_definition ~* '[[:<:]](AND|OR)[[:>:]]'
    THEN
      RAISE EXCEPTION
        'Agentic migration postcondition failed: status CHECK % differs from the planned values',
        status_contract.constraint_name;
    END IF;
  END LOOP;

  IF EXISTS (
    WITH expected(table_name, constraint_name, allowed_definitions) AS (
      VALUES
        ('tender_agentic_jobs'::text, 'tender_agentic_jobs_replicate_index_check'::text, ARRAY['checkreplicate_index>=1']::text[]),
        ('tender_agentic_jobs', 'tender_agentic_jobs_expected_documents_check', ARRAY['checkexpected_documents>=0']::text[]),
        ('tender_agentic_jobs', 'tender_agentic_jobs_staged_documents_check', ARRAY['checkstaged_documents>=0']::text[]),
        (
          'tender_agentic_jobs',
          'tender_agentic_jobs_attempts_check',
          ARRAY['checkattemptsbetween0and2', 'checkattempts>=0andattempts<=2']::text[]
        ),
        (
          'tender_agentic_field_results',
          'tender_agentic_field_results_field_index_check',
          ARRAY['checkfield_indexbetween1and27', 'checkfield_index>=1andfield_index<=27']::text[]
        )
    )
    SELECT 1
    FROM expected
    LEFT JOIN pg_catalog.pg_namespace AS table_namespace
      ON table_namespace.nspname = 'public'
    LEFT JOIN pg_catalog.pg_class AS table_class
      ON table_class.relnamespace = table_namespace.oid
     AND table_class.relname = expected.table_name
    LEFT JOIN pg_catalog.pg_constraint AS constraint_row
      ON constraint_row.conrelid = table_class.oid
     AND constraint_row.conname = expected.constraint_name
     AND constraint_row.contype = 'c'
    WHERE constraint_row.oid IS NULL
       OR table_class.oid IS NULL
       OR table_namespace.oid IS NULL
       OR NOT constraint_row.convalidated
       OR NOT COALESCE(
         (pg_catalog.to_jsonb(constraint_row) ->> 'conenforced')::boolean,
         true
       )
       OR pg_catalog.regexp_replace(
            lower(pg_catalog.pg_get_constraintdef(constraint_row.oid, true)),
            '[[:space:]()]',
            '',
            'g'
          ) <> ALL (expected.allowed_definitions)
  ) THEN
    RAISE EXCEPTION
      'Agentic migration postcondition failed: numeric CHECK constraints differ from the planned contract';
  END IF;

  FOR index_contract IN
    SELECT *
    FROM (
      VALUES
        ('idx_tender_agentic_jobs_status_heartbeat'::text, ARRAY['status', 'heartbeat_at']::text[]),
        ('idx_tender_agentic_jobs_poll_claimed', ARRAY['poll_claimed_at']::text[]),
        ('idx_tender_agentic_jobs_analysis_run', ARRAY['analysis_run_id']::text[])
    ) AS indexes(index_name, expected_columns)
  LOOP
    SELECT array_agg(
      pg_catalog.pg_get_indexdef(index_metadata.indexrelid, key_position, true)
      ORDER BY key_position
    )
    INTO actual_index_columns
    FROM pg_catalog.pg_class AS index_class
    JOIN pg_catalog.pg_namespace AS index_namespace
      ON index_namespace.oid = index_class.relnamespace
    JOIN pg_catalog.pg_index AS index_metadata
      ON index_metadata.indexrelid = index_class.oid
    JOIN pg_catalog.pg_class AS table_class
      ON table_class.oid = index_metadata.indrelid
    JOIN pg_catalog.pg_namespace AS table_namespace
      ON table_namespace.oid = table_class.relnamespace
    JOIN pg_catalog.pg_am AS index_method
      ON index_method.oid = index_class.relam
    CROSS JOIN LATERAL generate_series(1, index_metadata.indnkeyatts)
      AS generated_key(key_position)
    WHERE index_namespace.nspname = 'public'
      AND index_class.relname = index_contract.index_name
      AND index_class.relkind = 'i'
      AND index_class.relpersistence = 'p'
      AND table_namespace.nspname = 'public'
      AND table_class.relname = 'tender_agentic_jobs'
      AND index_method.amname = 'btree'
      AND NOT index_metadata.indisunique
      AND NOT index_metadata.indisprimary
      AND NOT index_metadata.indisexclusion
      AND index_metadata.indisvalid
      AND index_metadata.indisready
      AND index_metadata.indislive
      AND index_metadata.indpred IS NULL
      AND index_metadata.indexprs IS NULL
      AND index_metadata.indnatts = index_metadata.indnkeyatts;

    IF actual_index_columns IS DISTINCT FROM index_contract.expected_columns THEN
      RAISE EXCEPTION
        'Agentic migration postcondition failed: index % differs from the planned contract',
        index_contract.index_name;
    END IF;
  END LOOP;
END
$agentic_postconditions$;

COMMIT;
