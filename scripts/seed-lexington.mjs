#!/usr/bin/env node
// Load Lexington Club villages and unit addresses under ONE property.
//
// Default is a dry run: it reads the CSV and prints counts. It does not
// open a network connection.
//
//   node scripts/seed-lexington.mjs
//   node scripts/seed-lexington.mjs --write
//
// --write talks ONLY to the local Firestore emulator. It refuses to start
// unless FIRESTORE_EMULATOR_HOST is a loopback address. It never uses
// production credentials and never calls firestore.googleapis.com.
//
// The owner approves any production load separately, from the manager
// "Import village CSV" button on the Lexington Club property.

import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildCommunityFromCsvText, communityCounts, villageCountMap, toFirestoreValue } from './community-model.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CSV_PATH = path.join(HERE, '..', 'data', 'lexington-addresses.csv');
const PROJECT = 'diamond-landscapes-f676b';
const PROP_ID = 'lexington-club';
const CLUBHOUSE = '7799 Lexington Club Blvd, Delray Beach, FL 33446';

const write = process.argv.includes('--write');

function fail(msg) {
  console.error(msg);
  process.exit(2);
}

const csv = fs.readFileSync(CSV_PATH, 'utf8');
const community = buildCommunityFromCsvText(csv);
community.importedAt = new Date().toISOString();
const counts = communityCounts(community);
const byVillage = villageCountMap(community);

console.log('Lexington Club community (one property, not ' + counts.addresses + ' customers)');
console.log('Villages: ' + counts.villages);
console.log('Addresses: ' + counts.addresses);
console.log('Skipped rows: ' + (community.skipped || 0));
Object.keys(byVillage).sort(function(a, b) {
  return (parseInt(a.replace(/\D/g, ''), 10) || 0) - (parseInt(b.replace(/\D/g, ''), 10) || 0);
}).forEach(function(name) {
  console.log('  ' + name + ': ' + byVillage[name]);
});
console.log('JSON bytes: ' + JSON.stringify(community).length);

if (!write) {
  console.log('');
  console.log('Dry run only. Nothing was written.');
  console.log('To load the emulator: FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/seed-lexington.mjs --write');
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

const property = {
  id: PROP_ID,
  name: 'Lexington Club',
  address: CLUBHOUSE,
  phone: '',
  email: '',
  notes: 'Commercial HOA. Unit addresses live under Villages on this property. They are not separate customers.',
  services: [],
  community: community
};

const body = JSON.stringify({ fields: toFirestoreValue(property).mapValue.fields });
const reqPath = '/v1/projects/' + PROJECT + '/databases/(default)/documents/properties/' + PROP_ID;

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
      console.error('Emulator write failed (' + res.statusCode + '): ' + chunks.slice(0, 500));
      process.exit(1);
    }
    console.log('Wrote properties/' + PROP_ID + ' on emulator ' + host + ':' + port + ' (' + counts.villages + ' villages, ' + counts.addresses + ' addresses).');
    process.exit(0);
  });
});
req.on('error', function(err) {
  fail('Could not reach the Firestore emulator at ' + host + ':' + port + ' (' + err.message + '). Is it running? Nothing was written to production.');
});
req.write(body);
req.end();
