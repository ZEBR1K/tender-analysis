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
const parserNodeName = 'Разобрать состояния DOCX ActiveX';

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function loadWorkflow() {
  return JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
}

function fixtureParts(overrides = new Map()) {
  const parts = new Map();
  for (const part of manifest.derived_parts) {
    const override = overrides.get(part.path);
    if (override === null) continue;
    parts.set(
      part.path,
      override ?? fs.readFileSync(path.join(ooxmlRoot, ...part.path.split('/'))),
    );
  }
  return parts;
}

function binaryObjectFromParts(parts) {
  return Object.fromEntries(
    [...parts.entries()].map(([partPath, data], index) => [
      `docx_part_${index}`,
      {
        data: data.toString('base64'),
        fileName: partPath,
        fileExtension: path.extname(partPath).slice(1),
        mimeType: partPath.endsWith('.xml') || partPath.endsWith('.rels')
          ? 'application/xml'
          : 'application/octet-stream',
      },
    ]),
  );
}

async function runParser(parts = fixtureParts(), document = {}) {
  const workflow = loadWorkflow();
  const node = workflow.nodes.find(({ name }) => name === parserNodeName);
  assert.ok(node?.parameters?.jsCode, `Workflow node not found: ${parserNodeName}`);

  const inputItem = {
    json: {
      analysis_run_id: 'dw18-fixture-run',
      document: {
        document_id: 'dw18-fixture-document',
        file_name: manifest.source_file_name,
        file_extension: 'docx',
        ...document,
      },
    },
    binary: binaryObjectFromParts(parts),
  };
  const executionContext = {
    helpers: {
      async getBinaryDataBuffer(itemIndex, binaryPropertyName) {
        assert.equal(itemIndex, 0);
        const descriptor = inputItem.binary[binaryPropertyName];
        assert.ok(descriptor, `Unknown binary property: ${binaryPropertyName}`);
        return Buffer.from(descriptor.data, 'base64');
      },
    },
  };
  const context = vm.createContext({
    Buffer,
    console,
    structuredClone,
    __executionContext: executionContext,
    $json: inputItem.json,
    $binary: inputItem.binary,
    $input: {
      all: () => [inputItem],
      first: () => inputItem,
      item: inputItem,
    },
  });
  const result = await new vm.Script(
    `(async function () { ${node.parameters.jsCode}\n }).call(__executionContext)`,
  ).runInContext(context);
  const resultItems = Array.isArray(result) ? result : [result];
  assert.equal(resultItems.length, 1);
  return JSON.parse(JSON.stringify(resultItems[0]));
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

function replaceOnce(buffer, before, after) {
  const source = buffer.toString('utf8');
  const index = source.indexOf(before);
  assert.notEqual(index, -1, `Mutation marker not found: ${before}`);
  assert.equal(source.indexOf(before, index + before.length), -1, `Mutation marker is not unique: ${before}`);
  return Buffer.from(source.slice(0, index) + after + source.slice(index + before.length));
}

function insertBeforeRowEnd(buffer, relationshipId, xmlFragment) {
  const source = buffer.toString('utf8');
  const marker = `r:id="${relationshipId}"`;
  const markerIndex = source.indexOf(marker);
  assert.notEqual(markerIndex, -1, `Control marker not found: ${marker}`);
  const rowEnd = source.indexOf('</w:tr>', markerIndex);
  assert.notEqual(rowEnd, -1, `Row end not found after ${marker}`);
  return Buffer.from(source.slice(0, rowEnd) + xmlFragment + source.slice(rowEnd));
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
  buffer.writeUInt32LE(0xffffffff, offset + 68);
  buffer.writeUInt32LE(0xffffffff, offset + 72);
  buffer.writeUInt32LE(child, offset + 76);
  buffer.writeUInt32LE(startSector, offset + 116);
  buffer.writeBigUInt64LE(BigInt(streamSize), offset + 120);
}

function buildCfbWithContents(contents) {
  assert.ok(contents.length > 0 && contents.length <= 128);
  const FREE = 0xffffffff;
  const END = 0xfffffffe;
  const FAT = 0xfffffffd;
  const header = Buffer.alloc(512);
  Buffer.from('d0cf11e0a1b11ae1', 'hex').copy(header, 0);
  header.writeUInt16LE(0x003e, 24);
  header.writeUInt16LE(3, 26);
  header.writeUInt16LE(0xfffe, 28);
  header.writeUInt16LE(9, 30);
  header.writeUInt16LE(6, 32);
  header.writeUInt32LE(1, 44);
  header.writeUInt32LE(1, 48);
  header.writeUInt32LE(4096, 56);
  header.writeUInt32LE(2, 60);
  header.writeUInt32LE(1, 64);
  header.writeUInt32LE(END, 68);
  for (let offset = 76; offset < 512; offset += 4) header.writeUInt32LE(FREE, offset);
  header.writeUInt32LE(0, 76);

  const fat = Buffer.alloc(512, 0xff);
  fat.writeUInt32LE(FAT, 0);
  fat.writeUInt32LE(END, 4);
  fat.writeUInt32LE(END, 8);
  fat.writeUInt32LE(END, 12);

  const directory = Buffer.alloc(512);
  const miniSectorCount = Math.ceil(contents.length / 64);
  writeDirectoryEntry(directory, 0, {
    name: 'Root Entry',
    type: 5,
    child: 1,
    startSector: 3,
    streamSize: miniSectorCount * 64,
  });
  writeDirectoryEntry(directory, 128, {
    name: 'contents',
    type: 2,
    startSector: 0,
    streamSize: contents.length,
  });

  const miniFat = Buffer.alloc(512, 0xff);
  for (let index = 0; index < miniSectorCount; index += 1) {
    miniFat.writeUInt32LE(index + 1 < miniSectorCount ? index + 1 : END, index * 4);
  }
  const miniStream = Buffer.alloc(512);
  contents.copy(miniStream);
  return Buffer.concat([header, fat, directory, miniFat, miniStream]);
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

test('exact source controls preserve selected and unselected state with exact row labels', async () => {
  const result = await runParser();
  assert.deepEqual(
    result.json.docx_option_states.map((record) => ({
      control_name: record.control_name,
      control_type: record.control_type,
      state: record.state,
      exact_label: record.exact_label,
      source_row_ref: record.source_row_ref,
      control_rel_target: record.control_rel_target,
      binary_rel_target: record.binary_rel_target,
    })),
    manifest.expected_controls,
  );
  for (const record of result.json.docx_option_states) {
    assert.equal(record.contract_version, 'docx_option_state_v1');
    assert.equal(record.document_part, 'word/document.xml');
    assert.deepEqual(record.warnings, []);
  }
});

test('missing document relationship is unknown with audit warning', async () => {
  const parts = fixtureParts();
  const relsPath = 'word/_rels/document.xml.rels';
  parts.set(relsPath, replaceOnce(
    parts.get(relsPath),
    '  <Relationship Id="rId18" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/control" Target="activeX/activeX5.xml"/>\n',
    '',
  ));
  expectFailClosed(stateByName(await runParser(parts), 'CommonSupplierCheckBox11'), 'missing_document_relationship');
});

test('missing ActiveX binary relationship is unknown with audit warning', async () => {
  const parts = fixtureParts();
  const relsPath = 'word/activeX/_rels/activeX5.xml.rels';
  parts.set(relsPath, replaceOnce(
    parts.get(relsPath),
    '<Relationship Id="rId1" Type="http://schemas.microsoft.com/office/2006/relationships/activeXControlBinary" Target="activeX5.bin"/>',
    '',
  ));
  expectFailClosed(stateByName(await runParser(parts), 'CommonSupplierCheckBox11'), 'missing_activex_relationship');
});

test('unknown CLSID is unsupported and cannot prove selection', async () => {
  const parts = fixtureParts();
  const controlPath = 'word/activeX/activeX5.xml';
  parts.set(controlPath, replaceOnce(
    parts.get(controlPath),
    '{8BD21D40-EC42-11CE-9E0D-00AA006002F3}',
    '{00000000-0000-0000-0000-000000000000}',
  ));
  const record = stateByName(await runParser(parts), 'CommonSupplierCheckBox11');
  assert.equal(record.control_type, 'unsupported');
  expectFailClosed(record, 'unsupported_control_class');
});

test('malformed CFB is unknown with audit warning', async () => {
  const parts = fixtureParts();
  parts.set('word/activeX/activeX5.bin', Buffer.from('not-a-compound-file'));
  expectFailClosed(stateByName(await runParser(parts), 'CommonSupplierCheckBox11'), 'malformed_cfb');
});

test('unsupported ActiveX persistence is unknown with audit warning', async () => {
  const parts = fixtureParts();
  const controlPath = 'word/activeX/activeX5.xml';
  parts.set(controlPath, replaceOnce(parts.get(controlPath), 'persistStorage', 'persistStream'));
  expectFailClosed(stateByName(await runParser(parts), 'CommonSupplierCheckBox11'), 'unsupported_persistence');
});

test('missing MS-OFORMS Value is unknown rather than synthetic negative', async () => {
  const parts = fixtureParts();
  parts.set(
    'word/activeX/activeX5.bin',
    buildCfbWithContents(buildMorphDataContents({ displayStyle: 4, value: null })),
  );
  expectFailClosed(stateByName(await runParser(parts), 'CommonSupplierCheckBox11'), 'missing_value');
});

test('MS-OFORMS Value other than 0 or 1 is indeterminate, never selected', async () => {
  const parts = fixtureParts();
  parts.set(
    'word/activeX/activeX5.bin',
    buildCfbWithContents(buildMorphDataContents({ displayStyle: 4, value: '2' })),
  );
  expectFailClosed(
    stateByName(await runParser(parts), 'CommonSupplierCheckBox11'),
    'indeterminate_value',
    'indeterminate',
  );
});

test('one control mapping to multiple labels is unknown', async () => {
  const parts = fixtureParts();
  const documentPath = 'word/document.xml';
  parts.set(documentPath, insertBeforeRowEnd(
    parts.get(documentPath),
    'rId18',
    '<w:tc><w:p><w:r><w:t>Вторая независимая подпись</w:t></w:r></w:p></w:tc>',
  ));
  expectFailClosed(stateByName(await runParser(parts), 'CommonSupplierCheckBox11'), 'ambiguous_label_mapping');
});

test('one label mapping to multiple controls is unknown', async () => {
  const parts = fixtureParts();
  const documentPath = 'word/document.xml';
  const control = '<w:control r:id="rId91" w:name="DuplicateFixtureControl" w:shapeid="_fixture_duplicate"/>';
  const source = parts.get(documentPath).toString('utf8');
  const markerIndex = source.indexOf('r:id="rId18"');
  const objectEnd = source.indexOf('</w:object>', markerIndex);
  assert.notEqual(objectEnd, -1);
  parts.set(documentPath, Buffer.from(source.slice(0, objectEnd) + control + source.slice(objectEnd)));

  const relsPath = 'word/_rels/document.xml.rels';
  parts.set(relsPath, replaceOnce(
    parts.get(relsPath),
    '</Relationships>',
    '  <Relationship Id="rId91" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/control" Target="activeX/activeX6.xml"/>\n</Relationships>',
  ));
  const result = await runParser(parts);
  expectFailClosed(stateByName(result, 'CommonSupplierCheckBox11'), 'ambiguous_control_mapping');
  expectFailClosed(stateByName(result, 'DuplicateFixtureControl'), 'ambiguous_control_mapping');
});
