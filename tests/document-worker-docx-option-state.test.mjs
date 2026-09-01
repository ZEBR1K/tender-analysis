import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testDirectory, '..');
const workflowPath = path.join(
  repositoryRoot,
  'workflows',
  'n8n-exports',
  'TENDER — Обработать документ.json',
);
const fixtureRoot = path.join(
  testDirectory,
  'fixtures',
  'document-worker-docx-option-state',
);
const ooxmlRoot = path.join(fixtureRoot, 'ooxml');
const manifest = JSON.parse(
  fs.readFileSync(path.join(fixtureRoot, 'manifest.json'), 'utf8'),
);
const semanticBindingFixture = JSON.parse(
  fs.readFileSync(
    path.join(fixtureRoot, 'execution-14359-semantic-binding.json'),
    'utf8',
  ),
);

const nodeNames = Object.freeze({
  prepareArchive: 'Подготовить DOCX archive alias',
  routeDocx: 'DOCX option-state extraction?',
  decompress: 'Извлечь DOCX OOXML',
  unfoldParts: 'Развернуть DOCX OOXML части',
  routeXml: 'OOXML часть XML?',
  extractXmlText: 'Прочитать DOCX XML',
  parseXml: 'Разобрать DOCX XML',
  bindParsedXml: 'Привязать parsed XML к части',
  collectParts: 'Собрать DOCX parts для parser',
  parseOptionState: 'Разобрать состояния DOCX ActiveX',
  restoreBinary: 'Вернуть DOCX binary для Docling',
  joinDoclingResult: 'связать результат Docling и метаданные',
  normalizeDocling: 'Нормализовать документ Docling',
  prepareBlocks: 'подготовить блоки к анализу',
  buildSemantic: 'Собрать смысловые разделы v1.4',
  expandForAi: 'Развернуть части для AI v1.2',
  validateEvidence: 'Проверить и привязать evidence',
  dispatchValidator: 'Подготовить dispatch AI Validator',
  expandValidator: 'Развернуть units для AI Validator',
  checkValidator: 'Проверить ответ AI Validator',
  withoutValidator: 'Сформировать units without AI Validator',
  convergeValidator: 'Свести AI и units without AI',
  collectDocumentFacts: 'Собрать факты документа1',
});

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function loadWorkflow() {
  return JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
}

function findNode(workflow, name) {
  const node = workflow.nodes.find((candidate) => candidate.name === name);
  assert.ok(node, `Workflow node not found: ${name}`);
  return node;
}

function connectedTargets(workflow, sourceName, outputIndex = 0) {
  return (workflow.connections[sourceName]?.main?.[outputIndex] ?? []).map(
    ({ node, index }) => ({ node, index }),
  );
}

function binaryDescriptor(data, fileName, overrides = {}) {
  return {
    data: data.toString('base64'),
    fileName,
    fileExtension: path.extname(fileName).slice(1).toLowerCase(),
    mimeType: 'application/octet-stream',
    ...overrides,
  };
}

function decodeXmlEntities(value) {
  return value
    .replace(/&#x([0-9a-f]+);/giu, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#([0-9]+);/gu, (_, decimal) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replace(/&quot;/gu, '"')
    .replace(/&apos;/gu, "'")
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/&amp;/gu, '&');
}

function parseXmlLikeN8n(xml) {
  const tokens = xml.match(
    /<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\/[A-Za-z_][^>]*>|<[A-Za-z_][^>]*>|[^<]+/gu,
  ) ?? [];
  const stack = [];
  let root = null;

  function materialize(frame) {
    const keys = Object.keys(frame.children);
    const text = decodeXmlEntities(frame.text.join(''));
    if (Object.keys(frame.attributes).length === 0 && keys.length === 0) return text;
    const value = { ...frame.children };
    if (Object.keys(frame.attributes).length > 0) value.$ = frame.attributes;
    if (text.trim()) value._ = text;
    return value;
  }

  function attach(frame) {
    const value = materialize(frame);
    const parent = stack.at(-1);
    if (!parent) {
      assert.equal(root, null, 'XML fixture must contain exactly one root element');
      root = { [frame.name]: value };
      return;
    }
    parent.children[frame.name] ??= [];
    parent.children[frame.name].push(value);
  }

  for (const token of tokens) {
    if (token.startsWith('<?') || token.startsWith('<!--')) continue;
    if (token.startsWith('<![CDATA[')) {
      assert.ok(stack.length > 0, 'CDATA must be inside an element');
      stack.at(-1).text.push(token.slice(9, -3));
      continue;
    }
    if (token.startsWith('</')) {
      const name = token.slice(2, -1).trim();
      const frame = stack.pop();
      assert.equal(frame?.name, name, `Unexpected XML closing tag: ${name}`);
      attach(frame);
      continue;
    }
    if (token.startsWith('<')) {
      const selfClosing = /\/\s*>$/u.test(token);
      const body = token.slice(1, selfClosing ? token.lastIndexOf('/') : -1).trim();
      const name = body.match(/^[^\s]+/u)?.[0];
      assert.ok(name, `Malformed XML start tag: ${token}`);
      const attributes = {};
      const attributeSource = body.slice(name.length);
      const attributePattern = /([^\s=]+)\s*=\s*(["'])([\s\S]*?)\2/gu;
      let match;
      while ((match = attributePattern.exec(attributeSource)) !== null) {
        attributes[match[1]] = decodeXmlEntities(match[3]);
      }
      const frame = { name, attributes, children: {}, text: [] };
      if (selfClosing) attach(frame);
      else stack.push(frame);
      continue;
    }
    if (stack.length > 0) stack.at(-1).text.push(token);
    else assert.equal(token.trim(), '', 'Text outside XML root is unsupported');
  }

  assert.equal(stack.length, 0, 'XML fixture contains unclosed tags');
  assert.ok(root, 'XML fixture root is missing');
  return root;
}

async function runCodeNode(workflow, nodeName, inputItems, { sourceJsonByNode = {} } = {}) {
  const node = findNode(workflow, nodeName);
  assert.equal(node.type, 'n8n-nodes-base.code');
  const items = structuredClone(inputItems);
  const executionContext = {
    helpers: {
      async getBinaryDataBuffer(itemIndex, binaryPropertyName) {
        const descriptor = items[itemIndex]?.binary?.[binaryPropertyName];
        assert.ok(descriptor, `Unknown binary property ${itemIndex}:${binaryPropertyName}`);
        return Buffer.from(descriptor.data, 'base64');
      },
    },
  };
  const firstItem = items[0] ?? { json: {}, binary: {} };
  const context = vm.createContext({
    Buffer,
    console,
    structuredClone,
    __executionContext: executionContext,
    $json: firstItem.json,
    $binary: firstItem.binary,
    $input: {
      all: () => items,
      first: () => firstItem,
      item: firstItem,
    },
    $: (sourceNodeName) => {
      if (!Object.hasOwn(sourceJsonByNode, sourceNodeName)) {
        throw new Error(`Unknown workflow source node: ${sourceNodeName}`);
      }
      const raw = sourceJsonByNode[sourceNodeName];
      const sourceJsons = Array.isArray(raw) ? raw : [raw];
      const sourceItems = sourceJsons.map((json) => ({ json: structuredClone(json) }));
      return {
        all: () => sourceItems,
        first: () => sourceItems[0],
        itemMatching: (index) => sourceItems[index] ?? sourceItems[0],
        item: sourceItems[0],
      };
    },
  });
  const result = await new vm.Script(
    `(async function () { ${node.parameters.jsCode}\n }).call(__executionContext)`,
  ).runInContext(context);
  return JSON.parse(JSON.stringify(Array.isArray(result) ? result : [result]));
}

function textParagraph(text) {
  return { 'w:r': [{ 'w:t': [text] }] };
}

function fixturePartPaths(directory = ooxmlRoot, prefix = '') {
  return fs.readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const partPath = path.posix.join(prefix, entry.name);
      return entry.isDirectory()
        ? fixturePartPaths(path.join(directory, entry.name), partPath)
        : [partPath];
    })
    .sort();
}

function structuredXmlItems() {
  return fixturePartPaths()
    .filter((partPath) => !partPath.endsWith('.bin'))
    .map((partPath) => ({
      json: {
        docx_part_path: partPath,
        docx_part_kind: 'structured_xml',
        ...parseXmlLikeN8n(
          fs.readFileSync(path.join(ooxmlRoot, ...partPath.split('/')), 'utf8'),
        ),
      },
    }));
}

function binaryPartItems(overrides = new Map()) {
  return manifest.expected_controls.map((expected) => {
    const partPath = expected.binary_rel_target;
    const override = overrides.get(partPath);
    const data = override ?? fs.readFileSync(path.join(ooxmlRoot, ...partPath.split('/')));
    return {
      json: {
        docx_part_path: partPath,
        docx_part_kind: 'binary',
      },
      binary: {
        data: binaryDescriptor(data, partPath),
      },
    };
  });
}

function structuredParserItems({ xmlMutator, binaryOverrides } = {}) {
  const xmlItems = structuredXmlItems();
  if (xmlMutator) xmlMutator(xmlItems);
  return [...xmlItems, ...binaryPartItems(binaryOverrides)];
}

async function runOptionParser(options) {
  const [result] = await runCodeNode(
    loadWorkflow(),
    nodeNames.parseOptionState,
    structuredParserItems(options),
  );
  return result;
}

function findStructuredPart(items, partPath) {
  const item = items.find(({ json }) => json.docx_part_path === partPath);
  assert.ok(item, `Missing structured part: ${partPath}`);
  return item.json;
}

function stateByName(result, controlName) {
  const records = result.json.docx_option_states;
  assert.ok(Array.isArray(records), 'docx_option_states must be an array');
  const record = records.find(({ control_name: name }) => name === controlName);
  assert.ok(record, `Missing option-state record: ${controlName}`);
  return record;
}

