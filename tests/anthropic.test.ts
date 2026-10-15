import assert from 'node:assert/strict';
import test from 'node:test';
import { UsageTracker } from '../src/anthropic.js';

const events = [
  { type: 'message_start', message: { usage: { input_tokens: 10, output_tokens: 0 } } },
  { type: 'message_delta', usage: { output_tokens: 5 } },
  { type: 'message_delta', usage: { cache_read_input_tokens: 3 } },
  { type: 'message_stop' }
];
function encode(values: unknown[], ending = '\n') {
  return new TextEncoder().encode(values.map((value) => `data: ${JSON.stringify(value)}${ending}${ending}`).join(''));
}
test('later partial usage deltas preserve previously reported output count', () => {
  const tracker = new UsageTracker();
  tracker.push(encode(events));
  assert.deepEqual(tracker.result(), { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 3 });
});
test('CRLF delimiters and multibyte text may span arbitrary network chunks', () => {
  const tracker = new UsageTracker();
  const bytes = encode([...events.slice(0, 2), { type: 'content_block_delta', delta: { text: '\u20ac' } }, ...events.slice(2)], '\r\n');
  for (let i = 0; i < bytes.length; i++) tracker.push(bytes.slice(i, i + 1));
  assert.deepEqual(tracker.result(), { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 3 });
});
test('truncated events and provider error events never become measurable usage', () => {
  for (const values of [events.slice(0, -1), [...events, { type: 'error', error: { type: 'overloaded_error' } }]]) {
    const tracker = new UsageTracker();
    tracker.push(encode(values));
    assert.equal(tracker.result(), undefined);
  }
});
