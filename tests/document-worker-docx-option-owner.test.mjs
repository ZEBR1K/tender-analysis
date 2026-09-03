import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workflowPath = path.join(root, 'workflows', 'n8n-exports', 'TENDER — Обработать документ.json');
const fixturePath = path.join(root, 'tests', 'fixtures', 'document-worker-docx-option-owner', 'execution-14374-structural-owner.json');
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

function workflow() {
  return JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
}

function node(graph, name) {
  const found = graph.nodes.find((candidate) => candidate.name === name);
  assert.ok(found, `Workflow node missing: ${name}`);
  return found;
}

async function runCode(name, inputItems, sources = {}) {
  const graph = workflow();
  const code = node(graph, name).parameters.jsCode;
  const items = structuredClone(inputItems);
  const first = items[0] ?? { json: {} };
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
    structuredClone,
    console,
    $json: first.json,
    $binary: first.binary ?? {},
    $input: { all: () => items, first: () => first, item: first },
    $: (sourceName) => {
      if (!Object.hasOwn(sources, sourceName)) throw new Error(`Unknown source node: ${sourceName}`);
      const values = Array.isArray(sources[sourceName]) ? sources[sourceName] : [sources[sourceName]];
      const sourceItems = values.map((json) => ({ json: structuredClone(json) }));
      return { all: () => sourceItems, first: () => sourceItems[0], itemMatching: (index) => sourceItems[index] ?? sourceItems[0], item: sourceItems[0] };
    },
    __executionContext: executionContext,
  });
  const result = await new vm.Script(`(async function () { ${code}\n }).call(__executionContext)`).runInContext(context);
  return JSON.parse(JSON.stringify(Array.isArray(result) ? result : [result]));
}

function textParagraph(text) {
  return { 'w:r': [{ 'w:t': [text] }] };
}

