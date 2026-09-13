import assert from 'node:assert/strict';
import vm from 'node:vm';

function normalizeResult(raw, nodeName, mode) {
  assert.notEqual(raw, undefined, `${nodeName} returned no data`);
  if (mode === 'runOnceForEachItem') {
    assert.equal(
      Array.isArray(raw),
      false,
      `${nodeName} must return one item object in runOnceForEachItem mode`,
    );
  }
  const items = Array.isArray(raw) ? raw : [raw];
  return items.map((item) => (
    item && typeof item === 'object' && Object.hasOwn(item, 'json')
      ? item
      : { json: item }
  ));
}

export async function executeCodeNode(node, inputJson, globals = {}) {
  assert.equal(node.type, 'n8n-nodes-base.code');
  const inputItems = inputJson.map((json) => ({ json: structuredClone(json) }));
  const mode = node.parameters.mode ?? 'runOnceForAllItems';
  const run = async (currentItem) => {
    const context = vm.createContext({
      $input: {
        all: () => structuredClone(inputItems),
        first: () => structuredClone(inputItems[0]),
        item: structuredClone(currentItem),
      },
      $json: structuredClone(currentItem?.json ?? {}),
      $execution: { id: 'saved-key-contract-test' },
      structuredClone,
      console,
      ...globals,
    });
    const script = new vm.Script(
      `(async () => {\n${node.parameters.jsCode}\n})()`,
      { filename: `${node.name}.code-node.js` },
    );
    return normalizeResult(
      await script.runInContext(context, { timeout: 1000 }),
      node.name,
      mode,
    );
  };
  if (mode === 'runOnceForEachItem') {
    const output = [];
    for (const item of inputItems) output.push(...await run(item));
    return structuredClone(output);
  }
  return structuredClone(await run(inputItems[0]));
}
