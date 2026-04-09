import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';

const legalDir = path.join(process.cwd(), 'content', 'legal');

/**
 * @param {string} slug - filename without .md (e.g. privacy, terms, advertiser-agreement)
 */
export function readLegalDoc(slug) {
  if (!/^[a-z0-9-]+$/.test(slug)) {
    throw new Error(`Invalid legal doc slug: ${slug}`);
  }
  const filePath = path.join(legalDir, `${slug}.md`);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing legal doc: content/legal/${slug}.md`);
  }
  const raw = fs.readFileSync(filePath, 'utf8');
  return matter(raw);
}

export function getLegalMetadata(slug) {
  const { data } = readLegalDoc(slug);
  const title = data.title || slug;
  return {
    title: `${title} — PlayPlace Finder`,
    description: data.description || '',
  };
}
