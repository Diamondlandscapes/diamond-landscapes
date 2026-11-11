#!/usr/bin/env node
// One-time backfill for receptionistCalls that have no message.
// Marks them handled (handledBy 'auto', handledReason 'no message').
// Does not delete them.
//
// DO NOT run this against production unless the owner asks.
// The app already marks these on ingest and hides any that are still
// status "new". This script is only for updating Firestore ahead of that.
//
// Offline classification (no network, no writes):
//   node scripts/backfill-no-message-calls.mjs --file calls.json
//
// Read-only Firestore listing (still do not point this at production
// unless you mean to):
//   node scripts/backfill-no-message-calls.mjs --dry-run
//
// Write. Refuses unless CONFIRM_BACKFILL=mark-no-message-calls is set.
// Not run by the change that added this file.
//   CONFIRM_BACKFILL=mark-no-message-calls node scripts/backfill-no-message-calls.mjs --apply

import fs from 'fs';
import { callLeftNoMessage, noMessageHandlePatch } from './no-message-calls.mjs';

const APPLY_CONFIRM = 'mark-no-message-calls';

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  if (i === -1) return '';
  return process.argv[i + 1] || '';
}

function loadFile(file) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (Array.isArray(raw)) return raw;
  if (raw && Array.isArray(raw.docs)) return raw.docs;
  if (raw && (raw.callSid || raw.id)) return [raw];
  throw new Error('JSON must be a call, an array of calls, or { docs: [...] }');
}

function classify(docs, nowIso) {
  const marked = [];
  const skipped = [];
  docs.forEach(function(doc) {
    if (!doc || typeof doc !== 'object') return;
    const id = String(doc.id || doc.callSid || '');
    const patch = noMessageHandlePatch(doc, nowIso);
    if (patch) marked.push({ id: id, patch: patch });
    else skipped.push({ id: id, noMessage: callLeftNoMessage(doc), status: doc.status || 'new' });
  });
  return { wrote: false, marked: marked, skipped: skipped };
}

function printReport(report) {
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
}

const file = argValue('--file');
const apply = process.argv.includes('--apply');
const dryRun = process.argv.includes('--dry-run');
const nowIso = new Date().toISOString();

if (file) {
  const report = classify(loadFile(file), nowIso);
  printReport(report);
  console.error('Classified ' + report.marked.length + ' no-message call(s). Nothing was written.');
  process.exit(0);
}

if (!apply && !dryRun) {
  console.error('Pass --file <json> to classify local docs without network.');
  console.error('Pass --dry-run to list production matches without writing.');
  console.error('Pass --apply only when you intend to update Firestore. It stays refused until CONFIRM_BACKFILL=' + APPLY_CONFIRM + '.');
  process.exit(1);
}

if (apply && process.env.CONFIRM_BACKFILL !== APPLY_CONFIRM) {
  console.error('Refusing to write. Set CONFIRM_BACKFILL=' + APPLY_CONFIRM + ' to mark no-message receptionistCalls handled.');
  console.error('Do not run --apply against production unless the owner asked for the backfill.');
  process.exit(2);
}

const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'diamond-landscapes-f676b';

const adminMod = await import('firebase-admin');
const admin = adminMod.default || adminMod;
if (!admin.apps.length) admin.initializeApp({ projectId: projectId });
const db = admin.firestore();
const snap = await db.collection('receptionistCalls').get();
const docs = [];
snap.forEach(function(d) {
  docs.push(Object.assign({ id: d.id }, d.data()));
});
const report = classify(docs, nowIso);

if (!apply) {
  printReport(report);
  console.error('Dry run only. ' + report.marked.length + ' call(s) would be marked. Nothing was written.');
  process.exit(0);
}

let written = 0;
for (const item of report.marked) {
  if (!item.id) continue;
  await db.collection('receptionistCalls').doc(item.id).set(item.patch, { merge: true });
  written += 1;
}
report.wrote = true;
report.written = written;
printReport(report);
console.error('Marked ' + written + ' no-message call(s) handled.');
