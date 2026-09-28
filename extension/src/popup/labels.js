// @ts-check
/**
 * @module popup/labels
 * Human labels for factor codes. Safe to ship: codes and names reveal what is
 * measured, not how it is weighted.
 */

/** @type {Record<string, string>} */
export const FACTOR_LABELS = {
  CONTEXT_BLOAT: 'Long threads',
  EMPTY_MESSAGES: 'Empty messages',
  REGENERATIONS: 'Regenerating',
  REPEATED_PROMPTS: 'Repeated prompts',
  REPASTED_CONTENT: 'Re-pasted content',
  VAGUE_PROMPTS: 'Vague prompts',
  CLARIFICATIONS: 'Clarifying questions',
  DRIP_FED_CONTEXT: 'Drip-fed context',
  TOPIC_DRIFT: 'Topic drift',
  UNUSED_OUTPUT: 'Unused replies',
  OVERSIZED_REQUESTS: 'Oversized requests',
  VERBOSE_REPLIES: 'Verbose replies',
  STOPPED_REPLIES: 'Stopped replies',
  HEAVY_MODEL_TRIVIAL: 'Heavy model, light question',
  NO_REUSABLE_CONTEXT: 'No projects or instructions',
  TREND: 'Trend',
  INCONSISTENT: 'Inconsistent',
};

/** @type {Record<string, string>} */
export const STRENGTH_TIPS = {
  CONTEXT_BLOAT: 'You keep threads short and focused.',
  EMPTY_MESSAGES: 'You rarely send throwaway messages.',
  REGENERATIONS: 'You edit instead of regenerating.',
  REPEATED_PROMPTS: 'You rephrase instead of repeating.',
  REPASTED_CONTENT: 'You refer back instead of re-pasting.',
  VAGUE_PROMPTS: 'Your prompts are specific.',
  CLARIFICATIONS: 'The model rarely has to ask what you mean.',
  DRIP_FED_CONTEXT: 'You front-load context.',
  TOPIC_DRIFT: 'You keep each thread on one topic.',
  UNUSED_OUTPUT: 'You use what you ask for.',
  OVERSIZED_REQUESTS: 'You ask for the right amount.',
  VERBOSE_REPLIES: 'Replies stay compact.',
  STOPPED_REPLIES: 'You rarely stop replies midway.',
  HEAVY_MODEL_TRIVIAL: 'You match the model to the task.',
  NO_REUSABLE_CONTEXT: 'You reuse context through projects.',
  TREND: 'You are improving week over week.',
  INCONSISTENT: 'Your habits are consistent.',
};
