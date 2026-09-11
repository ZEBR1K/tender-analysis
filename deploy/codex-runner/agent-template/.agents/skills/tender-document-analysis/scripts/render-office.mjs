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
  node render-office.mjs <source.docx|source.xlsx|source.xls>

Converts one Office document to a derived PDF below workspace .tmp. The
original remains immutable and authoritative.
`;

export function buildLibreOfficeArgs(source, outputDirectory) {
  return [
    '--headless',
    '--convert-to',
    'pdf',
    '--outdir',
    outputDirectory,
    source,
  ];
}

export async function main(args) {
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
    process.stdout.write(USAGE);
    return;
  }
  if (args.length !== 1) throw new Error('Expected exactly one Office source file');
  const source = await resolveRegularInput(args[0], { extensions: ['.docx', '.xlsx', '.xls'] });
  const outputDirectory = await createToolOutputDirectory('office-render');
  try {
    await runBoundedCommand(
      'libreoffice',
      buildLibreOfficeArgs(source, outputDirectory),
      { maxBytes: 2 * 1024 * 1024 },
    );
    const [pdf] = await validateGeneratedFiles(outputDirectory, {
      extensions: ['.pdf'],
      expectedCount: 1,
      maxFileBytes: 128 * 1024 * 1024,
      maxTotalBytes: 128 * 1024 * 1024,
    });
    printJson({
      schema_version: 'tender_document_office_render_v1',
      source,
      pdf: pdf.path,
      advisory: 'The PDF is a visual inspection aid; cite the immutable Office source file.',
    });
  } catch (error) {
    await cleanupToolOutputAfterError(error, outputDirectory);
  }
}

if (isDirectRun(import.meta.url)) await runCli(main);
