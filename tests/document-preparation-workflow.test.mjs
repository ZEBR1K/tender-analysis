import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';

const workflowUrl = new URL(
  '../workflows/n8n-exports/TENDER — Подготовить документацию.json',
  import.meta.url,
);

async function loadWorkflow() {
  return JSON.parse(await readFile(workflowUrl, 'utf8'));
}

function findNode(workflow, name) {
  const node = workflow.nodes.find((candidate) => candidate.name === name);
  assert.ok(node, `Missing workflow node: ${name}`);
  return node;
}

async function executeCode({ workflow, name, inputItems, sourceItemsByNode = {}, binaryBuffers = {} }) {
  const node = findNode(workflow, name);
  const items = structuredClone(inputItems);
  const sources = Object.fromEntries(Object.entries(sourceItemsByNode).map(([sourceName, sourceItems]) => [
    sourceName,
    structuredClone(sourceItems),
  ]));
  const context = vm.createContext({
    Buffer,
    Date,
    Math,
    Set,
    String,
    Number,
    Array,
    Object,
    RegExp,
    JSON,
    $input: {
      all: () => items,
      first: () => items[0],
      item: items[0],
    },
    $: (sourceName) => {
      const sourceItems = sources[sourceName];
      if (!sourceItems) throw new Error(`Unknown source node: ${sourceName}`);
      return {
        all: () => sourceItems,
        first: () => sourceItems[0],
        item: sourceItems[0],
      };
    },
    __executionContext: {
      helpers: {
        getBinaryDataBuffer: async (index, key) => {
          const buffer = binaryBuffers[`${index}:${key}`];
          if (!buffer) throw new Error(`Missing binary fixture ${index}:${key}`);
          return buffer;
        },
      },
    },
  });
  const result = await new vm.Script(`(async function () { ${node.parameters.jsCode}\n }).call(__executionContext)`)
    .runInContext(context);
  return JSON.parse(JSON.stringify(result));
}

const RUN_ID = '11111111-1111-4111-8111-111111111111';

function sourceAttachment(overrides = {}) {
  return {
    document_index: 1,
    file_name: 'specification.pdf',
    file_extension: 'pdf',
    display_name: 'Specification',
    download_url: 'https://tender.example/file/1',
    publication_at: '2026-09-07T00:00:00.000Z',
    source_size: 123,
    ...overrides,
  };
}

