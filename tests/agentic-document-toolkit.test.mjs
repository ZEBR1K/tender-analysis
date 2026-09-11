import assert from 'node:assert/strict';
import {
  access,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { spawn } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const templateRoot = path.join(root, 'deploy', 'codex-runner', 'agent-template');
const skillRoot = path.join(
  templateRoot,
  '.agents',
  'skills',
  'tender-document-analysis',
);
const scriptsRoot = path.join(skillRoot, 'scripts');
const scriptNames = [
  'search-pdf-text.mjs',
  'render-pdf-pages.mjs',
  'ocr-image.mjs',
  'render-office.mjs',
  'ooxml-part.mjs',
];

async function importScript(name) {
  return import(pathToFileURL(path.join(scriptsRoot, name)).href);
}

function runNode(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { shell: false, windowsHide: true });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => resolve({
      code,
      stdout: Buffer.concat(stdout).toString('utf8'),
      stderr: Buffer.concat(stderr).toString('utf8'),
    }));
  });
}

test('focused skill ships the documented local helper set', async () => {
  await access(path.join(skillRoot, 'references', 'tool-recipes.md'));
  for (const name of ['document-toolkit-lib.mjs', ...scriptNames]) {
    await access(path.join(scriptsRoot, name));
  }

  const [agents, skill, recipes] = await Promise.all([
    readFile(path.join(templateRoot, 'AGENTS.md'), 'utf8'),
    readFile(path.join(skillRoot, 'SKILL.md'), 'utf8'),
    readFile(path.join(skillRoot, 'references', 'tool-recipes.md'), 'utf8'),
  ]);
  assert.ok(agents.trim().split(/\s+/u).length < 180, 'AGENTS.md must stay concise');
  assert.match(agents, /text search or OCR miss[^\n]+not evidence of absence/iu);
  assert.match(agents, /visually inspect/iu);
  assert.match(agents, /only the current job/iu);
  assert.match(skill, /references\/tool-recipes\.md/u);
  assert.match(skill, /Do not\s+pre-index every document, page, sheet, or OOXML part/iu);
  assert.match(skill, /OCR[^\n]+navigation aid/iu);
  assert.match(skill, /\.source[^\n]+byte-for-byte workspace alias/iu);
  assert.match(recipes, /sha256sum/iu);
  assert.match(recipes, /manifest `file_name` and `mime_type`/iu);
  for (const name of scriptNames) {
    assert.match(skill, new RegExp(name.replaceAll('.', '\\.')));
    assert.match(recipes, new RegExp(name.replaceAll('.', '\\.')));
  }
  assert.doesNotMatch(skill, /\b(?:PRICE|VAT|NEGATIVE|CONFLICT)\b|field-specific validator/u);
});

test('PDF text helper finds a plain term on the original page number', async () => {
  const {
    NO_MATCH_WARNING,
    buildPdftotextArgs,
    findPageMatches,
    searchPageMatches,
    splitPdfPages,
  } = await importScript('search-pdf-text.mjs');
  const pages = Array.from({ length: 45 }, (_, index) => (
    index === 42 ? 'Обеспечение заявки составляет 2 процента.' : `Страница ${index + 1}`
  ));
  const text = `${pages.join('\f')}\f`;

  assert.equal(splitPdfPages(text).length, 45);
  assert.deepEqual(buildPdftotextArgs('/input/source.pdf'), [
    '-layout',
    '-enc',
    'UTF-8',
    '/input/source.pdf',
    '-',
  ]);
  const matches = findPageMatches(text, ['обеспечение', 'несуществующий термин']);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].page, 43);
  assert.deepEqual(matches[0].terms, ['обеспечение']);
  assert.match(matches[0].snippet, /2 процента/u);
  assert.match(NO_MATCH_WARNING, /not evidence of absence/iu);

  const fiftyPages = `${Array.from({ length: 50 }, () => 'needle').join('\f')}\f`;
  const fifty = searchPageMatches(fiftyPages, ['needle']);
  assert.equal(fifty.matches.length, 50);
  assert.equal(fifty.truncated, false);
  const fiftyOnePages = `${Array.from({ length: 51 }, () => 'needle').join('\f')}\f`;
  const fiftyOne = searchPageMatches(fiftyOnePages, ['needle']);
  assert.equal(fiftyOne.matches.length, 50);
  assert.equal(fiftyOne.truncated, true);
});

