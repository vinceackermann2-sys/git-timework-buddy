// Text marks, two ways. The mark itself rides in invisible characters: the 80
// bits as zero width spaces (0) and zero width non-joiners (1) between two word
// joiners, placed right after the first word of the first line of prose, so
// copying the text keeps it. Code, URLs and anything inside code fences or
// backticks are never touched (an invisible character there changes what the
// code means), and text with no line of prose gets no mark.
// Invisible characters are easy to strip, so each text also has a
// fingerprint: a hash of its normalized form (exact copies) and winnowed
// hashes of its character runs (edited copies, which still share most runs).
import { markBits, markFromBits } from './payload.ts';

const ZERO = '\u200B', ONE = '\u200C', EDGE = '\u2060';
const MARK = /\u2060([\u200B\u200C]{80})\u2060/g;
// A mark, or what's left of one (cut short or missing an end).
const REMAINS = /\u2060[\u200B\u200C]{8,}\u2060?|[\u200B\u200C]{8,}\u2060/g;

// A line that reads as prose: no code punctuation, not a key: value line, and
// not starting like a statement in a common language.
const CODE = /[{};=<>\\|$`]|^\s*[\w.-]+\s*:|^\s*(import|export|from|def|class|function|const|let|var|return|if|for|while|package|using|public|private|#include|#!)\b/;
// The first word: letters (and inner apostrophes or hyphens), after the line's
// markdown prefix and before a space or punctuation, so the mark lands between
// the word and what follows it.
const FIRST_WORD = /^(\s{0,3}(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s*)*)(\p{L}[\p{L}\p{M}'’-]*\p{L}|\p{L})(?=[\s,.;:!?)])/u;

function insertionPoint(text: string) {
  let fenced = false, at = 0;
  for (const line of text.split('\n')) {
    const start = at;
    at += line.length + 1;
    if (/^\s{0,3}(```|~~~)/.test(line)) { fenced = !fenced; continue; }
    if (fenced || /^( {4}|\t)/.test(line) || CODE.test(line)) continue;
    // Prose has a few words on the line.
    if ((line.match(/\p{L}{2,}/gu) || []).length < 3) continue;
    const word = FIRST_WORD.exec(line);
    if (word && !/(:\/\/|www\.|@)/.test(line.slice(word[1].length).split(' ')[0])) return start + word[1].length + word[2].length;
  }
  return -1;
}

// The text with the mark in it, or unchanged when it has no line of prose.
// A text carries one mark: any earlier one is replaced.
export function embedText(text: string, mark: Uint8Array): string {
  const bits = markBits(mark);
  const clean = stripMarks(String(text ?? ''));
  const at = insertionPoint(clean);
  if (at < 0) return clean;
  return clean.slice(0, at) + EDGE + Array.from(bits, b => (b ? ONE : ZERO)).join('') + EDGE + clean.slice(at);
}

// The first whole mark whose CRC holds, or null.
export function extractText(text: string): Uint8Array | null {
  for (const match of String(text ?? '').matchAll(MARK)) {
    const mark = markFromBits(Array.from(match[1], c => (c === ONE ? 1 : 0)));
    if (mark) return mark;
  }
  return null;
}

// The text without marks or the remains of one; other invisible characters
// (a zero width non-joiner inside a Persian word, say) are left alone.
export const stripMarks = (text: string) => String(text ?? '').replace(MARK, '').replace(REMAINS, '');

// Lowercase, compatibility forms folded (NFKC), invisible characters gone and
// every run of whitespace one space.
export const normalizeText = (text: string) =>
  String(text ?? '').normalize('NFKC').replace(/[\u200B-\u200D\u2060\uFEFF\u00AD]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

// Runs of K characters (whitespace left out, so reformatting doesn't matter),
// winnowed with a window of W: the smallest hash in every W runs in a row is
// kept, so any shared stretch of K + W - 1 characters is always found.
const K = 12, W = 8;
const makeMix = (imul: typeof Math.imul) => (h: number) => {
  h = imul(h ^ (h >>> 16), 0x85ebca6b);
  h = imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
};
function winnow(s: string) {
  if (!s) return [];
  const imul = Math.imul, mix = makeMix(imul), k = K, w = W;
  if (s.length < k) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (imul(h, 31) + s.charCodeAt(i)) | 0;
    return [mix(h)];
  }
  // Rolling polynomial hash of each run of K characters.
  let top = 1;
  for (let i = 1; i < k; i++) top = imul(top, 31);
  const hashes = new Uint32Array(s.length - k + 1);
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    if (i >= k) h = (h - imul(s.charCodeAt(i - k), top)) | 0;
    h = (imul(h, 31) + s.charCodeAt(i)) | 0;
    if (i >= k - 1) hashes[i - k + 1] = mix(h);
  }
  const kept = new Set<number>(), last = Math.max(w, hashes.length);
  for (let start = 0; start + w <= last; start++) {
    let best = -1;
    for (let i = start; i < start + w && i < hashes.length; i++) if (best < 0 || hashes[i] <= hashes[best]) best = i;
    kept.add(hashes[best]);
  }
  return [...kept].sort((a, b) => a - b);
}

export type Fingerprint = { exact: string; shingles: number[] };

export async function fingerprint(text: string): Promise<Fingerprint> {
  const normal = normalizeText(text);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normal)));
  return { exact: Array.from(digest, b => b.toString(16).padStart(2, '0')).join(''), shingles: winnow(normal.replace(/ /g, '')) };
}

// How much two texts share, 0 to 1 (Jaccard of the winnowed hashes; 1 for the
// same normalized text). Takes fingerprints or their shingles.
export function similarity(a: Fingerprint | number[], b: Fingerprint | number[]): number {
  if (!Array.isArray(a) && !Array.isArray(b) && a?.exact && a.exact === b?.exact) return 1;
  const x = [...new Set(Array.isArray(a) ? a : a?.shingles || [])].sort((p, q) => p - q);
  const y = [...new Set(Array.isArray(b) ? b : b?.shingles || [])].sort((p, q) => p - q);
  if (!x.length || !y.length) return 0;
  let shared = 0;
  for (let i = 0, j = 0; i < x.length && j < y.length;) {
    if (x[i] === y[j]) { shared++; i++; j++; } else if (x[i] < y[j]) i++; else j++;
  }
  return shared / (x.length + y.length - shared);
}
