BEGIN;

CREATE TABLE public.tender_analysis_deliveries (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    analysis_run_id uuid NOT NULL
        REFERENCES public.tender_analysis_runs(id)
        ON DELETE CASCADE,
    channel text NOT NULL DEFAULT 'bitrix',
    dialog_id text NOT NULL,
    status text NOT NULL DEFAULT 'pending',
    attempt_count integer NOT NULL DEFAULT 0,
    n8n_execution_id text,
    next_attempt_at timestamptz,
    message_id text,
    file_id text,
    file_name text NOT NULL,
    file_size bigint NOT NULL,
    last_error_code text,
    last_error_message text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    sent_at timestamptz,

    CONSTRAINT tender_analysis_deliveries_identity_key
        UNIQUE (analysis_run_id, channel, dialog_id),

    CONSTRAINT tender_analysis_deliveries_channel_check
        CHECK (channel = 'bitrix'),

    CONSTRAINT tender_analysis_deliveries_status_check
        CHECK (
            status IN (
                'pending',
                'sending',
                'retry_wait',
                'sent',
                'failed',
                'unknown'
            )
        ),

    CONSTRAINT tender_analysis_deliveries_attempt_count_check
        CHECK (attempt_count BETWEEN 0 AND 4),

    CONSTRAINT tender_analysis_deliveries_file_size_check
        CHECK (file_size BETWEEN 6 AND 104857600),

    CONSTRAINT tender_analysis_deliveries_sent_check
        CHECK (
            status <> 'sent'
            OR (
                message_id IS NOT NULL
                AND file_id IS NOT NULL
                AND sent_at IS NOT NULL
            )
        ),

    CONSTRAINT tender_analysis_deliveries_retry_wait_check
        CHECK (
            status <> 'retry_wait'
            OR next_attempt_at IS NOT NULL
        ),

    CONSTRAINT tender_analysis_deliveries_non_retry_check
        CHECK (
            status = 'retry_wait'
            OR next_attempt_at IS NULL
        )
);

CREATE INDEX idx_tender_analysis_deliveries_due_retry
    ON public.tender_analysis_deliveries (next_attempt_at, id)
    WHERE status = 'retry_wait';

CREATE INDEX idx_tender_analysis_deliveries_execution
    ON public.tender_analysis_deliveries (n8n_execution_id)
    WHERE status = 'sending';

COMMIT;