test('PDF renderer accepts only an explicit bounded page range and sane DPI', async () => {
  const {
    buildPdftoppmArgs,
    parseRenderedPages,
    parseRenderRequest,
  } = await importScript('render-pdf-pages.mjs');
  assert.deepEqual(parseRenderRequest(['source.pdf', '43', '45', '--dpi=250']), {
    source: 'source.pdf',
    startPage: 43,
    endPage: 45,
    dpi: 250,
  });
  assert.throws(() => parseRenderRequest(['source.pdf', '1', '21']), /at most 20 pages/iu);
  assert.throws(() => parseRenderRequest(['source.pdf', '1', '--dpi=500']), /96 and 400/iu);
  assert.deepEqual(buildPdftoppmArgs('/input/source.pdf', '/tmp/page', {
    startPage: 43,
    endPage: 45,
    dpi: 250,
  }), [
    '-png',
    '-r',
    '250',
    '-f',
    '43',
    '-l',
    '45',
    '/input/source.pdf',
    '/tmp/page',
  ]);
  assert.deepEqual(
    parseRenderedPages(['page-43.png', 'page-44.png', 'page-45.png'], '/tmp/render', {
      startPage: 43,
      endPage: 45,
    }),
    [
      { page: 43, image: path.join('/tmp/render', 'page-43.png') },
      { page: 44, image: path.join('/tmp/render', 'page-44.png') },
      { page: 45, image: path.join('/tmp/render', 'page-45.png') },
    ],
  );
  assert.throws(
    () => parseRenderedPages(['page-43.png'], '/tmp/render', { startPage: 43, endPage: 44 }),
    /partial PDF render/iu,
  );
});

test('OCR and Office helpers build shell-free single-source commands', async () => {
  const { buildTesseractArgs, parseOcrRequest } = await importScript('ocr-image.mjs');
  const {
    OFFICE_NAMESPACE_SCRIPT,
    buildLibreOfficeArgs,
    buildSandboxedLibreOfficeCommand,
  } = await importScript('render-office.mjs');
  assert.deepEqual(parseOcrRequest(['page.png']), {
    source: 'page.png',
    language: 'rus+eng',
  });
  assert.deepEqual(buildTesseractArgs('/work/page.png', '/work/ocr/result', 'rus+eng'), [
    '/work/page.png',
    '/work/ocr/result',
    '-l',
    'rus+eng',
  ]);
  assert.deepEqual(buildLibreOfficeArgs('/input/form.docx', '/work/rendered'), [
    '-env:UserInstallation=file:///tmp/profile',
    '--headless',
    '--convert-to',
    'pdf',
    '--outdir',
    '/work/rendered',
    '/input/form.docx',
  ]);
  assert.deepEqual(
    buildSandboxedLibreOfficeCommand('/input/form.docx', '/work/rendered', '/work/runtime'),
    {
      command: 'unshare',
      args: [
        '--user',
        '--map-root-user',
        '--mount',
        'sh',
        '-ceu',
        OFFICE_NAMESPACE_SCRIPT,
        'render-office',
        '/work/runtime',
        'libreoffice',
        '-env:UserInstallation=file:///tmp/profile',
        '--headless',
        '--convert-to',
        'pdf',
        '--outdir',
        '/work/rendered',
        '/input/form.docx',
      ],
    },
  );
  assert.match(OFFICE_NAMESPACE_SCRIPT, /mount --bind "\$1" \/tmp/u);
  assert.match(OFFICE_NAMESPACE_SCRIPT, /exec "\$@"/u);
  assert.doesNotMatch(OFFICE_NAMESPACE_SCRIPT, /eval/u);
});

