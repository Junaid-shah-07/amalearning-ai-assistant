/**
 * Central Gemini Configuration for AMALearning Zeeshan Assistant
 *
 * Centralizes model selection, default generation parameters, and fallback model settings.
 * Ensures both streaming (generateContentStream) and non-streaming (generateContent)
 * calls consistently use the configured model.
 */

export const DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash-lite';

/**
 * The active Gemini model name used across all AI endpoints.
 * Defaults to 'gemini-3.5-flash-lite'. Can be overridden via process.env.GEMINI_MODEL.
 */
export const GEMINI_MODEL: string = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;

export const GEMINI_TEMPERATURE = 0.4;

export interface GeminiModelConfig {
  model: string;
  temperature: number;
}

export function getGeminiModelConfig(): GeminiModelConfig {
  return {
    model: GEMINI_MODEL,
    temperature: GEMINI_TEMPERATURE,
  };
}