function expectFailClosed(record, warningCode, expectedState = 'unknown') {
  assert.equal(record.state, expectedState);
  assert.ok(
    record.warnings.some(({ code }) => code === warningCode),
    `Expected warning ${warningCode}, got ${JSON.stringify(record.warnings)}`,
  );
  assert.notEqual(record.state, 'selected');
}

function buildMorphDataContents({ displayStyle = 4, value }) {
  const VALUE_BIT = 22n;
  const DISPLAY_STYLE_BIT = 6n;
  const SIZE_BIT = 8n;
  const RESERVED_BIT = 31n;
  let mask = (1n << DISPLAY_STYLE_BIT) | (1n << SIZE_BIT) | (1n << RESERVED_BIT);
  if (value !== null) mask |= 1n << VALUE_BIT;

  const dataBytes = [displayStyle];
  while ((12 + dataBytes.length) % 4 !== 0) dataBytes.push(0);
  if (value !== null) {
    const encoded = Buffer.from(value, 'latin1');
    const descriptor = Buffer.alloc(4);
    descriptor.writeUInt32LE((0x80000000 | encoded.length) >>> 0);
    dataBytes.push(...descriptor);
  }
  while ((12 + dataBytes.length) % 4 !== 0) dataBytes.push(0);

  const extraBytes = [];
  const size = Buffer.alloc(8);
  size.writeUInt32LE(451, 0);
  size.writeUInt32LE(451, 4);
  extraBytes.push(...size);
  if (value !== null) extraBytes.push(...Buffer.from(value, 'latin1'));
  while ((12 + dataBytes.length + extraBytes.length) % 4 !== 0) extraBytes.push(0);

  const header = Buffer.alloc(12);
  header[0] = 0x00;
  header[1] = 0x02;
  header.writeUInt16LE(8 + dataBytes.length + extraBytes.length, 2);
  header.writeBigUInt64LE(mask, 4);
  return Buffer.concat([header, Buffer.from(dataBytes), Buffer.from(extraBytes)]);
}

function writeDirectoryEntry(buffer, offset, {
  name,
  type,
  left = 0xffffffff,
  right = 0xffffffff,
  child = 0xffffffff,
  startSector = 0xfffffffe,
  streamSize = 0,
}) {
  const encodedName = Buffer.from(`${name}\0`, 'utf16le');
  assert.ok(encodedName.length <= 64);
  encodedName.copy(buffer, offset);
  buffer.writeUInt16LE(encodedName.length, offset + 64);
  buffer[offset + 66] = type;
  buffer[offset + 67] = 1;
  buffer.writeUInt32LE(left, offset + 68);
  buffer.writeUInt32LE(right, offset + 72);
  buffer.writeUInt32LE(child, offset + 76);
  buffer.writeUInt32LE(startSector, offset + 116);
  buffer.writeBigUInt64LE(BigInt(streamSize), offset + 120);
}

function buildCfbWithContents(contents, options = {}) {
  assert.ok(contents.length > 0 && contents.length <= 128);
  const FREE = 0xffffffff;
  const END = 0xfffffffe;
  const FAT = 0xfffffffd;
  const sectorShift = options.sectorShift ?? 9;
  const sectorSize = 2 ** sectorShift;
  const header = Buffer.alloc(sectorSize);
  Buffer.from('d0cf11e0a1b11ae1', 'hex').copy(header, 0);
  header.writeUInt16LE(0x003e, 24);
  header.writeUInt16LE(sectorShift === 12 ? 4 : 3, 26);
  header.writeUInt16LE(0xfffe, 28);
  header.writeUInt16LE(sectorShift, 30);
  header.writeUInt16LE(6, 32);
  header.writeUInt32LE(1, 44);
  header.writeUInt32LE(options.firstDirectorySector ?? 1, 48);
  header.writeUInt32LE(4096, 56);
  header.writeUInt32LE(2, 60);
  header.writeUInt32LE(options.numMiniFatSectors ?? 1, 64);
  header.writeUInt32LE(END, 68);
  for (let offset = 76; offset < 512; offset += 4) header.writeUInt32LE(FREE, offset);
  header.writeUInt32LE(options.fatSectorIndex ?? 0, 76);

  const fat = Buffer.alloc(sectorSize, 0xff);
  fat.writeUInt32LE(FAT, 0);
  fat.writeUInt32LE(options.directoryCycle ? 1 : END, 4);
  fat.writeUInt32LE(END, 8);
  fat.writeUInt32LE(END, 12);

  const directory = Buffer.alloc(sectorSize);
  const miniSectorCount = Math.ceil(contents.length / 64);
  writeDirectoryEntry(directory, 0, {
    name: 'Root Entry',
    type: 5,
    child: options.rootChild ?? 1,
    startSector: 3,
    streamSize: miniSectorCount * 64,
  });
  writeDirectoryEntry(directory, 128, {
    name: 'contents',
    type: 2,
    left: options.contentsLeft ?? FREE,
    right: options.contentsRight ?? FREE,
    startSector: 0,
    streamSize: options.declaredStreamSize ?? contents.length,
  });

  const miniFat = Buffer.alloc(sectorSize, 0xff);
  for (let index = 0; index < miniSectorCount; index += 1) {
    let next = index + 1 < miniSectorCount ? index + 1 : END;
    if (options.miniFatCycle && index + 1 === miniSectorCount) next = 0;
    miniFat.writeUInt32LE(next, index * 4);
  }
  const miniStream = Buffer.alloc(sectorSize);
  contents.copy(miniStream);
  return Buffer.concat([header, fat, directory, miniFat, miniStream]);
}

function exactStateProjection(record) {
  return {
    control_name: record.control_name,
    control_type: record.control_type,
    state: record.state,
    exact_label: record.exact_label,
    source_row_ref: record.source_row_ref,
    control_rel_target: record.control_rel_target,
    binary_rel_target: record.binary_rel_target,
  };
}

function expectedStateProjection(expected) {
  return {
    control_name: expected.control_name,
    control_type: expected.control_type,
    state: expected.state,
    exact_label: expected.exact_label,
    source_row_ref: expected.source_row_ref,
    control_rel_target: expected.control_rel_target,
    binary_rel_target: expected.binary_rel_target,
  };
}

function sourceOptionStates() {
  return manifest.expected_controls.map((expected) => ({
    contract_version: 'docx_option_state_v1',
    document_part: 'word/document.xml',
    control_name: expected.control_name,
    control_type: expected.control_type,
    state: expected.state,
    raw_value: expected.state === 'selected' ? '1' : '0',
    exact_label: expected.exact_label,
    group_context: null,
    source_row_ref: expected.source_row_ref,
    control_rel_target: expected.control_rel_target,
    binary_rel_target: expected.binary_rel_target,
    warnings: [],
  }));
}

function doclingTable(expectedControls, tableIndex) {
  const tableCells = [];
  expectedControls.forEach((expected, rowIndex) => {
    tableCells.push({
      start_row_offset_idx: rowIndex,
      end_row_offset_idx: rowIndex + 1,
      start_col_offset_idx: 0,
      end_col_offset_idx: 1,
      text: '',
    });
    tableCells.push({
      start_row_offset_idx: rowIndex,
      end_row_offset_idx: rowIndex + 1,
      start_col_offset_idx: 1,
      end_col_offset_idx: 2,
      text: expected.exact_label,
    });
  });
  return {
    self_ref: `#/tables/${tableIndex}`,
    label: 'table',
    prov: [],
    data: {
      num_rows: expectedControls.length,
      num_cols: 2,
      table_cells: tableCells,
    },
  };
}

function optionStateDoclingDocument() {
  return {
    schema_name: 'DoclingDocument',
    version: 'fixture',
    name: 'fixture.docx',
    origin: {
      filename: 'fixture.docx',
      mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      binary_hash: 'fixture',
    },
    body: {
      children: [{ $ref: '#/tables/0' }, { $ref: '#/tables/1' }],
    },
    furniture: { children: [] },
    texts: [],
    tables: [
      doclingTable(manifest.expected_controls.slice(0, 4), 0),
      doclingTable(manifest.expected_controls.slice(4), 1),
    ],
    pictures: [],
    groups: [],
    key_value_items: [],
    form_items: [],
    pages: {},
  };
}

function bindingFixtureOptionStates(overrides = new Map()) {
  return semanticBindingFixture.source_option_states.map((state) => ({
    contract_version: 'docx_option_state_v1',
    document_part: 'word/document.xml',
    control_type: 'option_button',
    raw_value: state.state === 'selected' ? '1' : '0',
    group_context: null,
    control_rel_target: null,
    binary_rel_target: null,
    warnings: [],
    ...state,
    ...(overrides.get(state.control_name) ?? {}),
  }));
}

