import { deriveExpectedAnalysisUnitIds } from './document-worker-canary-barrier.mjs';

export function injectExactlyOneFallbackEnvelope({
  wrappedItems,
  postMaterializationItems,
  replacementProviderResponse,
}) {
  deriveExpectedAnalysisUnitIds(postMaterializationItems);
  if (!Array.isArray(wrappedItems)) {
    throw new Error('[Canary fallback injector] Wrapped items must be an array.');
  }
  if (
    replacementProviderResponse === null
    || typeof replacementProviderResponse !== 'object'
    || Array.isArray(replacementProviderResponse)
  ) {
    throw new Error('[Canary fallback injector] Replacement provider response must be an object.');
  }

  // RED scaffold: the current temporary harness has no deterministic injector.
  return wrappedItems;
}
