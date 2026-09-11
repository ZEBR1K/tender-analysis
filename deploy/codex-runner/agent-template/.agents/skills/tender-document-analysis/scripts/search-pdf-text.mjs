import {
  isDirectRun,
  printJson,
  resolveRegularInput,
  runBoundedCommand,
  runCli,
} from './document-toolkit-lib.mjs';

const USAGE = `Usage:
  node search-pdf-text.mjs <source.pdf> <plain term> [more plain terms...]

Searches the existing PDF text layer for navigation. It does not run OCR and a
zero-match result is not evidence that the information is absent.
`;

export const NO_MATCH_WARNING = 'No text match is not evidence of absence. Inspect likely pages visually or use targeted OCR.';

export function buildPdftotextArgs(source) {
  return ['-layout', '-enc', 'UTF-8', source, '-'];
}

export function splitPdfPages(text) {
  const pages = String(text).replaceAll('\r', '').split('\f');
  if (pages.length > 1 && pages.at(-1) === '') pages.pop();
  return pages;
}

function normalizedTerms(terms) {
  if (!Array.isArray(terms) || terms.length === 0 || terms.length > 20) {
    throw new Error('Provide between 1 and 20 plain search terms');
  }
  return terms.map((term) => {
    const value = String(term).trim();
    if (!value || value.length > 200 || /[\u0000-\u001f]/u.test(value)) {
      throw new Error('Search terms must be nonblank plain text up to 200 characters');
    }
    return value;
  });
}

export function findPageMatches(text, terms, { maxMatches = 50, contextChars = 300 } = {}) {
  const needles = normalizedTerms(terms);
  const pages = splitPdfPages(text);
  const matches = [];
  for (const [index, rawPage] of pages.entries()) {
    const page = rawPage.replace(/\s+/gu, ' ').trim();
    const lower = page.toLocaleLowerCase('ru');
    const found = needles.filter((term) => lower.includes(term.toLocaleLowerCase('ru')));
    if (found.length === 0) continue;
    const firstAt = Math.min(...found.map((term) => lower.indexOf(term.toLocaleLowerCase('ru'))));
    matches.push({
      page: index + 1,
      terms: found,
      snippet: page.slice(Math.max(0, firstAt - contextChars), firstAt + contextChars),
    });
    if (matches.length >= maxMatches) break;
  }
  return matches;
}

export function searchPageMatches(text, terms, { maxMatches = 50, contextChars = 300 } = {}) {
  const found = findPageMatches(text, terms, {
    maxMatches: maxMatches + 1,
    contextChars,
  });
  return {
    matches: found.slice(0, maxMatches),
    truncated: found.length > maxMatches,
  };
}

export async function main(args) {
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
    process.stdout.write(USAGE);
    return;
  }
  const [sourceArg, ...terms] = args;
  const source = await resolveRegularInput(sourceArg, { extensions: ['.pdf'] });
  const { stdout } = await runBoundedCommand('pdftotext', buildPdftotextArgs(source));
  const text = stdout.toString('utf8');
  const { matches, truncated } = searchPageMatches(text, terms);
  printJson({
    schema_version: 'tender_document_text_search_v1',
    source,
    terms,
    pages_with_text: splitPdfPages(text).filter((page) => page.trim()).length,
    matches,
    truncated,
    warning: NO_MATCH_WARNING,
  });
}

if (isDirectRun(import.meta.url)) await runCli(main);
