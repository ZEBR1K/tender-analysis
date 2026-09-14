import path from 'node:path';

import {
  cleanupToolOutputAfterError,
  createToolOutputDirectory,
  isDirectRun,
  printJson,
  removeToolOutputDirectory,
  resolveRegularInput,
  runBoundedCommand,
  runCli,
  writeNewFile,
} from './document-toolkit-lib.mjs';

const USAGE = `Usage:
  node ooxml-part.mjs list <source.docx|source.xlsx>
  node ooxml-part.mjs extract <source.docx|source.xlsx> <package/part.xml>

Lists package entries or extracts one explicitly named OOXML part. It does not
unpack the complete package and does not interpret form state or field values.
`;

export function normalizeOoxmlPart(value) {
  if (
    typeof value !== 'string'
    || !value
    || /[\u0000-\u001f]/u.test(value)
    || /[*?[\]]/u.test(value)
  ) {
    throw new Error('OOXML part name is invalid');
  }
  const replaced = value.replaceAll('\\', '/');
  if (replaced.startsWith('/') || replaced.startsWith('-')) {
    throw new Error('OOXML part must be a relative package path');
  }
  const pieces = replaced.split('/');
  if (pieces.some((piece) => !piece || piece === '.' || piece === '..')) {
    throw new Error('OOXML part contains an invalid path segment');
  }
  const normalized = path.posix.normalize(replaced);
  if (normalized !== replaced || normalized.startsWith('../')) {
    throw new Error('OOXML part path is invalid');
  }
  return normalized;
}

export function buildUnzipArgs(operation, source, part) {
  if (operation === 'list') return ['-Z1', source];
  if (operation === 'extract') return ['-p', source, normalizeOoxmlPart(part)];
  throw new Error('OOXML operation must be list or extract');
}

export async function main(args, dependencies = {}) {
  const {
    cleanupAfterError = cleanupToolOutputAfterError,
    createOutputDirectory = createToolOutputDirectory,
    print = printJson,
    removeOutputDirectory = removeToolOutputDirectory,
    resolveInput = resolveRegularInput,
    runCommand = runBoundedCommand,
    writeFileOnce = writeNewFile,
  } = dependencies;
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
    process.stdout.write(USAGE);
    return;
  }
  const [operation, sourceArg, partArg] = args;
  if (!['list', 'extract'].includes(operation)) throw new Error('OOXML operation must be list or extract');
  if (!sourceArg || (operation === 'list' && args.length !== 2) || (operation === 'extract' && args.length !== 3)) {
    throw new Error('OOXML command arguments are invalid');
  }
  const source = await resolveInput(sourceArg, { extensions: ['.docx', '.xlsx'] });
  if (operation === 'list') {
    const { stdout } = await runCommand('unzip', buildUnzipArgs('list', source), {
      maxBytes: 4 * 1024 * 1024,
    });
    const entries = stdout.toString('utf8').split(/\r?\n/u).filter(Boolean);
    if (entries.length > 5000) throw new Error('OOXML package entry count exceeds the limit');
    print({
      schema_version: 'tender_document_ooxml_list_v1',
      source,
      entries,
      advisory: 'Listing package parts does not prove that every part was inspected.',
    });
    return;
  }
  const part = normalizeOoxmlPart(partArg);
  const { stdout } = await runCommand('unzip', buildUnzipArgs('extract', source, part));
  const outputDirectory = await createOutputDirectory('ooxml-part');
  const outputPath = path.join(outputDirectory, path.posix.basename(part));
  try {
    await writeFileOnce(outputPath, stdout);
    print({
      schema_version: 'tender_document_ooxml_part_v1',
      source,
      part,
      output_path: outputPath,
      bytes: stdout.length,
      advisory: 'The extracted part is an inspection aid. Do not infer a selected option without confirming the rendered source.',
    });
  } catch (error) {
    await cleanupAfterError(error, outputDirectory, { removeOutputDirectory });
  }
}

if (isDirectRun(import.meta.url)) await runCli(main);
