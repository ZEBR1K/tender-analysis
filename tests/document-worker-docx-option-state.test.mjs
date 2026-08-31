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
});

const classIds = Object.freeze({
  checkbox: '{8BD21D40-EC42-11CE-9E0D-00AA006002F3}',
  option_button: '{8BD21D50-EC42-11CE-9E0D-00AA006002F3}',
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

async function runCodeNode(workflow, nodeName, inputItems) {
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
  });
  const result = await new vm.Script(
    `(async function () { ${node.parameters.jsCode}\n }).call(__executionContext)`,
  ).runInContext(context);
  return JSON.parse(JSON.stringify(Array.isArray(result) ? result : [result]));
}

function textParagraph(text) {
  return { 'w:r': [{ 'w:t': [text] }] };
}

function controlParagraph(expected) {
  return {
    'w:r': [{
      'w:object': [{
        'w:control': [{
          $: {
            'r:id': expected.document_rel_id,
            'w:name': expected.control_name,
          },
        }],
      }],
    }],
  };
}

function tableForControls(expectedControls) {
  return {
    'w:tr': expectedControls.map((expected) => ({
      'w:tc': [
        { 'w:p': [controlParagraph(expected)] },
        { 'w:p': [textParagraph(expected.exact_label)] },
      ],
    })),
  };
}

function structuredXmlItems() {
  const nationalRegime = manifest.expected_controls.slice(0, 4);
  const participationGuarantee = manifest.expected_controls.slice(4);
  const items = [{
    json: {
      docx_part_path: 'word/document.xml',
      docx_part_kind: 'structured_xml',
      'w:document': {
        'w:body': [{
          'w:tbl': [
            tableForControls(nationalRegime),
            tableForControls(participationGuarantee),
          ],
          'w:sectPr': [''],
        }],
      },
    },
  }, {
    json: {
      docx_part_path: 'word/_rels/document.xml.rels',
      docx_part_kind: 'structured_xml',
      Relationships: {
        Relationship: manifest.expected_controls.map((expected) => ({
          $: {
            Id: expected.document_rel_id,
            Type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/control',
            Target: expected.control_rel_target.replace(/^word\//u, ''),
          },
        })),
      },
    },
  }];

  for (const expected of manifest.expected_controls) {
    const xmlPath = expected.control_rel_target;
    const relsPath = path.posix.join(
      path.posix.dirname(xmlPath),
      '_rels',
      `${path.posix.basename(xmlPath)}.rels`,
    );
    items.push({
      json: {
        docx_part_path: xmlPath,
        docx_part_kind: 'structured_xml',
        'ax:ocx': {
          $: {
            'ax:classid': classIds[expected.control_type],
            'ax:persistence': 'persistStorage',
            'r:id': expected.binary_rel_id,
          },
        },
      },
    });
    items.push({
      json: {
        docx_part_path: relsPath,
        docx_part_kind: 'structured_xml',
        Relationships: {
          Relationship: [{
            $: {
              Id: expected.binary_rel_id,
              Type: 'http://schemas.microsoft.com/office/2006/relationships/activeXControlBinary',
              Target: path.posix.basename(expected.binary_rel_target),
            },
          }],
        },
      },
    });
  }
  return items;
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
  ]);
  assert.deepEqual(connectedTargets(workflow, nodeNames.routeXml, 1), [
    { node: nodeNames.collectParts, index: 1 },
  ]);
  assert.deepEqual(connectedTargets(workflow, nodeNames.extractXmlText), [
    { node: nodeNames.parseXml, index: 0 },
    { node: nodeNames.bindParsedXml, index: 0 },
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
      document['w:document']['w:body'][0]['w:tbl'][0]['w:tr'][0]['w:tc'].push({
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
        ['w:tr'][0]['w:tc'][0]['w:p'][0]['w:r'][0]['w:object'][0];
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
