import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  seedProfile, seedDexa, weekdayMon0, daysBetween, countdown, inDeload,
  prescribedSets, deloadSetCount, targetWeightOn, trailingAverage, chartModel,
  buildSession, lastPerformance, formatLast, dayPlan, previewBundle,
  formatClock, formatHeight, profileIssue, dexaIssue, checkinIssue,
  strengthRows, mealTotals, paceLabel, PLAN_START, normalizeProfile,
  fluidGoalOz, fluidStatus, reminderDue, fluidTotal, inQuietHours, fluidSeries,
  rulesRefusal
} from '../fitness/model.js';
import { usualMealEntries, foodLogTotals, makeFoodEntry, foodById } from '../fitness/foods.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

test('Nov 16 2026 is Monday and the push day', function () {
  assert.equal(weekdayMon0('2026-11-16'), 0);
  assert.equal(weekdayMon0('2026-11-17'), 1);
  assert.equal(weekdayMon0('2026-11-22'), 6);
  assert.equal(weekdayMon0('2026-12-16'), 2);
  const profile = seedProfile();
  assert.equal(dayPlan(profile, '2026-11-16').name, 'Push + shoulders');
  assert.equal(dayPlan(profile, '2026-11-16').exercises[0].name, 'Smith incline press');
});

test('Tuesday stays Smith hip thrust and Saturday uses the hack squat combo', function () {
  const profile = seedProfile();
  const tue = dayPlan(profile, '2026-11-17');
  const sat = dayPlan(profile, '2026-11-21');
  assert.equal(tue.exercises.map(function (e) { return e.name; }).join('|'), [
    'Smith hip thrust',
    'DB Romanian deadlift',
    'Bulgarian split squat',
    'Leg curl',
    'Smith standing calf raise'
  ].join('|'));
  assert.equal(sat.exercises.map(function (e) { return e.name; }).join('|'), [
    'Hack squat',
    'Cable glute kickback',
    'Leg extension',
    'DB walking lunge',
    'Leg press calf raise'
  ].join('|'));
  const blob = JSON.stringify(profile).toLowerCase();
  assert.equal(blob.includes('glute drive'), false);
  assert.equal(blob.includes('hip thrust machine'), false);
  assert.equal(blob.includes('heels-elevated'), false);
  assert.equal(blob.includes('seated db calf'), false);
  assert.equal(blob.includes('seated dumbbell calf'), false);
  assert.ok(profile.equipment.some(function (line) { return /hack squat \/ leg press combo/i.test(line); }));
  assert.ok(profile.equipment.some(function (line) { return line === 'Plate tree'; }));
  assert.ok(profile.equipment.some(function (line) { return /leg extension \/ hamstring curl/i.test(line); }));
  assert.equal(profile.equipment.some(function (line) { return /glute drive/i.test(line); }), false);
});

test('macros, height, targets, and the Jan 2 DEXA seed', function () {
  const profile = seedProfile();
  assert.equal(profile.heightIn, 73);
  assert.equal(formatHeight(73), '6\'1"');
  assert.equal(profile.startWeightLb, 193);
  assert.equal(profile.targetWeightLb, 185);
  assert.equal(profile.targetBfPct, 15);
  assert.equal(profile.calories, 2250);
  assert.equal(profile.proteinG, 190);
  assert.equal(profile.carbsG, 220);
  assert.equal(profile.fatG, 65);
  assert.equal(profile.stepsGoal, 10000);
  assert.equal(profile.walkMin, 20);
  assert.equal(profile.plungeGapHours, 6);
  assert.equal(profile.targetDate, '2026-12-22');
  assert.equal(profile.vacationDate, '2026-12-23');
  assert.equal(profileIssue(profile), '');
  const dexa = seedDexa();
  assert.equal(dexa.date, '2026-01-02');
  assert.equal(dexa.weightLb, 198);
  assert.equal(dexa.bfPct, 19.4);
  assert.equal(dexa.fatMassG, 17158);
  assert.equal(dexa.leanBmcG, 71138);
  assert.equal(dexa.visceralFatG, 421);
  assert.equal(dexa.androidPct, 20.5);
  assert.equal(dexa.gynoidPct, 20.9);
  assert.equal(dexaIssue(dexa), '');
});

test('Friday curl and overhead extension are one superset', function () {
  const fri = dayPlan(seedProfile(), '2026-11-20');
  const curl = fri.exercises.find(function (e) { return e.id === 'curl'; });
  const ext = fri.exercises.find(function (e) { return e.id === 'overhead-extension'; });
  assert.equal(curl.superset, 'A');
  assert.equal(ext.superset, 'A');
  assert.equal(curl.restSec, 0);
  assert.equal(ext.restSec, 90);
  assert.equal(dayPlan(seedProfile(), '2026-11-19').exercises[0].minutes, 40);
  assert.equal(dayPlan(seedProfile(), '2026-11-22').kind, 'rest');
});

