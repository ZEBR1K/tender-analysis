export const CANARY_EXPECTED_ID_SOURCE = '[CANARY] Bypass analysis-unit persistence';

export function selectCanaryExpectedItems({ bypassItems }) {
  if (!Array.isArray(bypassItems)) {
    throw new Error('[Canary barrier source] Bypass items must be an array.');
  }
  return bypassItems;
}

export function deriveExpectedAnalysisUnitIds(items) {
  if (!Array.isArray(items)) {
    throw new Error('[Canary barrier source] Expected items must be an array.');
  }
  const ids = items.map((item, index) => {
    const id = item?.json?.analysis_unit_meta?.analysis_unit_id;
    if (typeof id !== 'string' || id.length === 0) {
      throw new Error(
        `[Canary barrier source] Expected item ${index} missing analysis_unit_id.`,
      );
    }
    return id;
  });
  if (new Set(ids).size !== ids.length) {
    throw new Error('[Canary barrier source] Duplicate analysis_unit_id.');
  }
  return ids;
}