function parserInputItems() {
  const projection = fixture.input.parser_input_projection;
  const group = projection.outer_group_table;
  const siblingGroup = projection.sibling_group;
  const emptyTables = Array.from({ length: projection.preceding_table_count }, () => ({ 'w:tr': [] }));
  const optionTable = {
    'w:tr': group.rows.map((row) => ({
      'w:tc': [
        { 'w:p': [{ 'w:r': [{ 'w:object': [{ 'w:control': [{ $: { 'r:id': row.document_rel_id, 'w:name': row.control_name } }] }] }] }] },
        { 'w:p': [] },
        { 'w:p': [textParagraph(row.label)] },
      ],
    })),
  };
  const siblingOptionTable = {
    'w:tr': siblingGroup.rows.map((row) => ({
      'w:tc': [
        { 'w:p': [{ 'w:r': [{ 'w:object': [{ 'w:control': [{ $: { 'r:id': row.document_rel_id, 'w:name': row.control_name } }] }] }] }] },
        { 'w:p': [] },
        { 'w:p': [textParagraph(row.label)] },
      ],
    })),
  };
  const outerTable = {
    'w:tr': [
      { 'w:tc': [{ 'w:p': [] }] },
      { 'w:tc': [{ 'w:p': [] }] },
      { 'w:tc': [{ 'w:p': [] }] },
      {
        'w:tc': [
          { 'w:p': [] },
          { 'w:p': [textParagraph(group.question_text)], 'w:tbl': [optionTable] },
          { 'w:p': [textParagraph(siblingGroup.question_text)], 'w:tbl': [siblingOptionTable] },
        ],
      },
    ],
  };
  const document = {
    json: {
      docx_part_path: projection.document_part,
      docx_part_kind: 'structured_xml',
      'w:document': [{ 'w:body': [{ 'w:tbl': [...emptyTables, outerTable] }] }],
    },
  };
  const documentRels = {
    json: {
      docx_part_path: 'word/_rels/document.xml.rels',
      docx_part_kind: 'structured_xml',
      Relationships: [{
        Relationship: [...group.rows, ...siblingGroup.rows].map((row) => ({ $: {
          Id: row.document_rel_id,
          Type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/control',
          Target: row.active_x_part.replace(/^word\//u, ''),
        } })),
      }],
    },
  };
  const stateShape = {
    selected: { number: '8', source: 'activeX8' },
    unselected: { number: '5', source: 'activeX5' },
  };
  const fixtureRoot = path.join(root, 'tests', 'fixtures', 'document-worker-docx-option-state', 'ooxml', 'word', 'activeX');
  const controlItems = [...group.rows, ...siblingGroup.rows].flatMap((row) => {
    const shape = stateShape[row.state_source];
    const baseName = path.posix.basename(row.active_x_part, '.xml');
    const binaryPart = `word/activeX/${baseName}.bin`;
    return [
      {
        json: {
          docx_part_path: row.active_x_part,
          docx_part_kind: 'structured_xml',
          'ax:ocx': [{ $: { 'ax:classid': '{8BD21D40-EC42-11CE-9E0D-00AA006002F3}', 'ax:persistence': 'persistStorage', 'r:id': 'rIdBinary' } }],
        },
      },
      {
        json: {
          docx_part_path: `word/activeX/_rels/${baseName}.xml.rels`,
          docx_part_kind: 'structured_xml',
          Relationships: [{ Relationship: [{ $: { Id: 'rIdBinary', Type: 'http://schemas.microsoft.com/office/2006/relationships/activeXControlBinary', Target: `${baseName}.bin` } }] }],
        },
      },
      {
        json: { docx_part_path: binaryPart, docx_part_kind: 'binary' },
        binary: { data: { data: fs.readFileSync(path.join(fixtureRoot, `${shape.source}.bin`)).toString('base64') } },
      },
    ];
  });
  return [document, documentRels, ...controlItems];
}

function doclingDocument({ cloneAlphaTable = false } = {}) {
  const textSlots = Array.from({ length: 521 }, () => null);
  const tableSlots = Array.from({ length: cloneAlphaTable ? 61 : 60 }, () => null);
  const children = [];
  for (const entry of fixture.input.body_sequence) {
    children.push({ $ref: entry.self_ref });
    if (entry.kind === 'question') {
      const index = Number(entry.self_ref.split('/').at(-1));
      textSlots[index] = { self_ref: entry.self_ref, label: 'section_header', level: 2, text: entry.text, prov: [] };
    }
  }
  for (const table of fixture.input.tables) {
    const index = Number(table.self_ref.split('/').at(-1));
    tableSlots[index] = {
      self_ref: table.self_ref,
      label: 'table',
      prov: [],
      data: {
        num_rows: table.rows.length,
        num_cols: 3,
        table_cells: table.rows.flatMap((row) => [
          { start_row_offset_idx: row.row, end_row_offset_idx: row.row + 1, start_col_offset_idx: row.control_col, end_col_offset_idx: row.control_col + 1, text: '' },
          { start_row_offset_idx: row.row, end_row_offset_idx: row.row + 1, start_col_offset_idx: row.label_col, end_col_offset_idx: row.label_col + 1, text: row.label },
        ]),
      },
    };
  }
  if (cloneAlphaTable) {
    tableSlots[60] = structuredClone(tableSlots[58]);
    tableSlots[60].self_ref = '#/tables/60';
    children.push({ $ref: '#/tables/60' });
  }
  return {
    schema_name: 'DoclingDocument', version: 'sanitized', name: 'sanitized.docx',
    origin: { filename: 'sanitized.docx', mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', binary_hash: 'sanitized' },
    body: { children }, furniture: { children: [] }, texts: textSlots, tables: tableSlots,
    pictures: [], groups: [], key_value_items: [], form_items: [], pages: {},
  };
}

function sourceContext(optionStates = fixture.input.option_states) {
  return {
    analysis_run_id: 'sanitized-run',
    document: { document_id: 'sanitized-document', file_name: 'sanitized.docx', file_extension: 'docx' },
    docx_option_state_status: 'resolved',
    docx_option_states: structuredClone(optionStates),
    docx_option_state_audit: { contract_version: 'docx_option_state_audit_v1', warnings: [] },
  };
}

async function normalize(document = doclingDocument(), optionStates = fixture.input.option_states) {
  if (optionStates === fixture.input.option_states) {
    const [parsed] = await runCode('Разобрать состояния DOCX ActiveX', parserInputItems());
    optionStates = parsed.json.docx_option_states;
  }
  return (await runCode('Нормализовать документ Docling', [{ json: document }], {
    'связать результат Docling и метаданные': sourceContext(optionStates),
  }))[0];
}

async function semanticReplay(normalized) {
  const prepared = (await runCode('подготовить блоки к анализу', [normalized]))[0];
  return (await runCode('Собрать смысловые разделы v1.4', [prepared]))[0];
}

function sourceFromSegment(segment, analysisUnitId = 'doc_3_au_0012') {
  return {
    tender: { tender_id: 'sanitized' }, document: { document_id: 'sanitized-document' },
    analysis_batch: { units_total: 1 }, analysis_unit_meta: { analysis_unit_id: analysisUnitId },
    ai_segments: [segment],
    provenance: { index: { [segment.semantic_block_id]: { scope: 'primary', source_block_ids: [], sources: [] } } },
    ai_request: { prompt_version: 'sanitized', schema_version: 'ai_extractor_v1', field_catalog_version: 'tender_fields_v1' },
  };
}

function groundedUnit(segment, evidenceLabels, { fieldKey = 'advance_contract_guarantee', attempt = 1 } = {}) {
  const evidence = evidenceLabels.map((quote) => ({ semantic_block_id: segment.semantic_block_id, quote }));
  return {
    json: {
      tender: { tender_id: 'sanitized' }, document: { document_id: 'sanitized-document' },
      analysis_batch: { unit_index: 1, units_total: 1 },
      analysis_unit_meta: { analysis_unit_id: 'doc_3_au_0012' },
      validation_attempt: attempt, validation_passed: true, violations: [],
      verified_facts: [{ fact_index: 0, field_key: fieldKey, value_text: 'VALUE_TOKEN', status: 'found', confidence: 0.99, evidence, review_reason_code: null, review_note: null }],
      deterministically_rejected_facts: [], resolved_violations: [],
      evidence_context: { [segment.semantic_block_id]: segment },
      extractor: { prompt_version: 'sanitized', schema_version: 'ai_extractor_v1', field_catalog_version: 'tender_fields_v1' },
      evidence_validation: { version: 'evidence_validator_v1', passed: true },
    },
  };
}

function validatorSourceWithOptionFacts() {
  const evidence = [{ semantic_block_id: 'sb_0466', scope: 'primary', quote: 'OPTION_ALPHA_SELECTED' }];
  const mapped = {
    ...fixture.input.option_states[0],
    mapping_status: 'mapped',
    option_group_id: 'word/document.xml#table[62]#group[1-3]',
    question_owner: { source_block_id: '#/texts/513', semantic_block_id: 'sb_0465' },
  };
  const missingOwner = { ...mapped, mapping_status: 'missing_owner', question_owner: null };
  return {
    tender: { tender_id: 'sanitized' },
    document: { document_id: 'sanitized-document' },
    analysis_batch: { unit_index: 1, units_total: 1 },
    analysis_unit_meta: { analysis_unit_id: 'doc_3_au_0012' },
    evidence_validation: { version: 'evidence_validator_v1', passed: true },
    extractor: { prompt_version: 'sanitized' },
    validator_prompt_context: {
      prompt_version: 'ai_validator_prompt_v1_2',
      field_profiles_version: 'validator_field_profiles_v1',
      field_keys: ['advance_contract_guarantee', 'participation_guarantee'],
      field_profiles_text: 'SANITIZED_FIELD_PROFILES',
    },
    validator_field_keys: ['advance_contract_guarantee', 'participation_guarantee'],
    verified_facts: [
      {
        fact_index: 0, field_key: 'advance_contract_guarantee', value_text: 'OPTION_ALPHA_SELECTED', status: 'requires_review', confidence: 0.99,
        review_reason_code: 'source_quality_issue', review_note: 'Structural owner is unresolved.', evidence,
        option_state_applicability: 'review_only', option_state_evidence: [missingOwner],
        option_state_audit: { contract_version: 'docx_option_state_fact_audit_v1', mapping_status: 'missing_owner' },
      },
      {
        fact_index: 1, field_key: 'participation_guarantee', value_text: 'OPTION_ALPHA_SELECTED', status: 'found', confidence: 0.99,
        review_reason_code: null, review_note: null, evidence,
        option_state_applicability: 'applicable', option_state_evidence: [mapped],
        option_state_audit: { contract_version: 'docx_option_state_fact_audit_v1', mapping_status: 'mapped' },
      },
    ],
    deterministically_rejected_facts: [],
    evidence_context: { sb_0466: { canonical_text: 'OPTION_ALPHA_SELECTED' } },
  };
}

function confirmedValidatorResponse() {
  return {
    id: 'sanitized-response', model: 'sanitized-model', provider: 'sanitized-provider',
    choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({
      schema_version: 'ai_validator_v1', analysis_unit_id: 'doc_3_au_0012',
      validations: [
        { fact_index: 0, field_key: 'advance_contract_guarantee', verdict: 'confirmed', confidence: 0.99, reason_code: null, reason_note: null },
        { fact_index: 1, field_key: 'participation_guarantee', verdict: 'confirmed', confidence: 0.99, reason_code: null, reason_note: null },
      ],
    }) } }],
    usage: {},
  };
}

