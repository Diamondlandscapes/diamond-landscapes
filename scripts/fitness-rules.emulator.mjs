// Runs the first-sign-in writes against the fitness rules fragment pasted
// into a ruleset the way production does. There is no firestore.rules in
// this repo. Start with: node scripts/fitness-rules.emulator.mjs
// Requires firebase-tools and Java. Does not deploy anything.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fitness-rules-'));
  const frag = fs.readFileSync(path.join(root, 'firestore.fitness.rules'), 'utf8');
  const rules = [
    "rules_version = '2';",
    'service cloud.firestore {',
    '  match /databases/{database}/documents {',
    frag,
    '  }',
    '}',
    ''
  ].join('\n');
  fs.writeFileSync(path.join(dir, 'firestore.rules'), rules);
  fs.writeFileSync(path.join(dir, 'firebase.json'), JSON.stringify({
    firestore: { rules: 'firestore.rules' },
    emulators: {
      auth: { port: 9159 },
      firestore: { port: 8159 },
      ui: { enabled: false },
      singleProjectMode: true
    }
  }));
  fs.writeFileSync(path.join(dir, '.firebaserc'), JSON.stringify({
    projects: { default: 'demo-fitness' }
  }));
  const firebase = process.env.FIREBASE_BIN || 'firebase';
  const child = spawnSync(firebase, [
    'emulators:exec',
    '--only', 'auth,firestore',
    '--project', 'demo-fitness',
    process.execPath + ' ' + JSON.stringify(fileURLToPath(import.meta.url))
  ], {
    cwd: dir,
    stdio: 'inherit',
    env: Object.assign({}, process.env, { FITNESS_RULES_INNER: '1' })
  });
  process.exit(child.status == null ? 1 : child.status);
}

const sdk = process.env.FIREBASE_SDK || '/tmp/fb-rules/node_modules/firebase';
const { pathToFileURL } = await import('node:url');
const { initializeApp } = await import(pathToFileURL(sdk + '/app/dist/index.mjs').href);
const { getAuth, connectAuthEmulator, signInWithEmailAndPassword } = await import(pathToFileURL(sdk + '/auth/dist/index.mjs').href);
const { getFirestore, connectFirestoreEmulator, doc, getDoc, setDoc } = await import(pathToFileURL(sdk + '/firestore/dist/index.mjs').href);
const { seedProfile, seedDexa, buildSession, emptyCheckin, emptyFluids, firestoreDoc } = await import('../fitness/model.js');
const { emptyFoodLog, makeFoodEntry, foodById } = await import('../fitness/foods.js');

const uid = 'dlVFarsoyDSG45vETl69qx19zDg2';
const email = 'dustin-rules@example.com';
const password = 'testpass1';
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const fsHost = process.env.FIRESTORE_EMULATOR_HOST;
const [fsName, fsPort] = fsHost.split(':');

const signup = await fetch('http://' + authHost + '/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
  body: JSON.stringify({ email, password, emailVerified: true, localId: uid, returnSecureToken: true })
});
if (!signup.ok) {
  const body = await signup.text();
  console.error('signup failed', signup.status, body);
  process.exit(1);
}

const app = initializeApp({ apiKey: 'fake', authDomain: 'localhost', projectId: 'demo-fitness' });
const auth = getAuth(app);
connectAuthEmulator(auth, 'http://' + authHost, { disableWarnings: true });
const db = getFirestore(app);
connectFirestoreEmulator(db, fsName, Number(fsPort));
const cred = await signInWithEmailAndPassword(auth, email, password);
if (cred.user.uid !== uid || cred.user.emailVerified !== true) {
  console.error('unexpected auth user', cred.user.uid, cred.user.emailVerified);
  process.exit(1);
}

const ref = doc(db, 'fitness', uid);
const missing = await getDoc(ref);
if (missing.exists()) {
  console.error('profile should not exist yet');
  process.exit(1);
}
const created = seedProfile(new Date().toISOString());
await setDoc(ref, created);
const updated = seedProfile(new Date().toISOString());
updated.calories = 2300;
await setDoc(ref, updated);
const saved = await getDoc(ref);
if (!saved.exists() || saved.data().calories !== 2300) {
  console.error('profile update did not stick', saved.data() && saved.data().calories);
  process.exit(1);
}
console.log('seedProfile create and update allowed');

const now = new Date().toISOString();
const session = buildSession(seedProfile(now), '2026-11-16', {});
session.updatedAt = now;
const checkin = emptyCheckin('2026-11-16');
checkin.weightLb = 193;
checkin.updatedAt = now;
const fluids = emptyFluids('2026-11-16');
fluids.entries = [{ id: 'water-1', name: 'Water', kind: 'water', oz: 16, at: now }];
fluids.updatedAt = now;
const foodlog = emptyFoodLog('2026-11-16');
foodlog.entries = [makeFoodEntry(foodById('chicken-breast-6'), 1, now)];
foodlog.updatedAt = now;
const measure = {
  date: '2026-11-16', waistIn: 34, armIn: null, shoulderIn: null, calfIn: null,
  notes: '', updatedAt: now
};
const dexa = seedDexa(now);

const collections = [
  ['profile', ['fitness', uid], created],
  ['checkins', ['fitness', uid, 'checkins', '2026-11-16'], checkin],
  ['sessions', ['fitness', uid, 'sessions', '2026-11-16'], session],
  ['measurements', ['fitness', uid, 'measurements', '2026-11-16'], measure],
  ['dexa', ['fitness', uid, 'dexa', '2026-01-02'], dexa],
  ['fluids', ['fitness', uid, 'fluids', '2026-11-16'], fluids],
  ['foodlog', ['fitness', uid, 'foodlog', '2026-11-16'], foodlog]
];

for (const [kind, segments, body] of collections) {
  const ref = doc(db, ...segments);
  const docId = segments[segments.length - 1];
  await setDoc(ref, firestoreDoc(kind, body));
  const loaded = Object.assign({ id: docId, extra: true }, body);
  let rawDenied = false;
  try {
    await setDoc(ref, loaded);
  } catch (err) {
    rawDenied = String(err.code || err.message || '').toLowerCase().indexOf('permission') !== -1;
  }
  if (!rawDenied) {
    console.error(kind + ' accepted a document that still has id');
    process.exit(1);
  }
  await setDoc(ref, firestoreDoc(kind, loaded));
  const snap = await getDoc(ref);
  if (!snap.exists() || Object.prototype.hasOwnProperty.call(snap.data(), 'id')) {
    console.error(kind + ' resave did not stick without id');
    process.exit(1);
  }
  console.log(kind + ' reload with id then save allowed');
}
process.exit(0);
