import { deriveExpectedAnalysisUnitIds } from './document-worker-canary-barrier.mjs';

export function injectExactlyOneFallbackEnvelope({
  wrappedItems,
  postMaterializationItems,
  replacementProviderResponse,
}) {
  const expectedIds = deriveExpectedAnalysisUnitIds(postMaterializationItems);
  if (expectedIds.length === 0) {
    throw new Error('[Canary fallback injector] Exactly one target is required; expected items are empty.');
  }
  if (!Array.isArray(wrappedItems)) {
    throw new Error('[Canary fallback injector] Wrapped items must be an array.');
  }
  if (wrappedItems.length !== expectedIds.length) {
    throw new Error('[Canary fallback injector] Wrapped/expected cardinality mismatch.');
  }
  if (
    replacementProviderResponse === null
    || typeof replacementProviderResponse !== 'object'
    || Array.isArray(replacementProviderResponse)
  ) {
    throw new Error('[Canary fallback injector] Replacement provider response must be an object.');
  }

  const wrapperIds = wrappedItems.map((item, index) => {
    const transport = item?.json?.attempt_transport;
    if (
      !transport
      || transport.version !== 'ai_extractor_attempt_transport_v1'
      || transport.attempt !== 'primary'
      || transport.transport_status !== 'succeeded'
    ) {
      throw new Error(`[Canary fallback injector] Item ${index} has an invalid primary attempt envelope.`);
    }
    const id = transport.analysis_unit_id;
    const sourceId = transport.source?.analysis_unit_meta?.analysis_unit_id;
    if (typeof id !== 'string' || id.length === 0 || sourceId !== id) {
      throw new Error(`[Canary fallback injector] Item ${index} has contradictory analysis_unit_id linkage.`);
    }
    if (id !== expectedIds[index]) {
      throw new Error(`[Canary fallback injector] Item ${index} violates validated source order.`);
    }
    return id;
  });
  if (new Set(wrapperIds).size !== wrapperIds.length) {
    throw new Error('[Canary fallback injector] Duplicate wrapper analysis_unit_id.');
  }

  const targetId = expectedIds[0];
  if (wrapperIds.filter((id) => id === targetId).length !== 1) {
    throw new Error('[Canary fallback injector] Exactly one target wrapper is required.');
  }
  const targetIndex = wrapperIds.indexOf(targetId);
  const originalProviderResponse = wrappedItems[targetIndex].json.attempt_transport.provider_response;
  if (JSON.stringify(originalProviderResponse) === JSON.stringify(replacementProviderResponse)) {
    throw new Error('[Canary fallback injector] Replacement must mutate the target provider_response.');
  }

  return wrappedItems.map((item, index) => {
    if (index !== targetIndex) return item;
    const injected = structuredClone(item);
    injected.json.attempt_transport.provider_response = structuredClone(replacementProviderResponse);
    return injected;
  });
}
