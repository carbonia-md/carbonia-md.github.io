/** Run one artifact-mismatch contract case in a fresh module process. */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createD1Stub } from './d1-stub.mjs';
import { ALLOWED_ORIGIN, SALT, SITE_NAME, createAiStub, postJson, validPayload } from './helpers.mjs';

const artifactPath = fileURLToPath(new URL('../vectors.json', import.meta.url));
const original = readFileSync(artifactPath);
const fixture = JSON.parse(original.toString('utf8'));
const mode = process.argv[2];

if (mode === 'model') {
  fixture.model = '@cf/example/wrong-embedding-model';
} else if (mode === 'dim') {
  const decoded = new Int8Array(Buffer.from(fixture.vectors, 'base64'));
  const expanded = new Int8Array(fixture.count * 4);
  for (let row = 0; row < fixture.count; row += 1) {
    expanded.set(decoded.slice(row * fixture.dim, (row + 1) * fixture.dim), row * 4);
  }
  fixture.dim = 4;
  fixture.vectors = Buffer.from(expanded.buffer).toString('base64');
} else {
  throw new Error(`unknown artifact case: ${mode}`);
}

writeFileSync(artifactPath, `${JSON.stringify(fixture, null, 2)}\n`);
try {
  const { handleRequest, SQL } = await import(`../src/index.mjs?artifact-case=${mode}`);
  const response = await handleRequest(postJson(validPayload()), {
    AI: createAiStub({ query: [10, 0, 0] }),
    DB: createD1Stub(SQL),
    ALLOWED_ORIGIN,
    SITE_NAME,
    IP_HASH_SALT: SALT,
  });
  process.stdout.write(JSON.stringify({ status: response.status, body: await response.text() }));
} finally {
  writeFileSync(artifactPath, original);
}
