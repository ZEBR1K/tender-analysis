import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';

export const AGENT_TEMPLATE_FILES = Object.freeze([
  'AGENTS.md',
  '.agents/skills/tender-document-analysis/SKILL.md',
  '.agents/skills/tender-document-analysis/references/tool-recipes.md',
  '.agents/skills/tender-document-analysis/scripts/document-toolkit-lib.mjs',
  '.agents/skills/tender-document-analysis/scripts/ocr-image.mjs',
  '.agents/skills/tender-document-analysis/scripts/ooxml-part.mjs',
  '.agents/skills/tender-document-analysis/scripts/render-office.mjs',
  '.agents/skills/tender-document-analysis/scripts/render-pdf-pages.mjs',
  '.agents/skills/tender-document-analysis/scripts/search-pdf-text.mjs',
]);

export function agentTemplatePath(root, relativePath) {
  if (!AGENT_TEMPLATE_FILES.includes(relativePath)) {
    throw new Error('Agent template path is not allowlisted');
  }
  return path.join(root, ...relativePath.split('/'));
}

export async function agentTemplateSha256(templateDirectory) {
  const hash = createHash('sha256');
  for (const relativePath of [...AGENT_TEMPLATE_FILES].sort()) {
    const filePath = agentTemplatePath(templateDirectory, relativePath);
    const metadata = await lstat(filePath);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error('Agent template artifact must be a regular image file');
    }
    const bytes = await readFile(filePath);
    hash.update(`${relativePath}\0${bytes.length}\0`, 'utf8');
    hash.update(bytes);
  }
  return hash.digest('hex').toUpperCase();
}