test('fixture is execution-derived, neutral, and preserves equality/collision topology', () => {
  const raw = fs.readFileSync(fixturePath, 'utf8');
  assert.equal(fixture.source_execution, 14374);
  assert.equal(fixture.observed_boundary.analysis_unit_id, 'doc_3_au_0012');
  assert.equal(fixture.observed_boundary.question_semantic_block_id, 'sb_0465');
  assert.equal(fixture.observed_boundary.option_semantic_block_id, 'sb_0466');
  assert.deepEqual(fixture.observed_boundary.states, ['selected', 'unselected', 'unselected']);
  assert.equal(raw.includes('https://'), false);
  assert.equal(/[А-Яа-яЁё]/u.test(raw), false);
  const shared = fixture.input.option_states.filter(({ exact_label: label }) => label === 'OPTION_SHARED');
  assert.equal(shared.length, 2);
  assert.notEqual(shared[0].source_row_ref.split('/row')[0], shared[1].source_row_ref.split('/row')[0]);
});

test('RED: real ActiveX parser derives exact cells and one typed structural question-owner candidate', async () => {
  const [parsed] = await runCode('Разобрать состояния DOCX ActiveX', parserInputItems());
  assert.equal(parsed.json.docx_option_state_status, 'resolved');
  const targetOptions = parsed.json.docx_option_states.filter(({ source_table_ref: tableRef }) => tableRef === fixture.oracle.target_group.source_table_ref);
  assert.deepEqual(targetOptions.map(({ state }) => state), ['selected', 'unselected', 'unselected']);
  const expected = fixture.oracle.target_group;
  for (const option of targetOptions) {
    assert.equal(option.source_table_ref, expected.source_table_ref);
    assert.match(option.source_row_ref, /^word\/document\.xml#table\[62\]\/row\[[123]\]$/u);
    assert.match(option.source_control_cell_ref, /\/cell\[1\]$/u);
    assert.match(option.source_label_cell_ref, /\/cell\[3\]$/u);
    assert.equal(option.structural_group_candidate?.relation, 'direct_enclosing_cell_child');
    assert.equal(option.structural_group_candidate?.question_source_ref, fixture.input.nested_table_case.question_ref);
    assert.equal(option.structural_group_candidate?.question_text, 'QUESTION_ALPHA');
    assert.equal(option.structural_group_candidate?.candidate_count, 1);
  }
});

test('RED: current Normalizer preserves exact states but lacks unique question/group/semantic ownership', async () => {
  const normalized = await normalize();
  const owner = normalized.json.blocks.find(({ block_id: id }) => id === '#/tables/58');
  assert.deepEqual(owner.docx_option_states.map(({ state }) => state), ['selected', 'unselected', 'unselected']);
  assert.deepEqual(owner.docx_option_states.map(({ exact_label: label }) => label), ['OPTION_ALPHA_SELECTED', 'OPTION_SHARED', 'OPTION_ALPHA_OTHER']);
  for (const option of owner.docx_option_states) {
    assert.equal(option.mapping_status, 'mapped');
    assert.equal(typeof option.option_group_id, 'string');
    assert.equal(option.question_owner?.source_block_id, '#/texts/513');
    assert.equal(option.source_table_ref, 'word/document.xml#table[62]');
    assert.equal(typeof option.source_control_cell_ref, 'string');
    assert.equal(typeof option.source_label_cell_ref, 'string');
  }
});

test('RED: duplicate option labels bind inside their own structural question groups', async () => {
  const semantic = await semanticReplay(await normalize());
  const alpha = semantic.json.semantic_blocks.find(({ semantic_block_id: id }) => id === 'sb_0002');
  const beta = semantic.json.semantic_blocks.find(({ semantic_block_id: id }) => id === 'sb_0004');
  const alphaShared = alpha.docx_option_states.find(({ exact_label: label }) => label === 'OPTION_SHARED');
  const betaShared = beta.docx_option_states.find(({ exact_label: label }) => label === 'OPTION_SHARED');
  assert.notEqual(alphaShared.option_group_id, betaShared.option_group_id);
  assert.equal(alphaShared.question_owner.semantic_block_id, 'sb_0001');
  assert.equal(betaShared.question_owner.semantic_block_id, 'sb_0003');
});

test('RED: AI-visible segment carries proven owner/group/state while canonical text is unchanged', async () => {
  const semantic = await semanticReplay(await normalize());
  semantic.json.analysis_units = [{ analysis_unit_id: 'doc_3_au_0012', primary_semantic_block_ids: ['sb_0001', 'sb_0002'], overlap_semantic_block_ids: [] }];
  const expanded = await runCode('Развернуть части для AI v1.2', [semantic]);
  const segment = expanded[0].json.ai_segments.find(({ semantic_block_id: id }) => id === 'sb_0002');
  const canonical = semantic.json.semantic_blocks.find(({ semantic_block_id: id }) => id === 'sb_0002').text;
  assert.equal(segment.canonical_text, canonical);
  assert.ok(segment.text.includes('[OPTION_STATE selected]'));
  assert.ok(segment.text.includes('[OPTION_GROUP'));
  assert.ok(segment.text.includes('QUESTION_ALPHA'));
  assert.ok(segment.docx_option_states.every(({ mapping_status: status }) => status === 'mapped'));
  assert.ok(segment.docx_option_states.every(({ question_owner: owner }) => owner.semantic_block_id === 'sb_0001'));
});

test('RED: AI-visible text never presents unresolved selected state as applicable', async () => {
  const semantic = await semanticReplay(await normalize());
  const target = semantic.json.semantic_blocks.find(({ semantic_block_id: id }) => id === 'sb_0002');
  target.docx_option_states = target.docx_option_states.map((option) => ({
    ...option,
    mapping_status: 'multiple_owners',
    question_owner: null,
  }));
  semantic.json.analysis_units = [{ analysis_unit_id: 'doc_3_au_0012', primary_semantic_block_ids: ['sb_0001', 'sb_0002'], overlap_semantic_block_ids: [] }];
  const expanded = await runCode('Развернуть части для AI v1.2', [semantic]);
  const segment = expanded[0].json.ai_segments.find(({ semantic_block_id: id }) => id === 'sb_0002');
  assert.doesNotMatch(segment.text, /\[OPTION_STATE selected\]/u);
  assert.doesNotMatch(segment.text, /applicable/iu);
  assert.match(segment.text, /OPTION_STATE unknown|OPTION_MAPPING review_only/u);
});

test('RED: mutually exclusive selected and unselected evidence cannot jointly support confirmed', async () => {
  const segment = {
    semantic_block_id: 'sb_0466', scope: 'primary', type: 'table', role: 'table',
    canonical_text: 'OPTION_ALPHA_SELECTED\nOPTION_SHARED\nOPTION_ALPHA_OTHER',
    text: 'OPTION_ALPHA_SELECTED\nOPTION_SHARED\nOPTION_ALPHA_OTHER',
    docx_option_states: fixture.input.option_states.slice(0, 3),
  };
  const dispatch = await runCode('Подготовить dispatch AI Validator', [groundedUnit(segment, ['OPTION_ALPHA_SELECTED', 'OPTION_SHARED'])]);
  const fact = dispatch[0].json.units_for_ai[0].verified_facts[0];
  assert.equal(fact.status, 'requires_review');
  assert.equal(fact.option_state_applicability, 'review_only');
  assert.equal(fact.accepted_for_normalization, false);
  assert.equal(fact.option_state_audit.mapping_status, 'multiple_option_states');
});

test('RED: unselected sibling is excluded universally, including advance_contract_guarantee', async () => {
  const option = fixture.input.option_states[1];
  const segment = { semantic_block_id: 'sb_0466', scope: 'primary', type: 'table', role: 'table', canonical_text: option.exact_label, text: option.exact_label, docx_option_states: [option] };
  const dispatch = await runCode('Подготовить dispatch AI Validator', [groundedUnit(segment, [option.exact_label])]);
  const excludedUnit = dispatch[0].json.units_without_ai[0] ?? null;
  assert.ok(excludedUnit, 'unselected option must be routed without AI');
  assert.equal(excludedUnit.verified_facts.length, 0);
  assert.equal(excludedUnit.deterministically_rejected_facts[0].deterministic_rejection.reason_code, 'unselected_option_not_applicable');
});

test('RED: unknown owner after repair path is review-only and keeps exact evidence', async () => {
  const option = { ...fixture.input.option_states[0], mapping_status: 'missing_owner', question_owner: null };
  const segment = { semantic_block_id: 'sb_0466', scope: 'primary', type: 'table', role: 'table', canonical_text: option.exact_label, text: option.exact_label, docx_option_states: [option], docx_option_state_mapping_issue_ids: ['docx_option_mapping_issue_0001'] };
  const unit = groundedUnit(segment, [option.exact_label], { attempt: 2 });
  const dispatch = await runCode('Подготовить dispatch AI Validator', [unit]);
  const fact = dispatch[0].json.units_for_ai[0].verified_facts[0];
  assert.equal(fact.status, 'requires_review');
  assert.equal(fact.accepted_for_normalization, false);
  assert.deepEqual(fact.evidence, unit.json.verified_facts[0].evidence);
});

test('RED: conflicting coordinates and multiple semantic owners fail closed', async () => {
  const conflicted = structuredClone(fixture.input.option_states.slice(0, 3));
  conflicted.push({ ...conflicted[0], source_row_ref: 'word/document.xml#table[62]/row[2]' });
  const normalizedConflict = await normalize(doclingDocument(), conflicted);
  assert.ok(normalizedConflict.json.docx_option_state_audit.semantic_mapping_warnings.some(({ code }) => code === 'conflicting_control_structural_identity'));
  const normalizedMultiple = await normalize(doclingDocument({ cloneAlphaTable: true }));
  assert.ok(normalizedMultiple.json.docx_option_state_audit.semantic_mapping_warnings.some(({ code }) => code === 'ambiguous_structural_semantic_owner'));
  for (const normalized of [normalizedConflict, normalizedMultiple]) {
    const candidate = normalized.json.blocks.find(({ docx_option_state_mapping_issue_ids: ids = [] }) => ids.length > 0);
    assert.ok(candidate);
    assert.ok((candidate.docx_option_states ?? []).every(({ mapping_status: status }) => status !== 'mapped'));
  }
});

test('RED: selected option with one mapped owner remains eligible for normal Validator', async () => {
  const option = { ...fixture.input.option_states[0], mapping_status: 'mapped', option_group_id: 'word/document.xml#table[62]#group[1-3]', question_owner: { source_block_id: '#/texts/513', semantic_block_id: 'sb_0465' } };
  const segment = { semantic_block_id: 'sb_0466', scope: 'primary', type: 'table', role: 'table', canonical_text: option.exact_label, text: option.exact_label, docx_option_states: [option] };
  const dispatch = await runCode('Подготовить dispatch AI Validator', [groundedUnit(segment, [option.exact_label])]);
  const fact = dispatch[0].json.units_for_ai[0].verified_facts[0];
  assert.equal(fact.status, 'found');
  assert.equal(fact.option_state_applicability, 'applicable');
  assert.equal(fact.option_state_evidence[0].question_owner.semantic_block_id, 'sb_0465');
});

test('RED: post-AI checker caps missing owner, preserves AI verdict/audit/evidence, and keeps mapped selected confirmed', async () => {
  const source = validatorSourceWithOptionFacts();
  const [checked] = await runCode(
    'Проверить ответ AI Validator',
    [{ json: confirmedValidatorResponse() }],
    { 'Развернуть units для AI Validator': source },
  );
  const unresolved = checked.json.validated_facts.find(({ fact_index: index }) => index === 0);
  const mapped = checked.json.validated_facts.find(({ fact_index: index }) => index === 1);
  assert.equal(unresolved.ai_validation.verdict, 'requires_review');
  assert.equal(unresolved.processing_status, 'requires_review');
  assert.equal(unresolved.accepted_for_normalization, false);
  assert.equal(unresolved.validator_meta.option_state_guard.original_ai_verdict, 'confirmed');
  assert.deepEqual(unresolved.option_state_audit, source.verified_facts[0].option_state_audit);
  assert.deepEqual(unresolved.evidence, source.verified_facts[0].evidence);
  assert.equal(mapped.ai_validation.verdict, 'confirmed');
  assert.equal(mapped.processing_status, 'confirmed');
  assert.equal(mapped.accepted_for_normalization, true);
  assert.deepEqual(mapped.option_state_audit, source.verified_facts[1].option_state_audit);
});

test('neutral non-option fact is unchanged', async () => {
  const segment = { semantic_block_id: 'sb_neutral', scope: 'primary', type: 'text', role: 'paragraph', canonical_text: 'NEUTRAL_EVIDENCE', text: 'NEUTRAL_EVIDENCE', docx_option_states: [] };
  const dispatch = await runCode('Подготовить dispatch AI Validator', [groundedUnit(segment, ['NEUTRAL_EVIDENCE'], { fieldKey: 'payment_terms' })]);
  const fact = dispatch[0].json.units_for_ai[0].verified_facts[0];
  assert.equal(fact.status, 'found');
  assert.equal('option_state_applicability' in fact, false);
});

test('nested-table owner relation is retained as a typed structural oracle, never proximity', () => {
  const nested = fixture.input.nested_table_case;
  assert.equal(nested.relation, 'direct_enclosing_cell_child');
  assert.equal(nested.inner_table_ref, fixture.oracle.target_group.source_table_ref);
  assert.match(nested.question_ref, /^word\/document\.xml#table\[61\]\/row\[4\]\/cell\[2\]\/paragraph\[1\]$/u);
});

test('canonical graph still contains the final dispatch and post-AI checker cap points', () => {
  const graph = workflow();
  assert.match(node(graph, 'Подготовить dispatch AI Validator').parameters.jsCode, /OPTION_STATE_GUARDED_FIELDS/u);
  assert.match(node(graph, 'Проверить ответ AI Validator').parameters.jsCode, /option_state_applicability/u);
});
