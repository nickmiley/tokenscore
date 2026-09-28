// @ts-check
/**
 * @module lib/pricing
 * Illustrative list prices in USD per million tokens, used only for the
 * "token receipt" in the popup. Providers change these often; they are not
 * part of the score.
 */

/** @type {Record<string, { input: number, output: number }>} */
export const PRICES = {
  chatgpt: { input: 1.25, output: 10 },
  claude: { input: 3, output: 15 },
  gemini: { input: 1.25, output: 10 },
  copilot: { input: 1.25, output: 10 },
};

/**
 * @param {import('@tokenscore/core/features').ConversationFeatures} f
 * @returns {number} USD
 */
export function estimateCost(f) {
  const p = PRICES[f.platform] ?? PRICES.chatgpt;
  const input = Math.max(0, f.effectiveTokens - f.assistantTokens);
  return (input * p.input + f.assistantTokens * p.output) / 1_000_000;
}
