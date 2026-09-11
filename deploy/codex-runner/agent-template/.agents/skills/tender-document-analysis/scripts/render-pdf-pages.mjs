import path from 'node:path';

import {
  cleanupToolOutputAfterError,
  createToolOutputDirectory,
  isDirectRun,
  printJson,
  resolveRegularInput,
  runBoundedCommand,
  runCli,
  validateGeneratedFiles,
} from './document-toolkit-lib.mjs';

const USAGE = `Usage:
  node render-pdf-pages.mjs <source.pdf> <start-page> [end-page] [--dpi=200]

Renders one explicit range of at most 20 pages to workspace .tmp PNG files.
`;

function positiveInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`${label} must be a positive integer`);
  return parsed;
}

export function parseRenderRequest(args) {
  const positional = args.filter((arg) => !arg.startsWith('--dpi='));
  const dpiArgs = args.filter((arg) => arg.startsWith('--dpi='));
  if (positional.length < 2 || positional.length > 3 || dpiArgs.length > 1) {
    throw new Error('Expected source, start page, optional end page, and optional --dpi');
  }
  const source = positional[0];
  const startPage = positiveInteger(positional[1], 'Start page');
  const endPage = positiveInteger(positional[2] ?? positional[1], 'End page');
  const dpi = positiveInteger(dpiArgs[0]?.slice('--dpi='.length) ?? '200', 'DPI');
  if (endPage < startPage) throw new Error('End page must not precede start page');
  if (endPage - startPage + 1 > 20) throw new Error('Render request may include at most 20 pages');
  if (dpi < 96 || dpi > 400) throw new Error('DPI must be between 96 and 400');
  return { source, startPage, endPage, dpi };
}

export function buildPdftoppmArgs(source, outputPrefix, { startPage, endPage, dpi }) {
  return [
    '-png',
    '-r',
    String(dpi),
    '-f',
    String(startPage),
    '-l',
    String(endPage),
    source,
    outputPrefix,
  ];
}

export function parseRenderedPages(fileNames, outputDirectory, { startPage, endPage }) {
  const pages = fileNames.map((name) => {
    const match = /^page-(\d+)\.png$/iu.exec(name);
    if (!match) throw new Error(`Partial PDF render: unexpected output file ${name}`);
    return { page: Number(match[1]), image: path.join(outputDirectory, name) };
  }).sort((left, right) => left.page - right.page);
  const expected = Array.from(
    { length: endPage - startPage + 1 },
    (_, index) => startPage + index,
  );
  if (
    pages.length !== expected.length
    || pages.some(({ page }, index) => page !== expected[index])
  ) {
    throw new Error(`Partial PDF render: expected pages ${startPage}-${endPage}`);
  }
  return pages;
}

export async function main(args) {
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
    process.stdout.write(USAGE);
    return;
  }
  const request = parseRenderRequest(args);
  const source = await resolveRegularInput(request.source, { extensions: ['.pdf'] });
  const outputDirectory = await createToolOutputDirectory('pdf-render');
  const outputPrefix = path.join(outputDirectory, 'page');
  try {
    await runBoundedCommand(
      'pdftoppm',
      buildPdftoppmArgs(source, outputPrefix, request),
      { maxBytes: 2 * 1024 * 1024 },
    );
    const files = await validateGeneratedFiles(outputDirectory, {
      extensions: ['.png'],
      expectedCount: request.endPage - request.startPage + 1,
      maxFileBytes: 64 * 1024 * 1024,
      maxTotalBytes: 256 * 1024 * 1024,
    });
    const pages = parseRenderedPages(
      files.map(({ name }) => name),
      outputDirectory,
      request,
    );
    printJson({
      schema_version: 'tender_document_pdf_render_v1',
      source,
      start_page: request.startPage,
      end_page: request.endPage,
      dpi: request.dpi,
      pages,
      advisory: 'Rendered PNG files are inspection aids; cite the immutable source file, not the PNG.',
    });
  } catch (error) {
    await cleanupToolOutputAfterError(error, outputDirectory);
  }
}

if (isDirectRun(import.meta.url)) await runCli(main);
