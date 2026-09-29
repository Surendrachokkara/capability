/**
 * The collector proper. Picks the adapter for the current host, runs it against
 * the live DOM and returns a Thread.
 */
import { adapterFor } from './adapters/index.js';
import { isMeaningful } from '../lib/model.js';

export async function captureCurrentThread(doc = document, loc = window.location) {
  const adapter = adapterFor(loc);
  if (!adapter) throw new Error('PacketPress does not support this site yet.');

  const thread = adapter.collect(doc, loc);
  if (!thread.messages.length) {
    throw new Error('No messages found — scroll the conversation into view and try again.');
  }
  if (!isMeaningful(thread)) {
    throw new Error('The captured messages were empty.');
  }
  return thread;
}