function doclingTableFromCapturedCells(tableRef, cells) {
  const tableIndex = Number(tableRef.match(/^#\/tables\/(\d+)$/u)?.[1]);
  assert.equal(Number.isSafeInteger(tableIndex), true, tableRef);
  const tableCells = cells.map(({ row_start: rowStart, col_start: colStart, text }) => ({
    start_row_offset_idx: rowStart,
    end_row_offset_idx: rowStart + 1,
    start_col_offset_idx: colStart,
    end_col_offset_idx: colStart + 1,
    text,
  }));
  return {
    self_ref: `#/tables/${tableIndex}`,
    label: 'table',
    prov: [],
    data: {
      num_rows: Math.max(...cells.map(({ row_start: rowStart }) => rowStart + 1)),
      num_cols: 2,
      table_cells: tableCells,
    },
  };
}

function execution14359SemanticDocument({ cloneGuaranteeStructure = false } = {}) {
  const tableCount = semanticBindingFixture.source_geometry_counts.docling_tables;
  const tables = Array.from({ length: tableCount }, () => null);
  const bodyChildren = [];
  for (const captured of semanticBindingFixture.normalized_table_cells) {
    const table = doclingTableFromCapturedCells(captured.docling_table_ref, captured.cells);
    const tableIndex = Number(captured.docling_table_ref.split('/').at(-1));
    tables[tableIndex] = table;
    bodyChildren.push({ $ref: captured.docling_table_ref });
  }
  if (cloneGuaranteeStructure) {
    const guaranteeBinding = semanticBindingFixture.oracle.bindings[1];
    const guaranteeCells = semanticBindingFixture.normalized_table_cells.find(
      ({ docling_table_ref: tableRef }) =>
        tableRef === guaranteeBinding.expected_docling_table_ref,
    ).cells;
    tables[63] = doclingTableFromCapturedCells('#/tables/63', guaranteeCells);
    bodyChildren.push({ $ref: '#/tables/63' });
  }

  return {
    schema_name: 'DoclingDocument',
    version: 'execution-14359-sanitized',
    name: 'sanitized.docx',
    origin: {
      filename: 'sanitized.docx',
      mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      binary_hash: 'sanitized',
    },
    body: { children: bodyChildren },
    furniture: { children: [] },
    texts: [],
    tables,
    pictures: [],
    groups: [],
    key_value_items: [],
    form_items: [],
    pages: {},
  };
}

async function normalizeBindingFixture(document, optionStates = bindingFixtureOptionStates()) {
  const [normalized] = await runCodeNode(
    loadWorkflow(),
    nodeNames.normalizeDocling,
    [{ json: document }],
    {
      sourceJsonByNode: {
        'связать результат Docling и метаданные': {
          document: { file_name: 'sanitized.docx', file_extension: 'docx' },
          docx_option_state_status: 'resolved',
          docx_option_states: optionStates,
          docx_option_state_audit: {
            contract_version: 'docx_option_state_audit_v1',
            warnings: [],
          },
        },
      },
    },
  );
  return normalized;
}

async function buildOptionStateSemanticFixture() {
  const workflow = loadWorkflow();
  const sourceContext = {
    analysis_run_id: 'fixture-run',
    document: {
      document_id: 'fixture-document',
      file_name: 'fixture.docx',
      file_extension: 'docx',
      mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    },
    docx_option_state_status: 'resolved',
    docx_option_states: sourceOptionStates(),
    docx_option_state_audit: {
      contract_version: 'docx_option_state_audit_v1',
      warnings: [],
    },
  };
  const [normalizedItem] = await runCodeNode(
    workflow,
    nodeNames.normalizeDocling,
    [{ json: optionStateDoclingDocument() }],
    { sourceJsonByNode: { 'связать результат Docling и метаданные': sourceContext } },
  );
  const [preparedItem] = await runCodeNode(
    workflow,
    nodeNames.prepareBlocks,
    [normalizedItem],
  );
  const [semanticItem] = await runCodeNode(
    workflow,
    nodeNames.buildSemantic,
    [preparedItem],
  );
  return { workflow, normalizedItem, semanticItem };
}

function buildOptionSource(segment, analysisUnitId = 'option-state-unit') {
  return {
    tender: { tender_id: 'fixture' },
    document: { document_id: 'fixture-document' },
    analysis_batch: { units_total: 1 },
    analysis_unit_meta: { analysis_unit_id: analysisUnitId },
    ai_segments: [segment],
    provenance: {
      index: {
        [segment.semantic_block_id]: {
          scope: segment.scope,
          source_block_ids: [],
          sources: [],
        },
      },
    },
    ai_request: {
      prompt_version: 'fixture',
      schema_version: 'ai_extractor_v1',
      field_catalog_version: 'tender_fields_v1',
    },
  };
}

function buildOptionFact(fieldKey, label, semanticBlockId) {
  return {
    field_key: fieldKey,
    value_text: label,
    status: 'found',
    confidence: 0.99,
    evidence: [{ semantic_block_id: semanticBlockId, quote: label }],
    review_reason_code: null,
    review_note: null,
  };
}

function buildExtractorResponse(facts, analysisUnitId = 'option-state-unit') {
  return {
    id: 'fixture-response',
    model: 'fixture-model',
    choices: [{
      finish_reason: 'stop',
      message: {
        content: JSON.stringify({
          schema_version: 'ai_extractor_v1',
          field_catalog_version: 'tender_fields_v1',
          analysis_unit_id: analysisUnitId,
          facts,
        }),
      },
    }],
    usage: {},
  };
}

function buildValidatorResponse(unit, verdict = 'confirmed') {
  return {
    id: `validator-${unit.analysis_unit_meta.analysis_unit_id}`,
    model: 'fixture-validator',
    choices: [{
      finish_reason: 'stop',
      message: {
        content: JSON.stringify({
          schema_version: 'ai_validator_v1',
          analysis_unit_id: unit.analysis_unit_meta.analysis_unit_id,
          validations: unit.verified_facts.map((fact) => ({
            fact_index: fact.fact_index,
            field_key: fact.field_key,
            verdict,
            confidence: 0.98,
            reason_code: verdict === 'confirmed' ? null : 'source_quality_issue',
            reason_note: verdict === 'confirmed' ? null : 'fixture review',
          })),
        }),
      },
    }],
    usage: {},
  };
}

test('fixture is a reviewed minimal derivative with exact source ActiveX parts', () => {
  assert.equal(manifest.contract_version, 'docx_option_state_fixture_v1');
  assert.equal(manifest.source_sha256, '32f79d377ad3b775497e70754bdfdce8ec0928cfeb2626d60ca65ef519f7437b');
  assert.equal(manifest.content_review.full_client_docx_included, false);
  assert.equal(manifest.content_review.credentials_or_secrets_found, false);
  assert.equal(manifest.content_review.personal_data_found, false);
  assert.equal(manifest.content_review.unrelated_procurement_content_included, false);
  assert.equal(manifest.expected_controls.length, 6);
  assert.equal(manifest.derived_parts.length, 20);

  for (const part of manifest.derived_parts) {
    assert.equal(path.extname(part.path).toLowerCase() === '.docx', false);
    const data = fs.readFileSync(path.join(ooxmlRoot, ...part.path.split('/')));
    assert.equal(data.length, part.size, part.path);
    assert.equal(sha256(data), part.sha256, part.path);
    if (part.path.endsWith('.bin')) {
      assert.equal(data.subarray(0, 8).toString('hex'), 'd0cf11e0a1b11ae1', part.path);
    }
  }
});

test('execution 14359 semantic-binding fixture is sanitized and preserves only required geometry', () => {
  assert.equal(
    semanticBindingFixture.contract_version,
    'docx_option_state_semantic_binding_fixture_v2',
  );
  assert.equal(semanticBindingFixture.source_execution, 14359);
  assert.equal(semanticBindingFixture.sanitization.full_document_included, false);
  assert.equal(semanticBindingFixture.sanitization.credentials_or_secrets_included, false);
  assert.equal(semanticBindingFixture.sanitization.personal_data_included, false);
  assert.equal(semanticBindingFixture.source_option_states.length, 6);
  assert.deepEqual(semanticBindingFixture.source_geometry_counts, {
    option_controls: 290,
    docling_tables: 64,
    docling_body_children: 528,
  });
  assert.equal(semanticBindingFixture.normalized_table_cells.length, 4);
  assert.equal(semanticBindingFixture.oracle.bindings.length, 2);
  assert.deepEqual(
    semanticBindingFixture.source_option_states.map(({ state }) => state),
    ['unselected', 'unselected', 'unselected', 'selected', 'selected', 'unselected'],
  );
  const capturedNationalTable = semanticBindingFixture.normalized_table_cells.find(
    ({ docling_table_ref: tableRef }) => tableRef === '#/tables/2',
  );
  assert.notEqual(
    semanticBindingFixture.source_option_states[0].exact_label,
    capturedNationalTable.cells[0].text,
  );
  assert.match(capturedNationalTable.cells[0].text, /\u00a0/u);
  assert.deepEqual(
    semanticBindingFixture.oracle.bindings[0].control_rel_targets,
    semanticBindingFixture.source_option_states.slice(0, 4)
      .map(({ control_rel_target: target }) => target),
  );
});

test('structured parser input is loaded from the checked-in source-derived XML fixture', () => {
  const parsedFixture = parseXmlLikeN8n(
    fs.readFileSync(path.join(ooxmlRoot, 'word', 'document.xml'), 'utf8'),
  );
  const documentPart = findStructuredPart(structuredXmlItems(), 'word/document.xml');
  assert.deepEqual(documentPart, {
    docx_part_path: 'word/document.xml',
    docx_part_kind: 'structured_xml',
    ...parsedFixture,
  });
});

test('workflow uses native Compression and XML nodes with the reviewed structured contract', () => {
  const workflow = loadWorkflow();
  const decompress = findNode(workflow, nodeNames.decompress);
  assert.equal(decompress.type, 'n8n-nodes-base.compression');
  assert.equal(decompress.typeVersion, 1.1);
  assert.deepEqual(decompress.parameters, {
    operation: 'decompress',
    binaryPropertyName: 'docx_archive',
    outputPrefix: 'docx_part_',
  });

  const extractXml = findNode(workflow, nodeNames.extractXmlText);
  assert.equal(extractXml.type, 'n8n-nodes-base.extractFromFile');
  assert.equal(extractXml.typeVersion, 1.1);
  assert.deepEqual(extractXml.parameters, {
    operation: 'text',
    binaryPropertyName: 'data',
    destinationKey: 'xml_text',
    options: {},
  });

  const parseXml = findNode(workflow, nodeNames.parseXml);
  assert.equal(parseXml.type, 'n8n-nodes-base.xml');
  assert.equal(parseXml.typeVersion, 1);
  assert.deepEqual(parseXml.parameters, {
    mode: 'xmlToJson',
    dataPropertyName: 'xml_text',
    options: {
      explicitArray: true,
      explicitRoot: true,
      ignoreAttrs: false,
      mergeAttrs: false,
      normalize: false,
      normalizeTags: false,
      trim: false,
    },
  });

  const parserCode = findNode(workflow, nodeNames.parseOptionState).parameters.jsCode;
  assert.doesNotMatch(parserCode, /DOMParser|xml2js|fast-xml-parser|parseXml|xml_text/u);
  assert.match(parserCode, /docx_part_kind/u);
  assert.match(parserCode, /structured_xml/u);
});

test('workflow connections isolate DOCX extraction and restore the original binary before Docling', () => {
  const workflow = loadWorkflow();
  assert.deepEqual(connectedTargets(workflow, 'Связать метаданные и файл'), [
    { node: nodeNames.prepareArchive, index: 0 },
  ]);
  assert.deepEqual(connectedTargets(workflow, nodeNames.prepareArchive), [
    { node: nodeNames.routeDocx, index: 0 },
  ]);
  assert.deepEqual(connectedTargets(workflow, nodeNames.routeDocx, 0), [
    { node: nodeNames.decompress, index: 0 },
    { node: nodeNames.restoreBinary, index: 0 },
  ]);
  assert.deepEqual(connectedTargets(workflow, nodeNames.routeDocx, 1), [
    { node: 'определить тип файла', index: 0 },
  ]);
  assert.deepEqual(connectedTargets(workflow, nodeNames.decompress), [
    { node: nodeNames.unfoldParts, index: 0 },
  ]);
  assert.deepEqual(connectedTargets(workflow, nodeNames.unfoldParts), [
    { node: nodeNames.routeXml, index: 0 },
  ]);
  assert.deepEqual(connectedTargets(workflow, nodeNames.routeXml, 0), [
    { node: nodeNames.extractXmlText, index: 0 },
    { node: nodeNames.bindParsedXml, index: 0 },
  ]);
  assert.deepEqual(connectedTargets(workflow, nodeNames.routeXml, 1), [
    { node: nodeNames.collectParts, index: 1 },
  ]);
  assert.deepEqual(connectedTargets(workflow, nodeNames.extractXmlText), [
    { node: nodeNames.parseXml, index: 0 },
  ]);
  assert.deepEqual(connectedTargets(workflow, nodeNames.parseXml), [
    { node: nodeNames.bindParsedXml, index: 1 },
  ]);
  assert.deepEqual(connectedTargets(workflow, nodeNames.bindParsedXml), [
    { node: nodeNames.collectParts, index: 0 },
  ]);
  assert.deepEqual(connectedTargets(workflow, nodeNames.collectParts), [
    { node: nodeNames.parseOptionState, index: 0 },
  ]);
  assert.deepEqual(connectedTargets(workflow, nodeNames.parseOptionState), [
    { node: nodeNames.restoreBinary, index: 1 },
  ]);
  assert.deepEqual(connectedTargets(workflow, nodeNames.restoreBinary), [
    { node: 'Загрузка файла в Docling', index: 0 },
  ]);
  assert.ok(
    connectedTargets(workflow, 'определить тип файла', 0)
      .some(({ node }) => node === 'Загрузка файла в Docling'),
  );
});

test('DOCX preparation creates a zip alias without changing the original binary descriptor', async () => {
  const workflow = loadWorkflow();
  const original = binaryDescriptor(
    Buffer.from('PK\u0003\u0004fixture-docx'),
    'source.docx',
    { fileExtension: 'docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  );
  const [result] = await runCodeNode(workflow, nodeNames.prepareArchive, [{
    json: { document: { file_name: 'source.docx', file_extension: 'docx' } },
    binary: { data: original },
  }]);
  assert.deepEqual(result.binary.data, original);
  assert.equal(result.binary.docx_archive.data, original.data);
  assert.equal(result.binary.docx_archive.fileName, 'source.zip');
  assert.equal(result.binary.docx_archive.fileExtension, 'zip');
  assert.equal(result.binary.docx_archive.mimeType, 'application/zip');
});

for (const extension of ['pdf', 'xlsx']) {
  test(`${extension.toUpperCase()} bypass keeps the pre-existing JSON and binary contract`, async () => {
    const workflow = loadWorkflow();
    const item = {
      json: { document: { file_name: `source.${extension}`, file_extension: extension } },
      binary: { data: binaryDescriptor(Buffer.from(`fixture-${extension}`), `source.${extension}`) },
    };
    const [result] = await runCodeNode(workflow, nodeNames.prepareArchive, [item]);
    assert.deepEqual(result, item);
    assert.equal(Object.hasOwn(result.binary, 'docx_archive'), false);
  });
}

test('Docling result context carries DOCX option audit and leaves non-DOCX output unchanged', async () => {
  const workflow = loadWorkflow();
  const resultEnvelope = {
    documents: [{
      status: 'success',
      source_index: 0,
      source_uri: 'fixture',
      filename: 'fixture.docx',
      artifacts: [
        { artifact_type: 'json', uri: 'https://fixture.invalid/document.json' },
        { artifact_type: 'markdown', uri: 'https://fixture.invalid/document.md' },
      ],
      errors: [],
    }],
    processing_time: 1,
  };
  const baseSource = {
    analysis_run_id: 'fixture-run',
    tender_meta: { tender_id: 'fixture' },
    document: { document_id: 'fixture-document', file_name: 'fixture.docx', file_extension: 'docx' },
  };
  const parserResult = {
    docx_option_state_status: 'resolved',
    docx_option_states: sourceOptionStates(),
    docx_option_state_audit: { contract_version: 'docx_option_state_audit_v1', warnings: [] },
  };
  const [docx] = await runCodeNode(
    workflow,
    nodeNames.joinDoclingResult,
    [{ json: resultEnvelope }],
    {
      sourceJsonByNode: {
        'Связать метаданные и файл': baseSource,
        'Разобрать состояния DOCX ActiveX': parserResult,
        'Загрузка файла в Docling': { task_id: 'fixture-task' },
      },
    },
  );
  assert.equal(docx.json.docx_option_state_status, 'resolved');
  assert.deepEqual(docx.json.docx_option_states, parserResult.docx_option_states);
  assert.deepEqual(docx.json.docx_option_state_audit, parserResult.docx_option_state_audit);

  const pdfSource = {
    ...baseSource,
    document: { ...baseSource.document, file_name: 'fixture.pdf', file_extension: 'pdf' },
  };
  const [pdf] = await runCodeNode(
    workflow,
    nodeNames.joinDoclingResult,
    [{ json: resultEnvelope }],
    {
      sourceJsonByNode: {
        'Связать метаданные и файл': pdfSource,
        'Загрузка файла в Docling': { task_id: 'fixture-task' },
      },
    },
  );
  assert.equal(Object.hasOwn(pdf.json, 'docx_option_state_status'), false);
  assert.equal(Object.hasOwn(pdf.json, 'docx_option_states'), false);
  assert.equal(Object.hasOwn(pdf.json, 'docx_option_state_audit'), false);
});

test('part preparation identifies required members by descriptor.fileName, never binary key or order', async () => {
  const workflow = loadWorkflow();
  const shuffledParts = [...manifest.derived_parts].reverse();
  const binary = Object.fromEntries(shuffledParts.map((part, index) => {
    const data = fs.readFileSync(path.join(ooxmlRoot, ...part.path.split('/')));
    return [`opaque_${String(index).padStart(4, '0')}`, binaryDescriptor(data, part.path)];
  }));
  const results = await runCodeNode(workflow, nodeNames.unfoldParts, [{ json: {}, binary }]);
  assert.deepEqual(
    results.map(({ json }) => json.docx_part_path).sort(),
    manifest.derived_parts.map(({ path: partPath }) => partPath).sort(),
  );
  assert.ok(results.every(({ binary: outputBinary }) => Object.keys(outputBinary).join() === 'data'));
});

test('part preparation reconstructs the OPC path from live Compression directory and fileName', async () => {
  const workflow = loadWorkflow();
  const shuffledParts = [...manifest.derived_parts].reverse();
  const binary = Object.fromEntries(shuffledParts.map((part, index) => {
    const data = fs.readFileSync(path.join(ooxmlRoot, ...part.path.split('/')));
    return [
      `opaque_${String(index).padStart(4, '0')}`,
      binaryDescriptor(data, path.posix.basename(part.path), {
        directory: path.posix.dirname(part.path),
      }),
    ];
  }));

  const results = await runCodeNode(workflow, nodeNames.unfoldParts, [{ json: {}, binary }]);
  assert.deepEqual(
    results.map(({ json }) => json.docx_part_path).sort(),
    manifest.derived_parts.map(({ path: partPath }) => partPath).sort(),
  );
});

const rejectedDescriptorPaths = [
  { name: 'leading slash full path', fileName: '/word/document.xml' },
  { name: 'leading backslash full path', fileName: '\\word\\document.xml' },
  { name: 'UNC full path', fileName: '\\\\server\\share\\word\\document.xml' },
  { name: 'drive-prefixed full path', fileName: 'C:\\word\\document.xml' },
  { name: 'URI full path', fileName: 'https://example.invalid/word/document.xml' },
  { name: 'leading slash split directory', directory: '/word', fileName: 'document.xml' },
  { name: 'leading backslash split directory', directory: '\\word', fileName: 'document.xml' },
  { name: 'UNC split directory', directory: '\\\\server\\share\\word', fileName: 'document.xml' },
  { name: 'drive-prefixed split directory', directory: 'C:\\word', fileName: 'document.xml' },
  { name: 'URI split directory', directory: 'https://example.invalid/word', fileName: 'document.xml' },
  { name: 'dot segment in split directory', directory: 'word/.', fileName: 'document.xml' },
  { name: 'parent segment in split directory', directory: 'word/../word', fileName: 'document.xml' },
  { name: 'dot segment in split fileName', directory: 'word', fileName: './document.xml' },
  { name: 'parent segment in split fileName', directory: 'word', fileName: '../document.xml' },
];

for (const descriptorPath of rejectedDescriptorPaths) {
  test(`part preparation rejects ${descriptorPath.name} before OPC normalization`, async () => {
    const workflow = loadWorkflow();
    const descriptor = binaryDescriptor(Buffer.from('fixture'), descriptorPath.fileName, {
      ...(descriptorPath.directory === undefined ? {} : { directory: descriptorPath.directory }),
    });
    const [result] = await runCodeNode(workflow, nodeNames.unfoldParts, [{
      json: {},
      binary: { opaque: descriptor },
    }]);
    assert.equal(result.json.docx_option_state_status, 'unknown');
    assert.ok(result.json.docx_option_state_source_warnings.some(
      ({ code }) => code === 'invalid_extracted_part_path',
    ));
  });
}

test('extracted part count limit returns an audit-only unknown boundary', async () => {
  const workflow = loadWorkflow();
  const binary = {};
  for (let index = 0; index < 1501; index += 1) {
    binary[`opaque_${index}`] = binaryDescriptor(Buffer.from([index % 251]), `noise/${index}.dat`);
  }
  const [result] = await runCodeNode(workflow, nodeNames.unfoldParts, [{ json: {}, binary }]);
  assert.equal(result.json.docx_option_state_status, 'unknown');
  assert.equal(result.json.docx_part_kind, 'audit');
  assert.ok(result.json.docx_option_state_source_warnings.some(
    ({ code }) => code === 'extracted_part_limit_exceeded',
  ));
});

test('required part byte limit returns an audit-only unknown boundary', async () => {
  const workflow = loadWorkflow();
  const oversized = Buffer.alloc((4 * 1024 * 1024) + 1);
  const [result] = await runCodeNode(workflow, nodeNames.unfoldParts, [{
    json: {},
    binary: { opaque: binaryDescriptor(oversized, 'word/document.xml') },
  }]);
  assert.equal(result.json.docx_option_state_status, 'unknown');
  assert.ok(result.json.docx_option_state_source_warnings.some(
    ({ code }) => code === 'required_parts_size_limit_exceeded',
  ));
});

test('exact source controls preserve selected and unselected state with exact row labels', async () => {
  const result = await runOptionParser();
  assert.deepEqual(
    result.json.docx_option_states.map(exactStateProjection),
    manifest.expected_controls.map(expectedStateProjection),
  );
  for (const record of result.json.docx_option_states) {
    assert.equal(record.contract_version, 'docx_option_state_v1');
    assert.equal(record.document_part, 'word/document.xml');
    assert.deepEqual(record.warnings, []);
  }
});

test('source-shaped nested multi-control tables map each control only to its exact inner-row label', async () => {
  const result = await runOptionParser();
  assert.equal(result.json.docx_option_states.length, 6);
  assert.equal(new Set(result.json.docx_option_states.map(({ control_name: name }) => name)).size, 6);
  assert.deepEqual(
    result.json.docx_option_states.map(exactStateProjection),
    manifest.expected_controls.map(expectedStateProjection),
  );
  assert.ok(result.json.docx_option_states.every(({ warnings }) => warnings.length === 0));
});

test('CFB version 4 with 4096-byte sectors decodes through the standards-based path', async () => {
  const binaryOverrides = new Map([[
    'word/activeX/activeX5.bin',
    buildCfbWithContents(
      buildMorphDataContents({ displayStyle: 4, value: '0' }),
      { sectorShift: 12 },
    ),
  ]]);
  const result = await runOptionParser({ binaryOverrides });
  const record = stateByName(result, 'CommonSupplierCheckBox11');
  assert.equal(record.state, 'unselected');
  assert.deepEqual(record.warnings, []);
});

test('normalization maps exact option labels to owning source blocks and semantic blocks', async () => {
  const { normalizedItem, semanticItem } = await buildOptionStateSemanticFixture();
  assert.equal(normalizedItem.json.docx_option_state_status, 'resolved');
  assert.equal(normalizedItem.json.docx_option_states.length, 6);
  assert.equal(normalizedItem.json.docx_option_state_audit.semantic_mapping_warnings.length, 0);

  const normalizedOptionStates = normalizedItem.json.blocks.flatMap(
    (block) => block.docx_option_states ?? [],
  );
  assert.deepEqual(
    normalizedOptionStates.map(({ control_name }) => control_name),
    manifest.expected_controls.map(({ control_name }) => control_name),
  );

  const semanticOptionStates = semanticItem.json.semantic_blocks.flatMap(
    (block) => block.docx_option_states ?? [],
  );
  assert.deepEqual(
    semanticOptionStates.map(({ control_name }) => control_name),
    manifest.expected_controls.map(({ control_name }) => control_name),
  );
  for (const block of semanticItem.json.semantic_blocks) {
    assert.doesNotMatch(block.text, /\[OPTION_STATE/u);
  }
});

test('execution 14359 binds duplicate labels only through their unique source table and row structure', async () => {
  const workflow = loadWorkflow();
  const normalized = await normalizeBindingFixture(execution14359SemanticDocument());
  assert.equal(normalized.json.docx_option_state_audit.semantic_mapping_warnings.length, 0);
  const [nationalBinding, guaranteeBinding] = semanticBindingFixture.oracle.bindings;

  const nationalBlock = normalized.json.blocks.find(
    ({ block_id: blockId }) =>
      blockId === nationalBinding.expected_docling_table_ref,
  );
  const guaranteeBlock = normalized.json.blocks.find(
    ({ block_id: blockId }) =>
      blockId === guaranteeBinding.expected_docling_table_ref,
  );
  assert.deepEqual(
    nationalBlock.docx_option_states.map(({ control_rel_target: target }) => target),
    nationalBinding.control_rel_targets,
  );
  assert.deepEqual(
    guaranteeBlock.docx_option_states.map(({ control_rel_target: target }) => target),
    guaranteeBinding.control_rel_targets,
  );
  for (const duplicateRef of semanticBindingFixture.oracle.duplicate_only_table_refs) {
    assert.equal(
      normalized.json.blocks.find(({ block_id: blockId }) => blockId === duplicateRef)
        .docx_option_states?.length ?? 0,
      0,
    );
  }

  const [prepared] = await runCodeNode(workflow, nodeNames.prepareBlocks, [normalized]);
  const [semantic] = await runCodeNode(workflow, nodeNames.buildSemantic, [prepared]);
  const nationalSemantic = semantic.json.semantic_blocks.find(
    ({ source_block_ids: sourceBlockIds = [] }) =>
      sourceBlockIds.includes(nationalBinding.expected_docling_table_ref),
  );
  const guaranteeSemantic = semantic.json.semantic_blocks.find(
    ({ source_block_ids: sourceBlockIds = [] }) =>
      sourceBlockIds.includes(guaranteeBinding.expected_docling_table_ref),
  );
  assert.deepEqual(
    nationalSemantic.docx_option_states.map(({ state }) => state),
    ['unselected', 'unselected', 'unselected', 'selected'],
  );
  assert.deepEqual(
    guaranteeSemantic.docx_option_states.map(({ state }) => state),
    ['selected', 'unselected'],
  );
});

test('missing source row coordinate fails closed without label-only attachment', async () => {
  const target = semanticBindingFixture.source_option_states[3];
  const overrides = new Map([[target.control_name, { source_row_ref: null }]]);
  const normalized = await normalizeBindingFixture(
    execution14359SemanticDocument(),
    bindingFixtureOptionStates(overrides),
  );
  const warning = normalized.json.docx_option_state_audit.semantic_mapping_warnings.find(
    ({ code, control_name: controlName }) =>
      code === 'missing_structural_option_coordinate' && controlName === target.control_name,
  );
  assert.ok(warning);
  assert.match(warning.issue_id, /^docx_option_mapping_issue_\d{4}$/u);
  assert.equal(
    normalized.json.blocks.flatMap((block) => block.docx_option_states ?? [])
      .some(({ control_name: name }) => name === target.control_name),
    false,
  );
});

test('conflicting source row coordinate fails closed instead of searching the label globally', async () => {
  const target = semanticBindingFixture.source_option_states[3];
  const overrides = new Map([[
    target.control_name,
    { source_row_ref: 'word/document.xml#table[3]/row[1]' },
  ]]);
  const normalized = await normalizeBindingFixture(
    execution14359SemanticDocument(),
    bindingFixtureOptionStates(overrides),
  );
  assert.ok(normalized.json.docx_option_state_audit.semantic_mapping_warnings.some(
    ({ code }) => code === 'conflicting_structural_option_coordinates',
  ));
  assert.equal(
    normalized.json.blocks.flatMap((block) => block.docx_option_states ?? [])
      .some(({ control_rel_target: relTarget }) =>
        semanticBindingFixture.oracle.bindings[0].control_rel_targets.includes(relTarget)),
    false,
  );
});

test('multiple structural table matches fail closed for the whole source-table group', async () => {
  const normalized = await normalizeBindingFixture(
    execution14359SemanticDocument({ cloneGuaranteeStructure: true }),
  );
  assert.ok(normalized.json.docx_option_state_audit.semantic_mapping_warnings.some(
    ({ code, source_table_ref: sourceTableRef, matches_count: matchesCount }) =>
      code === 'ambiguous_structural_semantic_owner' &&
      sourceTableRef === 'word/document.xml#table[28]' &&
      matchesCount === 2,
  ));
  assert.equal(
    normalized.json.blocks.flatMap((block) => block.docx_option_states ?? [])
      .some(({ control_rel_target: relTarget }) =>
        semanticBindingFixture.oracle.bindings[1].control_rel_targets.includes(relTarget)),
    false,
  );
});

test('one stable control identity with contradictory table coordinates fails closed everywhere', async () => {
  const target = semanticBindingFixture.source_option_states[4];
  const contradictory = {
    ...target,
    source_row_ref: 'word/document.xml#table[99]/row[1]',
  };
  const normalized = await normalizeBindingFixture(
    execution14359SemanticDocument(),
    [...bindingFixtureOptionStates(), contradictory],
  );
  const warnings = normalized.json.docx_option_state_audit.semantic_mapping_warnings;
  assert.ok(warnings.some(
    ({ code, control_rel_target: relTarget }) =>
      code === 'conflicting_control_structural_identity' &&
      relTarget === target.control_rel_target,
  ));
  assert.equal(
    normalized.json.blocks.flatMap((block) => block.docx_option_states ?? [])
      .some(({ control_rel_target: relTarget }) => relTarget === target.control_rel_target),
    false,
  );
});

test('document semantic unknown with no candidate block remains bounded and guards facts globally', async () => {
  const workflow = loadWorkflow();
  const selected = semanticBindingFixture.source_option_states[4];
  const optionStates = [
    ...bindingFixtureOptionStates(),
    {
      contract_version: 'docx_option_state_v1',
      document_part: 'word/document.xml',
      control_type: 'option_button',
      control_name: 'sanitized_absent_control',
      control_rel_target: 'word/activeX/sanitized-absent.xml',
      binary_rel_target: null,
      raw_value: '1',
      state: 'selected',
      exact_label: 'sanitized structurally absent option',
      source_row_ref: 'word/document.xml#table[99]/row[1]',
      group_context: null,
      warnings: [],
    },
  ];
  const normalized = await normalizeBindingFixture(
    execution14359SemanticDocument(),
    optionStates,
  );
  const warning = normalized.json.docx_option_state_audit.semantic_mapping_warnings.find(
    ({ code, source_table_ref: sourceTableRef }) =>
      code === 'missing_structural_semantic_owner' &&
      sourceTableRef === 'word/document.xml#table[99]',
  );
  assert.ok(warning);
  assert.deepEqual(warning.candidate_block_ids, []);
  assert.equal(normalized.json.docx_option_state_semantic_status, 'unknown');

  const [prepared] = await runCodeNode(workflow, nodeNames.prepareBlocks, [normalized]);
  const [semantic] = await runCodeNode(workflow, nodeNames.buildSemantic, [prepared]);
  const guaranteeRef = semanticBindingFixture.oracle.bindings[1].expected_docling_table_ref;
  const semanticBlock = semantic.json.semantic_blocks.find(
    ({ source_block_ids: sourceBlockIds = [] }) => sourceBlockIds.includes(guaranteeRef),
  );
  assert.ok(semanticBlock);
  semantic.json.analysis_units = [{
    analysis_unit_id: 'document-semantic-unknown-unit',
    primary_semantic_block_ids: [semanticBlock.semantic_block_id],
    overlap_semantic_block_ids: [],
  }];
  const [expanded] = await runCodeNode(workflow, nodeNames.expandForAi, [semantic]);
  const segment = expanded.json.ai_segments[0];
  assert.deepEqual(segment.docx_option_state_mapping_issue_ids, []);
  assert.equal(segment.docx_option_state_semantic_status, 'unknown');
  assert.equal('docx_option_state_mapping_warnings' in segment, false);

  const source = buildOptionSource(segment, 'document-semantic-unknown-unit');
  const [evidenceResult] = await runCodeNode(
    workflow,
    nodeNames.validateEvidence,
    [{ json: buildExtractorResponse([
      buildOptionFact(
        'participation_guarantee',
        selected.exact_label,
        segment.semantic_block_id,
      ),
    ], 'document-semantic-unknown-unit') }],
    { sourceJsonByNode: { 'Подготовить запрос для AI': source } },
  );
  const [dispatch] = await runCodeNode(workflow, nodeNames.dispatchValidator, [evidenceResult]);
  const fact = dispatch.json.units_for_ai[0].verified_facts[0];
  assert.equal(fact.status, 'requires_review');
  assert.equal(fact.option_state_applicability, 'review_only');
  assert.deepEqual(
    fact.evidence.map(({ semantic_block_id: blockId, quote }) => ({ blockId, quote })),
    [{ blockId: segment.semantic_block_id, quote: selected.exact_label }],
  );
  assert.ok(fact.evidence.every((entry) => !('issue_id' in entry)));
});

test('document-level mapping warnings are stored once and segments carry bounded issue references', async () => {
  const workflow = loadWorkflow();
  const target = semanticBindingFixture.source_option_states[3];
  const overrides = new Map([[target.control_name, { source_row_ref: null }]]);
  const normalized = await normalizeBindingFixture(
    execution14359SemanticDocument(),
    bindingFixtureOptionStates(overrides),
  );
  const [prepared] = await runCodeNode(workflow, nodeNames.prepareBlocks, [normalized]);
  const [semantic] = await runCodeNode(workflow, nodeNames.buildSemantic, [prepared]);
  const ids = semantic.json.semantic_blocks.map(({ semantic_block_id: id }) => id);
  semantic.json.analysis_units = [0, 1, 2].map((index) => ({
    analysis_unit_id: `bounded-warning-unit-${index + 1}`,
    primary_semantic_block_ids: ids.slice(index * 50, index === 2 ? ids.length : (index + 1) * 50),
    overlap_semantic_block_ids: [],
  }));
  const expanded = await runCodeNode(workflow, nodeNames.expandForAi, [semantic]);
  const documentWarnings = expanded.flatMap(
    ({ json }) => json.analysis_unit?.docx_option_state_audit?.semantic_mapping_warnings ?? [],
  );
  assert.equal(documentWarnings.length, 1);
  assert.equal(new Set(documentWarnings.map(({ issue_id: issueId }) => issueId)).size, 1);
  assert.equal(
    expanded.flatMap(({ json }) => json.ai_segments)
      .flatMap(({ docx_option_state_mapping_warnings: warnings = [] }) => warnings)
      .length,
    0,
  );
  const issueReferences = expanded.flatMap(({ json }) => json.ai_segments)
    .flatMap(({ docx_option_state_mapping_issue_ids: issueIds = [] }) => issueIds);
  assert.ok(issueReferences.length >= 1);
  assert.ok(issueReferences.every((issueId) => issueId === documentWarnings[0].issue_id));
});

test('structural mapping issue references remain fail-closed through evidence and Validator dispatch', async () => {
  const workflow = loadWorkflow();
  const missing = semanticBindingFixture.source_option_states[3];
  const overrides = new Map([[missing.control_name, { source_row_ref: null }]]);
  const normalized = await normalizeBindingFixture(
    execution14359SemanticDocument(),
    bindingFixtureOptionStates(overrides),
  );
  const [prepared] = await runCodeNode(workflow, nodeNames.prepareBlocks, [normalized]);
  const [semantic] = await runCodeNode(workflow, nodeNames.buildSemantic, [prepared]);
  const semanticBlock = semantic.json.semantic_blocks.find(
    ({ docx_option_state_mapping_issue_ids: issueIds = [] }) => issueIds.length > 0,
  );
  assert.ok(semanticBlock);
  semantic.json.analysis_units = [{
    analysis_unit_id: 'structural-issue-unit',
    primary_semantic_block_ids: [semanticBlock.semantic_block_id],
    overlap_semantic_block_ids: [],
  }];
  const [expanded] = await runCodeNode(workflow, nodeNames.expandForAi, [semantic]);
  const segment = expanded.json.ai_segments[0];
  assert.equal(segment.docx_option_state_mapping_issue_ids.length, 1);

  const source = buildOptionSource(segment, 'structural-issue-unit');
  const [evidenceResult] = await runCodeNode(
    workflow,
    nodeNames.validateEvidence,
    [{ json: buildExtractorResponse([
      buildOptionFact('national_regime', missing.exact_label, segment.semantic_block_id),
    ], 'structural-issue-unit') }],
    { sourceJsonByNode: { 'Подготовить запрос для AI': source } },
  );
  const [dispatch] = await runCodeNode(workflow, nodeNames.dispatchValidator, [evidenceResult]);
  const fact = dispatch.json.units_for_ai[0].verified_facts[0];
  assert.equal(fact.status, 'requires_review');
  assert.equal(fact.option_state_applicability, 'review_only');
  assert.deepEqual(
    fact.evidence.map(({ semantic_block_id: blockId, quote }) => ({ blockId, quote })),
    [{ blockId: segment.semantic_block_id, quote: missing.exact_label }],
  );
  assert.ok(fact.evidence.every((entry) => !('issue_id' in entry)));
  assert.deepEqual(
    fact.option_state_audit_warnings.map(({ issue_id: issueId }) => issueId),
    segment.docx_option_state_mapping_issue_ids,
  );
});

test('AI segments expose deterministic option markers without replacing canonical semantic text', async () => {
  const { workflow, semanticItem } = await buildOptionStateSemanticFixture();
  const semanticBlocks = semanticItem.json.semantic_blocks;
  const [expanded] = await runCodeNode(workflow, nodeNames.expandForAi, [{
    json: {
      ...semanticItem.json,
      analysis_units: [{
        analysis_unit_id: 'option-state-unit',
        primary_semantic_block_ids: semanticBlocks.map(({ semantic_block_id }) => semantic_block_id),
        overlap_semantic_block_ids: [],
      }],
    },
  }]);
  const selected = manifest.expected_controls.find(
    ({ state, exact_label: label }) => state === 'selected' && label === 'Не применимо.',
  );
  const segment = expanded.json.ai_segments.find(({ docx_option_states: states }) =>
    states?.some(({ control_name }) => control_name === selected.control_name));
  const semanticBlock = semanticBlocks.find(
    ({ semantic_block_id: id }) => id === segment.semantic_block_id,
  );
  assert.equal(segment.canonical_text, semanticBlock.text);
  assert.ok(segment.text.includes(semanticBlock.text));
  assert.ok(segment.text.includes(`[OPTION_STATE selected] ${selected.exact_label}`));
  assert.ok(segment.docx_option_states.some(
    ({ control_name }) => control_name === selected.control_name,
  ));
  assert.match(
    findNode(workflow, 'подготовить части для анализа v1.3').parameters.jsCode,
    /block\?\.ai_text\s*\?\?/u,
  );
});

for (const candidateCase of [
  { fieldKey: 'national_regime', expected: manifest.expected_controls[0] },
  { fieldKey: 'participation_guarantee', expected: manifest.expected_controls[5] },
]) {
  test(`unselected ${candidateCase.fieldKey} option is deterministically excluded from applicable candidates`, async () => {
    const workflow = loadWorkflow();
    const optionState = sourceOptionStates().find(
      ({ control_name }) => control_name === candidateCase.expected.control_name,
    );
    const segment = {
      semantic_block_id: 'sb_option_state',
      scope: 'primary',
      type: 'table',
      role: 'table',
      canonical_text: candidateCase.expected.exact_label,
      text: `${candidateCase.expected.exact_label}\n[OPTION_STATE unselected] ${candidateCase.expected.exact_label}`,
      docx_option_states: [optionState],
    };
    const source = buildOptionSource(segment);
    const response = buildExtractorResponse([
      buildOptionFact(candidateCase.fieldKey, candidateCase.expected.exact_label, segment.semantic_block_id),
    ]);
    const [evidenceResult] = await runCodeNode(
      workflow,
      nodeNames.validateEvidence,
      [{ json: response }],
      { sourceJsonByNode: { 'Подготовить запрос для AI': source } },
    );
    const [dispatch] = await runCodeNode(
      workflow,
      nodeNames.dispatchValidator,
      [evidenceResult],
    );
    const result = dispatch.json.units_without_ai[0];
    assert.equal(result.verified_facts.length, 0);
    assert.equal(result.deterministically_rejected_facts.length, 1);
    assert.equal(
      result.deterministically_rejected_facts[0].deterministic_rejection.reason_code,
      'unselected_option_not_applicable',
    );
    const terminal = await runCodeNode(
      workflow,
      nodeNames.withoutValidator,
      [dispatch],
    );
    assert.equal(terminal[0].json.validated_facts[0].processing_status, 'rejected');
    assert.equal(
      terminal[0].json.validated_facts[0].option_state_applicability,
      'excluded',
    );
  });
}

for (const state of ['unknown', 'indeterminate']) {
  test(`${state} option state remains review-only and cannot stay found`, async () => {
    const workflow = loadWorkflow();
    const expected = manifest.expected_controls[0];
    const optionState = {
      ...sourceOptionStates()[0],
      state,
      raw_value: state === 'indeterminate' ? '2' : null,
      warnings: [{ code: `${state}_fixture`, message: 'fixture' }],
    };
    const segment = {
      semantic_block_id: 'sb_option_state',
      scope: 'primary',
      type: 'table',
      role: 'table',
      canonical_text: expected.exact_label,
      text: `${expected.exact_label}\n[OPTION_STATE ${state}] ${expected.exact_label}`,
      docx_option_states: [optionState],
    };
    const source = buildOptionSource(segment);
    const response = buildExtractorResponse([
      buildOptionFact('national_regime', expected.exact_label, segment.semantic_block_id),
    ]);
    const [evidenceResult] = await runCodeNode(
      workflow,
      nodeNames.validateEvidence,
      [{ json: response }],
      { sourceJsonByNode: { 'Подготовить запрос для AI': source } },
    );
    const [dispatch] = await runCodeNode(
      workflow,
      nodeNames.dispatchValidator,
      [evidenceResult],
    );
    const result = dispatch.json.units_for_ai[0];
    assert.equal(result.deterministically_rejected_facts.length, 0);
    assert.equal(result.verified_facts[0].status, 'requires_review');
    assert.equal(result.verified_facts[0].review_reason_code, 'source_quality_issue');
    assert.equal(result.verified_facts[0].option_state_applicability, 'review_only');

    const [expanded] = await runCodeNode(workflow, nodeNames.expandValidator, [dispatch]);
    const [checked] = await runCodeNode(
      workflow,
      nodeNames.checkValidator,
      [{ json: buildValidatorResponse(expanded.json, 'confirmed') }],
      { sourceJsonByNode: { 'Развернуть units для AI Validator': expanded.json } },
    );
    const finalFact = checked.json.validated_facts[0];
    assert.equal(finalFact.processing_status, 'requires_review');
    assert.equal(finalFact.accepted_for_normalization, false);
    assert.equal(finalFact.option_state_applicability, 'review_only');
    assert.equal(finalFact.option_state_evidence[0].state, state);
  });
}

test('global unknown DOCX option-state source keeps guarded facts review-only', async () => {
  const workflow = loadWorkflow();
  const expected = manifest.expected_controls[0];
  const segment = {
    semantic_block_id: 'sb_global_unknown_option_state',
    scope: 'primary',
    type: 'table',
    role: 'table',
    canonical_text: expected.exact_label,
    text: expected.exact_label,
    docx_option_states: [],
    docx_option_state_status: 'unknown',
    docx_option_state_source_warnings: [{ code: 'resource_gate', message: 'fixture' }],
  };
  const source = buildOptionSource(segment, 'global-unknown-option-unit');
  const [evidenceResult] = await runCodeNode(
    workflow,
    nodeNames.validateEvidence,
    [{ json: buildExtractorResponse([
      buildOptionFact('national_regime', expected.exact_label, segment.semantic_block_id),
    ], 'global-unknown-option-unit') }],
    { sourceJsonByNode: { 'Подготовить запрос для AI': source } },
  );
  const [dispatch] = await runCodeNode(workflow, nodeNames.dispatchValidator, [evidenceResult]);
  const guarded = dispatch.json.units_for_ai[0].verified_facts[0];
  assert.equal(guarded.status, 'requires_review');
  assert.equal(guarded.option_state_applicability, 'review_only');
  assert.equal(guarded.option_state_audit_warnings[0].code, 'resource_gate');

  const [expanded] = await runCodeNode(workflow, nodeNames.expandValidator, [dispatch]);
  const [checked] = await runCodeNode(
    workflow,
    nodeNames.checkValidator,
    [{ json: buildValidatorResponse(expanded.json, 'confirmed') }],
    { sourceJsonByNode: { 'Развернуть units для AI Validator': expanded.json } },
  );
  assert.equal(checked.json.validated_facts[0].processing_status, 'requires_review');
  assert.equal(checked.json.validated_facts[0].accepted_for_normalization, false);
});

test('selected grounded negative option remains an applicable candidate with option provenance', async () => {
  const workflow = loadWorkflow();
  const expected = manifest.expected_controls[3];
  const optionState = sourceOptionStates()[3];
  const segment = {
    semantic_block_id: 'sb_option_state',
    scope: 'primary',
    type: 'table',
    role: 'table',
    canonical_text: expected.exact_label,
    text: `${expected.exact_label}\n[OPTION_STATE selected] ${expected.exact_label}`,
    docx_option_states: [optionState],
  };
  const source = buildOptionSource(segment);
  const response = buildExtractorResponse([
    buildOptionFact('national_regime', expected.exact_label, segment.semantic_block_id),
  ]);
  const [evidenceResult] = await runCodeNode(
    workflow,
    nodeNames.validateEvidence,
    [{ json: response }],
    { sourceJsonByNode: { 'Подготовить запрос для AI': source } },
  );
  const [dispatch] = await runCodeNode(
    workflow,
    nodeNames.dispatchValidator,
    [evidenceResult],
  );
  const result = dispatch.json.units_for_ai[0];
  assert.equal(result.verified_facts.length, 1);
  assert.equal(result.verified_facts[0].status, 'found');
  assert.equal(result.verified_facts[0].option_state_applicability, 'applicable');
  assert.equal(result.verified_facts[0].option_state_evidence[0].state, 'selected');

  const [expanded] = await runCodeNode(workflow, nodeNames.expandValidator, [dispatch]);
  const [checked] = await runCodeNode(
    workflow,
    nodeNames.checkValidator,
    [{ json: buildValidatorResponse(expanded.json) }],
    { sourceJsonByNode: { 'Развернуть units для AI Validator': expanded.json } },
  );
  assert.equal(checked.json.validated_facts[0].processing_status, 'confirmed');
  assert.equal(checked.json.validated_facts[0].option_state_applicability, 'applicable');
  assert.equal(checked.json.validated_facts[0].option_state_evidence[0].state, 'selected');

  const [documentFacts] = await runCodeNode(
    workflow,
    nodeNames.collectDocumentFacts,
    [checked],
    {
      sourceJsonByNode: {
        'Сохранить analysis unit': {
          analysis_run_id: 'fixture-run',
          tender: source.tender,
          document: source.document,
          analysis_batch: { units_total: 1 },
          analysis_unit_id: 'option-state-unit',
          analysis_unit: { analysis_unit_id: 'option-state-unit' },
          unit_db_id: 'fixture-unit-db',
        },
      },
    },
  );
  const storedAudit = documentFacts.json.facts[0].validator_meta.option_state;
  assert.equal(storedAudit.applicability, 'applicable');
  assert.equal(storedAudit.evidence[0].state, 'selected');
});

test('mixed selected and unselected facts survive Validator mapping without reviving the excluded fact', async () => {
  const workflow = loadWorkflow();
  const selected = sourceOptionStates()[3];
  const unselected = sourceOptionStates()[0];
  const segment = {
    semantic_block_id: 'sb_mixed_option_state',
    scope: 'primary',
    type: 'table',
    role: 'table',
    canonical_text: `${selected.exact_label}\n${unselected.exact_label}`,
    text: `${selected.exact_label}\n${unselected.exact_label}`,
    docx_option_states: [selected, unselected],
  };
  const source = buildOptionSource(segment, 'mixed-option-unit');
  const [evidenceResult] = await runCodeNode(
    workflow,
    nodeNames.validateEvidence,
    [{ json: buildExtractorResponse([
      buildOptionFact('national_regime', selected.exact_label, segment.semantic_block_id),
      buildOptionFact('national_regime', unselected.exact_label, segment.semantic_block_id),
    ], 'mixed-option-unit') }],
    { sourceJsonByNode: { 'Подготовить запрос для AI': source } },
  );
  const [dispatch] = await runCodeNode(workflow, nodeNames.dispatchValidator, [evidenceResult]);
  const [expanded] = await runCodeNode(workflow, nodeNames.expandValidator, [dispatch]);
  const [checked] = await runCodeNode(
    workflow,
    nodeNames.checkValidator,
    [{ json: buildValidatorResponse(expanded.json) }],
    { sourceJsonByNode: { 'Развернуть units для AI Validator': expanded.json } },
  );
  assert.equal(checked.json.validated_facts.length, 2);
  assert.equal(checked.json.validated_facts[0].processing_status, 'confirmed');
  assert.equal(checked.json.validated_facts[0].option_state_applicability, 'applicable');
  assert.equal(checked.json.validated_facts[1].processing_status, 'rejected');
  assert.equal(checked.json.validated_facts[1].option_state_applicability, 'excluded');
});

test('convergence converts option-state rejection-only units without weakening AI units', async () => {
  const workflow = loadWorkflow();
  const states = [sourceOptionStates()[3], sourceOptionStates()[0]];
  const evidenceItems = [];
  for (let index = 0; index < states.length; index += 1) {
    const optionState = states[index];
    const analysisUnitId = `converge-option-${index}`;
    const segment = {
      semantic_block_id: `sb_converge_${index}`,
      scope: 'primary',
      type: 'table',
      role: 'table',
      canonical_text: optionState.exact_label,
      text: optionState.exact_label,
      docx_option_states: [optionState],
    };
    const [evidenceResult] = await runCodeNode(
      workflow,
      nodeNames.validateEvidence,
      [{ json: buildExtractorResponse([
        buildOptionFact('national_regime', optionState.exact_label, segment.semantic_block_id),
      ], analysisUnitId) }],
      { sourceJsonByNode: { 'Подготовить запрос для AI': buildOptionSource(segment, analysisUnitId) } },
    );
    evidenceResult.json.analysis_batch.units_total = 2;
    evidenceItems.push(evidenceResult);
  }
  const [dispatch] = await runCodeNode(workflow, nodeNames.dispatchValidator, evidenceItems);
  const [expanded] = await runCodeNode(workflow, nodeNames.expandValidator, [dispatch]);
  const [checked] = await runCodeNode(
    workflow,
    nodeNames.checkValidator,
    [{ json: buildValidatorResponse(expanded.json) }],
    { sourceJsonByNode: { 'Развернуть units для AI Validator': expanded.json } },
  );
  const converged = await runCodeNode(
    workflow,
    nodeNames.convergeValidator,
    [checked],
    { sourceJsonByNode: { 'Подготовить dispatch AI Validator': dispatch.json } },
  );
  assert.equal(converged.length, 2);
  assert.deepEqual(
    converged.map(({ json }) => json.validated_facts[0].processing_status),
    ['confirmed', 'rejected'],
  );
});

test('AI-only option marker cannot be accepted as a canonical evidence quote', async () => {
  const workflow = loadWorkflow();
  const expected = manifest.expected_controls[3];
  const marker = `[OPTION_STATE selected] ${expected.exact_label}`;
  const segment = {
    semantic_block_id: 'sb_option_state',
    scope: 'primary',
    type: 'table',
    role: 'table',
    canonical_text: expected.exact_label,
    text: `${expected.exact_label}\n${marker}`,
    docx_option_states: [sourceOptionStates()[3]],
  };
  const source = buildOptionSource(segment);
  const fact = buildOptionFact('national_regime', expected.exact_label, segment.semantic_block_id);
  fact.evidence[0].quote = marker;
  const [result] = await runCodeNode(
    workflow,
    nodeNames.validateEvidence,
    [{ json: buildExtractorResponse([fact]) }],
    { sourceJsonByNode: { 'Подготовить запрос для AI': source } },
  );
  assert.equal(result.json.validation_passed, false);
  assert.ok(result.json.violations.some(({ code }) => code === 'quote_not_found'));
});

test('missing document relationship is unknown with audit warning', async () => {
  const result = await runOptionParser({
    xmlMutator(items) {
      const rels = findStructuredPart(items, 'word/_rels/document.xml.rels');
      rels.Relationships.Relationship = rels.Relationships.Relationship.filter(
        ({ $ }) => $.Id !== 'rId18',
      );
    },
  });
  expectFailClosed(stateByName(result, 'CommonSupplierCheckBox11'), 'missing_document_relationship');
});

test('missing ActiveX binary relationship is unknown with audit warning', async () => {
  const result = await runOptionParser({
    xmlMutator(items) {
      const rels = findStructuredPart(items, 'word/activeX/_rels/activeX5.xml.rels');
      rels.Relationships.Relationship = [];
    },
  });
  expectFailClosed(stateByName(result, 'CommonSupplierCheckBox11'), 'missing_activex_relationship');
});

test('unknown CLSID is unsupported and cannot prove selection', async () => {
  const result = await runOptionParser({
    xmlMutator(items) {
      findStructuredPart(items, 'word/activeX/activeX5.xml')['ax:ocx'].$['ax:classid'] =
        '{00000000-0000-0000-0000-000000000000}';
    },
  });
  const record = stateByName(result, 'CommonSupplierCheckBox11');
  assert.equal(record.control_type, 'unsupported');
  expectFailClosed(record, 'unsupported_control_class');
});

test('malformed CFB is unknown with audit warning', async () => {
  const result = await runOptionParser({
    binaryOverrides: new Map([['word/activeX/activeX5.bin', Buffer.from('not-a-compound-file')]]),
  });
  expectFailClosed(stateByName(result, 'CommonSupplierCheckBox11'), 'malformed_cfb');
});

test('unsupported ActiveX persistence is unknown with audit warning', async () => {
  const result = await runOptionParser({
    xmlMutator(items) {
      findStructuredPart(items, 'word/activeX/activeX5.xml')['ax:ocx'].$['ax:persistence'] = 'persistStream';
    },
  });
  expectFailClosed(stateByName(result, 'CommonSupplierCheckBox11'), 'unsupported_persistence');
});

test('missing MS-OFORMS Value is unknown rather than synthetic negative', async () => {
  const binaryOverrides = new Map([[
    'word/activeX/activeX5.bin',
    buildCfbWithContents(buildMorphDataContents({ displayStyle: 4, value: null })),
  ]]);
  const result = await runOptionParser({ binaryOverrides });
  expectFailClosed(stateByName(result, 'CommonSupplierCheckBox11'), 'missing_value');
});

test('MS-OFORMS Value other than 0 or 1 is indeterminate, never selected', async () => {
  const binaryOverrides = new Map([[
    'word/activeX/activeX5.bin',
    buildCfbWithContents(buildMorphDataContents({ displayStyle: 4, value: '2' })),
  ]]);
  const result = await runOptionParser({ binaryOverrides });
  expectFailClosed(stateByName(result, 'CommonSupplierCheckBox11'), 'indeterminate_value', 'indeterminate');
});

test('one control mapping to multiple labels is unknown', async () => {
  const result = await runOptionParser({
    xmlMutator(items) {
      const document = findStructuredPart(items, 'word/document.xml');
      document['w:document']['w:body'][0]['w:tbl'][0]['w:tr'][0]['w:tc'][1]
        ['w:tbl'][0]['w:tr'][0]['w:tc'].push({
        'w:p': [textParagraph('Вторая независимая подпись')],
      });
    },
  });
  expectFailClosed(stateByName(result, 'CommonSupplierCheckBox11'), 'ambiguous_label_mapping');
});

test('one label mapping to multiple controls is unknown', async () => {
  const result = await runOptionParser({
    xmlMutator(items) {
      const document = findStructuredPart(items, 'word/document.xml');
      const object = document['w:document']['w:body'][0]['w:tbl'][0]
        ['w:tr'][0]['w:tc'][1]['w:tbl'][0]['w:tr'][0]
        ['w:tc'][0]['w:p'][0]['w:r'][0]['w:object'][0];
      object['w:control'].push({ $: { 'r:id': 'rId91', 'w:name': 'DuplicateFixtureControl' } });
      const rels = findStructuredPart(items, 'word/_rels/document.xml.rels');
      rels.Relationships.Relationship.push({
        $: {
          Id: 'rId91',
          Type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/control',
          Target: 'activeX/activeX6.xml',
        },
      });
    },
  });
  expectFailClosed(stateByName(result, 'CommonSupplierCheckBox11'), 'ambiguous_control_mapping');
  expectFailClosed(stateByName(result, 'DuplicateFixtureControl'), 'ambiguous_control_mapping');
});

const cfbGateCases = [
  {
    name: 'unsupported CFB sector size',
    warning: 'unsupported_sector_size',
    options: { sectorShift: 10 },
  },
  {
    name: 'out-of-range CFB directory sector',
    warning: 'cfb_sector_out_of_range',
    options: { firstDirectorySector: 99 },
  },
  {
    name: 'cyclic CFB directory FAT chain',
    warning: 'cfb_chain_cycle',
    options: { directoryCycle: true },
  },
  {
    name: 'cyclic CFB miniFAT chain',
    warning: 'cfb_chain_cycle',
    options: { miniFatCycle: true },
  },
  {
    name: 'CFB chain count over limit',
    warning: 'cfb_chain_limit_exceeded',
    options: { numMiniFatSectors: 4097 },
  },
  {
    name: 'CFB contents stream over limit',
    warning: 'contents_stream_too_large',
    options: { declaredStreamSize: (1024 * 1024) + 1 },
  },
  {
    name: 'out-of-range CFB FAT sector',
    warning: 'cfb_sector_out_of_range',
    options: { fatSectorIndex: 99 },
  },
  {
    name: 'orphan CFB contents stream',
    warning: 'missing_reachable_contents',
    options: { rootChild: 0xffffffff },
  },
  {
    name: 'out-of-range CFB root child',
    warning: 'cfb_directory_entry_out_of_range',
    options: { rootChild: 99 },
  },
  {
    name: 'out-of-range CFB directory sibling',
    warning: 'cfb_directory_entry_out_of_range',
    options: { contentsRight: 99 },
  },
  {
    name: 'cyclic CFB directory tree',
    warning: 'cfb_directory_tree_cycle',
    options: { contentsLeft: 1 },
  },
];

for (const gateCase of cfbGateCases) {
  test(`${gateCase.name} is fail-closed with audit warning`, async () => {
    const contents = buildMorphDataContents({ displayStyle: 4, value: '0' });
    const binaryOverrides = new Map([[
      'word/activeX/activeX5.bin',
      buildCfbWithContents(contents, gateCase.options),
    ]]);
    const result = await runOptionParser({ binaryOverrides });
    expectFailClosed(stateByName(result, 'CommonSupplierCheckBox11'), gateCase.warning);
  });
}
