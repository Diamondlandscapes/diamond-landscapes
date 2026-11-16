// Pure training-plan and progress math for the fitness log.
// No DOM and no Firebase. The browser app and the node tests both import this.

import { usualMealEntries } from './foods.js';

export const APP_VERSION = '2026-11-16-2';

export const VACATION_DATE = '2026-12-23';
export const TARGET_DATE = '2026-12-22';
export const DELOAD_START = '2026-12-16';
export const DELOAD_END = '2026-12-22';
export const PLAN_START = '2026-11-16';

export const WEEKDAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export const BOUNDS = {
  weightLb: [50, 500],
  heightIn: [48, 96],
  bfPct: [1, 80],
  steps: [0, 200000],
  calories: [0, 20000],
  macro: [0, 2000],
  sleep: [0, 24],
  inches: [0, 100],
  grams: [0, 200000],
  visceral: [0, 20000],
  minutes: [0, 300],
  sets: [1, 12],
  restSec: [0, 600]
};

export function todayISO(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + d;
}

export function weekdayMon0(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

export function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function daysBetween(a, b) {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

export function formatLong(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC'
  });
}

export function formatWeekday(iso) {
  return WEEKDAYS[weekdayMon0(iso)];
}

export function formatHeight(inches) {
  const n = Number(inches);
  if (!Number.isFinite(n) || n <= 0) return '';
  const ft = Math.floor(n / 12);
  const inch = Math.round(n - ft * 12);
  return ft + "'" + inch + '"';
}

export function formatLb(n) {
  if (n == null || n === '' || !Number.isFinite(Number(n))) return '—';
  const x = Math.round(Number(n) * 10) / 10;
  const body = Math.abs(x - Math.round(x)) < 0.001 ? String(Math.round(x)) : x.toFixed(1);
  return body + ' lb';
}

export function formatGrams(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  return Math.round(Number(n)).toLocaleString('en-US') + ' g';
}

export function formatClock(sec) {
  sec = Math.max(0, Math.round(Number(sec) || 0));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m + ':' + String(s).padStart(2, '0');
}