test('workflow has the exact preparation topology, typed trigger and fail-closed HTTP settings', async () => {
  const workflow = await loadWorkflow();
  assert.equal(workflow.name, 'TENDER — Подготовить документацию');
  assert.equal(workflow.active, false);
  assert.equal(workflow.nodes.filter((node) => node.type !== 'n8n-nodes-base.stickyNote').length, 24);
  assert.equal(workflow.nodes.filter((node) => node.type === 'n8n-nodes-base.stickyNote').length, 1);

  const trigger = findNode(workflow, 'When Executed by Another Workflow');
  assert.equal(trigger.typeVersion, 1.2);
  assert.deepEqual(trigger.parameters.workflowInputs.values, [
    { name: 'analysis_run_id', type: 'string' },
    { name: 'attachments', type: 'array' },
  ]);

  const download = findNode(workflow, 'Скачать архив');
  assert.equal(download.parameters.options.response.response.responseFormat, 'file');
  assert.equal(download.parameters.options.response.response.outputPropertyName, 'archive');
  assert.equal(download.retryOnFail, false);
  assert.equal(download.onError, 'continueErrorOutput');

  const directDownload = findNode(workflow, 'Скачать прямой документ');
  assert.equal(directDownload.parameters.options.response.response.responseFormat, 'file');
  assert.equal(directDownload.parameters.options.response.response.outputPropertyName, 'data');
  assert.equal(directDownload.retryOnFail, false);
  assert.equal(directDownload.onError, 'continueErrorOutput');

  const directLoop = findNode(workflow, 'Обработать прямые документы по одному');
  assert.equal(directLoop.parameters.batchSize, 1);
  const directHash = findNode(workflow, 'Вычислить SHA-256 прямого документа');
  assert.equal(directHash.parameters.binaryData, true);
  assert.equal(directHash.parameters.type, 'SHA256');

  const extract = findNode(workflow, 'Распаковать архив');
  assert.equal(extract.parameters.contentType, 'binaryData');
  assert.equal(extract.parameters.inputDataFieldName, 'archive');
  assert.equal(extract.parameters.options.response.response.fullResponse, true);
  assert.equal(extract.parameters.options.response.response.neverError, true);
  assert.equal(extract.parameters.options.response.response.responseFormat, 'json');
  assert.equal(extract.retryOnFail, false);
  assert.equal(extract.onError, 'continueErrorOutput');

  const c = workflow.connections;
  assert.deepEqual(c['Есть архивы?'].main[0].map(({ node }) => node), ['Развернуть очередь архивов']);
  assert.deepEqual(c['Есть архивы?'].main[1].map(({ node }) => node), ['Сформировать полный manifest']);
  assert.deepEqual(c['Обработать архивы по одному'].main[0].map(({ node }) => node), ['Сформировать полный manifest']);
  assert.deepEqual(c['Обработать архивы по одному'].main[1].map(({ node }) => node), ['Начать обработку архива']);
  assert.deepEqual(c['Скачать архив'].main[1].map(({ node }) => node), ['Нормализовать скачивание архива']);
  assert.deepEqual(c['Распаковать архив'].main[1].map(({ node }) => node), ['Нормализовать распаковку']);
  assert.deepEqual(c['Архив обработан?'].main[0].map(({ node }) => node), ['Обработать архивы по одному']);
  assert.deepEqual(c['Архив обработан?'].main[1].map(({ node }) => node), ['Сформировать ошибку подготовки']);
  assert.deepEqual(c['Обработать прямые документы по одному'].main[0].map(({ node }) => node), ['Собрать результаты прямых документов']);
  assert.deepEqual(c['Собрать результаты прямых документов'].main[0].map(({ node }) => node), ['Есть архивы?']);
  assert.deepEqual(c['Обработать прямые документы по одному'].main[1].map(({ node }) => node), ['Скачать прямой документ']);
  assert.deepEqual(c['Скачать прямой документ'].main[1].map(({ node }) => node), ['Нормализовать скачивание прямого документа']);
  assert.deepEqual(c['Вычислить SHA-256 прямого документа'].main[1].map(({ node }) => node), ['Зафиксировать идентичность прямого документа']);
  assert.deepEqual(c['Идентичность прямого документа готова?'].main[0].map(({ node }) => node), ['Обработать прямые документы по одному']);
  assert.deepEqual(c['Идентичность прямого документа готова?'].main[1].map(({ node }) => node), ['Сформировать ошибку подготовки']);
});

test('direct loop done output keeps every processed document for the manifest', async () => {
  const workflow = await loadWorkflow();
  const classified = await executeCode({
    workflow,
    name: 'Проверить и классифицировать вход',
    inputItems: [{ json: {
      analysis_run_id: RUN_ID,
      attachments: [
        sourceAttachment(),
        sourceAttachment({
          document_index: 2,
          file_name: 'prices.xls',
          file_extension: 'xls',
          download_url: 'https://tender.example/file/2',
        }),
      ],
    } }],
  });
  const context = classified[0].json;
  const doneItems = context.direct_document_jobs.map((job, offset) => ({
    json: {
      direct_ok: true,
      direct_document: {
        source_attachment_index: job.source_attachment_index,
        sort_path: '',
        file_name: job.source_attachment.file_name,
        file_extension: job.source_attachment.file_extension,
        display_name: job.source_attachment.display_name,
        download_url: job.download_url,
        publication_at: job.source_attachment.publication_at,
        source_size: job.source_attachment.source_size,
        mime_type: offset === 0 ? 'application/pdf' : 'application/vnd.ms-excel',
        file_size: 100 + offset,
        status: 'pending',
        error_message: null,
        ingestion_metadata: {
          source_attachment_index: job.source_attachment_index,
          artifact_kind: 'direct_document',
          archive_chain: [],
          entry_path: null,
          archive_depth: 0,
          content_sha256: String(offset + 1).repeat(64),
          extractor_job_id: null,
          skip_reason: null,
        },
      },
    },
  }));

  const collected = await executeCode({
    workflow,
    name: 'Собрать результаты прямых документов',
    inputItems: doneItems,
    sourceItemsByNode: { 'Проверить и классифицировать вход': classified },
  });
  assert.equal(collected.length, 1);
  assert.equal(collected[0].json.direct_results.length, 2);
  assert.equal(collected[0].json.archive_jobs.length, 0);

  const result = await executeCode({
    workflow,
    name: 'Сформировать полный manifest',
    inputItems: collected,
    sourceItemsByNode: {
      'Проверить и классифицировать вход': classified,
      'Собрать результаты прямых документов': collected,
    },
  });
  assert.equal(result[0].json.success, true);
  assert.deepEqual(
    result[0].json.manifest.documents.map((document) => document.file_name),
    ['specification.pdf', 'prices.xls'],
  );
});

