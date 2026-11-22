// remark-wikilinks.test.mjs -- run with `node --test tests/remark-wikilinks.test.mjs`.
//
// A [[wikilink]] must stay in the language of the page it appears on: inside
// an article under src/content/{lang}/ it resolves to that language's URL when
// the target exists there, and to the default language's URL when it does not.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'wikilinks-'));
for (const [dir, files] of Object.entries({
  'knowledge/Cat': ['both', 'only-default'],
  'knowledge/xx/Cat': ['both'],
})) {
  mkdirSync(join(root, dir), { recursive: true });
  for (const f of files) writeFileSync(join(root, dir, `${f}.md`), '');
}
process.chdir(root);

const { default: remarkWikilinks } = await import('../plugins/remark-wikilinks.mjs');

const options = {
  categories: [{ title: 'Cat', slug: 'cat' }],
  languages: ['en', 'xx'],
  defaultLanguage: 'en',
};

function linkUrls(path, text) {
  const tree = { type: 'root', children: [{ type: 'paragraph', children: [{ type: 'text', value: text }] }] };
  remarkWikilinks(options)(tree, { path });
  const nodes = tree.children[0].children.flatMap((n) => (n.type === 'strong' ? n.children : [n]));
  return nodes.filter((n) => n.type === 'link').map((n) => n.url);
}

test('default-language page links to default-language URLs', () => {
  assert.deepEqual(linkUrls(`${root}/src/content/en/cat/a.md`, '[[both]]'), ['/cat/both']);
});

test('translated page links to its own language when the target exists there', () => {
  assert.deepEqual(linkUrls(`${root}/src/content/xx/cat/a.md`, '[[both|Etichetta]]'), ['/xx/cat/both']);
});

test('translated page falls back to the default language when the target is untranslated', () => {
  assert.deepEqual(linkUrls(`${root}/src/content/xx/cat/a.md`, '[[only-default]]'), ['/cat/only-default']);
});

test('bold wikilinks are resolved the same way', () => {
  assert.deepEqual(linkUrls(`${root}/src/content/xx/cat/a.md`, '**[[both]]**'), ['/xx/cat/both']);
});
