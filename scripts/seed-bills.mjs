#!/usr/bin/env node
// Import a Bills & Expenses JSON file into the LOCAL Firestore emulator.
//
// This file is not run by the app and is not run against production.
// Default is a dry run: it reads the JSON and prints counts. It does not
// open a network connection.
//
//   node scripts/seed-bills.mjs
//   node scripts/seed-bills.mjs data/bills.sample.json
//   node scripts/seed-bills.mjs --write data/your-bills.json
//
// --write talks ONLY to the local Firestore emulator. It refuses to start
// unless FIRESTORE_EMULATOR_HOST is a loopback address. It never uses
// production credentials and never calls firestore.googleapis.com.
//
// The owner approves any production load separately. Do not point this
// at the live diamond-landscapes-f676b database.
//
// JSON shape:
//   {
//     "_comment": "optional note",
//     "balances": {
//       "chase0714": { "amount": 1000.5, "asOf": "2026-11-12", "source": "manual" },
//       "boa1003":   { "amount": null, "asOf": null, "source": "" },
//       "quickbooks": { "asOf": null, "source": "", "connected": false }
//     },
//     "bills": [
//       { "id": "bill_rent", "name": "Shop rent", "category": "Rent & storage",
//         "amount": 2200, "recurrence": "monthly", "dueDay": 3, "type": "fixed",
//         "notes": "" }
//     ],
//     "payments": [
//       { "billId": "bill_rent", "month": "2026-11", "amountPaid": 2200,
//         "paidAt": "2026-11-03", "paidBy": "owner", "expectedAmount": 2200 }
//     ],
//     "invoices": [
//       { "customer": "Palm Court HOA", "invoiceNumber": "INV-1044",
//         "amount": 2400, "dueDate": "2026-11-01" }
//     ]
//   }
//
// Categories: Payroll, Vehicles & equipment, Loans, Rent & storage,
// Insurance, Fuel, Services/software/phone, Crew operating,
// Card minimums/Affirm, Personal.
// type "credit_card" (or variableAmount true) makes Mark paid ask for
// the amount instead of recording the minimum.

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
const fileArg = args[0] || path.join(HERE, '..', 'data', 'bills.sample.json');

function fail(msg) {
  console.error(msg);
  process.exit(2);
}

const rawText = fs.readFileSync(fileArg, 'utf8');
let raw;
try { raw = JSON.parse(rawText); }
catch (e) { fail('Could not parse JSON (' + fileArg + '): ' + e.message); }

const parsed = Bills.validateImport(raw);
if (!parsed.ok) {
  parsed.errors.forEach(function(err) { console.error(err); });
  fail('JSON did not validate. Nothing was written.');
}

console.log('Bills file: ' + fileArg);
if (raw && raw._comment) console.log(String(raw._comment));
console.log('Balances doc: finance/balances');
console.log('  Chase ···0714: ' + Bills.money(parsed.balances.chase0714.amount) + (parsed.balances.chase0714.asOf ? (' as of ' + parsed.balances.chase0714.asOf) : ''));
console.log('  BoA ···1003: ' + Bills.money(parsed.balances.boa1003.amount) + (parsed.balances.boa1003.asOf ? (' as of ' + parsed.balances.boa1003.asOf) : ''));
console.log('Bills: ' + parsed.bills.length);
parsed.bills.forEach(function(b) {
  var when = b.recurrence === 'monthly' ? ('day ' + b.dueDay) : b.dueDate;
  console.log('  ' + b.name + ' · ' + b.category + ' · ' + Bills.money(b.amount) + ' · ' + b.recurrence + ' ' + when + (b.type === 'credit_card' ? ' · card' : ''));
});
console.log('Payments: ' + parsed.payments.length);
console.log('Invoices: ' + parsed.invoices.length);

if (!write) {
  console.log('');
  console.log('Dry run only. Nothing was written.');
  console.log('To load the emulator: FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/seed-bills.mjs --write ' + fileArg);
  process.exit(0);
}

const hostEnv = process.env.FIRESTORE_EMULATOR_HOST || '';
if (!hostEnv) {
  fail('Refusing to write: FIRESTORE_EMULATOR_HOST is not set. This script does not touch production Firestore.');
}
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
      host: host,
      port: port,
      method: 'PATCH',
      path: reqPath,
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
      reject(new Error('Could not reach the Firestore emulator at ' + host + ':' + port + ' (' + err.message + '). Is it running? Nothing was written to production.'));
    });
    req.write(body);
    req.end();
  });
}

const docs = [{ collection: 'finance', id: 'balances', record: parsed.balances }]
  .concat(parsed.bills.map(function(b) { return { collection: 'bills', id: b.id, record: b }; }))
  .concat(parsed.payments.map(function(p) { return { collection: 'billPayments', id: p.id, record: p }; }))
  .concat(parsed.invoices.map(function(inv) { return { collection: 'financeInvoices', id: inv.id, record: inv }; }));

let chain = Promise.resolve();
docs.forEach(function(doc) {
  chain = chain.then(function() { return putDoc(doc.collection, doc.id, doc.record); });
});
chain.then(function() {
  console.log('Wrote ' + docs.length + ' docs on emulator ' + host + ':' + port + '.');
  process.exit(0);
}).catch(function(err) {
  console.error(err.message || err);
  process.exit(1);
});