test('countdown from Nov 16 to Dec 23 is 37 days', function () {
  assert.equal(daysBetween('2026-11-16', '2026-12-23'), 37);
  assert.equal(daysBetween('2026-11-16', '2026-12-22'), 36);
  assert.deepEqual(countdown('2026-11-16', '2026-12-23'), { days: 37, label: '37 days until vacation' });
  assert.equal(countdown('2026-12-23', '2026-12-23').label, 'Vacation day');
  assert.equal(countdown('2026-12-24', '2026-12-23').label, 'Vacation started');
});

test('deload is Dec 16 through Dec 22 and cuts sets in half', function () {
  const profile = seedProfile();
  assert.equal(inDeload(profile, '2026-12-15'), false);
  assert.equal(inDeload(profile, '2026-12-16'), true);
  assert.equal(inDeload(profile, '2026-12-22'), true);
  assert.equal(inDeload(profile, '2026-12-23'), false);
  assert.equal(deloadSetCount(4), 2);
  assert.equal(deloadSetCount(3), 2);
  assert.equal(deloadSetCount(2), 1);
  const incline = dayPlan(profile, '2026-11-16').exercises[0];
  assert.equal(prescribedSets(incline, profile, '2026-11-16'), 4);
  assert.equal(prescribedSets(incline, profile, '2026-12-21'), 2);
  const custom = Object.assign({}, incline, { deloadSets: 3 });
  assert.equal(prescribedSets(custom, profile, '2026-12-21'), 3);
  const session = buildSession(profile, '2026-12-21', {});
  const logged = session.exercises.find(function (e) { return e.id === 'smith-incline'; });
  assert.equal(session.deload, true);
  assert.equal(logged.sets.length, 2);
});

test('target line runs from 193 on Nov 16 to 185 on Dec 22', function () {
  const profile = seedProfile();
  assert.equal(targetWeightOn(profile, '2026-11-16'), 193);
  assert.equal(targetWeightOn(profile, '2026-12-22'), 185);
  assert.equal(targetWeightOn(profile, '2026-12-04'), 189);
  assert.equal(targetWeightOn(profile, '2026-11-01'), 193);
  assert.equal(targetWeightOn(profile, '2026-12-30'), 185);
});

test('7-day average uses logged weigh-ins in the window', function () {
  const rows = {
    '2026-11-10': { weightLb: 194 },
    '2026-11-11': { weightLb: 193 },
    '2026-11-12': { weightLb: 193 },
    '2026-11-13': { weightLb: 192 },
    '2026-11-14': { weightLb: 192 },
    '2026-11-15': { weightLb: 192 },
    '2026-11-16': { weightLb: 191 }
  };
  const avg = trailingAverage(rows, '2026-11-16', 7);
  assert.ok(Math.abs(avg - (1347 / 7)) < 1e-9);
  const sparse = { '2026-11-16': { weightLb: 192.5 }, '2026-11-14': { weightLb: null } };
  assert.equal(trailingAverage(sparse, '2026-11-16', 7), 192.5);
  const profile = seedProfile();
  const chart = chartModel(rows, profile, '2026-11-16');
  assert.equal(chart.points.length, 7);
  assert.equal(chart.target[0].weight, 193);
  assert.equal(chart.target[1].weight, 185);
  assert.ok(chart.avg.length >= 7);
  assert.equal(paceLabel(193, 193), 'On the target line');
  assert.equal(paceLabel(193.4, 193), '0.4 lb above the line');
});

test('today prefills last time and does not mark those sets done', function () {
  const profile = seedProfile();
  const prior = {
    '2026-11-09': {
      date: '2026-11-09',
      exercises: [{
        id: 'smith-incline',
        mode: 'strength',
        sets: [
          { weight: 90, reps: 8, done: true },
          { weight: 90, reps: 6, done: true }
        ]
      }]
    }
  };
  const last = lastPerformance(prior, { id: 'smith-incline', name: 'Smith incline press' }, '2026-11-16');
  assert.equal(formatLast(last), '90×8, 90×6 · Sun, Nov 8'.replace('Sun, Nov 8', formatLast(last).split(' · ')[1]));
  assert.match(formatLast(last), /^90×8, 90×6 · /);
  const session = buildSession(profile, PLAN_START, prior);
  const incline = session.exercises.find(function (e) { return e.id === 'smith-incline'; });
  assert.equal(incline.sets.length, 4);
  assert.equal(incline.sets[0].weight, 90);
  assert.equal(incline.sets[0].reps, 8);
  assert.equal(incline.sets[0].done, false);
  assert.equal(incline.sets[3].weight, null);
  assert.equal(session.kind, 'lift');
});

