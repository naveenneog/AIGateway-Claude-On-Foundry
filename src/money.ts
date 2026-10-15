import { z } from 'zod';
import { GatewayError } from './errors.js';
import type { Model } from './policy.js';

export function usdMicros(usd: number): number {
  const micros = Math.ceil(usd * 1_000_000);
  if (!Number.isFinite(usd) || usd < 0 || !Number.isSafeInteger(micros)) throw new GatewayError(400, 'invalid_amount');
  return micros;
}

const tokens = z.number().int().nonnegative().max(2_000_000);
const usageSchema = z.object({
  input_tokens: tokens,
  output_tokens: tokens,
  cache_read_input_tokens: tokens.optional().default(0),
  cache_creation_input_tokens: tokens.optional().default(0)
});
export type Usage = z.infer<typeof usageSchema>;

export function parseUsage(value: unknown): Usage {
  const result = usageSchema.safeParse(value);
  if (!result.success) throw new GatewayError(502, 'usage_unavailable');
  return result.data;
}

export function priceUsage(model: Model, value: unknown): number {
  const usage = parseUsage(value);
  return Math.ceil(
    usage.input_tokens * model.inputUsdPerMillion +
    usage.output_tokens * model.outputUsdPerMillion +
    usage.cache_read_input_tokens * model.cacheReadUsdPerMillion +
    usage.cache_creation_input_tokens * model.cacheWriteUsdPerMillion
  );
}

export function reserveCeiling(model: Model, maxOutput: number): number {
  if (!Number.isInteger(maxOutput) || maxOutput < 1 || maxOutput > model.maxOutputTokens) {
    throw new GatewayError(400, 'output_limit_exceeded');
  }
  const inputRate = Math.max(model.inputUsdPerMillion, model.cacheReadUsdPerMillion, model.cacheWriteUsdPerMillion);
  const value = Math.ceil(model.contextTokens * inputRate + maxOutput * model.outputUsdPerMillion);
  if (!Number.isSafeInteger(value)) throw new GatewayError(400, 'invalid_amount');
  return value;
}
