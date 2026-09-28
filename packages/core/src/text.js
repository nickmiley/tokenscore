// @ts-check
/**
 * @module text
 *
 * Lexical utilities used by feature extraction. Everything here is pure and
 * allocation-light: it runs inside the chat page on every settled message.
 * Text goes in, numbers and booleans come out; nothing is retained.
 */

const WORD = /[\p{L}\p{N}']+/gu;

/**
 * FNV-1a 32-bit hash. Deterministic and fast; not cryptographic.
 * @param {string} str
 * @returns {number} unsigned 32-bit integer
 */
export function hash32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Lower-cased word tokens.
 * @param {string} text
 * @returns {string[]}
 */
export function words(text) {
  return text.toLowerCase().match(WORD) ?? [];
}

/**
 * Hashed word k-shingles, for near-duplicate detection between prompts.
 * @param {string[]} w  output of {@link words}
 * @param {number} [k]
 * @returns {Set<number>}
 */
export function shingles(w, k = 3) {
  const out = new Set();
  if (w.length < k) {
    if (w.length) out.add(hash32(w.join(' ')));
    return out;
  }
  for (let i = 0; i + k <= w.length; i++) {
    let s = w[i];
    for (let j = 1; j < k; j++) s += ' ' + w[i + j];
    out.add(hash32(s));
  }
  return out;
}

/**
 * Hashed content words (≥ 4 letters), for coarse topic comparison between prompts.
 * @param {string[]} w  output of {@link words}
 * @returns {Set<number>}
 */
export function terms(w) {
  const out = new Set();
  for (const x of w) if (x.length >= 4) out.add(hash32(x));
  return out;
}

/**
 * Jaccard similarity of two sets. 0 when either is empty.
 * @param {Set<number>} a
 * @param {Set<number>} b
 * @returns {number}
 */
export function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  const [small, large] = a.size < b.size ? [a, b] : [b, a];
  let inter = 0;
  for (const x of small) if (large.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/**
 * Paragraphs long enough to be worth fingerprinting for re-paste detection.
 * @param {string} text
 * @param {number} [minChars]
 * @returns {string[]}
 */
export function paragraphs(text, minChars = 40) {
  const out = [];
  for (const p of text.split(/\n+/)) {
    const t = p.trim();
    if (t.length >= minChars) out.push(t);
  }
  return out;
}

const EMPTY_CALORIE =
  /^\s*(?:(?:ok(?:ay)?|k|thanks?(?: you)?|thank you|thx|ty|yes|yep|yeah|no|nope|sure|continue|go on|keep going|more|next|please|do it|great|cool|nice|good|perfect|awesome|got it|understood)[\s,.!]*){1,3}$/i;

/**
 * A standalone acknowledgement that resends the whole context for nothing.
 * @param {string} text
 */
export function isEmptyCalorie(text) {
  return EMPTY_CALORIE.test(text);
}

const CODE = /```|^\s{4}\S|[{};]\s*$/m;

/**
 * Short, single-line, prose-only ask — the kind a light model answers just as well.
 * @param {string} text
 * @param {number} wordCount
 */
export function isTrivialPrompt(text, wordCount) {
  return wordCount <= 12 && !text.includes('\n') && !CODE.test(text);
}

const CLARIFYING =
  /\b(?:could|can|would) you (?:clarify|specify|confirm|share|tell me|let me know)\b|\bwhich (?:one|of these|version)\b|\bdo you (?:mean|want)\b|\bto (?:clarify|confirm)\b/i;

/**
 * An assistant reply that asked for missing information instead of answering.
 * A short reply ending in a question counts; a long answer that ends with an
 * offer ("Want me to…?") does not.
 * @param {string} text
 * @param {number} wordCount
 */
export function isClarification(text, wordCount) {
  const tail = text.trimEnd().slice(-240);
  return CLARIFYING.test(tail) || (wordCount < 80 && /\?\s*$/.test(tail));
}

/** Independent signals that a prompt is specific. Four of seven saturates the score. */
const SPECIFICITY_SIGNALS = [
  /\b(?:json|csv|markdown|table|bullet(?:ed| points?)?|numbered|outline|yaml|code block|headers?)\b/i,
  /\b(?:\d+\s*(?:words?|sentences?|paragraphs?|lines?|bullets?|items?|pages?)|concise|brief(?:ly)?|short|max(?:imum)?|at most|no more than|under \d+)\b/i,
  /\b(?:for (?:a|an|my) [a-z-]+ (?:audience|team|reader|client|student)|audience|explain (?:it )?to|non-technical|beginner|expert|executive)\b/i,
  /\b(?:you are|act as|as (?:a|an) [a-z-]+ (?:expert|engineer|writer|analyst|lawyer|teacher|editor))\b/i,
  /\b(?:for example|for instance|e\.g\.|example:|like this|here'?s an example|such as)\b/i,
  /\b(?:must|don'?t|do not|avoid|only|never|always|exclude|include|constraints?|requirements?)\b/i,
  /(?:^|\n)\s*(?:\d+[.)]|[-*•])\s+\S/m,
];

/**
 * How specific a prompt is, 0..1.
 * @param {string} text
 */
export function specificity(text) {
  let hits = 0;
  for (const re of SPECIFICITY_SIGNALS) if (re.test(text)) hits++;
  return Math.min(1, hits / 4);
}
