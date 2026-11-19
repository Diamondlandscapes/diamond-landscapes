#!/usr/bin/env node
// Ingest a Diamond Ops finance export. Dry run by default.
//
// This does not connect to Chase, Bank of America, Capital One, or the
// Diamond Ops connector. It reads a JSON file the connector (or a person)
// already produced. It does not store secrets. live is always reported false.
//
//   node scripts/import-finance.mjs
//   node scripts/import-finance.mjs data/finance-import.sample.json
//   node scripts/import-finance.mjs --write data/your-export.json
//
// --write talks ONLY to the local Firestore emulator. It upserts by
// source + sourceId. A second run of the same file does not create a
// second copy. A posted row replaces its pending source id when
// supersedes (or the same sourceId) says so. It refuses any host that
// is not loopback and never calls production.
//
// The live security rules do not allow financeTransactions or
// financeAccounts yet. Loading the emulator does not publish those rules.
// See docs/finance-import.md.

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
const fileArg = args[0] || path.join(HERE, '..', 'data', 'finance-import.sample.json');

function fail(msg) {
  console.error(msg);
  process.exit(2);
}

let raw;
try { raw = JSON.parse(fs.readFileSync(fileArg, 'utf8')); }
catch (e) { fail('Could not parse JSON (' + fileArg + '): ' + e.message); }

const prepared = Bills.prepareImport(raw);
console.log('Import file: ' + fileArg);
if (raw && raw._comment) console.log(String(raw._comment));
console.log('Source: ' + (prepared.meta.source || ''));
console.log('Imported at: ' + (prepared.meta.importedAt || '(none)'));
console.log('Live synchronization: no');
console.log('Accounts: ' + prepared.accounts.length);
prepared.accounts.forEach(function(a) {
  var fresh = a.freshness && a.freshness.importedAt ? ('imported ' + a.freshness.importedAt) : 'no import timestamp';
  console.log('  ' + a.name + ' · ' + a.kind + ' · ' + fresh);
});
const report = prepared.report;
console.log('Transactions received: ' + report.received);
console.log('Unique after upsert: ' + report.unique);
console.log('Duplicates collapsed: ' + report.duplicatesCollapsed);
console.log('Pending superseded: ' + report.supersededPending);
console.log('Confirmed expenses: ' + Bills.money(report.buckets.expense) + ' (' + report.counts.expense + ')');
console.log('Refunds: ' + Bills.money(report.buckets.refund) + ' (' + report.counts.refund + ')');
console.log('Card settlements: ' + Bills.money(report.buckets.settlement) + ' (' + report.counts.settlement + ')');
console.log('Transfers: ' + Bills.money(report.buckets.transfer) + ' (' + report.counts.transfer + ')');
console.log('Unmatched: ' + Bills.money(report.buckets.unmatched) + ' (' + report.counts.unmatched + ')');
console.log('Personal: ' + Bills.money(report.buckets.personal) + ' (' + report.counts.personal + ')');
console.log('Bill payments: ' + Bills.money(report.buckets.bill_payment) + ' (' + report.counts.bill_payment + ')');
Object.keys(report.byAccount).forEach(function(id) {
  var slot = report.byAccount[id];
  console.log('  ' + id + ': posted out ' + Bills.money(slot.postedOut) + ', posted in ' + Bills.money(slot.postedIn) + ', pending out ' + Bills.money(slot.pendingOut) + ', pending in ' + Bills.money(slot.pendingIn));
});
if (prepared.errors.length) {
  prepared.errors.forEach(function(err) { console.error(err); });
  fail('Import did not validate. Nothing was written.');
}

if (!write) {
  console.log('');
  console.log('Dry run only. Nothing was written. This is not a live bank connection.');
  console.log('Emulator only: FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/import-finance.mjs --write ' + fileArg);
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

function putDoc(collection, id, record) {
  const body = JSON.stringify({ fields: toFirestoreValue(record).mapValue.fields });
  const reqPath = '/v1/projects/' + PROJECT + '/databases/(default)/documents/' + collection + '/' + encodeURIComponent(id);
  return new Promise(function(resolve, reject) {
    const req = http.request({
      host: host, port: port, method: 'PATCH', path: reqPath,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, function(res) {
      var chunks = '';
      res.on('data', function(d) { chunks += d; });
      res.on('end', function() {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(collection + '/' + id + ' failed (' + res.statusCode + '): ' + chunks.slice(0, 300)));
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

const docs = prepared.accounts.map(function(a) {
  return { collection: 'financeAccounts', id: a.id, record: Object.assign({ id: a.id }, a) };
}).concat(prepared.transactions.map(function(tx) {
  return { collection: 'financeTransactions', id: tx.id, record: tx };
}));
let chain = Promise.resolve();
docs.forEach(function(doc) {
  chain = chain.then(function() { return putDoc(doc.collection, doc.id, doc.record); });
});
chain.then(function() {
  console.log('Upserted ' + docs.length + ' docs on emulator ' + host + ':' + port + '. Not a live connection.');
  process.exit(0);
}).catch(function(err) {
  console.error(err.message || err);
  process.exit(1);
});
