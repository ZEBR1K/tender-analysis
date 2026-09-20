import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const testsDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testsDirectory, '..');
const workflowPath = path.join(
  repositoryRoot,
  'workflows',
  'n8n-exports',
  'beta',
  '[BITRIX] TENDER — Отправить отчёт в Bitrix.json',
);
const fixturesDirectory = path.join(
  testsDirectory,
  'fixtures',
  'bitrix-delivery',
);

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function workflow() {
  return loadJson(workflowPath);
}

function byName(name) {
  const node = workflow().nodes.find((candidate) => candidate.name === name);
  assert.ok(node, `Missing node: ${name}`);
  return node;
}

function targets(sourceName, outputIndex = 0) {
  return (workflow().connections[sourceName]?.main?.[outputIndex] ?? [])
    .map(({ node }) => node);
}

function fixture(name) {
  return loadJson(path.join(fixturesDirectory, name));
}

function reportItem(overrides = {}, pdfBytes = Buffer.from('%PDF-fixture')) {
  const json = structuredClone(fixture('report-input.json'));
  Object.assign(json, structuredClone(overrides));
  return {
    json,
    binary: {
      report_pdf: {
        data: pdfBytes.toString('base64'),
        mimeType: 'application/pdf',
        fileName: 'Анализ закупки 10293451.pdf',
        fileExtension: 'pdf',
      },
    },
  };
}

async function runCodeNode(name, inputItem, sources = {}) {
  const node = byName(name);
  assert.equal(node.type, 'n8n-nodes-base.code');
  const items = [structuredClone(inputItem)];
  const executionContext = {
    helpers: {
      async getBinaryDataBuffer(itemIndex, binaryPropertyName) {
        const descriptor = items[itemIndex]?.binary?.[binaryPropertyName];
        assert.ok(descriptor?.data, `Unknown binary property ${itemIndex}:${binaryPropertyName}`);
        return Buffer.from(descriptor.data, 'base64');
      },
    },
  };
  const context = vm.createContext({
    Buffer,
    Intl,
    structuredClone,
    __executionContext: executionContext,
    $json: items[0].json,
    $binary: items[0].binary,
    $input: {
      all: () => items,
      first: () => items[0],
      item: items[0],
    },
    $: (sourceName) => {
      if (!Object.hasOwn(sources, sourceName)) {
        throw new Error(`Unknown source node: ${sourceName}`);
      }
      const sourceItems = Array.isArray(sources[sourceName])
        ? sources[sourceName]
        : [sources[sourceName]];
      const normalized = sourceItems.map((value) => (
        value?.json ? structuredClone(value) : { json: structuredClone(value) }
      ));
      return {
        all: () => normalized,
        first: () => normalized[0],
        item: normalized[0],
      };
    },
  });
  const result = await new vm.Script(
    `(async function () { ${node.parameters.jsCode}\n }).call(__executionContext)`,
  ).runInContext(context);
  return structuredClone(result);
}

test('delivery candidate is inactive, binary-passthrough, and credential free', () => {
  assert.equal(workflow().active, false);
  assert.equal(byName('When Executed by Another Workflow').parameters.inputSource, 'passthrough');
  assert.equal(byName('Отправить PDF в Bitrix').parameters.url, '__BITRIX_WEBHOOK_FILE_UPLOAD_URL__');
  assert.equal(Object.hasOwn(byName('Отправить PDF в Bitrix'), 'credentials'), false);
});

test('delivery request contains the approved short message and exact PDF bytes', async () => {
  const [result] = await runCodeNode(
    'Проверить и подготовить доставку Bitrix',
    reportItem(),
  );
  assert.equal(result.json.analysis_run_id, '11111111-1111-4111-8111-111111111111');
  assert.equal(
    result.json.bitrix_request.fields.message,
    [
      'Отчёт по закупке №10293451',
      'Предмет: Поставка мебели',
      'Заказчик: АО КИТА ТЕХ',
      'Начальная цена: 1 250 000 ₽',
      '',
      'Результаты: подтверждено — 20; требуют проверки — 4; не найдено — 3.',
    ].join('\n'),
  );
  assert.equal(
    result.json.bitrix_request.fields.content,
    Buffer.from('%PDF-fixture').toString('base64'),
  );
  assert.doesNotMatch(
    result.json.bitrix_request.fields.message,
    /UUID|confidence|field_key|Внимание/u,
  );
});

test('delivery preflight rejects invalid statistics and non-PDF bytes', async () => {
  await assert.rejects(
    runCodeNode(
      'Проверить и подготовить доставку Bitrix',
      reportItem({
        statistics: {
          total: 27,
          resolved: 20,
          requires_review: 4,
          not_found: 2,
        },
      }),
    ),
    /BITRIX_STATISTICS_INVALID/u,
  );
  await assert.rejects(
    runCodeNode(
      'Проверить и подготовить доставку Bitrix',
      reportItem({}, Buffer.from('not-a-pdf')),
    ),
    /BITRIX_PDF_SIGNATURE_INVALID/u,
  );
});

test('delivery entry path validates, registers, claims, and branches exactly once', () => {
  assert.deepEqual(targets('When Executed by Another Workflow'), ['Конфигурация Bitrix']);
  assert.deepEqual(targets('Конфигурация Bitrix'), ['Проверить и подготовить доставку Bitrix']);
  assert.deepEqual(targets('Проверить и подготовить доставку Bitrix'), ['Зарегистрировать доставку']);
  assert.deepEqual(targets('Зарегистрировать доставку'), ['Захватить доставку']);
  assert.deepEqual(targets('Захватить доставку'), ['Доставка захвачена?']);
  assert.deepEqual(targets('Доставка захвачена?', 1), []);
  assert.equal(targets('Доставка захвачена?', 1).includes('Отправить PDF в Bitrix'), false);
});

test('delivery registration uses the immutable destination identity', () => {
  const node = byName('Зарегистрировать доставку');
  const sql = node.parameters.query;
  assert.match(sql, /ON CONFLICT \(analysis_run_id, channel, dialog_id\)/u);
  assert.match(sql, /d[.]analysis_run_id = \$1::uuid/u);
  assert.match(sql, /d[.]channel = 'bitrix'/u);
  assert.match(sql, /d[.]dialog_id = \$2/u);
  assert.match(
    node.parameters.options.queryReplacement,
    /Проверить и подготовить доставку Bitrix/u,
  );
});

test('delivery claim is atomic, bounded, due-aware, and records the execution', () => {
  const node = byName('Захватить доставку');
  const sql = node.parameters.query;
  assert.match(sql, /UPDATE public[.]tender_analysis_deliveries/u);
  assert.match(sql, /status = 'sending'/u);
  assert.match(sql, /attempt_count = attempt_count \+ 1/u);
  assert.match(sql, /attempt_count < 4/u);
  assert.match(sql, /status = 'pending'/u);
  assert.match(sql, /status = 'retry_wait'/u);
  assert.match(sql, /next_attempt_at <= now\(\)/u);
  assert.match(sql, /NOT EXISTS \(SELECT 1 FROM claimed\)/u);
  assert.match(node.parameters.options.queryReplacement, /\$execution[.]id/u);

  const branch = byName('Доставка захвачена?');
  assert.equal(
    branch.parameters.conditions.conditions[0].leftValue,
    '={{ $json.claim_succeeded }}',
  );
});

export {
  byName,
  fixture,
  loadJson,
  reportItem,
  runCodeNode,
  targets,
};
