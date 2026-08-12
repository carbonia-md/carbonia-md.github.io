#!/usr/bin/env node
// check-chat-context-schema-docs.mjs -- the chat-context manifest schema documentation gate.
//
// `src/lib/chat-contexts.ts` is the only implementation of the
// `knowledge/chat/_contexts.md` schema, and three documents restate that schema in
// prose: dev_docs/SPEC.md (New builds, 6), the manifest's own body, and
// docs/runbook/DEPLOY.md -- the last of which SURVIVES adoption and is therefore the
// copy most adopters actually read.
//
// Two of the registered statements are not prose. The `hint` bound is enforced by two
// implementations -- this reader at build time, workers/chat/src/index.mjs at request
// time -- and a manifest hint the worker would refuse turns a printed code into a
// permanent error, so the worker's own constant is registered as a statement about the
// reader's value. The qr:sheet flag list is registered the same way, from the CLI.
//
// The engine -- derivation from the reader's exported consts, anchor matching, scope
// rules, and reporting -- lives in scripts/lib/schema-docs.mjs, shared with the
// soundscape gate. This file is the registry: which statement describes which group,
// and nothing else.
//
// Usage: node scripts/ci/check-chat-context-schema-docs.mjs   (run from anywhere)
//
// This file lives under scripts/, which both machine gates scan: its source is pure
// ASCII and carries no denylisted place term.

import { fileURLToPath } from 'node:url';

import { runSchemaDocsGate } from '../lib/schema-docs.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const READER = 'src/lib/chat-contexts.ts';
const CLI = 'scripts/tools/qr-sheet.mjs';

const GROUPS = {
  'context required': { reader: READER, constName: 'CONTEXT_REQUIRED_FIELDS' },
  'context optional': { reader: READER, constName: 'CONTEXT_OPTIONAL_FIELDS' },
  // The hint bound is carried by two implementations, not just by prose: the reader
  // drops an over-long hint at build time, and the chat worker rejects one at request
  // time. The worker's own constant is registered below as a statement, so the value
  // exists once and the two sides cannot drift apart -- they cannot share an import,
  // because an adopter may delete a worker tree it does not deploy.
  'hint bound': { reader: READER, constName: 'CONTEXT_HINT_MAX_CHARS', kind: 'number' },
  // The sheet's flags are documented in the same runbook section as the schema, and a
  // flag list is the same drift class as a field list.
  'sheet flags': { reader: CLI, constName: 'QR_SHEET_FLAGS' },
};

// Each entry's `anchor` has exactly one capture group, capturing ONLY the
// enumeration. Anchors carry prose, never field names.

const SPEC = 'dev_docs/SPEC.md';
const MANIFEST = 'knowledge/chat/_contexts.md';
const RUNBOOK = 'docs/runbook/DEPLOY.md';
const WORKER = 'workers/chat/src/index.mjs';

const REGISTRY = [
  {
    file: SPEC,
    label: 'New builds (6), context required fields',
    group: 'context required',
    scope: 'instance',
    anchor: /A\s+context\s+requires\s+([^.]+)\./,
  },
  {
    file: SPEC,
    label: 'New builds (6), context optional fields',
    group: 'context optional',
    scope: 'instance',
    anchor: /A\s+context\s+also\s+accepts\s+optional\s+([^.]+)\./,
  },
  {
    file: MANIFEST,
    label: 'manifest body, context required fields',
    group: 'context required',
    scope: 'instance',
    anchor: /A\s+context\s+requires\s+([^.]+)\./,
  },
  {
    file: MANIFEST,
    label: 'manifest body, context optional fields',
    group: 'context optional',
    scope: 'instance',
    anchor: /A\s+context\s+also\s+accepts\s+optional\s*\n?#?\s*([^:]+):/,
  },
  {
    file: RUNBOOK,
    label: 'runbook, context required fields',
    group: 'context required',
    scope: 'framework',
    anchor: /A\s+context\s+requires\s+([^.]+)\./,
  },
  {
    file: RUNBOOK,
    label: 'runbook, context optional fields',
    group: 'context optional',
    scope: 'framework',
    anchor: /A\s+context\s+also\s+accepts\s+optional\s+([^.]+)\./,
  },
  // The hint bound, in the two implementations that enforce it and the three documents
  // that state it. The worker is `instance` scope for the same reason a demo manifest
  // is: an adopter who does not deploy chat may delete the tree, and
  // `scripts/ci/run-worker-tests.mjs` already treats an absent `workers/` as a skip. A
  // worker that IS present must agree with the reader.
  {
    file: WORKER,
    label: 'chat worker, request-time hint bound',
    group: 'hint bound',
    scope: 'instance',
    anchor: /const\s+MAX_HINT_CHARS\s*=\s*(\d+)\s*;/,
  },
  {
    file: SPEC,
    label: 'New builds (6), hint bound',
    group: 'hint bound',
    scope: 'instance',
    anchor: /A\s+`hint`\s+is\s+capped\s+at\s+(\d+)\s+characters/,
  },
  {
    file: MANIFEST,
    label: 'manifest body, hint bound',
    group: 'hint bound',
    scope: 'instance',
    // The manifest body is a YAML comment block, so its statement carries no backticks.
    anchor: /hint\s+is\s+capped\s+at\s+(\d+)\s+characters/,
  },
  {
    file: RUNBOOK,
    label: 'runbook, hint bound',
    group: 'hint bound',
    scope: 'framework',
    anchor: /A\s+`hint`\s+is\s+capped\s+at\s+(\d+)\s+characters/,
  },
  {
    file: RUNBOOK,
    label: 'runbook, qr:sheet flags',
    group: 'sheet flags',
    scope: 'framework',
    anchor: /The\s+flags,\s+all\s+optional:\s+([^.]+)\./,
  },
];

runSchemaDocsGate({
  name: 'chat context schema docs guard',
  root: ROOT,
  groups: GROUPS,
  registry: REGISTRY,
});
