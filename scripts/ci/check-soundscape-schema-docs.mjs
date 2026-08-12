#!/usr/bin/env node
// check-soundscape-schema-docs.mjs -- the soundscape manifest schema documentation gate.
//
// `src/lib/sounds.ts` is the only implementation of the `knowledge/sounds/_manifest.md`
// schema, and two documents restate that schema in prose: dev_docs/SPEC.md (New builds, 4)
// and the manifest's own body, which is what an adopter reads before editing the file.
//
// The engine -- derivation from the reader's exported arrays, anchor matching, scope
// rules, and reporting -- lives in scripts/lib/schema-docs.mjs, which is shared with
// the chat-context gate. This file is the registry: which statement describes which
// field group, and nothing else.
//
// Usage: node scripts/ci/check-soundscape-schema-docs.mjs   (run from anywhere)
//
// This file lives under scripts/, which both machine gates scan: its source is pure
// ASCII and carries no denylisted place term.

import { fileURLToPath } from 'node:url';

import { runSchemaDocsGate } from '../lib/schema-docs.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const READER = 'src/lib/sounds.ts';

const GROUPS = {
  'recording required': { reader: READER, constName: 'RECORDING_REQUIRED_FIELDS' },
  'recording optional': { reader: READER, constName: 'RECORDING_OPTIONAL_FIELDS' },
  'category required': { reader: READER, constName: 'CATEGORY_REQUIRED_FIELDS' },
  'category optional': { reader: READER, constName: 'CATEGORY_OPTIONAL_FIELDS' },
  'wishlist required': { reader: READER, constName: 'WISHLIST_REQUIRED_FIELDS' },
};

// Each entry's `anchor` has exactly one capture group, and that group captures ONLY
// the enumeration -- comma-separated field names terminated by a period. Anchors
// carry prose, never field names, so they stay valid when the reader changes and fail
// loudly when the prose changes.

const SPEC = 'dev_docs/SPEC.md';
const MANIFEST = 'knowledge/sounds/_manifest.md';

const REGISTRY = [
  {
    file: SPEC,
    label: 'New builds (4), recording required fields',
    group: 'recording required',
    scope: 'instance',
    anchor: /A\s+recording\s+requires\s+([^.]+)\./,
  },
  {
    file: SPEC,
    label: 'New builds (4), recording optional fields',
    group: 'recording optional',
    scope: 'instance',
    anchor: /A\s+recording\s+also\s+accepts\s+optional\s+([^.]+)\./,
  },
  {
    file: SPEC,
    label: 'New builds (4), category required fields',
    group: 'category required',
    scope: 'instance',
    anchor: /A\s+category\s+requires\s+([^.]+)\./,
  },
  {
    file: SPEC,
    label: 'New builds (4), category optional fields',
    group: 'category optional',
    scope: 'instance',
    anchor: /A\s+category\s+also\s+accepts\s+optional\s+([^,]+),/,
  },
  {
    file: SPEC,
    label: 'New builds (4), wishlist fields',
    group: 'wishlist required',
    scope: 'instance',
    anchor: /whose\s+entries\s+carry\s+([^]*?)\s+and\s+name/,
  },
  {
    file: MANIFEST,
    label: 'manifest body, recording required fields',
    group: 'recording required',
    scope: 'instance',
    anchor: /A\s+recording\s+requires\s+([^.]+)\./,
  },
  {
    file: MANIFEST,
    label: 'manifest body, recording optional fields',
    group: 'recording optional',
    scope: 'instance',
    anchor: /A\s+recording\s+also\s*\n?\s*accepts\s+optional\s+([^.]+)\./,
  },
  {
    file: MANIFEST,
    label: 'manifest body, category required fields',
    group: 'category required',
    scope: 'instance',
    anchor: /A\s+category\s+requires\s+([^.]+)\./,
  },
  {
    file: MANIFEST,
    label: 'manifest body, category optional fields',
    group: 'category optional',
    scope: 'instance',
    anchor: /A\s+category\s+also\s+accepts\s+optional\s+([^:]+):/,
  },
  {
    file: MANIFEST,
    label: 'manifest body, wishlist fields',
    group: 'wishlist required',
    scope: 'instance',
    anchor: /whose\s+entries\s+carry\s+([^]*?)\s+and\s+name/,
  },
];

runSchemaDocsGate({
  name: 'soundscape schema docs guard',
  root: ROOT,
  groups: GROUPS,
  registry: REGISTRY,
});
