import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { callLeftNoMessage, callIsOpenQueue, noMessageHandlePatch } from './no-message-calls.mjs';

const NOW = '2026-11-11T18:00:00.000Z';
const ENDED = '2026-11-11T17:00:00.000Z';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function call(extra) {
  return Object.assign({
    id: 'CA_test',
    callSid: 'CA_test',
    from: '+15555550100',
    startedAt: '2026-11-11T16:59:00.000Z',
    endedAt: ENDED,
    durationSec: 20,
    kind: 'no_message',
    callbackAt: null,
    reason: null,
    message: null,
    summary: 'Caller hung up before leaving a message.',
    transcript: [{ role: 'ara', text: 'Diamond Landscapes, this is Ara.' }],
    status: 'new',
    source: 'ara'
  }, extra);
}

test('hung up with only an Ara greeting is no message and gets an auto handled patch', function() {
  const c = call();
  assert.equal(callLeftNoMessage(c), true);
  assert.equal(callIsOpenQueue(c), false);
  assert.deepEqual(noMessageHandlePatch(c, NOW), {
    status: 'handled',
    handledAt: NOW,
    handledBy: 'auto',
    handledReason: 'no message'
  });
});

test('whitespace message and whitespace caller transcript still count as no message', function() {
  const c = call({
    kind: 'message',
    summary: null,
    message: ' \n\t ',
    transcript: [
      { role: 'ara', text: '   ' },
      { role: 'caller', text: '\n  ' }
    ]
  });
  assert.equal(callLeftNoMessage(c), true);
  assert.equal(callIsOpenQueue(c), false);
  assert.equal(noMessageHandlePatch(c, NOW).handledBy, 'auto');
});

test('a real message body stays in the open queue', function() {
  const c = call({
    kind: 'message',
    summary: 'Caller left a gate code.',
    message: 'Gate code is 0000.'
  });
  assert.equal(callLeftNoMessage(c), false);
  assert.equal(callIsOpenQueue(c), true);
  assert.equal(noMessageHandlePatch(c, NOW), null);
});

test('caller transcript counts as a message even when the body is empty', function() {
  const c = call({
    kind: 'no_message',
    message: null,
    transcript: [
      { role: 'ara', text: 'How can I help?' },
      { role: 'Caller', text: 'Please trim the hedge.' }
    ]
  });
  assert.equal(callLeftNoMessage(c), false);
  assert.equal(callIsOpenQueue(c), true);
});

test('a recording or voicemail url is a message', function() {
  assert.equal(callLeftNoMessage(call({ recordingUrl: ' https://example.test/vm.mp3 ' })), false);
  assert.equal(callLeftNoMessage(call({ voicemailUrl: 'https://example.test/vm.mp3' })), false);
  assert.equal(callLeftNoMessage(call({ kind: 'message', summary: null, outcome: 'voicemail' })), false);
});

test('callbacks stay in the queue even with an empty message', function() {
  const requested = call({
    kind: 'callback',
    message: null,
    summary: null,
    reason: 'Please call back about the front walk.',
    callbackAt: ENDED
  });
  assert.equal(callLeftNoMessage(requested), false);
  assert.equal(callIsOpenQueue(requested), true);
  assert.equal(noMessageHandlePatch(requested, NOW), null);
});

test('outbound calls, including Ara voicemail, stay in the queue', function() {
  const outbound = call({
    kind: 'outbound',
    direction: 'outbound',
    outcome: 'voicemail',
    message: null,
    summary: 'Ara left a voicemail about the irrigation timer.',
    transcript: []
  });
  assert.equal(callLeftNoMessage(outbound), false);
  assert.equal(callIsOpenQueue(outbound), true);
  const missed = call({
    kind: 'outbound',
    direction: 'outbound',
    outcome: 'no_answer',
    message: null,
    summary: null,
    transcript: []
  });
  assert.equal(callLeftNoMessage(missed), false);
  assert.equal(callIsOpenQueue(missed), true);
});

test('in-progress no-message calls are hidden but not written until the call ends', function() {
  const live = call({ endedAt: null, durationSec: null, summary: null });
  assert.equal(callLeftNoMessage(live), true);
  assert.equal(callIsOpenQueue(live), false);
  assert.equal(noMessageHandlePatch(live, NOW), null);
});

