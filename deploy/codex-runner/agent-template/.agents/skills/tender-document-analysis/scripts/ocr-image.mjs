import path from 'node:path';

import {
  cleanupToolOutputAfterError,
  createToolOutputDirectory,
  isDirectRun,
  printJson,
  readBoundedRegularFile,
  resolveRegularInput,
  runBoundedCommand,
  runCli,
  validateGeneratedFiles,
} from './document-toolkit-lib.mjs';

const USAGE = `Usage:
  node ocr-image.mjs <page-image> [--lang=rus+eng]

Runs local Tesseract on one selected image. OCR text is a navigation aid and
must not replace visual inspection of the relevant source page.
`;

export function parseOcrRequest(args) {
  const positional = args.filter((arg) => !arg.startsWith('--lang='));
  const languageArgs = args.filter((arg) => arg.startsWith('--lang='));
  if (positional.length !== 1 || languageArgs.length > 1) {
    throw new Error('Expected one image and optional --lang');
  }
  const language = languageArgs[0]?.slice('--lang='.length) || 'rus+eng';
  if (!/^[a-z0-9_.+-]{1,80}$/iu.test(language)) throw new Error('OCR language is invalid');
  return { source: positional[0], language };
}

export function buildTesseractArgs(source, outputBase, language) {
  return [source, outputBase, '-l', language];
}

export async function main(args) {
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
    process.stdout.write(USAGE);
    return;
  }
  const request = parseOcrRequest(args);
  const source = await resolveRegularInput(request.source, {
    extensions: ['.png', '.jpg', '.jpeg', '.tif', '.tiff', '.bmp'],
  });
  const outputDirectory = await createToolOutputDirectory('ocr');
  const outputBase = path.join(outputDirectory, 'result');
  try {
    await runBoundedCommand(
      'tesseract',
      buildTesseractArgs(source, outputBase, request.language),
      { maxBytes: 2 * 1024 * 1024 },
    );
    const [output] = await validateGeneratedFiles(outputDirectory, {
      extensions: ['.txt'],
      expectedCount: 1,
      maxFileBytes: 16 * 1024 * 1024,
      maxTotalBytes: 16 * 1024 * 1024,
    });
    const text = (await readBoundedRegularFile(output.path, 16 * 1024 * 1024)).toString('utf8');
    printJson({
      schema_version: 'tender_document_ocr_v1',
      source,
      language: request.language,
      text_path: output.path,
      text_chars: text.length,
      advisory: 'OCR is a navigation aid. Confirm relevant content visually and cite the immutable source file.',
    });
  } catch (error) {
    await cleanupToolOutputAfterError(error, outputDirectory);
  }
}

if (isDirectRun(import.meta.url)) await runCli(main);