test('OOXML helper permits one normalized part and rejects traversal', async () => {
  const {
    buildUnzipArgs,
    main,
    normalizeOoxmlPart,
  } = await importScript('ooxml-part.mjs');
  assert.equal(normalizeOoxmlPart('word/document.xml'), 'word/document.xml');
  assert.equal(normalizeOoxmlPart('word\\activeX\\activeX1.xml'), 'word/activeX/activeX1.xml');
  for (const value of [
    '../secret',
    '/word/document.xml',
    '-x',
    'word/../../secret',
    'word/\u0000.xml',
    'word/*.xml',
    'word/?.xml',
    'word/[a].xml',
  ]) {
    assert.throws(() => normalizeOoxmlPart(value), /OOXML part/iu);
  }
  assert.deepEqual(buildUnzipArgs('list', '/input/form.docx'), ['-Z1', '/input/form.docx']);
  assert.deepEqual(
    buildUnzipArgs('extract', '/input/form.docx', 'word/document.xml'),
    ['-p', '/input/form.docx', 'word/document.xml'],
  );
  let written;
  let printed;
  await main(['extract', 'form.docx', 'word/document.xml'], {
    createOutputDirectory: async () => '/workspace/.tmp/document-tools/ooxml-test',
    print: (value) => { printed = value; },
    resolveInput: async () => '/input/form.docx',
    runCommand: async () => ({ stdout: Buffer.from('<document/>', 'utf8'), stderr: Buffer.alloc(0) }),
    writeFileOnce: async (target, bytes) => {
      written = { target, bytes: bytes.toString('utf8') };
      return target;
    },
  });
  assert.equal(written.bytes, '<document/>');
  assert.match(written.target, /document\.xml$/u);
  assert.equal(printed.output_path, written.target);
  assert.equal(printed.part, 'word/document.xml');

  let cleaned;
  await assert.rejects(main(['extract', 'form.docx', 'word/document.xml'], {
    createOutputDirectory: async () => '/workspace/.tmp/document-tools/ooxml-failed',
    print: () => {},
    removeOutputDirectory: async (directory) => { cleaned = directory; },
    resolveInput: async () => '/input/form.docx',
    runCommand: async () => ({ stdout: Buffer.from('<document/>', 'utf8'), stderr: Buffer.alloc(0) }),
    writeFileOnce: async () => { throw new Error('simulated write failure'); },
  }), /simulated write failure/iu);
  assert.equal(cleaned, '/workspace/.tmp/document-tools/ooxml-failed');
});

test('shared helper keeps generated files below workspace .tmp and bounds commands', async () => {
  const {
    createToolOutputDirectory,
    cleanupToolOutputAfterError,
    removeToolOutputDirectory,
    resolveRegularInput,
    runBoundedCommand,
    toolOutputRoot,
    validateGeneratedFiles,
    writeNewFile,
  } = await importScript('document-toolkit-lib.mjs');
  const workspace = path.join(root, 'fixture-workspace');
  assert.equal(toolOutputRoot(workspace), path.join(workspace, '.tmp', 'document-tools'));
  const result = await runBoundedCommand(process.execPath, ['-e', 'process.stdout.write("ok")']);
  assert.equal(result.stdout.toString('utf8'), 'ok');
  await assert.rejects(
    runBoundedCommand(process.execPath, ['-e', 'process.stdout.write("123456")'], { maxBytes: 5 }),
    /output limit/iu,
  );
  await assert.rejects(
    runBoundedCommand(process.execPath, ['-e', 'setTimeout(() => {}, 10000)'], { timeoutMs: 50 }),
    /timed out/iu,
  );
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'document-toolkit-'));
  const target = path.join(temporary, 'one.xml');
  try {
    await writeNewFile(target, Buffer.from('<one/>', 'utf8'));
    assert.equal(await readFile(target, 'utf8'), '<one/>');
    await assert.rejects(writeNewFile(target, Buffer.from('<two/>', 'utf8')), { code: 'EEXIST' });
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }

  const boundaryRoot = await mkdtemp(path.join(os.tmpdir(), 'document-toolkit-boundary-'));
  const boundaryWorkspace = path.join(boundaryRoot, 'job', 'workspace');
  const boundaryInput = path.join(boundaryRoot, 'job', 'input');
  const outside = path.join(boundaryRoot, 'outside');
  await Promise.all([
    mkdir(boundaryWorkspace, { recursive: true }),
    mkdir(boundaryInput, { recursive: true }),
    mkdir(outside, { recursive: true }),
  ]);
  const insideInput = path.join(boundaryInput, 'source.pdf');
  const insideWorkspace = path.join(boundaryWorkspace, 'derived.pdf');
  const outsideFile = path.join(outside, 'secret.pdf');
  await Promise.all([
    writeFile(insideInput, 'input'),
    writeFile(insideWorkspace, 'workspace'),
    writeFile(outsideFile, 'outside'),
  ]);
  try {
    assert.equal(await resolveRegularInput(insideInput, {
      extensions: ['.pdf'],
      workspaceDirectory: boundaryWorkspace,
      inputDirectory: boundaryInput,
    }), insideInput);
    assert.equal(await resolveRegularInput(insideWorkspace, {
      extensions: ['.pdf'],
      workspaceDirectory: boundaryWorkspace,
      inputDirectory: boundaryInput,
    }), insideWorkspace);
    await assert.rejects(resolveRegularInput(outsideFile, {
      extensions: ['.pdf'],
      workspaceDirectory: boundaryWorkspace,
      inputDirectory: boundaryInput,
    }), /approved job roots/iu);

    const generated = await createToolOutputDirectory('limit-test', {
      workspaceDirectory: boundaryWorkspace,
    });
    await writeFile(path.join(generated, 'large.bin'), Buffer.alloc(1024));
    await assert.rejects(validateGeneratedFiles(generated, {
      maxFileBytes: 100,
      maxTotalBytes: 100,
    }), /artifact size limit/iu);
    await removeToolOutputDirectory(generated, { workspaceDirectory: boundaryWorkspace });

    await assert.rejects(
      cleanupToolOutputAfterError(
        new Error('primary failure'),
        path.join(boundaryWorkspace, '.tmp', 'document-tools', 'missing-output'),
        {
          removeOutputDirectory: async () => { throw new Error('cleanup failure'); },
        },
      ),
      /primary failure[\s\S]*cleanup failure/iu,
    );

    const junctionWorkspace = path.join(boundaryRoot, 'junction-job', 'workspace');
    await mkdir(junctionWorkspace, { recursive: true });
    try {
      await symlink(outside, path.join(junctionWorkspace, '.tmp'), 'junction');
      await assert.rejects(
        createToolOutputDirectory('escape-test', { workspaceDirectory: junctionWorkspace }),
        /workspace|symlink|junction/iu,
      );
      await symlink(outside, path.join(junctionWorkspace, 'linked'), 'junction');
      await assert.rejects(resolveRegularInput(path.join(junctionWorkspace, 'linked', 'secret.pdf'), {
        extensions: ['.pdf'],
        workspaceDirectory: junctionWorkspace,
        inputDirectory: path.join(boundaryRoot, 'junction-job', 'input'),
      }), /approved job roots|symlink|junction/iu);
    } catch (error) {
      if (!['EPERM', 'EACCES', 'UNKNOWN'].includes(error?.code)) throw error;
    }
  } finally {
    await rm(boundaryRoot, { recursive: true, force: true });
  }
});

