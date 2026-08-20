import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

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

const enCollection = defineCollection({
  loader: glob({ pattern: '**/*.md', base: 'src/content/en' }),
  schema: articleSchema,
});

export const collections = {
  en: enCollection,
};
