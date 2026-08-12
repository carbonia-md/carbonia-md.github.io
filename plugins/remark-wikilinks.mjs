/**
 * Remark plugin: convert [[wikilinks]] to <a> tags pointing to the correct article URL.
 * Builds a title→URL map from knowledge/ directory at startup.
 * Category map passed as option from astro.config — zero hardcoded category names.
 */
import { readdirSync } from 'fs';
import { join, basename } from 'path';
import { visit } from 'unist-util-visit';

let titleToUrl = null;

function buildMap(categorySlugMap) {
  if (titleToUrl) return titleToUrl;
  titleToUrl = new Map();
  const knowledgeDir = join(process.cwd(), 'knowledge');

  for (const [folder, slug] of Object.entries(categorySlugMap)) {
    const dir = join(knowledgeDir, folder);
    try {
      const files = readdirSync(dir);
      for (const file of files) {
        if (!file.endsWith('.md') || file.startsWith('_')) continue;
        const name = basename(file, '.md');
        titleToUrl.set(name, `/${slug}/${encodeURIComponent(name)}`);
      }
    } catch {
      // Category dir may not exist yet
    }
  }
  return titleToUrl;
}

export default function remarkWikilinks(options = {}) {
  const { categories = [] } = options;
  const categorySlugMap = {};
  for (const cat of categories) {
    categorySlugMap[cat.title] = cat.slug;
  }

  return (tree) => {
    const map = buildMap(categorySlugMap);

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
