// @ts-check
/**
 * @module tokenizer
 *
 * Fast, dependency-free token estimator.
 *
 * Chat UIs never expose real token counts, and a true BPE tokenizer carries a
 * ~1.5 MB vocabulary — too heavy to run on every DOM mutation of a streaming
 * reply. This single-pass estimator tracks cl100k/o200k-class tokenizers to
 * within roughly ±12% on English prose and ±20% on code, which is ample for a
 * *relative* score. An exact tokenizer can be plugged in with {@link setTokenizer}.
 *
 * Per segment of one regex pass:
 *   alphabetic run   1 token up to 6 chars, then ~1 token per 5 chars
 *   digit run        ~1 token per 3 digits
 *   newline run      1 token
 *   anything else    1 token per UTF-16 code unit (punctuation, symbols, CJK, emoji halves)
 *   spaces           free — BPE vocabularies attach them to the following word
 */

const SEGMENT = /[A-Za-z\u00C0-\u024F]+|\d+|\n+|[^\sA-Za-z0-9\u00C0-\u024F]/g;

/**
 * Heuristic token count. O(n), no allocation beyond regex matches.
 * @param {string} text
 * @returns {number}
 */
export function estimateTokens(text) {
  if (!text) return 0;
  let n = 0;
  SEGMENT.lastIndex = 0;
  for (let m = SEGMENT.exec(text); m !== null; m = SEGMENT.exec(text)) {
    const s = m[0];
    const c = s.charCodeAt(0);
    if (c === 10) n += 1;
    else if (c >= 48 && c <= 57) n += Math.ceil(s.length / 3);
    else if ((c | 32) >= 97 && (c | 32) <= 122 || c >= 0xc0) n += s.length <= 6 ? 1 : Math.ceil(s.length / 5);
    else n += 1;
  }
  return n;
}

/** @type {(text: string) => number} */
let active = estimateTokens;

/**
 * Replace the estimator, e.g. with an exact BPE implementation.
 * @param {(text: string) => number} fn
 */
export function setTokenizer(fn) {
  active = fn;
}

/**
 * Count tokens with the active tokenizer.
 * @param {string} text
 * @returns {number}
 */
export function countTokens(text) {
  return text ? active(text) : 0;
}