export function parseNum(value) {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function inRange(n, bounds) {
  return n != null && Number.isFinite(Number(n)) && Number(n) >= bounds[0] && Number(n) <= bounds[1];
}

export function countdown(today, vacationDate) {
  const days = daysBetween(today, vacationDate || VACATION_DATE);
  if (days > 1) return { days: days, label: days + ' days until vacation' };
  if (days === 1) return { days: 1, label: '1 day until vacation' };
  if (days === 0) return { days: 0, label: 'Vacation day' };
  return { days: days, label: 'Vacation started' };
}

function lift(id, name, sets, reps, restSec, notes) {
  return {
    id: id,
    name: name,
    mode: 'strength',
    sets: sets,
    reps: reps,
    restSec: restSec,
    minutes: null,
    notes: notes || '',
    superset: '',
    deloadSets: null
  };
}

function timed(id, name, minutes, notes) {
  return {
    id: id,
    name: name,
    mode: 'timed',
    sets: 1,
    reps: '',
    restSec: 0,
    minutes: minutes,
    notes: notes || '',
    superset: '',
    deloadSets: null
  };
}

function check(id, name, notes) {
  return {
    id: id,
    name: name,
    mode: 'check',
    sets: 1,
    reps: '',
    restSec: 0,
    minutes: null,
    notes: notes || '',
    superset: '',
    deloadSets: null
  };
}

function day(key, name, kind, notes, exercises) {
  return { key: key, name: name, kind: kind, notes: notes || '', exercises: exercises };
}

const EQUIPMENT = [
  'Mikolo power rack / functional trainer — Smith bar, dual cable stacks, pull-up bar, dip handles, rope, straight bar',
  'Mikolo plate-loaded hack squat / leg press combo',
  'Mikolo plate-loaded leg extension / hamstring curl',
  'Plate tree',
  'Olympic barbell',
  'Bumper plates: 25, 35, 45, 55 lb',
  'Hex dumbbells, pairs up to 100 lb',
  'Adjustable bench',
  'Peloton bike',
  'NordicTrack treadmill',
  'Infrared sauna',
  'Cold plunge',
  'Stability ball'
];

const GUIDELINES = [
  'About 2,250 kcal, 190 g protein, 220 g carbs, 65 g fat.',
  '10,000 steps every day.',
  '20 min incline treadmill walk after lifting.',
  'Cold plunge at least 6 hours away from lifting.',
  'Dec 16–22: half the lifting sets. Same movements, less volume.',
  'Target about 185 lb and 15% body fat by Dec 22. Vacation is Dec 23.'
];

function starterWeek() {
  return [
    day('mon', 'Push + shoulders', 'lift', '', [
      lift('smith-incline', 'Smith incline press', 4, '6-10', 150, 'Smith bar, incline bench.'),
      lift('db-shoulder-press', 'Seated DB shoulder press', 3, '8-12', 120, 'Seated, hex dumbbells.'),
      lift('cable-lateral', 'Cable lateral raise', 3, '12-15', 60, 'One arm at a time, cable stack.'),
      lift('db-lateral-drop', 'DB lateral raise drop set', 2, '12 + drop', 75, 'Log the heavy set, then the drop.'),
      lift('rope-pushdown', 'Rope triceps pushdown', 3, '10-15', 75, 'Rope on the cable stack.'),
      lift('dips', 'Dips', 3, '6-12', 90, 'Dip handles on the rack. Log 0 lb for bodyweight.')
    ]),
    day('tue', 'Glutes + legs', 'lift', 'Hip thrust is the Smith bar. Leg curl is the plate-loaded machine.', [
      lift('smith-hip-thrust', 'Smith hip thrust', 4, '8-12', 120, 'Smith bar, bench under the shoulders.'),
      lift('db-rdl', 'DB Romanian deadlift', 3, '8-12', 120, 'Hex dumbbells.'),
      lift('bulgarian-split-squat', 'Bulgarian split squat', 3, '8-12 / leg', 90, 'Rear foot on the bench.'),
      lift('leg-curl', 'Leg curl', 3, '10-15', 75, 'Plate-loaded leg extension / hamstring curl machine.'),
      lift('smith-calf-raise', 'Smith standing calf raise', 4, '10-15', 60, 'Smith bar. Pause at the top.')
    ]),
    day('wed', 'Pull + arms', 'lift', '', [
      lift('pull-up', 'Pull-ups', 4, '4-10', 120, 'Pull-up bar on the rack. Log 0 lb for bodyweight.'),
      lift('db-row', 'Chest-supported DB row', 3, '8-12', 90, 'Chest on the incline bench.'),
      lift('face-pull', 'Rope face pull', 3, '12-20', 60, 'Rope to the face, rear delts.'),
      lift('incline-curl', 'Incline DB curl', 3, '8-12', 75, 'Bench set to a shallow incline.'),
      lift('hammer-curl', 'Hammer curl', 3, '8-12', 75, 'Hex dumbbells, neutral grip.'),
      lift('cable-curl', 'Cable curl', 2, '12-15', 60, 'Straight bar on the low cable.')
    ]),
    day('thu', 'Recovery', 'recovery', 'Easy day. Plunge can sit next to the sauna; there is no lift to space it from.', [
      timed('peloton', 'Zone-2 Peloton', 40, 'Conversational pace, about 40 minutes.'),
      check('sauna', 'Sauna', 'Infrared sauna.'),
      check('plunge', 'Cold plunge', 'Easy to pair with the sauna on this day.')
    ]),
    day('fri', 'Upper / arms', 'lift', 'Curl and overhead extension are a superset.', [
      lift('db-bench', 'DB bench press', 4, '6-10', 150, 'Adjustable bench, hex dumbbells.'),
      lift('cable-row', 'Cable row', 3, '8-12', 90, 'Seated, straight bar or rope.'),
      lift('lateral-raise', 'Lateral raise', 3, '12-15', 60, 'Cable or dumbbell.'),
      lift('rear-delt-fly', 'Rear-delt fly', 3, '12-15', 60, 'Dumbbell or cable.'),
      Object.assign(lift('curl', 'Curl', 3, '8-12', 0, 'Superset with the overhead extension. No rest yet.'), { superset: 'A' }),
      Object.assign(lift('overhead-extension', 'Overhead cable / DB triceps extension', 3, '10-15', 90, 'Cable or dumbbell. Rest after this side of the superset.'), { superset: 'A' })
    ]),
    day('sat', 'Glutes + legs', 'lift', 'Hack squat and calf raises are on the hack squat / leg press combo.', [
      lift('hack-squat', 'Hack squat', 4, '8-12', 150, 'Mikolo hack squat / leg press combo.'),
      lift('glute-kickback', 'Cable glute kickback', 3, '12-15 / side', 60, 'Functional trainer, one side at a time.'),
      lift('leg-extension', 'Leg extension', 3, '10-15', 75, 'Plate-loaded leg extension / hamstring curl machine.'),
      lift('walking-lunge', 'DB walking lunge', 3, '10-12 / leg', 90, 'Hex dumbbells, walking.'),
      lift('leg-press-calf', 'Leg press calf raise', 4, '10-15', 60, 'On the hack squat / leg press combo. Ball of the foot on the platform.')
    ]),
    day('sun', 'Rest + long walk', 'rest', 'No lifting. Get the steps in on foot.', [
      timed('long-walk', 'Long walk', 45, 'Easy pace. 10,000 steps still counts today.')
    ])
  ];
}

export function seedProfile(nowIso) {
  return {
    v: 1,
    heightIn: 73,
    startDate: PLAN_START,
    startWeightLb: 193,
    targetWeightLb: 185,
    targetBfPct: 15,
    targetDate: TARGET_DATE,
    vacationDate: VACATION_DATE,
    deloadStart: DELOAD_START,
    deloadEnd: DELOAD_END,
    calories: 2250,
    proteinG: 190,
    carbsG: 220,
    fatG: 65,
    stepsGoal: 10000,
    walkMin: 20,
    plungeGapHours: 6,
    fluidTrainOz: 128,
    fluidRestOz: 110,
    paceStart: '07:00',
    paceEnd: '20:00',
    remindOn: true,
    remindEveryMin: 90,
    quietStart: '21:00',
    quietEnd: '07:00',
    equipment: EQUIPMENT.slice(),
    guidelines: GUIDELINES.slice(),
    foods: [],
    week: starterWeek(),
    createdAt: nowIso || PLAN_START + 'T00:00:00.000Z',
    updatedAt: nowIso || PLAN_START + 'T00:00:00.000Z'
  };
}

export function seedDexa(nowIso) {
  return {
    date: '2026-01-02',
    weightLb: 198,
    bfPct: 19.4,
    fatMassG: 17158,
    leanBmcG: 71138,
    visceralFatG: 421,
    androidPct: 20.5,
    gynoidPct: 20.9,
    notes: 'DEXA scan.',
    updatedAt: nowIso || '2026-01-02T00:00:00.000Z'
  };
}

export function normalizeProfile(saved) {
  const base = seedProfile();
  if (!saved || typeof saved !== 'object') return base;
  const merged = Object.assign({}, base, saved);
  if (!Array.isArray(saved.week) || saved.week.length !== 7) merged.week = base.week;
  if (!Array.isArray(saved.equipment)) merged.equipment = base.equipment;
  if (!Array.isArray(saved.guidelines)) merged.guidelines = base.guidelines;
  if (!Array.isArray(saved.foods)) merged.foods = [];
  merged.v = 1;
  return merged;
}

export function dayPlan(profile, iso) {
  const week = (profile && profile.week) || [];
  return week[weekdayMon0(iso)] || week[0] || day('mon', 'Push + shoulders', 'lift', '', []);
}

export function inDeload(profile, iso) {
  if (!profile || !iso) return false;
  const start = profile.deloadStart || DELOAD_START;
  const end = profile.deloadEnd || DELOAD_END;
  return iso >= start && iso <= end;
}

export function deloadSetCount(sets) {
  const n = Math.max(1, Math.round(Number(sets) || 1));
  const cut = Math.max(1, Math.round(n / 2));
  return Math.min(n, cut);
}

export function prescribedSets(ex, profile, iso) {
  const planned = Math.max(1, Math.round(Number(ex && ex.sets) || 1));
  if (!ex || ex.mode !== 'strength') return planned;
  if (!inDeload(profile, iso)) return planned;
  if (ex.deloadSets != null && ex.deloadSets !== '') {
    const custom = Math.round(Number(ex.deloadSets));
    if (Number.isFinite(custom) && custom >= 1) return Math.min(planned, custom);
  }
  return deloadSetCount(planned);
}

export function targetWeightOn(profile, iso) {
  const startW = Number(profile.startWeightLb);
  const endW = Number(profile.targetWeightLb);
  const span = daysBetween(profile.startDate, profile.targetDate);
  if (!Number.isFinite(span) || span <= 0) return endW;
  let t = daysBetween(profile.startDate, iso) / span;
  if (t < 0) t = 0;
  if (t > 1) t = 1;
  return startW + (endW - startW) * t;
}

export function trailingAverage(checkins, iso, windowDays) {
  const days = windowDays || 7;
  const start = addDays(iso, -(days - 1));
  const vals = [];
  Object.keys(checkins || {}).forEach(function (date) {
    if (date < start || date > iso) return;
    const row = checkins[date];
    if (!row || row.weightLb == null || row.weightLb === '') return;
    const n = Number(row.weightLb);
    if (Number.isFinite(n)) vals.push(n);
  });
  if (!vals.length) return null;
  return vals.reduce(function (sum, n) { return sum + n; }, 0) / vals.length;
}

export function eachDate(from, to) {
  if (!from || !to || from > to) return [];
  const out = [];
  const n = daysBetween(from, to);
  for (let i = 0; i <= n; i++) out.push(addDays(from, i));
  return out;
}

export function chartModel(checkins, profile, today) {
  const start = profile.startDate;
  const end = profile.targetDate;
  const dated = Object.keys(checkins || {}).filter(function (d) {
    const row = checkins[d];
    return row && row.weightLb != null && row.weightLb !== '' && Number.isFinite(Number(row.weightLb));
  }).sort();
  let from = start;
  let to = end;
  if (dated.length) {
    if (dated[0] < from) from = dated[0];
    if (dated[dated.length - 1] > to) to = dated[dated.length - 1];
  }
  if (today && today > to) to = today;
  const points = dated.map(function (d) {
    return { date: d, weight: Number(checkins[d].weightLb) };
  });
  const avg = [];
  if (points.length) {
    const first = points[0].date;
    const lastPoint = points[points.length - 1].date;
    const stop = today && today >= first ? (today > lastPoint ? today : lastPoint) : lastPoint;
    eachDate(first, stop).forEach(function (d) {
      const a = trailingAverage(checkins, d, 7);
      if (a != null) avg.push({ date: d, weight: a });
    });
  }
  return {
    from: from,
    to: to,
    points: points,
    avg: avg,
    target: [
      { date: start, weight: Number(profile.startWeightLb) },
      { date: end, weight: Number(profile.targetWeightLb) }
    ],
    todayTarget: targetWeightOn(profile, today || start)
  };
}

function normName(s) {
  return String(s || '').trim().toLowerCase();
}

export function formatSet(s) {
  if (!s) return '';
  const hasW = s.weight != null && s.weight !== '';
  const hasR = s.reps != null && s.reps !== '';
  const w = hasW ? (Number(s.weight) === 0 ? 'BW' : trimNum(s.weight)) : '';
  const r = hasR ? trimNum(s.reps) : '';
  if (w && r) return w + '×' + r;
  if (r) return r + ' reps';
  if (w) return w + ' lb';
  return '';
}

function trimNum(n) {
  const x = Math.round(Number(n) * 10) / 10;
  if (!Number.isFinite(x)) return '';
  return Math.abs(x - Math.round(x)) < 0.001 ? String(Math.round(x)) : x.toFixed(1);
}

export function lastPerformance(sessionsByDate, exercise, beforeDate) {
  const dates = Object.keys(sessionsByDate || {}).filter(function (d) { return d < beforeDate; }).sort().reverse();
  for (let i = 0; i < dates.length; i++) {
    const session = sessionsByDate[dates[i]];
    const ex = (session.exercises || []).find(function (e) {
      return e.id === exercise.id || normName(e.name) === normName(exercise.name);
    });
    if (!ex || ex.mode !== 'strength') continue;
    const done = (ex.sets || []).filter(function (s) {
      return s.done && (s.weight != null || s.reps != null);
    });
    if (!done.length) continue;
    return { date: dates[i], sets: done };
  }
  return null;
}

export function formatLast(last) {
  if (!last) return '';
  const parts = last.sets.map(formatSet).filter(Boolean);
  if (!parts.length) return '';
  return parts.join(', ') + ' · ' + formatLong(last.date);
}

export function isExerciseDone(ex) {
  if (!ex) return false;
  if (ex.mode === 'strength') return Array.isArray(ex.sets) && ex.sets.length > 0 && ex.sets.every(function (s) { return !!s.done; });
  return !!ex.done;
}

export function buildSession(profile, date, sessionsByDate) {
  const plan = dayPlan(profile, date);
  const deload = inDeload(profile, date);
  const exercises = (plan.exercises || []).filter(function (ex) {
    return ex && String(ex.name || '').trim();
  }).map(function (ex) {
    if (ex.mode === 'timed') {
      return {
        id: ex.id, name: ex.name, mode: 'timed', minutes: ex.minutes || 0,
        done: false, notes: ex.notes || '', restSec: 0, superset: ''
      };
    }
    if (ex.mode === 'check') {
      return {
        id: ex.id, name: ex.name, mode: 'check', done: false,
        notes: ex.notes || '', restSec: 0, superset: ''
      };
    }
    const n = prescribedSets(ex, profile, date);
    const last = lastPerformance(sessionsByDate, ex, date);
    const sets = [];
    for (let i = 0; i < n; i++) {
      const prev = last && last.sets[i];
      sets.push({
        weight: prev && prev.weight != null ? prev.weight : null,
        reps: prev && prev.reps != null ? prev.reps : null,
        done: false
      });
    }
    return {
      id: ex.id,
      name: ex.name,
      mode: 'strength',
      superset: ex.superset || '',
      restSec: Number(ex.restSec) || 0,
      targetReps: ex.reps || '',
      notes: ex.notes || '',
      sets: sets
    };
  });
  return {
    date: date,
    dayKey: plan.key,
    planName: plan.name,
    kind: plan.kind,
    deload: deload,
    notes: '',
    walkDone: false,
    exercises: exercises,
    updatedAt: ''
  };
}

export function strengthRows(sessionsByDate, profile) {
  const order = [];
  const seen = new Set();
  ((profile && profile.week) || []).forEach(function (d) {
    (d.exercises || []).forEach(function (ex) {
      if (ex.mode !== 'strength' || seen.has(ex.id)) return;
      seen.add(ex.id);
      order.push(ex);
    });
  });
  const extras = [];
  Object.keys(sessionsByDate || {}).forEach(function (date) {
    ((sessionsByDate[date] && sessionsByDate[date].exercises) || []).forEach(function (ex) {
      if (ex.mode !== 'strength' || seen.has(ex.id)) return;
      seen.add(ex.id);
      extras.push(ex);
    });
  });
  return order.concat(extras).map(function (ex) {
    const history = [];
    Object.keys(sessionsByDate || {}).sort().forEach(function (date) {
      const logged = ((sessionsByDate[date].exercises) || []).find(function (e) { return e.id === ex.id; });
      if (!logged) return;
      const done = (logged.sets || []).filter(function (s) {
        return s.done && s.weight != null && s.reps != null && Number(s.weight) > 0;
      });
      if (!done.length) return;
      const best = done.slice().sort(function (a, b) {
        return (Number(b.weight) - Number(a.weight)) || (Number(b.reps) - Number(a.reps));
      })[0];
      history.push({ date: date, weight: Number(best.weight), reps: Number(best.reps) });
    });
    return {
      id: ex.id,
      name: ex.name,
      history: history,
      latest: history.length ? history[history.length - 1] : null
    };
  });
}

export function mealTotals(meals) {
  const totals = { kcal: 0, protein: 0, carbs: 0, fat: 0, count: 0 };
  (meals || []).forEach(function (m) {
    if (!m) return;
    totals.count += 1;
    totals.kcal += Number(m.kcal) || 0;
    totals.protein += Number(m.protein) || 0;
    totals.carbs += Number(m.carbs) || 0;
    totals.fat += Number(m.fat) || 0;
  });
  return totals;
}

export function emptyCheckin(date) {
  return {
    date: date,
    weightLb: null,
    steps: null,
    calories: null,
    protein: null,
    carbs: null,
    fat: null,
    sleepHours: null,
    sauna: false,
    coldPlunge: false,
    notes: '',
    meals: [],
    photoPath: '',
    updatedAt: ''
  };
}

export function emptyMeasurement(date) {
  return {
    date: date,
    waistIn: null,
    armIn: null,
    shoulderIn: null,
    calfIn: null,
    notes: '',
    updatedAt: ''
  };
}

export function checkinIssue(row) {
  if (!row || !row.date || String(row.date).length !== 10) return 'Pick a date.';
  const fields = [
    ['weightLb', BOUNDS.weightLb, 'Weight'],
    ['steps', BOUNDS.steps, 'Steps'],
    ['calories', BOUNDS.calories, 'Calories'],
    ['protein', BOUNDS.macro, 'Protein'],
    ['carbs', BOUNDS.macro, 'Carbs'],
    ['fat', BOUNDS.macro, 'Fat'],
    ['sleepHours', BOUNDS.sleep, 'Sleep']
  ];
  for (let i = 0; i < fields.length; i++) {
    const n = parseNum(row[fields[i][0]]);
    if (n != null && !inRange(n, fields[i][1])) return fields[i][2] + ' looks off.';
  }
  if (row.notes && String(row.notes).length > 2000) return 'Notes are too long.';
  if (row.meals && row.meals.length > 30) return 'Too many foods on this day.';
  return '';
}

export function measurementIssue(row) {
  if (!row || !row.date) return 'Pick a date.';
  const fields = ['waistIn', 'armIn', 'shoulderIn', 'calfIn'];
  let any = false;
  for (let i = 0; i < fields.length; i++) {
    const n = parseNum(row[fields[i]]);
    if (n == null) continue;
    any = true;
    if (!inRange(n, BOUNDS.inches)) return 'A measurement looks off.';
  }
  if (!any) return 'Enter at least one measurement.';
  return '';
}

export function dexaIssue(row) {
  if (!row || !row.date || String(row.date).length !== 10) return 'Pick a scan date.';
  if (!inRange(row.weightLb, BOUNDS.weightLb)) return 'Scan weight looks off.';
  if (!inRange(row.bfPct, BOUNDS.bfPct)) return 'Body fat looks off.';
  if (!inRange(row.fatMassG, BOUNDS.grams)) return 'Fat mass looks off.';
  if (!inRange(row.leanBmcG, BOUNDS.grams)) return 'Lean mass looks off.';
  if (!inRange(row.visceralFatG, BOUNDS.visceral)) return 'Visceral fat looks off.';
  if (!inRange(row.androidPct, [0, 80])) return 'Android fat looks off.';
  if (!inRange(row.gynoidPct, [0, 80])) return 'Gynoid fat looks off.';
  return '';
}

export function profileIssue(profile) {
  if (!profile) return 'Plan is missing.';
  if (!Array.isArray(profile.week) || profile.week.length !== 7) return 'The week needs 7 days.';
  if (!inRange(profile.heightIn, BOUNDS.heightIn)) return 'Height looks off.';
  if (!inRange(profile.startWeightLb, BOUNDS.weightLb)) return 'Start weight looks off.';
  if (!inRange(profile.targetWeightLb, BOUNDS.weightLb)) return 'Target weight looks off.';
  if (!inRange(profile.targetBfPct, [1, 60])) return 'Target body fat looks off.';
  if (!inRange(profile.calories, BOUNDS.calories)) return 'Calories look off.';
  if (!inRange(profile.proteinG, BOUNDS.macro)) return 'Protein looks off.';
  if (!inRange(profile.carbsG, BOUNDS.macro)) return 'Carbs look off.';
  if (!inRange(profile.fatG, BOUNDS.macro)) return 'Fat looks off.';
  const keys = WEEKDAY_KEYS;
  for (let i = 0; i < 7; i++) {
    const d = profile.week[i];
    if (!d || d.kind !== 'lift' && d.kind !== 'recovery' && d.kind !== 'rest') return 'Each day needs a type.';
    if (!d.name || String(d.name).trim().length === 0) return 'Each day needs a name.';
    if (String(d.name).length > 80) return 'A day name is too long.';
    if (String(d.key || '').length > 12) return 'A day key is too long.';
    if (d.notes != null && String(d.notes).length > 500) return 'A day note is too long.';
    if (d.key !== keys[i]) return 'Day order is Monday through Sunday.';
    if ((d.exercises || []).length > 20) return 'Too many exercises on ' + d.name + '.';
  }
  if ((profile.foods || []).length > 200) return 'Too many saved foods.';
  if ((profile.equipment || []).length > 40) return 'Equipment list is too long.';
  if (!inRange(profile.fluidTrainOz, [16, 400])) return 'Training-day fluid goal looks off.';
  if (!inRange(profile.fluidRestOz, [16, 400])) return 'Rest-day fluid goal looks off.';
  if (parseClock(profile.paceStart) == null || parseClock(profile.paceEnd) == null) return 'Pace window needs times like 07:00.';
  if (parseClock(profile.quietStart) == null || parseClock(profile.quietEnd) == null) return 'Quiet hours need times like 21:00.';
  if (profile.remindOn !== true && profile.remindOn !== false) return 'Reminder switch needs to be on or off.';
  if (!inRange(profile.remindEveryMin, [15, 360])) return 'Reminder interval looks off.';
  return '';
}

export const DRINKS = [
  { kind: 'water', name: 'Water' },
  { kind: 'gatorade-zero', name: 'Gatorade Zero' },
  { kind: 'bcaa', name: 'BCAA drink' },
  { kind: 'electrolyte', name: 'Electrolyte drink' }
];

export const SIP_OUNCES = [8, 12, 16, 20, 32];

export function parseClock(value) {
  const match = /^(\d{2}):(\d{2})$/.exec(String(value || ''));
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

export function inQuietHours(profile, now) {
  const start = parseClock(profile && profile.quietStart);
  const end = parseClock(profile && profile.quietEnd);
  if (start == null || end == null || start === end) return false;
  const mins = now.getHours() * 60 + now.getMinutes();
  if (start < end) return mins >= start && mins < end;
  return mins >= start || mins < end;
}

export function fluidGoalOz(profile, iso) {
  const kind = dayPlan(profile, iso).kind;
  const raw = kind === 'lift' ? Number(profile.fluidTrainOz) : Number(profile.fluidRestOz);
  if (Number.isFinite(raw) && raw > 0) return raw;
  return kind === 'lift' ? 128 : 110;
}

export function fluidTotal(entries) {
  return (entries || []).reduce(function (sum, entry) {
    return sum + (Number(entry && entry.oz) || 0);
  }, 0);
}

export function emptyFluids(date) {
  return { date: date, entries: [], updatedAt: '' };
}

export function makeFluidEntry(name, kind, oz, at) {
  const amount = Math.round(Number(oz) * 10) / 10;
  return {
    id: slug(kind || name) + '-' + Math.random().toString(36).slice(2, 8),
    name: String(name || 'Drink').trim().slice(0, 40) || 'Drink',
    kind: String(kind || 'custom').slice(0, 24),
    oz: amount,
    at: at || new Date().toISOString()
  };
}

export function fluidEntryIssue(entry) {
  if (!entry || !String(entry.name || '').trim()) return 'Name the drink.';
  if (!inRange(entry.oz, [1, 128])) return 'Amount should be 1 to 128 oz.';
  return '';
}

export function fluidStatus(profile, entries, date, now) {
  const goal = fluidGoalOz(profile, date);
  const consumed = fluidTotal(entries);
  const ratio = goal > 0 ? consumed / goal : 0;
  if (date !== todayISO(now)) {
    const short = Math.max(0, goal - consumed);
    const met = consumed + 0.05 >= goal;
    return {
      goal: goal,
      consumed: consumed,
      expected: goal,
      behind: met ? 0 : short,
      onPace: met,
      phase: 'past',
      ratio: ratio,
      label: met ? 'Goal met' : Math.round(short) + ' oz short of the goal'
    };
  }
  const start = parseClock(profile.paceStart || '07:00');
  const end = parseClock(profile.paceEnd || '20:00');
  const mins = now.getHours() * 60 + now.getMinutes();
  let expected = 0;
  let phase = 'before';
  if (start == null || end == null || end <= start) {
    expected = goal;
    phase = 'during';
  } else if (mins < start) {
    expected = 0;
    phase = 'before';
  } else if (mins >= end) {
    expected = goal;
    phase = 'after';
  } else {
    expected = goal * ((mins - start) / (end - start));
    phase = 'during';
  }
  const behind = Math.max(0, expected - consumed);
  const onPace = consumed + 0.05 >= expected;
  let label = 'On pace';
  if (phase === 'before') label = 'Pace starts at ' + (profile.paceStart || '07:00');
  else if (!onPace) label = Math.round(behind) + ' oz behind';
  else if (phase === 'after' && consumed + 0.05 < goal) label = Math.round(goal - consumed) + ' oz short of the goal';
  return {
    goal: goal,
    consumed: consumed,
    expected: expected,
    behind: behind,
    onPace: onPace,
    phase: phase,
    ratio: ratio,
    label: label
  };
}

export function reminderMessage(status) {
  return "You're " + Math.round(status.behind) + ' oz behind, drink some water';
}

export function reminderDue(profile, status, now, lastNotifiedAt) {
  if (!profile || profile.remindOn !== true) return null;
  if (!status || status.phase !== 'during') return null;
  if (!(status.behind >= 8)) return null;
  if (inQuietHours(profile, now)) return null;
  const every = Number(profile.remindEveryMin) || 90;
  if (lastNotifiedAt) {
    const elapsed = (now.getTime() - new Date(lastNotifiedAt).getTime()) / 60000;
    if (!(elapsed >= every)) return null;
  }
  return { title: 'Time to drink', body: reminderMessage(status) };
}

export function fluidSeries(fluidsByDate, profile, today) {
  const logged = Object.keys(fluidsByDate || {}).filter(function (date) {
    return fluidTotal((fluidsByDate[date] || {}).entries) > 0;
  }).sort();
  if (!logged.length || !today) return [];
  let from = logged[0];
  const cap = addDays(today, -20);
  if (from < cap) from = cap;
  if (from > today) return [];
  return eachDate(from, today).map(function (date) {
    return {
      date: date,
      oz: fluidTotal(((fluidsByDate[date] || {}).entries) || []),
      goal: fluidGoalOz(profile, date)
    };
  });
}

export function slug(s) {
  const out = String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  return out || 'item';
}

export function newExercise(name) {
  const label = String(name || '').trim();
  return {
    id: slug(label) + '-' + Math.random().toString(36).slice(2, 6),
    name: label,
    mode: 'strength',
    sets: 3,
    reps: '8-12',
    restSec: 90,
    minutes: null,
    notes: '',
    superset: '',
    deloadSets: null
  };
}

export function isPermissionDenied(err) {
  const code = String((err && (err.code || err.message)) || '').toLowerCase();
  return code.indexOf('permission-denied') !== -1
    || code.indexOf('permission_denied') !== -1
    || code.indexOf('storage/unauthorized') !== -1;
}

export function rulesRefusal(operation, path) {
  const op = operation || 'write';
  const doc = path || 'fitness';
  return 'Firestore refused ' + op + ' on ' + doc + '. Publish the fitness rules, then try that save again. Changes stay on this phone until then.';
}

// Sample logs for local preview screenshots. Not Dustin's measurements.
export function previewBundle(today) {
  const day = today || PLAN_START;
  const profile = seedProfile(day + 'T15:00:00.000Z');
  const weights = {
    '2026-11-10': 193.6,
    '2026-11-11': 193.2,
    '2026-11-12': 193.8,
    '2026-11-13': 193.0,
    '2026-11-14': 192.8,
    '2026-11-15': 193.1,
    '2026-11-16': 192.6
  };
  const checkins = {};
  Object.keys(weights).forEach(function (date) {
    const row = emptyCheckin(date);
    row.weightLb = weights[date];
    row.steps = date === '2026-11-16' ? 6400 : 10840;
    row.calories = date === '2026-11-16' ? null : 2310;
    row.protein = date === '2026-11-16' ? null : 188;
    row.carbs = date === '2026-11-16' ? null : 215;
    row.fat = date === '2026-11-16' ? null : 64;
    row.sleepHours = 7.5;
    row.sauna = date === '2026-11-12';
    row.coldPlunge = false;
    row.updatedAt = date + 'T12:00:00.000Z';
    checkins[date] = row;
  });
  const sessions = {};
  sessions['2026-11-09'] = {
    date: '2026-11-09',
    dayKey: 'mon',
    planName: 'Push + shoulders',
    kind: 'lift',
    deload: false,
    notes: '',
    walkDone: true,
    updatedAt: '2026-11-09T18:00:00.000Z',
    exercises: [
      {
        id: 'smith-incline', name: 'Smith incline press', mode: 'strength',
        superset: '', restSec: 150, targetReps: '6-10', notes: '',
        sets: [
          { weight: 90, reps: 8, done: true },
          { weight: 90, reps: 8, done: true },
          { weight: 90, reps: 6, done: true }
        ]
      }
    ]
  };
  sessions['2026-11-14'] = {
    date: '2026-11-14',
    dayKey: 'sat',
    planName: 'Glutes + legs',
    kind: 'lift',
    deload: false,
    notes: '',
    walkDone: true,
    updatedAt: '2026-11-14T17:00:00.000Z',
    exercises: [
      {
        id: 'hack-squat', name: 'Hack squat', mode: 'strength',
        superset: '', restSec: 150, targetReps: '8-12', notes: '',
        sets: [
          { weight: 90, reps: 10, done: true },
          { weight: 90, reps: 10, done: true },
          { weight: 90, reps: 8, done: true }
        ]
      },
      {
        id: 'leg-press-calf', name: 'Leg press calf raise', mode: 'strength',
        superset: '', restSec: 60, targetReps: '10-15', notes: '',
        sets: [
          { weight: 140, reps: 12, done: true },
          { weight: 140, reps: 12, done: true }
        ]
      }
    ]
  };
  const built = buildSession(profile, '2026-11-16', sessions);
  const incline = built.exercises.find(function (ex) { return ex.id === 'smith-incline'; });
  if (incline && incline.sets[0]) {
    incline.sets[0].weight = 95;
    incline.sets[0].reps = 8;
    incline.sets[0].done = true;
  }
  built.updatedAt = '2026-11-16T16:10:00.000Z';
  sessions['2026-11-16'] = built;
  const foodlog = {};
  foodlog['2026-11-16'] = {
    date: '2026-11-16',
    entries: usualMealEntries('usual-chicken-rice', 1),
    updatedAt: '2026-11-16T12:00:00.000Z'
  };
  const fluids = {};
  function sip(date, name, kind, oz, hm) {
    return { id: kind + '-' + hm.replace(':', ''), name: name, kind: kind, oz: oz, at: date + 'T' + hm + ':00' };
  }
  fluids['2026-11-14'] = {
    date: '2026-11-14',
    updatedAt: '2026-11-14T18:00:00',
    entries: [sip('2026-11-14', 'Water', 'water', 32, '09:00'), sip('2026-11-14', 'Electrolyte drink', 'electrolyte', 16, '12:00'), sip('2026-11-14', 'Water', 'water', 48, '16:00')]
  };
  fluids['2026-11-15'] = {
    date: '2026-11-15',
    updatedAt: '2026-11-15T17:00:00',
    entries: [sip('2026-11-15', 'Water', 'water', 40, '10:00'), sip('2026-11-15', 'Water', 'water', 40, '15:00')]
  };
  fluids['2026-11-16'] = {
    date: '2026-11-16',
    updatedAt: '2026-11-16T10:30:00',
    entries: [sip('2026-11-16', 'Water', 'water', 16, '08:10'), sip('2026-11-16', 'Gatorade Zero', 'gatorade-zero', 16, '10:30')]
  };
  return {
    profile: profile,
    checkins: checkins,
    sessions: sessions,
    fluids: fluids,
    foodlog: foodlog,
    measurements: [],
    dexa: [seedDexa()],
    today: day
  };
}

export function paceLabel(avg, target) {
  if (avg == null || target == null || !Number.isFinite(avg) || !Number.isFinite(target)) return '';
  const diff = Math.round((avg - target) * 10) / 10;
  if (Math.abs(diff) < 0.15) return 'On the target line';
  if (diff > 0) return trimNum(diff) + ' lb above the line';
  return trimNum(Math.abs(diff)) + ' lb under the line';
}
