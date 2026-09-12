import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';
import { ENABLED_LANGUAGE_CODES } from './config/languages';

const articleSchema = z.object({
  title: z.string(),
  description: z.string(),
  date: z.coerce.date(),
  category: z.string(),
  tags: z.array(z.string()).default([]),
  subcategory: z.string().optional().default(''),
  author: z.string().optional().default('Contributors'),
  featured: z.boolean().optional().default(false),
  lastVerified: z.coerce.date().optional(),
  lastHumanReview: z.boolean().optional().default(false),
  // Hero image set (ARTICLE-PLAYBOOK.md §4.0 optional fields): article.template.astro
  // renders these directly from frontmatter, so they must survive the schema parse.
  image: z.string().optional(),
  imageAlt: z.string().optional(),
  imageCredit: z.string().optional(),
  imageLicense: z.string().optional(),
  imageSource: z.string().optional(),
  // geo: raw string "Name,lat,lng,Area" — parsed downstream by 2.1, stored as-is here
  geo: z.string().optional(),
  source: z.array(z.string()).optional().default([]),
});

// One collection per enabled language (src/config/languages.ts), each pointed
// at the language's slice of the sync.sh projection (src/content/{lang}/).
// A language with no synced content yet still gets a collection — an empty
// one — rather than a missing key, so getCollection(lang) never throws.
export const collections = Object.fromEntries(
  ENABLED_LANGUAGE_CODES.map((lang) => [
    lang,
    defineCollection({
      loader: glob({ pattern: '**/*.md', base: `src/content/${lang}` }),
      schema: articleSchema,
    }),
  ]),
);
