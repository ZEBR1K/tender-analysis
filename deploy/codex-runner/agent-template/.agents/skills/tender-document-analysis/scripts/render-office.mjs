import { mkdir, rm } from 'node:fs/promises';
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

export const OFFICE_NAMESPACE_SCRIPT = `
mount --bind "$1" /tmp
shift
umask 077
mkdir -p /tmp/profile /tmp/home /tmp/cache
export HOME=/tmp/home TMPDIR=/tmp XDG_CACHE_HOME=/tmp/cache
exec "$@"
`.trim();

const USAGE = `Usage:
  node render-office.mjs <source.docx|source.xlsx|source.xls>

Converts one Office document to a derived PDF below workspace .tmp. The
original remains immutable and authoritative.
`;

export function buildLibreOfficeArgs(source, outputDirectory) {
  return [
    '-env:UserInstallation=file:///tmp/profile',
    '--headless',
    '--convert-to',
    'pdf',
    '--outdir',
    outputDirectory,
    source,
  ];
}

export function buildSandboxedLibreOfficeCommand(source, outputDirectory, runtimeDirectory) {
  return {
    command: 'unshare',
    args: [
      '--user',
      '--map-root-user',
      '--mount',
      'sh',
      '-ceu',
      OFFICE_NAMESPACE_SCRIPT,
      'render-office',
      runtimeDirectory,
      'libreoffice',
      ...buildLibreOfficeArgs(source, outputDirectory),
    ],
  };
}

export async function main(args) {
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
    process.stdout.write(USAGE);
    return;
  }
  if (args.length !== 1) throw new Error('Expected exactly one Office source file');
  const source = await resolveRegularInput(args[0], { extensions: ['.docx', '.xlsx', '.xls'] });
  const outputDirectory = await createToolOutputDirectory('office-render');
  const runtimeDirectory = path.join(outputDirectory, 'runtime');
  try {
    await mkdir(runtimeDirectory, { mode: 0o700 });
    const command = buildSandboxedLibreOfficeCommand(source, outputDirectory, runtimeDirectory);
    await runBoundedCommand(
      command.command,
      command.args,
      { maxBytes: 2 * 1024 * 1024 },
    );
    await rm(runtimeDirectory, { recursive: true, force: true });
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
