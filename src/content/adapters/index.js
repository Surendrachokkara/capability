import * as chatgpt from './chatgpt.js';
import * as claude from './claude.js';

export const ADAPTERS = [chatgpt, claude];

export function adapterFor(loc) {
  return ADAPTERS.find((a) => a.matches(loc)) || null;
}
