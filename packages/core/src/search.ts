import { contentWords, stem, words } from './text.ts';

/**
 * Build a safe SQLite FTS5 MATCH expression from free text. Each term is quoted
 * (so user input can never inject FTS operators) and prefix-matched on a light
 * stem, so "deploying" finds "deployment".
 */
export function buildFtsQuery(input: string, maxTerms = 12): string | null {
  const content = contentWords(input);
  const terms = (content.length ? content : words(input))
    .map((w) => w.replace(/['’-]/g, ' ').trim())
    .filter(Boolean);
  const unique = [
    ...new Set(
      terms
        .flatMap((t) => t.split(/\s+/))
        .map((t) => stem(t))
        .filter((t) => t.length >= 2),
    ),
  ].slice(0, maxTerms);
  if (unique.length === 0) return null;
  return unique.map((t) => `"${t.replace(/"/g, '')}"*`).join(' OR ');
}

/** Terms used for highlighting and relevance scoring. */
export function queryTerms(input: string): string[] {
  return [...new Set(contentWords(input).map(stem))];
}