test('bounded command rejects only after its subprocess tree is terminated', async () => {
  const { runBoundedCommand } = await importScript('document-toolkit-lib.mjs');
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'document-toolkit-tree-'));
  const pidPath = path.join(temporary, 'child.pid');
  let childPid;
  try {
    const program = [
      "const { spawn } = require('node:child_process');",
      "const { writeFileSync } = require('node:fs');",
      "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 10000)'], { stdio: 'ignore' });",
      `writeFileSync(${JSON.stringify(pidPath)}, String(child.pid));`,
      'setInterval(() => {}, 10000);',
    ].join(' ');
    await assert.rejects(
      runBoundedCommand(process.execPath, ['-e', program], {
        cwd: temporary,
        timeoutMs: 300,
        killGraceMs: 2000,
      }),
      /timed out/iu,
    );
    childPid = Number(await readFile(pidPath, 'utf8'));
    assert.throws(
      () => process.kill(childPid, 0),
      (error) => error?.code === 'ESRCH',
      'subprocess must already be gone when the timeout rejection is returned',
    );
  } finally {
    if (Number.isSafeInteger(childPid)) {
      try { process.kill(childPid, 'SIGKILL'); } catch {}
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    await rm(temporary, { recursive: true, force: true });
  }
});

test('every document helper has local CLI help without external binaries', async () => {
  for (const name of scriptNames) {
    const result = await runNode([path.join(scriptsRoot, name), '--help']);
    assert.equal(result.code, 0, `${name}: ${result.stderr}`);
    assert.match(result.stdout, /Usage:/u, name);
  }
});

test('every document helper rejects missing arguments with a JSON error envelope', async () => {
  for (const name of scriptNames) {
    const result = await runNode([path.join(scriptsRoot, name)]);
    assert.equal(result.code, 1, name);
    const error = JSON.parse(result.stderr);
    assert.equal(error.status, 'error', name);
    assert.equal(typeof error.message, 'string', name);
    assert.ok(error.message.length > 0, name);
  }
});