test('no-archive input hashes direct documents and preserves skipped audit rows', async () => {
  const workflow = await loadWorkflow();
  const classified = await executeCode({
    workflow,
    name: 'Проверить и классифицировать вход',
    inputItems: [{ json: {
      analysis_run_id: RUN_ID,
      attachments: [
        sourceAttachment(),
        sourceAttachment({ document_index: 2, file_name: 'readme.txt', file_extension: 'txt' }),
      ],
    } }],
  });
  const context = classified[0].json;
  assert.deepEqual(context.archive_jobs, []);
  assert.equal(context.direct_document_jobs.length, 1);
  assert.deepEqual(context.base_documents.map((document) => document.status), ['skipped']);

  const bytes = Buffer.from('%PDF direct fixture');
  const normalized = await executeCode({
    workflow,
    name: 'Нормализовать скачивание прямого документа',
    inputItems: [{
      json: {},
      binary: { data: { fileName: 'specification.pdf', mimeType: 'application/pdf' } },
    }],
    sourceItemsByNode: {
      'Обработать прямые документы по одному': [{
        json: { direct_document_jobs: context.direct_document_jobs[0] },
      }],
    },
    binaryBuffers: { '0:data': bytes },
  });
  assert.equal(normalized[0].json.file_size, bytes.length);
  assert.equal(normalized[0].json.mime_type, 'application/pdf');

  const identified = await executeCode({
    workflow,
    name: 'Зафиксировать идентичность прямого документа',
    inputItems: [{ json: { content_sha256: 'a'.repeat(64) } }],
    sourceItemsByNode: {
      'Нормализовать скачивание прямого документа': normalized,
    },
  });
  const collected = await executeCode({
    workflow,
    name: 'Собрать результаты прямых документов',
    inputItems: identified,
    sourceItemsByNode: { 'Проверить и классифицировать вход': classified },
  });

  const result = await executeCode({
    workflow,
    name: 'Сформировать полный manifest',
    inputItems: collected,
    sourceItemsByNode: {
      'Проверить и классифицировать вход': classified,
      'Собрать результаты прямых документов': collected,
    },
  });
  assert.equal(result[0].json.success, true);
  assert.equal(result[0].json.manifest.processable_document_count, 1);
  assert.equal(result[0].json.manifest.skipped_document_count, 1);
  assert.deepEqual(result[0].json.manifest.documents.map((document) => document.document_index), [1, 2]);
  const directDocument = result[0].json.manifest.documents[0];
  assert.equal(directDocument.file_name, 'specification.pdf');
  assert.equal(directDocument.mime_type, 'application/pdf');
  assert.equal(directDocument.file_size, bytes.length);
  assert.equal(directDocument.status, 'pending');
  assert.equal(directDocument.ingestion_metadata.content_sha256, 'a'.repeat(64));
});

test('archive manifest keeps root container, stable paths and duplicate basenames', async () => {
  const workflow = await loadWorkflow();
  const classified = await executeCode({
    workflow,
    name: 'Проверить и классифицировать вход',
    inputItems: [{ json: {
      analysis_run_id: RUN_ID,
      attachments: [sourceAttachment({ file_name: 'documents.zip', file_extension: 'zip' })],
    } }],
  });
  const job = classified[0].json.archive_jobs[0];
  const extractorResult = {
    schema_version: 'tender_archive_extraction_v1',
    success: true,
    job_id: job.extractor_job_id,
    analysis_run_id: RUN_ID,
    source_attachment_index: 1,
    source: { declared_extension: 'zip', detected_format: 'zip', size_bytes: 10, sha256: 'a'.repeat(64) },
    stats: { entry_count: 2, unpacked_total_bytes: 6, archive_count: 1, duration_ms: 1 },
    entries: [
      { kind: 'file', logical_path: 'b/report.pdf', file_name: 'report.pdf', file_extension: 'pdf', archive_depth: 1, archive_chain: [], mime_type: 'application/pdf', size_bytes: 3, sha256: 'b'.repeat(64), artifact_id: 'c'.repeat(64), download_url: 'http://extractor/b' },
      { kind: 'file', logical_path: 'a/report.pdf', file_name: 'report.pdf', file_extension: 'pdf', archive_depth: 1, archive_chain: [], mime_type: 'application/pdf', size_bytes: 3, sha256: 'd'.repeat(64), artifact_id: 'e'.repeat(64), download_url: 'http://extractor/a' },
    ],
  };
  const result = await executeCode({
    workflow,
    name: 'Сформировать полный manifest',
    inputItems: [{ json: { job, extractor_result: extractorResult } }],
    sourceItemsByNode: {
      'Проверить и классифицировать вход': classified,
      'Нормализовать распаковку': [{ json: { job, extractor_result: extractorResult } }],
    },
  });
  const documents = result[0].json.manifest.documents;
  assert.deepEqual(documents.map((document) => document.ingestion_metadata.entry_path), [null, 'a/report.pdf', 'b/report.pdf']);
  assert.equal(documents[1].file_name, documents[2].file_name);
  assert.notEqual(documents[1].download_url, documents[2].download_url);
  assert.deepEqual(documents.map((document) => document.document_index), [1, 2, 3]);
});

