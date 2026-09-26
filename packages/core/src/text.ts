/** Small, dependency-free text helpers shared by extraction, validation, search and eval. */

const STOPWORDS = new Set(
  (
    'a an the and or but if then so of to in on at by for with from as is are was were be been being ' +
    'it its this that these those there here i me my we our us you your he she they them their his her ' +
    'do does did done doing have has had having will would shall should can could may might must ' +
    'not no yes ok okay yeah just also very really about into over up down out than too more most some ' +
    "any all each what which who whom when where why how let lets let's get got go going gonna " +
    'um uh like well right sure think know mean thing things kind sort maybe need needs want wants one'
  ).split(/\s+/),
);

/** Title for a stretch of meeting with no clear topic. */
export const GENERAL_DISCUSSION = 'General discussion';

export function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** Lowercased word tokens (letters, digits, apostrophes, internal hyphens). */
export function words(s: string): string[] {
  return (s.toLowerCase().match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) ?? []).map((w) =>
    w.replace(/’/g, "'"),
  );
}

/** Very light suffix stripping so "deploying", "deployment" and "deploy" compare equal. */
export function stem(word: string): string {
  let w = word.toLowerCase();
  if (w.length <= 4) return w;
  for (const suffix of [
    'ments',
    'ment',
    'ings',
    'ing',
    'ations',
    'ation',
    'ers',
    'er',
    'ed',
    'es',
    's',
  ]) {
    if (w.endsWith(suffix) && w.length - suffix.length >= 4) {
      w = w.slice(0, -suffix.length);
      break;
    }
  }
  if (w.length > 4 && w.endsWith('e')) w = w.slice(0, -1);
  return w;
}

export function contentWords(s: string): string[] {
  return words(s).filter((w) => !STOPWORDS.has(w) && w.length > 1);
}

export function contentStems(s: string): Set<string> {
  return new Set(contentWords(s).map(stem));
}

/** Jaccard similarity of content-word stems, in [0, 1]. */
export function similarity(a: string, b: string): number {
  const A = contentStems(a);
  const B = contentStems(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

/** Share of `a`'s content stems that also appear in `b`, in [0, 1]. */
export function coverage(a: string, b: string): number {
  const A = contentStems(a);
  if (A.size === 0) return 0;
  const B = contentStems(b);
  let hit = 0;
  for (const x of A) if (B.has(x)) hit++;
  return hit / A.size;
}

/**
 * Split text into sentences. Only splits when terminal punctuation is followed
 * by whitespace, so emails, URLs and decimals stay intact. Text without any
 * punctuation (common in raw speech recognition) comes back as one sentence.
 */
export function sentences(text: string): string[] {
  const t = normalizeWhitespace(text);
  if (!t) return [];
  const parts = t
    .split(/(?<=[.!?])\s+(?=\S)/)
    .map((p) => p.trim())
    .filter(Boolean);
  const merged: string[] = [];
  for (const part of parts) {
    const prev = merged[merged.length - 1];
    if (prev && /\b(?:dr|mr|mrs|ms|vs|etc|e\.g|i\.e|approx|no)\.$/i.test(prev))
      merged[merged.length - 1] = `${prev} ${part}`;
    else merged.push(part);
  }
  return merged;
}

export function capitalize(s: string): string {
  return s ? s[0]!.toUpperCase() + s.slice(1) : s;
}

export function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, Math.max(0, max - 1)).trimEnd() + '…';
}

/** First name, for matching "John" against "John Smith". */
export function firstName(name: string): string {
  return normalizeWhitespace(name).split(' ')[0] ?? name;
}

/** Stable, fast, non-cryptographic 53-bit hash (cyrb53). Used for ids and cache keys. */
export function hash53(str: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
