import { lstat, mkdir } from 'node:fs/promises';
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

const OFFICE_RUNTIME_PATTERN = /^\/dev\/shm\/tc-[0-9a-f]{24}$/u;

const USAGE = `Usage:
  node render-office.mjs <source.docx|source.xlsx|source.xls>

Converts one Office document to a derived PDF below workspace .tmp. The
original remains immutable and authoritative.
`;

export function requiredOfficeRuntimeDirectory(environment = process.env) {
  const runtimeDirectory = environment?.TENDER_OFFICE_RUNTIME_DIR;
  if (typeof runtimeDirectory !== 'string' || !OFFICE_RUNTIME_PATTERN.test(runtimeDirectory)) {
    throw new Error('Office runtime directory is missing or invalid');
  }
  return runtimeDirectory;
}

export function buildLibreOfficeArgs(source, outputDirectory, runtimeDirectory) {
  const runtime = requiredOfficeRuntimeDirectory({
    TENDER_OFFICE_RUNTIME_DIR: runtimeDirectory,
  });
  return [
    `-env:OSL_SOCKET_PATH=${runtime}`,
    `-env:UserInstallation=file://${runtime}/profile`,
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
  const runtimeDirectory = requiredOfficeRuntimeDirectory();
  try {
    const runtimeMetadata = await lstat(runtimeDirectory);
    if (!runtimeMetadata.isDirectory() || runtimeMetadata.isSymbolicLink()) {
      throw new Error('Office runtime directory is not a real directory');
    }
    await Promise.all([
      mkdir(path.join(runtimeDirectory, 'profile'), { recursive: true, mode: 0o700 }),
      mkdir(path.join(runtimeDirectory, 'home'), { recursive: true, mode: 0o700 }),
      mkdir(path.join(runtimeDirectory, 'cache'), { recursive: true, mode: 0o700 }),
    ]);
    await runBoundedCommand(
      'libreoffice',
      buildLibreOfficeArgs(source, outputDirectory, runtimeDirectory),
      {
        maxBytes: 2 * 1024 * 1024,
        environment: {
          ...process.env,
          HOME: path.join(runtimeDirectory, 'home'),
          XDG_CACHE_HOME: path.join(runtimeDirectory, 'cache'),
        },
      },
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