test('an in-progress message call is not treated as no message', function() {
  const live = call({
    kind: 'message',
    endedAt: null,
    durationSec: null,
    message: null,
    summary: null,
    transcript: []
  });
  assert.equal(callLeftNoMessage(live), false);
  assert.equal(callIsOpenQueue(live), true);
});

test('a finished message with only a summary stays in the queue', function() {
  const c = call({
    kind: 'message',
    message: '  ',
    summary: 'Caller left a gate-code message.',
    transcript: [{ role: 'ara', text: 'I can take a message.' }]
  });
  assert.equal(callLeftNoMessage(c), false);
  assert.equal(callIsOpenQueue(c), true);
});

test('a finished call with no kind and no content is no message', function() {
  const c = call({
    kind: '',
    message: null,
    summary: null,
    reason: null,
    transcript: []
  });
  assert.equal(callLeftNoMessage(c), true);
  assert.ok(noMessageHandlePatch(c, NOW));
});

test('an already handled call is not patched again', function() {
  const c = call({ status: 'handled', handledBy: 'manager@example.com', handledReason: 'called back' });
  assert.equal(callIsOpenQueue(c), false);
  assert.equal(noMessageHandlePatch(c, NOW), null);
});

test('firestore timestamp endedAt counts as ended, and a missing end does not', function() {
  assert.equal(noMessageHandlePatch(call({ endedAt: { seconds: 1762880000, nanoseconds: 0 } }), NOW).status, 'handled');
  assert.equal(noMessageHandlePatch(call({ kind: 'message', summary: null, message: '', transcript: [], endedAt: { toDate: function() { return new Date(ENDED); } } }), NOW).handledReason, 'no message');
});

test('queue filter still drops an unhandled no-message row', function() {
  const existing = call({ status: 'new', handledBy: null });
  assert.equal(callLeftNoMessage(existing), true);
  assert.equal(callIsOpenQueue(existing), false);
});

test('app wires the open-queue filter and ingest mark, and does not touch rules', function() {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(html, /function callsNewCount\(\) \{[\s\S]*?_callIsOpenQueue\(c\)/);
  assert.match(html, /renderDashCalls\(\) \{[\s\S]*?_callIsOpenQueue\(c\)/);
  assert.match(html, /var nNew = all\.filter\(function\(c\) \{ return _callIsOpenQueue\(c\); \}\)/);
  assert.match(html, /autoHandleNoMessageCalls\(\)/);
  assert.match(html, /handledBy: 'auto'/);
  assert.match(html, /handledReason: 'no message'/);
  const rules = fs.readFileSync(path.join(root, 'firestore.receptionistCalls.rules'), 'utf8');
  assert.doesNotMatch(rules, /handledReason/);
});

test('backfill file mode classifies without contacting Firestore', function() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dl-nomsg-'));
  const file = path.join(dir, 'calls.json');
  fs.writeFileSync(file, JSON.stringify({
    docs: [
      call({ id: 'CA_hangup', callSid: 'CA_hangup' }),
      call({
        id: 'CA_callback',
        callSid: 'CA_callback',
        kind: 'callback',
        callbackAt: ENDED,
        reason: 'Call me back.',
        summary: null
      })
    ]
  }));
  const result = spawnSync(process.execPath, [
    path.join(root, 'scripts', 'backfill-no-message-calls.mjs'),
    '--file', file
  ], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.wrote, false);
  assert.equal(report.marked.length, 1);
  assert.equal(report.marked[0].id, 'CA_hangup');
  assert.equal(report.marked[0].patch.handledBy, 'auto');
  assert.equal(report.marked[0].patch.handledReason, 'no message');
  assert.equal(report.skipped.length, 1);
  assert.equal(report.skipped[0].id, 'CA_callback');
  assert.match(result.stderr, /Nothing was written/);
});

test('backfill refuses to write without the confirmation env', function() {
  const result = spawnSync(process.execPath, [
    path.join(root, 'scripts', 'backfill-no-message-calls.mjs'),
    '--apply'
  ], { encoding: 'utf8' });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Refusing to write/);
  assert.doesNotMatch(result.stderr + result.stdout, /firebase/i);
});
