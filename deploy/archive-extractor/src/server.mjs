import { createReadStream } from 'node:fs';
import http from 'node:http';
import { pathToFileURL } from 'node:url';

import { config } from './config.mjs';
import { ArchiveError, toSafeError } from './errors.mjs';
import { extractJob as defaultExtractJob } from './extract-job.mjs';
import { createStore, validateAnalysisRunId } from './store.mjs';

function writeJson(response, statusCode, body) {
  const payload = Buffer.from(`${JSON.stringify(body)}\n`, 'utf8');
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': payload.length,
    'cache-control': 'no-store',
  });
  response.end(payload);
}

function methodNotAllowed(response) {
  writeJson(response, 405, toSafeError(new ArchiveError(
    'INGESTION_CONTRACT_INVALID',
    'HTTP method is not allowed for this route',
    405,
  )));
}

function parsePositiveInteger(value, name) {
  if (!/^\d+$/u.test(String(value ?? ''))) {
    throw new ArchiveError('INGESTION_CONTRACT_INVALID', `${name} must be a positive integer`, 400);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new ArchiveError('INGESTION_CONTRACT_INVALID', `${name} must be a positive integer`, 400);
  }
  return parsed;
}

function safeDownloadName(value) {
  return String(value || 'artifact.bin')
    .replace(/[\r\n"\\/]/gu, '_')
    .slice(0, 200) || 'artifact.bin';
}

function decorateManifest(manifest, publicBaseUrl) {
  const base = String(publicBaseUrl).replace(/\/+$/u, '');
  return {
    ...manifest,
    entries: Array.isArray(manifest.entries)
      ? manifest.entries.map((entry) => entry.kind === 'file' && entry.artifact_id
        ? {
            ...entry,
            download_url: `${base}/v1/artifacts/${manifest.analysis_run_id}/${entry.artifact_id}`,
          }
        : { ...entry })
      : [],
  };
}

export function createServer({
  extractJob = defaultExtractJob,
  store = createStore({ rootDirectory: config.rootDirectory, ttlHours: config.ttlHours }),
  publicBaseUrl = config.publicBaseUrl,
  cleanupIntervalMs = config.cleanupIntervalMinutes * 60 * 1000,
} = {}) {
  let extractionActive = false;

  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url || '/', 'http://archive-extractor.invalid');
      const pathSegments = url.pathname.split('/').filter(Boolean).map((segment) => decodeURIComponent(segment));

      if (url.pathname === '/health') {
        if (request.method !== 'GET') return methodNotAllowed(response);
        return writeJson(response, 200, {
          status: 'ok',
          schema_version: 'tender_archive_extractor_health_v1',
        });
      }

      if (pathSegments[0] === 'v1' && pathSegments[1] === 'extractions' && pathSegments.length === 3) {
        if (request.method !== 'POST') return methodNotAllowed(response);
        if (!String(request.headers['content-type'] || '').toLowerCase().startsWith('application/octet-stream')) {
          request.resume();
          throw new ArchiveError('INGESTION_CONTRACT_INVALID', 'Content-Type must be application/octet-stream', 400);
        }
        if (extractionActive) {
          request.resume();
          throw new ArchiveError('EXTRACTOR_BUSY', 'Archive extractor is processing another job', 503);
        }
        const sourceAttachmentIndex = parsePositiveInteger(
          url.searchParams.get('source_attachment_index'),
          'source_attachment_index',
        );
        const deadlineEpochMs = parsePositiveInteger(url.searchParams.get('deadline_epoch_ms'), 'deadline_epoch_ms');
        const analysisRunId = validateAnalysisRunId(url.searchParams.get('run_id'));
        const declaredExtension = String(url.searchParams.get('declared_extension') || '');
        extractionActive = true;
        try {
          const manifest = await extractJob({
            inputStream: request,
            analysisRunId,
            sourceAttachmentIndex,
            declaredExtension,
            jobId: pathSegments[2],
            deadlineEpochMs,
          });
          return writeJson(response, 200, decorateManifest(manifest, publicBaseUrl));
        } finally {
          extractionActive = false;
        }
      }

      if (pathSegments[0] === 'v1' && pathSegments[1] === 'artifacts' && pathSegments.length === 4) {
        if (request.method !== 'GET') return methodNotAllowed(response);
        const resolved = await store.resolveArtifact({
          analysisRunId: validateAnalysisRunId(pathSegments[2]),
          artifactId: pathSegments[3],
        });
        response.writeHead(200, {
          'content-type': resolved.artifact.mime_type || 'application/octet-stream',
          'content-disposition': `attachment; filename="${safeDownloadName(resolved.artifact.file_name)}"`,
          'cache-control': 'private, no-store',
          'x-content-type-options': 'nosniff',
        });
        const stream = createReadStream(resolved.path);
        stream.on('error', () => response.destroy());
        stream.pipe(response);
        return;
      }

      if (pathSegments[0] === 'v1' && pathSegments[1] === 'runs' && pathSegments.length === 3) {
        if (request.method !== 'DELETE') return methodNotAllowed(response);
        const analysisRunId = validateAnalysisRunId(pathSegments[2]);
        await store.deleteRun(analysisRunId);
        return writeJson(response, 200, { success: true, analysis_run_id: analysisRunId, deleted: true });
      }

      return writeJson(response, 404, toSafeError(new ArchiveError(
        'ARTIFACT_NOT_FOUND',
        'Route was not found',
        404,
      )));
    } catch (error) {
      const typed = error instanceof ArchiveError
        ? error
        : new ArchiveError('ARTIFACT_STORE_ERROR', 'Archive extractor failed', 500);
      if (!response.headersSent) writeJson(response, typed.httpStatus, toSafeError(typed));
      else response.destroy();
    }
  });

  const cleanupTimer = setInterval(() => {
    Promise.resolve(store.cleanupExpiredRuns?.({ now: Date.now() })).catch(() => {});
  }, Math.max(1, cleanupIntervalMs));
  cleanupTimer.unref?.();
  server.once('close', () => clearInterval(cleanupTimer));
  return server;
}

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const server = createServer();
  server.listen(config.port, config.host);
}