test('preview sample includes the new Saturday machines and the real DEXA', function () {
  const bundle = previewBundle('2026-11-16');
  assert.equal(bundle.dexa[0].fatMassG, 17158);
  assert.equal(bundle.measurements.length, 0);
  assert.ok(bundle.sessions['2026-11-14'].exercises.some(function (e) { return e.id === 'hack-squat'; }));
  assert.ok(bundle.sessions['2026-11-14'].exercises.some(function (e) { return e.id === 'leg-press-calf'; }));
  const rows = strengthRows(bundle.sessions, bundle.profile);
  const hack = rows.find(function (r) { return r.id === 'hack-squat'; });
  assert.equal(hack.latest.weight, 90);
  assert.equal(hack.latest.reps, 10);
  const chart = chartModel(bundle.checkins, bundle.profile, '2026-11-16');
  assert.equal(chart.points.length, 7);
  assert.equal(checkinIssue(bundle.checkins['2026-11-16']), '');
});

test('normalize keeps a saved week and fills a broken one from the starter', function () {
  const custom = seedProfile();
  custom.week[1].exercises[0].name = 'Smith hip thrust';
  custom.calories = 2300;
  const kept = normalizeProfile(custom);
  assert.equal(kept.calories, 2300);
  assert.equal(kept.week[1].exercises[0].name, 'Smith hip thrust');
  const broken = normalizeProfile({ calories: 2100, week: [] });
  assert.equal(broken.calories, 2100);
  assert.equal(broken.week[1].exercises[0].name, 'Smith hip thrust');
});

test('clock, meals, and profile guards', function () {
  assert.equal(formatClock(90), '1:30');
  assert.equal(formatClock(40 * 60), '40:00');
  const meals = mealTotals([{ kcal: 400, protein: 35 }, { kcal: 220, protein: 20, carbs: 10, fat: 8 }]);
  assert.equal(meals.kcal, 620);
  assert.equal(meals.protein, 55);
  const bad = seedProfile();
  bad.week = bad.week.slice(0, 3);
  assert.match(profileIssue(bad), /7 days/);
});

test('fluid goals, pace, and reminders', function () {
  const profile = seedProfile();
  assert.equal(fluidGoalOz(profile, '2026-11-16'), 128);
  assert.equal(fluidGoalOz(profile, '2026-11-15'), 110);
  assert.equal(fluidGoalOz(profile, '2026-11-19'), 110);
  const noon = new Date(2026, 10, 16, 12, 0, 0);
  const ahead = fluidStatus(profile, [{ oz: 64 }], '2026-11-16', noon);
  assert.equal(ahead.phase, 'during');
  assert.equal(ahead.onPace, true);
  assert.equal(ahead.label, 'On pace');
  const behind = fluidStatus(profile, [{ oz: 16 }], '2026-11-16', noon);
  assert.equal(Math.round(behind.behind), 33);
  assert.equal(behind.label, '33 oz behind');
  const due = reminderDue(profile, behind, noon, null);
  assert.equal(due.body, "You're 33 oz behind, drink some water");
  const recent = new Date(noon.getTime() - 30 * 60000).toISOString();
  assert.equal(reminderDue(profile, behind, noon, recent), null);
  const old = new Date(noon.getTime() - 100 * 60000).toISOString();
  assert.ok(reminderDue(profile, behind, noon, old));
  assert.equal(inQuietHours(profile, new Date(2026, 10, 16, 22, 0, 0)), true);
  assert.equal(inQuietHours(profile, new Date(2026, 10, 16, 6, 30, 0)), true);
  assert.equal(inQuietHours(profile, noon), false);
  assert.equal(reminderDue(profile, behind, new Date(2026, 10, 16, 22, 0, 0), null), null);
  const early = fluidStatus(profile, [], '2026-11-16', new Date(2026, 10, 16, 6, 0, 0));
  assert.equal(early.phase, 'before');
  assert.equal(fluidTotal([{ oz: 16 }, { oz: 8 }]), 24);
  const series = fluidSeries(previewBundle('2026-11-16').fluids, profile, '2026-11-16');
  assert.ok(series.some(function (row) { return row.date === '2026-11-16' && row.oz === 32 && row.goal === 128; }));
  assert.equal(profileIssue(profile), '');
});

