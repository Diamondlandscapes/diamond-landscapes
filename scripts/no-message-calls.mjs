// Loads the no-message helpers from index.html so the backfill and the
// tests use the same functions the app runs. No Firestore access.
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const htmlPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const match = html.match(/\/\* NO_MESSAGE_CALLS_START \*\/([\s\S]*?)\/\* NO_MESSAGE_CALLS_END \*\//);
if (!match) throw new Error('NO_MESSAGE_CALLS block missing from index.html');

const context = { Object, Date, String, Number, Array, JSON, isFinite };
vm.createContext(context);
vm.runInContext(match[1], context, { filename: 'index.html' });

// Returned objects are created inside the vm, so copy them into this realm.
export function callLeftNoMessage(call) {
  return context._callLeftNoMessage(call);
}
export function callIsOpenQueue(call) {
  return context._callIsOpenQueue(call);
}
export function callHasEnded(call) {
  return context._callHasEnded(call);
}
export function noMessageHandlePatch(call, nowIso) {
  var patch = context._noMessageHandlePatch(call, nowIso);
  if (!patch) return null;
  return {
    status: patch.status,
    handledAt: patch.handledAt,
    handledBy: patch.handledBy,
    handledReason: patch.handledReason
  };
}

if (typeof context._callLeftNoMessage !== 'function' || typeof context._noMessageHandlePatch !== 'function') {
  throw new Error('no-message helpers did not load from index.html');
}
