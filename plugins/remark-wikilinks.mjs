/**
 * Remark plugin: convert [[wikilinks]] to <a> tags pointing to the correct article URL.
 * Builds a slug→URL map per language from the knowledge/ directory at startup.
 * Category map and language list passed as options from astro.config — zero
 * hardcoded category or language names.
 *
 * A link inside an article of language L resolves to L's own version of the
 * target when it exists (`/{L}/{category}/{slug}`), and falls back to the
 * default language's URL when it does not, so a partially translated site
 * never produces a dead link.
 */
import { readdirSync } from 'fs';
import { join, basename } from 'path';
import { visit } from 'unist-util-visit';

const mapsByLang = new Map();

function buildMap(categorySlugMap, lang, defaultLanguage) {
  if (mapsByLang.has(lang)) return mapsByLang.get(lang);
  const map = new Map();
  mapsByLang.set(lang, map);
  const isDefault = lang === defaultLanguage;
  const knowledgeDir = join(process.cwd(), 'knowledge');
  const langDir = isDefault ? knowledgeDir : join(knowledgeDir, lang);
  const urlPrefix = isDefault ? '' : `/${lang}`;

  for (const [folder, slug] of Object.entries(categorySlugMap)) {
    const dir = join(langDir, folder);
    try {
      const files = readdirSync(dir);
      for (const file of files) {
        if (!file.endsWith('.md') || file.startsWith('_')) continue;
        const name = basename(file, '.md');
        map.set(name, `${urlPrefix}/${slug}/${encodeURIComponent(name)}`);
      }
    } catch {
      // Category dir may not exist yet
    }
  }
  return map;
}

/**
 * The language of the file being processed, from its path: the content
 * collections live at `src/content/{lang}/...`. Anything else is the default.
 */
function langOfFile(file, languages, defaultLanguage) {
  const path = (file && (file.path || file.history?.[0])) || '';
  const match = path.replace(/\\/g, '/').match(/\/src\/content\/([^/]+)\//);
  return match && languages.includes(match[1]) ? match[1] : defaultLanguage;
}

export default function remarkWikilinks(options = {}) {
  const { categories = [], languages = [], defaultLanguage = 'en' } = options;
  const categorySlugMap = {};
  for (const cat of categories) {
    categorySlugMap[cat.title] = cat.slug;
  }

  return (tree, file) => {
    const lang = langOfFile(file, languages, defaultLanguage);
    const fallbackMap = buildMap(categorySlugMap, defaultLanguage, defaultLanguage);
    const langMap = buildMap(categorySlugMap, lang, defaultLanguage);
    const map = { get: (slug) => langMap.get(slug) ?? fallbackMap.get(slug) };

    visit(tree, 'text', (node, index, parent) => {
      if (!node.value || !node.value.includes('[[')) return;

      const regex = /\*\*\[\[([^\]|]+)(?:\|([^\]]*))?\]\]\*\*|\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g;
      const parts = [];
      let lastIndex = 0;
      let match;

      while ((match = regex.exec(node.value)) !== null) {
        if (match.index > lastIndex) {
          parts.push({
            type: 'text',
            value: node.value.slice(lastIndex, match.index),
          });
        }

        const isBold = match[1] !== undefined;
        const slug = isBold ? match[1] : match[3];
        const displayText = isBold ? (match[2] || match[1]) : (match[4] || match[3]);
        const url = map.get(slug);

        let linkOrText;
        if (url) {
          linkOrText = {
            type: 'link',
            url,
            children: [{ type: 'text', value: displayText }],
          };
        } else {
          linkOrText = { type: 'text', value: displayText };
        }

        if (isBold) {
          parts.push({
            type: 'strong',
            children: [linkOrText],
          });
        } else {
          parts.push(linkOrText);
        }

        lastIndex = match.index + match[0].length;
      }

      if (lastIndex < node.value.length) {
        parts.push({ type: 'text', value: node.value.slice(lastIndex) });
      }

      if (parts.length > 0 && lastIndex > 0) {
        parent.children.splice(index, 1, ...parts);
        return index + parts.length;
      }
    });
  };
}
