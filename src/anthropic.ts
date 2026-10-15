import { z } from 'zod';

const block = z.record(z.string(), z.unknown());
const tool = z.object({
  name: z.string().min(1).max(200),
  type: z.literal('custom').optional(),
  description: z.string().max(100000).optional(),
  input_schema: block,
  cache_control: block.optional(),
  defer_loading: z.boolean().optional()
}).strict();
export const messageSchema = z.strictObject({
  model: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/),
  max_tokens: z.number().int().min(1).max(200000),
  messages: z.array(z.strictObject({
    role: z.enum(['user', 'assistant', 'system']),
    content: z.union([z.string().min(1), z.array(block).min(1)])
  })).min(1).max(10000),
  system: z.union([z.string(), z.array(block)]).optional(),
  stream: z.boolean().optional(),
  tools: z.array(tool).max(1000).optional(),
  tool_choice: block.optional(),
  thinking: block.optional(),
  temperature: z.number().min(0).max(1).optional(),
  top_p: z.number().min(0).max(1).optional(),
  top_k: z.number().int().nonnegative().optional(),
  stop_sequences: z.array(z.string()).max(100).optional(),
  metadata: z.strictObject({ user_id: z.string().max(256).optional() }).optional(),
  output_config: block.optional(),
  service_tier: z.literal('standard_only').optional()
});
export type MessageRequest = z.infer<typeof messageSchema>;

export class UsageTracker {
  private buffer = '';
  private decoder = new TextDecoder();
  private usage: Record<string, unknown> = {};
  private started = false;
  private outputSeen = false;
  private ended = false;
  private invalid = false;
  push(chunk: Uint8Array) {
    this.buffer = (this.buffer + this.decoder.decode(chunk, { stream: true })).replace(/\r\n/g, '\n');
    if (this.buffer.length > 2_000_000) { this.invalid = true; this.buffer = ''; return; }
    let end: number;
    while ((end = this.buffer.indexOf('\n\n')) >= 0) {
      const event = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end + 2);
      const data = event.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n');
      if (!data) continue;
      let value: unknown;
      try { value = JSON.parse(data); } catch { this.invalid = true; continue; }
      if (!value || typeof value !== 'object') { this.invalid = true; continue; }
      const record = value as Record<string, unknown>;
      if (record.type === 'error') this.invalid = true;
      if (record.type === 'message_start') {
        const message = record.message;
        if (message && typeof message === 'object' && 'usage' in message &&
            message.usage && typeof message.usage === 'object') {
          this.usage = { ...message.usage };
          this.started = true;
        }
      }
      if (record.type === 'message_delta' && record.usage && typeof record.usage === 'object') {
        this.usage = { ...this.usage, ...record.usage };
        this.outputSeen ||= 'output_tokens' in record.usage;
      }
      if (record.type === 'message_stop') this.ended = true;
    }
  }
  result(): unknown {
    return this.started && this.outputSeen && this.ended && !this.invalid && !this.buffer.trim() ? this.usage : undefined;
  }
}