test('preflight and response contract failures remain typed and stop partial success', async () => {
  const workflow = await loadWorkflow();
  const tooLarge = await executeCode({
    workflow,
    name: 'Проверить и классифицировать вход',
    inputItems: [{ json: {
      analysis_run_id: RUN_ID,
      attachments: [sourceAttachment({ file_name: 'big.zip', file_extension: 'zip', source_size: 100 * 1024 * 1024 + 1 })],
    } }],
  });
  assert.equal(tooLarge[0].json.preliminary_failure.error_code, 'ARCHIVE_TOO_LARGE');

  const preliminaryManifest = await executeCode({
    workflow,
    name: 'Сформировать полный manifest',
    inputItems: tooLarge,
    sourceItemsByNode: { 'Проверить и классифицировать вход': tooLarge },
  });
  assert.equal(preliminaryManifest[0].json.success, false);
  assert.equal(preliminaryManifest[0].json.failure.error_code, 'ARCHIVE_TOO_LARGE');

  const archiveInput = await executeCode({
    workflow,
    name: 'Проверить и классифицировать вход',
    inputItems: [{ json: { analysis_run_id: RUN_ID, attachments: [sourceAttachment({ file_name: 'a.zip', file_extension: 'zip' })] } }],
  });
  const mismatch = await executeCode({
    workflow,
    name: 'Нормализовать распаковку',
    inputItems: [{ json: { body: { schema_version: 'wrong', success: true, entries: [] }, statusCode: 200 } }],
    sourceItemsByNode: {
      'Нормализовать скачивание архива': [{ json: { job: archiveInput[0].json.archive_jobs[0] } }],
    },
  });
  assert.equal(mismatch[0].json.archive_ok, false);
  assert.equal(mismatch[0].json.failure.error_code, 'INGESTION_CONTRACT_INVALID');
});

test('download normalization enforces the actual 100 MiB boundary', async () => {
  const workflow = await loadWorkflow();
  const job = {
    analysis_run_id: RUN_ID,
    source_attachment_index: 1,
    extractor_job_id: `${RUN_ID}--source-000001`,
    deadline_epoch_ms: Date.now() + 300_000,
  };
  const result = await executeCode({
    workflow,
    name: 'Нормализовать скачивание архива',
    inputItems: [{ json: {}, binary: { archive: { fileName: 'a.zip' } } }],
    sourceItemsByNode: { 'Начать обработку архива': [{ json: { job } }] },
    binaryBuffers: { '0:archive': Buffer.alloc(100 * 1024 * 1024 + 1) },
  });
  assert.equal(result[0].json.archive_ok, false);
  assert.equal(result[0].json.failure.error_code, 'ARCHIVE_TOO_LARGE');
});

test('zero processable documents returns NO_PROCESSABLE_DOCUMENTS', async () => {
  const workflow = await loadWorkflow();
  const classified = await executeCode({
    workflow,
    name: 'Проверить и классифицировать вход',
    inputItems: [{ json: { analysis_run_id: RUN_ID, attachments: [sourceAttachment({ file_name: 'notes.txt', file_extension: 'txt' })] } }],
  });
  const result = await executeCode({
    workflow,
    name: 'Сформировать полный manifest',
    inputItems: classified,
    sourceItemsByNode: { 'Проверить и классифицировать вход': classified },
  });
  assert.equal(result[0].json.success, false);
  assert.equal(result[0].json.failure.error_code, 'NO_PROCESSABLE_DOCUMENTS');
});
