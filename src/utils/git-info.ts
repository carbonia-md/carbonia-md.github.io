import placeConfig from '../../place.config';
// Prebuilt by scripts/core/build-git-info.mjs (one git pass over knowledge/).
// Reading the JSON keeps the render stage free of any git dependency.
import gitInfoData from '../data/git-info.json';

export interface GitInfo {
  contributors: string[];
  commitHash: string;
}

interface GitInfoEntry {
  contributors: string[];
  lastModified: string;
  commitHash: string;
  revisionCount: number;
}

const files: Record<string, GitInfoEntry> =
  (gitInfoData as { files?: Record<string, GitInfoEntry> }).files ?? {};

const categoryFolderMap: Record<string, string> = Object.fromEntries(
  placeConfig.categories.map((c) => [c.slug, c.title]),
);

export function getGitInfo(category: string, slug: string): GitInfo {
  const folder = categoryFolderMap[category];
  if (!folder) return { contributors: [], commitHash: '' };

  // Keys are repo-relative NFC paths, matching build-git-info.mjs.
  const key = `knowledge/${folder}/${slug}.md`.normalize('NFC');
  const entry = files[key];
  if (!entry) return { contributors: [], commitHash: '' };

  return {
    contributors: entry.contributors ?? [],
    commitHash: entry.commitHash ?? '',
  };
}
