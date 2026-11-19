#!/usr/bin/env node
// Reclassify clearly identified monthly expense budgets.
//
// Default is a dry run. It reads a JSON export of bill templates and prints
// what would change. It does not open a network connection.
//
//   node scripts/migrate-bill-budgets.mjs
//   node scripts/migrate-bill-budgets.mjs data/bills-migration.sample.json
//   node scripts/migrate-bill-budgets.mjs --write data/your-export.json
//
// --write talks ONLY to the local Firestore emulator and only updates the
// templates this plan marks reclassify_budget. It copies the original
// document onto classification.original and does not delete payments.
// It refuses any host that is not loopback. It never calls production.
//
// Card minimums stay bills even when the notes say "estimated minimums"
// or "enter actual". "Enter actual" by itself is not a budget. Ambiguous
// rows are listed for a person and are not written.
//
// The live security rules do not allow the new kind/funding fields yet.
// Do not point this at diamond-landscapes-f676b. See docs/finance-import.md.

import fs from 'fs';
import http from 'http';
import path from 'path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'url';
import { toFirestoreValue } from './community-model.mjs';

const require = createRequire(import.meta.url);
const Bills = require('./bills-model.js');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = 'diamond-landscapes-f676b';
const args = process.argv.slice(2).filter(function(a) { return a !== '--write'; });
const write = process.argv.includes('--write');
const fileArg = args[0] || path.join(HERE, '..', 'data', 'bills-migration.sample.json');

function fail(msg) {
  console.error(msg);
  process.exit(2);
}

let raw;
try { raw = JSON.parse(fs.readFileSync(fileArg, 'utf8')); }
catch (e) { fail('Could not parse JSON (' + fileArg + '): ' + e.message); }

const plan = Bills.migrationPlan(raw.bills || [], '2026-11-19T15:00:00.000Z');
const counts = { reclassify_budget: 0, keep_bill: 0, needs_review: 0, already_budget: 0 };
plan.forEach(function(row) { counts[row.action] = (counts[row.action] || 0) + 1; });

console.log('Migration file: ' + fileArg);
if (raw && raw._comment) console.log(String(raw._comment));
console.log('Reclassify as running budget: ' + (counts.reclassify_budget || 0));
console.log('Keep as fixed bill: ' + (counts.keep_bill || 0));
console.log('Needs manual review: ' + (counts.needs_review || 0));
console.log('Already a budget: ' + (counts.already_budget || 0));
console.log('');
plan.forEach(function(row) {
  var head = row.action === 'reclassify_budget' ? 'RECLASSIFY' : (row.action === 'needs_review' ? 'REVIEW' : (row.action === 'already_budget' ? 'ALREADY' : 'KEEP'));
  console.log(head + ' ' + row.id + ' ' + row.name);
  console.log('  ' + row.category + ' · ' + Bills.money(row.amount));
  console.log('  ' + row.reason);
  if (row.action === 'reclassify_budget' && row.proposed) {
    console.log('  Preserved original due day, amount, notes, and id. No payment docs deleted.');
    console.log('  Funding guess: ' + row.proposed.funding + '.');
  }
  if (row.dueIsEstimate) console.log('  Due date stays labeled as an estimate.');
  if (row.amountIsEstimate && row.action === 'keep_bill') console.log('  Amount stays labeled as an estimate.');
});

if (!write) {
  console.log('');
  console.log('Migration dry run. Nothing was written.');
  console.log('Emulator only: FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/migrate-bill-budgets.mjs --write ' + fileArg);
  process.exit(0);
}

const hostEnv = process.env.FIRESTORE_EMULATOR_HOST || '';
if (!hostEnv) fail('Refusing to write: FIRESTORE_EMULATOR_HOST is not set. This script does not touch production Firestore.');
if (/googleapis|firebaseio|cloud\.google|firebaseapp/i.test(hostEnv)) {
  fail('Refusing to write: FIRESTORE_EMULATOR_HOST looks like a production host (' + hostEnv + ').');
}
const hp = hostEnv.split(':');
const host = hp[0];
const port = parseInt(hp[1] || '8080', 10);
if (host !== '127.0.0.1' && host !== 'localhost') {
  fail('Refusing to write: emulator host must be 127.0.0.1 or localhost, got ' + host);
}

function putDoc(id, record) {
  const body = JSON.stringify({ fields: toFirestoreValue(record).mapValue.fields });
  const reqPath = '/v1/projects/' + PROJECT + '/databases/(default)/documents/bills/' + encodeURIComponent(id);
  return new Promise(function(resolve, reject) {
    const req = http.request({
      host: host, port: port, method: 'PATCH', path: reqPath,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, function(res) {
      var chunks = '';
      res.on('data', function(d) { chunks += d; });
      res.on('end', function() {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error('bills/' + id + ' failed (' + res.statusCode + '): ' + chunks.slice(0, 300)));
          return;
        }
        resolve();
      });
    });
    req.on('error', function(err) {
      reject(new Error('Could not reach the Firestore emulator at ' + host + ':' + port + ' (' + err.message + '). Nothing was written to production.'));
    });
    req.write(body);
    req.end();
  });
}

const docs = plan.filter(function(row) { return row.action === 'reclassify_budget' && row.proposed; });
let chain = Promise.resolve();
docs.forEach(function(row) {
  chain = chain.then(function() { return putDoc(row.id, row.proposed); });
});
chain.then(function() {
  console.log('Updated ' + docs.length + ' budget templates on emulator ' + host + ':' + port + '. Review rows were not written. Payment docs were not deleted.');
  process.exit(0);
}).catch(function(err) {
  console.error(err.message || err);
  process.exit(1);
});
