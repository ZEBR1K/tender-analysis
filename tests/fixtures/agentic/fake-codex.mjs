#!/usr/bin/env node

import { writeFile } from 'node:fs/promises';

let prompt = '';
for await (const chunk of process.stdin) prompt += chunk;
const mode = /\[fake:([^\]]+)\]/u.exec(prompt)?.[1] ?? 'success';
const outputIndex = process.argv.indexOf('-o');
const resultPath = outputIndex >= 0 ? process.argv[outputIndex + 1] : null;

if (mode === 'hang') {
  setInterval(() => {}, 10_000);
} else if (mode === 'invalid-jsonl') {
  process.stdout.write('not-json\n');
  if (resultPath) await writeFile(resultPath, '{"schema_version":"fake_result_v1"}\n', 'utf8');
} else if (mode === 'nonzero') {
  process.stdout.write('{"type":"error","message":"synthetic failure"}\n');
  process.exitCode = 17;
} else {
  process.stdout.write('{"type":"thread.started","thread_id":"fake-thread"}\n');
  process.stdout.write(`${JSON.stringify({
    type: 'item.completed',
    item: {
      type: 'fake_environment',
      environment_keys: Object.keys(process.env).sort(),
    },
  })}\n`);
  process.stdout.write(`${JSON.stringify({
    type: 'turn.completed',
    usage: {
      input_tokens: 120,
      cached_input_tokens: 80,
      output_tokens: 30,
      reasoning_output_tokens: 12,
    },
  })}\n`);
  process.stderr.write(`TOKEN=should-hide ${'x'.repeat(70 * 1024)}\n`);
  if (resultPath) await writeFile(resultPath, '{"schema_version":"fake_result_v1"}\n', 'utf8');
}