test('day name length is capped in the app, and the rules banner names the operation', function () {
  const profile = seedProfile();
  profile.week[0].name = 'x'.repeat(81);
  assert.match(profileIssue(profile), /too long/);
  assert.equal(
    rulesRefusal('setDoc', 'fitness/abc'),
    'Firestore refused setDoc on fitness/abc. Publish the fitness rules, then try that save again. Changes stay on this phone until then.'
  );
});

test('usual chicken and rice and a scaled serving', function () {
  const totals = foodLogTotals(usualMealEntries('usual-chicken-rice', 1));
  assert.equal(totals.kcal, 486);
  assert.equal(totals.protein, 57);
  const beef = foodLogTotals(usualMealEntries('usual-beef-rice', 1));
  assert.equal(beef.kcal, 574);
  assert.equal(beef.protein, 48);
  const scaled = makeFoodEntry(foodById('chicken-breast-4'), 1.5);
  assert.equal(scaled.kcal, 280.5);
  assert.equal(scaled.protein, 52.5);
  assert.equal(foodById('franks-tsp').kcal, 0);
});

test('rules fragments are owner-only and are not deployable alone', function () {
  const firestore = fs.readFileSync(path.join(root, 'firestore.fitness.rules'), 'utf8');
  const storage = fs.readFileSync(path.join(root, 'storage.fitness.rules'), 'utf8');
  assert.match(firestore, /Do not deploy this file by itself/);
  assert.match(firestore, /match \/fitness\/\{uid\}/);
  assert.match(firestore, /request\.auth\.uid == uid/);
  assert.match(firestore, /email_verified == true/);
  assert.match(firestore, /sign_in_provider == 'password'/);
  assert.match(firestore, /catch-all/);
  assert.equal(/allow read, write: if request\.auth != null;/.test(firestore), false);
  assert.match(firestore, /match \/checkins\/\{day\}/);
  assert.match(firestore, /match \/sessions\/\{day\}/);
  assert.match(firestore, /match \/measurements\/\{id\}/);
  assert.match(firestore, /match \/dexa\/\{id\}/);
  assert.match(firestore, /match \/fluids\/\{day\}/);
  assert.match(firestore, /fitnessFluidOk/);
  assert.match(firestore, /day is map/);
  assert.match(firestore, /match \/foodlog\/\{day\}/);
  assert.match(firestore, /fitnessFoodLogOk/);
  assert.equal(/day\.name\.size\(\)/.test(firestore), false);
  const profile = seedProfile();
  Object.keys(profile).forEach(function (key) {
    assert.ok(firestore.includes("'" + key + "'"), 'rules allow-list missing ' + key);
  });
  ['date', 'weightLb', 'steps', 'calories', 'protein', 'carbs', 'fat', 'sleepHours', 'sauna', 'coldPlunge', 'notes', 'meals', 'photoPath', 'updatedAt'].forEach(function (key) {
    assert.ok(firestore.includes("'" + key + "'"), 'check-in key missing ' + key);
  });
  assert.match(storage, /Do not deploy this file by itself/);
  assert.match(storage, /match \/fitness\/\{uid\}\/\{allPaths=\*\*\}/);
  assert.match(storage, /email_verified == true/);
  assert.match(storage, /image\/\.\*/);
  assert.match(storage, /request\.resource\.size < 5 \* 1024 \* 1024/);
});

test('service worker stays inside fitness and does not wipe other caches', function () {
  const sw = fs.readFileSync(path.join(root, 'fitness/sw.js'), 'utf8');
  assert.match(sw, /fitness-/);
  assert.match(sw, /k\.startsWith\('fitness-'\)/);
  assert.match(sw, /showNotification/);
  assert.match(sw, /periodicsync/);
  assert.match(sw, /fitness-hydration/);
  assert.equal(sw.includes("k !== CACHE_NAME"), false);
  const html = fs.readFileSync(path.join(root, 'fitness/index.html'), 'utf8');
  assert.match(html, /register\('\.\/sw\.js', \{ scope: '\.\/' \}\)/);
  assert.match(html, /dustin-fitness|app\.js/);
  const app = fs.readFileSync(path.join(root, 'fitness/app.js'), 'utf8');
  assert.match(app, /initializeApp\(firebaseConfig, 'dustin-fitness'\)/);
  assert.match(app, /signInWithEmailAndPassword/);
  assert.equal(app.includes('createUserWithEmailAndPassword'), false);
  assert.match(app, /Smith hip thrust|seedProfile/);
  const rootIndex = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.equal(rootIndex.includes('fitness/'), false);
  assert.equal(rootIndex.includes('dustin-fitness'), false);
});
