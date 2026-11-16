import {
  APP_VERSION, WEEKDAY_KEYS, WEEKDAYS, VACATION_DATE,
  seedProfile, seedDexa, todayISO, weekdayMon0, formatLong, formatWeekday,
  formatHeight, formatLb, formatGrams, formatClock, parseNum, countdown,
  dayPlan, inDeload, prescribedSets, targetWeightOn, trailingAverage, chartModel,
  lastPerformance, formatLast, formatSet, isExerciseDone, buildSession,
  strengthRows, mealTotals, emptyCheckin, emptyMeasurement, checkinIssue,
  measurementIssue, dexaIssue, profileIssue, slug, newExercise, normalizeProfile,
  isPermissionDenied, previewBundle, paceLabel, daysBetween, addDays,
  DRINKS, SIP_OUNCES, fluidStatus, fluidGoalOz, fluidSeries, emptyFluids,
  makeFluidEntry, fluidEntryIssue, reminderDue, fluidTotal, rulesRefusal
} from './model.js?v=2026-11-16-3';
import {
  FOOD_LIBRARY, USUAL_MEALS, SERVING_MULTIPLIERS, foodById, makeFoodEntry,
  usualMealEntries, emptyFoodLog, foodLogTotals, foodEntryIssue
} from './foods.js?v=2026-11-16-3';

const firebaseConfig = {
  apiKey: 'AIzaSyBYcBBQ2IFVgL4Oq0Oob54ttzxuntwdY2Q',
  authDomain: 'diamond-landscapes-f676b.firebaseapp.com',
  projectId: 'diamond-landscapes-f676b',
  storageBucket: 'diamond-landscapes-f676b.firebasestorage.app',
  messagingSenderId: '795500111307',
  appId: '1:795500111307:web:39379296ce4d91a509824e'
};

const state = {
  preview: false,
  user: null,
  db: null,
  storage: null,
  auth: null,
  tab: 'today',
  viewDate: todayISO(),
  profile: null,
  checkins: {},
  sessions: {},
  drafts: {},
  measurements: [],
  dexa: [],
  fluids: {},
  foodlog: {},
  foodMult: 1,
  sipOz: 16,
  expand: null,
  expandDate: '',
  openDay: null,
  rulesProblem: false,
  offline: false,
  photoDraft: null,
  photoDraftDate: '',
  dexaOpen: false,
  confirmRestore: false,
  scrollTop: false,
  scrollToDay: false,
  timers: { session: 0, checkin: 0, profile: 0 },
  timer: null
};

const $ = (id) => document.getElementById(id);

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function isPreview() {
  const host = location.hostname;
  const local = host === 'localhost' || host === '127.0.0.1';
  return local && new URLSearchParams(location.search).get('preview') === '1';
}

function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('show'), 2400);
}

function show(id) {
  ['boot', 'login-screen', 'verify-screen', 'shell'].forEach((key) => {
    $(key).hidden = key !== id;
  });
}

function maxViewDate() {
  if (state.preview && state.profile && state.profile.vacationDate) return state.profile.vacationDate;
  return todayISO();
}

function applyQuery() {
  const q = new URLSearchParams(location.search);
  const tab = q.get('tab');
  if (tab === 'today' || tab === 'checkin' || tab === 'progress' || tab === 'plan') state.tab = tab;
  const open = WEEKDAY_KEYS.indexOf(q.get('open') || '');
  if (open >= 0) {
    state.openDay = open;
    state.scrollToDay = true;
  }
  const day = q.get('day');
  if (day && /^\d{4}-\d{2}-\d{2}$/.test(day) && day <= maxViewDate()) state.viewDate = day;
}

function authMessage(code) {
  if (code === 'auth/invalid-email') return 'Enter a valid email.';
  if (code === 'auth/too-many-requests') return 'Too many tries. Wait a minute and try again.';
  if (code === 'auth/network-request-failed') return 'Can’t reach Firebase. Check the connection.';
  if (code === 'auth/user-disabled') return 'That account is disabled in Firebase Authentication.';
  return 'That email and password didn’t work. Use a verified account in this Firebase project.';
}

async function initFirebase() {
  const appMod = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js');
  const authMod = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js');
  const fsMod = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
  const stMod = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js');
  let app = appMod.getApps().find((a) => a.name === 'dustin-fitness');
  if (!app) app = appMod.initializeApp(firebaseConfig, 'dustin-fitness');
  const auth = authMod.getAuth(app);
  await authMod.setPersistence(auth, authMod.browserLocalPersistence);
  state.auth = auth;
  state.authMod = authMod;
  state.db = fsMod.getFirestore(app);
  state.fs = fsMod;
  state.storage = stMod.getStorage(app);
  state.st = stMod;
  return authMod.onAuthStateChanged(auth, onAuth);
}

function onAuth(user) {
  state.user = user || null;
  if (!user) {
    show('login-screen');
    return;
  }
  if (!user.emailVerified) {
    $('verify-copy').textContent = 'A link was sent to ' + (user.email || 'your email') + '. Open it, then tap the button below.';
    show('verify-screen');
    return;
  }
  loadAll(user.uid);
}

let loadGen = 0;
async function loadAll(uid) {
  const gen = ++loadGen;
  show('boot');
  const { doc, getDoc, setDoc } = state.fs;
  const root = doc(state.db, 'fitness', uid);
  try {
    let snap;
    try {
      snap = await getDoc(root);
    } catch (err) {
      throw tagOp(err, 'getDoc', 'fitness/' + uid);
    }
    if (!snap.exists()) {
      const now = new Date().toISOString();
      const profile = seedProfile(now);
      const dexa = seedDexa(now);
      try {
        await setDoc(root, profile);
      } catch (err) {
        throw tagOp(err, 'setDoc', 'fitness/' + uid);
      }
      try {
        await setDoc(doc(state.db, 'fitness', uid, 'dexa', dexa.date), dexa);
      } catch (err) {
        throw tagOp(err, 'setDoc', 'fitness/' + uid + '/dexa/' + dexa.date);
      }
      state.profile = profile;
      state.dexa = [Object.assign({ id: dexa.date }, dexa)];
      state.checkins = {};
      state.sessions = {};
      state.measurements = [];
      state.fluids = {};
      state.foodlog = {};
    } else {
      state.profile = normalizeProfile(snap.data());
      state.checkins = indexByDate(await readCol(uid, 'checkins'));
      state.sessions = indexByDate(await readCol(uid, 'sessions'));
      state.measurements = (await readCol(uid, 'measurements')).sort(byDateDesc);
      state.dexa = (await readCol(uid, 'dexa')).sort(byDateDesc);
      state.fluids = indexByDate(await readCol(uid, 'fluids'));
      state.foodlog = indexByDate(await readCol(uid, 'foodlog'));
      if (!state.dexa.length) {
        const dexa = seedDexa(new Date().toISOString());
        try {
          await setDoc(doc(state.db, 'fitness', uid, 'dexa', dexa.date), dexa);
        } catch (err) {
          throw tagOp(err, 'setDoc', 'fitness/' + uid + '/dexa/' + dexa.date);
        }
        state.dexa = [Object.assign({ id: dexa.date }, dexa)];
      }
    }
    state.rulesProblem = false;
    state.offline = false;
    writeCache(uid);
  } catch (err) {
    console.warn('Fitness load', err);
    const cached = readCache(uid);
    if (cached && cached.profile) {
      state.profile = normalizeProfile(cached.profile);
      state.checkins = cached.checkins || {};
      state.sessions = cached.sessions || {};
      state.measurements = cached.measurements || [];
      state.dexa = cached.dexa && cached.dexa.length ? cached.dexa : [seedDexa()];
      state.fluids = cached.fluids || {};
      state.foodlog = cached.foodlog || {};
    } else {
      state.profile = seedProfile(new Date().toISOString());
      state.dexa = [Object.assign({ id: '2026-01-02' }, seedDexa())];
      state.fluids = {};
      state.foodlog = {};
    }
    state.rulesProblem = isPermissionDenied(err)
      ? rulesRefusal(err.fitnessOp, err.fitnessPath)
      : false;
    state.offline = !state.rulesProblem;
  }
  if (gen !== loadGen) return;
  applyQuery();
  show('shell');
  render();
}

function indexByDate(rows) {
  const out = {};
  rows.forEach((row) => { if (row.date || row.id) out[row.date || row.id] = row; });
  return out;
}

function byDateDesc(a, b) {
  return String(b.date || '').localeCompare(String(a.date || ''));
}

function tagOp(err, operation, path) {
  if (err && !err.fitnessOp) err.fitnessOp = operation;
  if (err && !err.fitnessPath) err.fitnessPath = path;
  return err;
}

async function readCol(uid, name) {
  const path = 'fitness/' + uid + '/' + name;
  try {
    const snap = await state.fs.getDocs(state.fs.collection(state.db, 'fitness', uid, name));
    return snap.docs.map((d) => Object.assign({ id: d.id }, d.data()));
  } catch (err) {
    throw tagOp(err, 'getDocs', path);
  }
}

function cacheKey(uid) { return 'fitness-v1:' + uid; }

function writeCache(uid) {
  if (state.preview || !uid) return;
  try {
    localStorage.setItem(cacheKey(uid), JSON.stringify({
      profile: state.profile,
      checkins: state.checkins,
      sessions: state.sessions,
      measurements: state.measurements,
      dexa: state.dexa,
      fluids: state.fluids,
      foodlog: state.foodlog
    }));
  } catch (e) { /* private mode */ }
}

function readCache(uid) {
  try { return JSON.parse(localStorage.getItem(cacheKey(uid)) || 'null'); } catch (e) { return null; }
}

function strip(value) {
  if (Array.isArray(value)) return value.map(strip);
  if (value && typeof value === 'object') {
    const out = {};
    Object.keys(value).forEach((key) => {
      if (value[key] === undefined) return;
      out[key] = strip(value[key]);
    });
    return out;
  }
  return value;
}

async function putDoc(parts, data) {
  data.updatedAt = new Date().toISOString();
  if (state.user) writeCache(state.user.uid);
  if (state.preview || !state.user) return;
  const path = 'fitness/' + state.user.uid + (parts.length ? '/' + parts.join('/') : '');
  try {
    const ref = state.fs.doc(state.db, 'fitness', state.user.uid, ...parts);
    await state.fs.setDoc(ref, strip(data));
    state.rulesProblem = false;
    state.offline = false;
    renderBanner();
  } catch (err) {
    handleWriteError(tagOp(err, 'setDoc', path));
  }
}

function handleWriteError(err) {
  console.warn('Fitness save', err);
  if (isPermissionDenied(err)) {
    state.rulesProblem = rulesRefusal(err.fitnessOp, err.fitnessPath);
    renderBanner();
    toast('Saved on this phone. ' + state.rulesProblem);
    return;
  }
  state.offline = true;
  renderBanner();
  toast('Saved on this phone. It will sync when you have a signal.');
}

function schedule(name, fn) {
  clearTimeout(state.timers[name]);
  state.timers[name] = setTimeout(fn, 500);
}

function currentSession() {
  const date = state.viewDate;
  if (state.sessions[date]) return state.sessions[date];
  if (!state.drafts[date]) state.drafts[date] = buildSession(state.profile, date, state.sessions);
  return state.drafts[date];
}

function commitSession() {
  const date = state.viewDate;
  if (!state.sessions[date]) state.sessions[date] = currentSession();
  return state.sessions[date];
}

function saveSessionSoon() {
  const session = commitSession();
  schedule('session', () => putDoc(['sessions', session.date], session));
}

function ensureCheckin(date) {
  if (!state.checkins[date]) state.checkins[date] = emptyCheckin(date);
  return state.checkins[date];
}

function saveCheckinSoon() {
  const row = ensureCheckin(state.viewDate);
  schedule('checkin', () => {
    const issue = checkinIssue(row);
    if (issue) { toast(issue); return; }
    putDoc(['checkins', row.date], row);
  });
}

function saveProfileSoon() {
  schedule('profile', () => {
    const issue = profileIssue(state.profile);
    const status = $('save-state');
    if (issue) {
      if (status) status.textContent = issue;
      return;
    }
    putDoc([], state.profile);
    if (status) status.textContent = state.preview ? 'Preview only' : 'Saved';
  });
}

function ensureExpand(session) {
  if (state.expandDate !== session.date || !state.expand) {
    state.expandDate = session.date;
    state.expand = new Set();
    if (session.kind === 'lift') {
      const next = session.exercises.find((ex) => !isExerciseDone(ex));
      if (next) addExpand(session, next.id);
    } else {
      session.exercises.forEach((ex) => state.expand.add(ex.id));
    }
  }
}

function addExpand(session, id) {
  const ex = session.exercises.find((item) => item.id === id);
  state.expand.add(id);
  if (ex && ex.superset) {
    session.exercises.forEach((other) => {
      if (other.superset && other.superset === ex.superset) state.expand.add(other.id);
    });
  }
}

function render() {
  if (!state.profile) return;
  renderHeader();
  renderBanner();
  renderMain();
  renderNav();
}

function renderHeader() {
  const today = todayISO();
  const count = countdown(today, state.profile.vacationDate || VACATION_DATE);
  $('header-date').textContent = formatWeekday(today) + ' · ' + formatLong(today).replace(/^[A-Za-z]+, /, '');
  $('header-count').innerHTML = count.days > 0
    ? esc(String(count.days)) + '<span>days to Dec 23</span>'
    : '<span>' + esc(count.label) + '</span>';
}

function renderBanner() {
  const el = $('banner');
  if (state.preview) {
    el.hidden = false;
    el.textContent = 'Preview sample. Nothing is saved to Firebase.';
    return;
  }
  if (state.rulesProblem) {
    el.hidden = false;
    el.textContent = typeof state.rulesProblem === 'string'
      ? state.rulesProblem
      : rulesRefusal('write', 'fitness/' + (state.user ? state.user.uid : ''));
    return;
  }
  if (state.offline) {
    el.hidden = false;
    el.textContent = 'Offline. Changes stay on this phone until the signal comes back.';
    return;
  }
  el.hidden = true;
}

function renderMain() {
  const main = $('main');
  const y = main.scrollTop;
  const body = state.tab === 'today' ? renderToday()
    : state.tab === 'checkin' ? renderCheckin()
    : state.tab === 'progress' ? renderProgress()
    : renderPlan();
  main.innerHTML = body;
  if (state.scrollTop) {
    main.scrollTop = 0;
    state.scrollTop = false;
  } else {
    main.scrollTop = y;
  }
  afterRender();
}

function afterRender() {
  const img = $('photo-preview');
  if (img && state.photoDraft && state.photoDraftDate === state.viewDate) img.src = state.photoDraft;
  if (state.tab === 'progress') requestAnimationFrame(function () { drawChart(); drawFluidChart(); });
  if (state.scrollToDay && state.tab === 'plan') {
    const el = $('day-' + state.openDay);
    if (el) el.scrollIntoView({ block: 'start' });
    state.scrollToDay = false;
  }
  if (state.tab === 'checkin') hydratePhoto();
}

function renderNav() {
  const items = [
    ['today', 'Today', iconBarbell()],
    ['checkin', 'Check-in', iconScale()],
    ['progress', 'Progress', iconTrend()],
    ['plan', 'Plan', iconList()]
  ];
  $('tabbar').innerHTML = items.map(([id, label, icon]) =>
    '<button type="button" data-act="tab" data-tab="' + id + '" class="' + (state.tab === id ? 'on' : '') + '" aria-current="' + (state.tab === id ? 'page' : 'false') + '">' +
    icon + '<small>' + label + '</small></button>'
  ).join('');
}

function iconBarbell() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 9v6M8 7v10M16 7v10M20 9v6M8 12h8"/></svg>';
}
function iconScale() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 4v16M6 8h12M7 8l-3 6h6L7 8zm10 0l-3 6h6l-3-6z"/></svg>';
}
function iconTrend() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 16l5-5 3 3 7-8"/><path d="M14 6h6v6"/></svg>';
}
function iconList() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M8 7h12M8 12h12M8 17h8M4 7h.01M4 12h.01M4 17h.01"/></svg>';
}

function renderToday() {
  const session = currentSession();
  ensureExpand(session);
  const plan = dayPlan(state.profile, state.viewDate);
  const today = todayISO();
  const progress = session.kind === 'lift' ? setProgress(session) : exerciseProgress(session);
  const macros = state.profile.calories.toLocaleString() + ' kcal · ' + state.profile.proteinG + ' g protein';
  let html = '';
  html += '<div class="stepper">';
  html += '<button type="button" class="icon-btn" data-act="shift-day" data-dir="-1" aria-label="Previous day">‹</button>';
  html += '<p><b>' + esc(formatWeekday(state.viewDate)) + '</b><span>' + esc(formatLong(state.viewDate)) + '</span></p>';
  html += '<button type="button" class="icon-btn" data-act="shift-day" data-dir="1" aria-label="Next day"' + (state.viewDate >= maxViewDate() ? ' disabled' : '') + '>›</button>';
  html += '</div>';
  html += '<p class="screen-kicker">' + esc(plan.kind === 'lift' ? 'Lift' : plan.kind === 'recovery' ? 'Recovery' : 'Rest') + '</p>';
  html += '<h1 class="screen-title">' + esc(session.planName || plan.name) + '</h1>';
  html += '<p class="meta">' + progress + ' · ' + esc(macros) + '</p>';
  html += renderFoodProgress(state.viewDate);
  if (session.deload) {
    html += '<div class="note">Deload week. Lifting sets are cut in half. Same movements, less volume.</div>';
  }
  if (plan.notes) html += '<p class="hint" style="margin-bottom:10px;">' + esc(plan.notes) + '</p>';
  html += renderHydration();
  html += session.exercises.map((ex, i) => renderExercise(ex, i, session)).join('');
  if (session.kind === 'lift') {
    html += '<button type="button" class="toggle ' + (session.walkDone ? 'on' : '') + '" data-act="toggle-walk" style="width:100%;margin-top:6px;">';
    html += '<b>' + esc(String(state.profile.walkMin)) + ' min incline walk</b>';
    html += '<span>' + (session.walkDone ? 'Done' : 'After lifting, on the treadmill') + '</span></button>';
  }
  const check = state.checkins[state.viewDate];
  if (session.kind === 'lift' && check && check.coldPlunge) {
    html += '<div class="note">Plunge is logged today. Keep it ' + esc(String(state.profile.plungeGapHours)) + ' hours away from this lift.</div>';
  }
  html += '<button type="button" class="linkish" data-act="tab" data-tab="checkin">Steps goal ' + Number(state.profile.stepsGoal).toLocaleString() + ' · log them on Check-in</button>';
  if (state.viewDate !== today) {
    html += '<button type="button" class="ghost" data-act="jump-today" style="width:100%;margin-top:8px;">Back to today</button>';
  }
  return html;
}

function ensureFluids(date) {
  if (!state.fluids[date]) state.fluids[date] = emptyFluids(date);
  return state.fluids[date];
}

function renderHydration() {
  const doc = state.fluids[state.viewDate] || emptyFluids(state.viewDate);
  const status = fluidStatus(state.profile, doc.entries, state.viewDate, new Date());
  const pct = Math.max(0, Math.min(100, status.ratio * 100));
  const paceClass = status.onPace ? 'onpace' : 'behind';
  let html = '<section class="card">';
  html += '<div class="hydro">';
  html += '<svg class="ring" viewBox="0 0 36 36" aria-hidden="true">';
  html += '<circle class="track" cx="18" cy="18" r="15.5" pathLength="100"></circle>';
  html += '<circle class="value" cx="18" cy="18" r="15.5" pathLength="100" stroke-dasharray="' + pct.toFixed(1) + ' 100" transform="rotate(-90 18 18)"></circle>';
  html += '</svg><div><h2>' + Math.round(status.consumed) + ' / ' + Math.round(status.goal) + ' oz</h2>';
  html += '<p class="' + paceClass + '">' + esc(status.label) + '</p>';
  html += '<p class="hint">' + (dayPlan(state.profile, state.viewDate).kind === 'lift' ? 'Training day' : 'Rest day') + ' · ' + esc(state.profile.paceStart) + '–' + esc(state.profile.paceEnd) + '</p>';
  html += '</div></div>';
  html += '<div class="oz-picks">';
  SIP_OUNCES.forEach((oz) => {
    html += '<button type="button" data-act="sip-oz" data-oz="' + oz + '" class="' + (state.sipOz === oz ? 'on' : '') + '">' + oz + '</button>';
  });
  html += '</div><div class="drink-grid">';
  DRINKS.forEach((drink) => {
    html += '<button type="button" data-act="add-drink" data-kind="' + esc(drink.kind) + '" data-name="' + esc(drink.name) + '">' + esc(drink.name) + '</button>';
  });
  html += '</div>';
  html += '<div class="grid-2" style="margin-top:8px;">';
  html += '<input class="text-input" id="custom-drink" maxlength="40" placeholder="Custom drink">';
  html += '<button type="button" class="primary" data-act="add-custom">Add ' + state.sipOz + ' oz</button>';
  html += '</div>';
  (doc.entries || []).slice().reverse().forEach((entry) => {
    html += '<div class="meal"><div><b>' + esc(entry.name) + '</b><div class="hint">' + esc(String(entry.oz)) + ' oz · ' + esc(formatSipTime(entry.at)) + '</div></div>';
    html += '<button type="button" data-act="remove-drink" data-id="' + esc(entry.id) + '" aria-label="Remove drink" style="min-width:44px;min-height:44px;border-radius:10px;border:1px solid var(--line);background:var(--bg);">✕</button></div>';
  });
  html += '</section>';
  return html;
}

function formatSipTime(at) {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function setProgress(session) {
  let done = 0;
  let total = 0;
  session.exercises.forEach((ex) => {
    (ex.sets || []).forEach((set) => {
      total += 1;
      if (set.done) done += 1;
    });
  });
  return done + ' of ' + total + ' sets';
}

function exerciseProgress(session) {
  const done = session.exercises.filter(isExerciseDone).length;
  return done + ' of ' + session.exercises.length + ' done';
}

function renderExercise(ex, index, session) {
  const open = state.expand.has(ex.id);
  const planEx = (dayPlan(state.profile, state.viewDate).exercises || []).find((item) => item.id === ex.id);
  const last = lastPerformance(state.sessions, ex, state.viewDate);
  const lastLine = formatLast(last);
  if (!open) {
    let summary = '';
    if (ex.mode === 'strength') {
      const doneSets = (ex.sets || []).filter((s) => s.done).map(formatSet).filter(Boolean);
      summary = doneSets.join(', ');
      if (!summary) summary = (ex.sets || []).length + ' × ' + (ex.targetReps || (planEx && planEx.reps) || '');
    } else if (ex.mode === 'timed') {
      summary = ex.done ? 'Done' : (ex.minutes || 0) + ' min';
    } else {
      summary = ex.done ? 'Done' : 'Tap to log';
    }
    return '<button type="button" class="compact ' + (isExerciseDone(ex) ? 'done' : '') + '" data-act="expand" data-ex="' + index + '">' +
      '<span>' + esc(ex.name) + (ex.superset ? '<i class="pill">Superset</i>' : '') + '</span>' +
      '<em>' + esc(summary) + '</em></button>';
  }
  let html = '<article class="card">';
  html += '<h2>' + esc(ex.name) + (ex.superset ? '<i class="pill">Superset ' + esc(ex.superset) + '</i>' : '') + '</h2>';
  if (ex.mode === 'strength') {
    const planned = planEx ? planEx.sets : (ex.sets || []).length;
    const showing = (ex.sets || []).length;
    html += '<div class="targets"><span>' + showing + ' × ' + esc(ex.targetReps || (planEx && planEx.reps) || '') + '</span>';
    if (ex.restSec) html += '<span>Rest ' + esc(formatClock(ex.restSec)) + '</span>';
    if (session.deload && planned !== showing) html += '<span>Plan is ' + planned + ' sets</span>';
    html += '</div>';
    if (lastLine) html += '<p class="last">Last ' + esc(lastLine) + '</p>';
    if (ex.notes) html += '<p class="hint">' + esc(ex.notes) + '</p>';
    html += '<div style="height:8px"></div>';
    (ex.sets || []).forEach((set, s) => {
      html += '<div class="set-row ' + (set.done ? 'done' : '') + '">';
      html += '<span class="set-no">' + (s + 1) + '</span>';
      html += fieldInput('lb', 'set-weight', index, s, set.weight, 'decimal');
      html += fieldInput('reps', 'set-reps', index, s, set.reps, 'numeric');
      html += '<button type="button" class="check ' + (set.done ? 'on' : '') + '" data-act="toggle-set" data-ex="' + index + '" data-set="' + s + '" aria-label="Set ' + (s + 1) + ' done">' + (set.done ? '✓' : '') + '</button>';
      html += '</div>';
    });
    if (ex.restSec) {
      html += '<div class="row-actions"><button type="button" class="ghost" data-act="rest" data-ex="' + index + '">Rest ' + esc(formatClock(ex.restSec)) + '</button></div>';
    }
  } else if (ex.mode === 'timed') {
    if (ex.notes) html += '<p class="hint">' + esc(ex.notes) + '</p>';
    html += '<div class="grid-2" style="margin-top:10px;">';
    html += '<label class="stack">Minutes<input class="text-input" inputmode="numeric" data-field="timed-min" data-ex="' + index + '" value="' + esc(ex.minutes ?? '') + '"></label>';
    html += '<button type="button" class="primary" data-act="start-timed" data-ex="' + index + '" style="align-self:end;">Start ' + esc(formatClock((Number(ex.minutes) || 0) * 60)) + '</button>';
    html += '</div>';
    html += '<button type="button" class="toggle ' + (ex.done ? 'on' : '') + '" data-act="toggle-done" data-ex="' + index + '" style="width:100%;margin-top:8px;"><b>' + (ex.done ? 'Done' : 'Mark done') + '</b><span>' + esc(ex.name) + '</span></button>';
  } else {
    if (ex.notes) html += '<p class="hint">' + esc(ex.notes) + '</p>';
    html += '<button type="button" class="toggle ' + (ex.done ? 'on' : '') + '" data-act="toggle-done" data-ex="' + index + '" style="width:100%;margin-top:8px;"><b>' + (ex.done ? 'Done' : 'Not yet') + '</b><span>Tap when it’s done</span></button>';
  }
  html += '<button type="button" class="linkish" data-act="collapse" data-ex="' + index + '">Collapse</button>';
  html += '</article>';
  return html;
}

function fieldInput(label, field, ex, set, value, mode) {
  const shown = value == null ? '' : value;
  return '<label class="field"><em>' + label + '</em><input inputmode="' + mode + '" autocomplete="off" data-field="' + field + '" data-ex="' + ex + '" data-set="' + set + '" value="' + esc(shown) + '" aria-label="' + label + '"></label>';
}

function renderCheckin() {
  const row = ensureCheckin(state.viewDate);
  let html = '';
  html += '<p class="screen-kicker">Daily check-in</p>';
  html += '<h1 class="screen-title">' + esc(formatLong(state.viewDate)) + '</h1>';
  html += '<label class="stack" style="margin:8px 0 12px;">Date<input class="text-input" type="date" data-field="view-date" value="' + esc(state.viewDate) + '" max="' + esc(todayISO()) + '"></label>';
  html += '<label class="hero-weight"><span>Body weight</span><input inputmode="decimal" autocomplete="off" data-field="weightLb" placeholder="' + esc(String(state.profile.startWeightLb)) + '" value="' + esc(row.weightLb ?? '') + '" aria-label="Body weight in pounds"></label>';
  html += '<div class="toggle-grid">';
  html += '<button type="button" class="toggle ' + (row.sauna ? 'on' : '') + '" data-act="toggle-flag" data-flag="sauna"><b>Sauna</b><span>' + (row.sauna ? 'Done' : 'Not logged') + '</span></button>';
  html += '<button type="button" class="toggle ' + (row.coldPlunge ? 'on' : '') + '" data-act="toggle-flag" data-flag="coldPlunge"><b>Cold plunge</b><span>' + (row.coldPlunge ? 'Done' : 'Not logged') + '</span></button>';
  html += '</div>';
  if (row.coldPlunge && dayPlan(state.profile, state.viewDate).kind === 'lift') {
    html += '<div class="note">Keep the plunge ' + esc(String(state.profile.plungeGapHours)) + ' hours away from lifting.</div>';
  }
  html += '<div class="grid-2">';
  html += stackNum('Steps', 'steps', row.steps, 'numeric', String(state.profile.stepsGoal));
  html += stackNum('Sleep hours', 'sleepHours', row.sleepHours, 'decimal', '7.5');
  html += stackNum('Calories', 'calories', row.calories, 'numeric', '');
  html += stackNum('Protein g', 'protein', row.protein, 'numeric', '');
  html += stackNum('Carbs g', 'carbs', row.carbs, 'numeric', '');
  html += stackNum('Fat g', 'fat', row.fat, 'numeric', '');
  html += '</div>';
  html += '<div class="sleep" style="margin-top:8px;">';
  html += '<button type="button" class="step-btn" data-act="sleep-step" data-dir="-1" aria-label="Less sleep">−</button>';
  html += '<span class="hint" style="flex:1;text-align:center;">Sleep steps by half an hour</span>';
  html += '<button type="button" class="step-btn" data-act="sleep-step" data-dir="1" aria-label="More sleep">+</button>';
  html += '</div>';
  html += '<label class="stack" style="margin-top:8px;">Notes<textarea class="text-input" data-field="notes" maxlength="2000" placeholder="How the day felt">' + esc(row.notes || '') + '</textarea></label>';
  html += renderFoodLog();
  html += '<div class="savebar"><button type="button" class="primary" data-act="save-checkin" style="width:100%;">Save check-in</button><p class="hint" id="save-state" style="text-align:center;margin-top:6px;"></p></div>';
  return html;
}

function stackNum(label, field, value, mode, placeholder) {
  return '<label class="stack">' + label + '<input class="text-input" inputmode="' + mode + '" autocomplete="off" data-field="' + field + '" placeholder="' + esc(placeholder) + '" value="' + esc(value ?? '') + '"></label>';
}

function foodBars(date) {
  const doc = state.foodlog[date] || emptyFoodLog(date);
  const totals = foodLogTotals(doc.entries);
  const kcalGoal = Number(state.profile.calories) || 2250;
  const proteinGoal = Number(state.profile.proteinG) || 190;
  return macroBar('Calories', totals.kcal, kcalGoal, 'kcal')
    + macroBar('Protein', totals.protein, proteinGoal, 'g')
    + '<p class="hint">' + Math.round(totals.carbs) + ' g carbs · ' + Math.round(totals.fat) + ' g fat</p>';
}

function renderFoodProgress(date) {
  return '<section class="card" id="food-progress"><h2>Food</h2>'
    + foodBars(date)
    + '<button type="button" class="linkish" data-act="tab" data-tab="checkin">Open the food log</button></section>';
}

function macroBar(label, value, goal, unit) {
  const pct = goal > 0 ? Math.min(100, Math.round((value / goal) * 100)) : 0;
  const over = value > goal + 0.5;
  return '<div style="margin-top:8px;"><div class="split"><span class="hint" style="margin:0;">' + esc(label) + '</span><b>'
    + Math.round(value) + ' / ' + Math.round(goal) + ' ' + unit + '</b></div>'
    + '<div class="macro-track"><div class="macro-fill' + (over ? ' over' : '') + '" style="width:' + pct + '%"></div></div></div>';
}

function renderFoodLog() {
  const doc = ensureFoodLog(state.viewDate);
  const mult = state.foodMult;
  let html = '<section class="card" id="food-log"><h2>Food log</h2>';
  html += foodBars(state.viewDate);
  html += '<p class="hint">Servings</p><div class="oz-picks">';
  SERVING_MULTIPLIERS.forEach((n) => {
    html += '<button type="button" data-act="food-mult" data-mult="' + n + '" class="' + (mult === n ? 'on' : '') + '">' + n + 'x</button>';
  });
  html += '</div>';
  html += '<label class="stack" style="margin:8px 0;">Custom servings<input class="text-input" id="food-custom-mult" inputmode="decimal" placeholder="2.5" value="' + (SERVING_MULTIPLIERS.indexOf(mult) === -1 ? esc(mult) : '') + '"></label>';
  html += '<div class="drink-grid">';
  USUAL_MEALS.forEach((meal) => {
    html += '<button type="button" data-act="add-usual" data-meal="' + esc(meal.id) + '">' + esc(meal.name) + '</button>';
  });
  html += '</div><div class="food-list">';
  FOOD_LIBRARY.forEach((food) => {
    const scaled = makeFoodEntry(food, mult);
    html += '<button type="button" class="compact" data-act="add-food-item" data-food="' + esc(food.id) + '"><span>'
      + esc(food.name) + '<i class="pill">' + esc(food.serving) + '</i></span><em>'
      + Math.round(scaled.kcal) + ' kcal</em></button>';
  });
  html += '</div>';
  html += '<h2 style="margin-top:12px;">Custom food</h2><div class="grid-2">';
  html += '<label class="stack" style="grid-column:1/-1;">Name<input class="text-input" id="custom-food-name" maxlength="80"></label>';
  html += '<label class="stack">Serving<input class="text-input" id="custom-food-serving" maxlength="40" placeholder="1 bowl"></label>';
  html += '<label class="stack">Kcal<input class="text-input" id="custom-food-kcal" inputmode="decimal"></label>';
  html += '<label class="stack">Protein<input class="text-input" id="custom-food-protein" inputmode="decimal"></label>';
  html += '<label class="stack">Carbs<input class="text-input" id="custom-food-carbs" inputmode="decimal"></label>';
  html += '<label class="stack">Fat<input class="text-input" id="custom-food-fat" inputmode="decimal"></label>';
  html += '</div><button type="button" class="ghost" data-act="add-custom-food" style="width:100%;margin-top:8px;">Add custom food</button>';
  (doc.entries || []).slice().reverse().forEach((entry) => {
    html += '<div class="meal"><div><b>' + esc(entry.name) + '</b><div class="hint">'
      + esc(entry.multiplier) + ' × ' + esc(entry.serving || '') + ' · '
      + Math.round(entry.kcal) + ' kcal · ' + Math.round(entry.protein) + ' g protein</div></div>';
    html += '<button type="button" data-act="remove-food-entry" data-id="' + esc(entry.id) + '" aria-label="Remove food" style="min-width:44px;min-height:44px;border-radius:10px;border:1px solid var(--line);background:var(--bg);">✕</button></div>';
  });
  html += '<button type="button" class="ghost" data-act="copy-food-totals" style="width:100%;margin-top:8px;">Copy totals into check-in</button>';
  html += '</section>';
  return html;
}

function ensureFoodLog(date) {
  if (!state.foodlog[date]) state.foodlog[date] = emptyFoodLog(date);
  return state.foodlog[date];
}

function activeFoodMultiplier() {
  const custom = document.getElementById('food-custom-mult');
  if (custom && String(custom.value || '').trim()) {
    const n = Number(custom.value);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return state.foodMult || 1;
}

function saveFoodSoon() {
  const doc = ensureFoodLog(state.viewDate);
  const bad = (doc.entries || []).map(foodEntryIssue).find(Boolean);
  if (bad) { toast(bad); return; }
  schedule('food', () => putDoc(['foodlog', doc.date], doc));
}

function addFoodToDay(entry) {
  const issue = foodEntryIssue(entry);
  if (issue) { toast(issue); return; }
  const doc = ensureFoodLog(state.viewDate);
  doc.entries = (doc.entries || []).concat(entry);
  saveFoodSoon();
  render();
}

function mealLine(meal) {
  const bits = [];
  if (meal.kcal != null) bits.push(Math.round(meal.kcal) + ' kcal');
  if (meal.protein != null) bits.push(Math.round(meal.protein) + ' g protein');
  return bits.join(' · ');
}

function renderProgress() {
  const today = todayISO();
  const model = chartModel(state.checkins, state.profile, today);
  const latest = model.points.length ? model.points[model.points.length - 1] : null;
  const avg = trailingAverage(state.checkins, today, 7);
  const line = targetWeightOn(state.profile, today);
  const fromWeight = latest ? latest.weight : state.profile.startWeightLb;
  const toGo = Math.round((fromWeight - state.profile.targetWeightLb) * 10) / 10;
  const count = countdown(today, state.profile.vacationDate || VACATION_DATE);
  const avgCount = Object.keys(state.checkins).filter((d) => {
    return d <= today && d >= addDays(today, -6) && state.checkins[d] && state.checkins[d].weightLb != null;
  }).length;
  let html = '';
  html += '<p class="screen-kicker">' + esc(count.label) + '</p>';
  html += '<h1 class="screen-title">' + (count.days > 0 ? esc(String(count.days)) : esc(count.label)) + '</h1>';
  html += '<p class="meta">' + esc(formatHeight(state.profile.heightIn)) + ' · target ' + esc(formatLb(state.profile.targetWeightLb)) + ' and ' + esc(String(state.profile.targetBfPct)) + '% by ' + esc(formatLong(state.profile.targetDate)) + '</p>';
  html += '<section class="card"><h2>Weight</h2>';
  html += '<canvas id="weight-chart" width="640" height="440"></canvas>';
  html += '<div class="legend"><span><i class="avg"></i>7-day average</span><span><i class="line"></i>Target line</span></div>';
  html += '<p class="hint">Line runs from ' + esc(formatLb(state.profile.startWeightLb)) + ' on ' + esc(formatLong(state.profile.startDate)) + ' to ' + esc(formatLb(state.profile.targetWeightLb)) + ' on ' + esc(formatLong(state.profile.targetDate)) + '.</p>';
  html += '</section>';
  html += '<div class="stats">';
  html += stat('Latest', latest ? formatLb(latest.weight) : formatLb(state.profile.startWeightLb));
  html += stat('7-day avg', avg == null ? '—' : formatLb(avg) + (avgCount && avgCount < 7 ? ' · ' + avgCount + 'd' : ''));
  html += stat('Vs line', paceLabel(avg == null ? fromWeight : avg, line) || formatLb(line));
  html += stat('To goal', (toGo > 0 ? toGo : 0) + ' lb');
  html += '</div>';
  html += renderFluids();
  html += renderMeasures();
  html += renderDexa();
  html += renderStrength();
  return html;
}

function stat(label, value) {
  return '<div class="stat"><span>' + esc(label) + '</span><b>' + esc(value) + '</b></div>';
}

function renderFluids() {
  const today = todayISO();
  const series = fluidSeries(state.fluids, state.profile, today);
  const todayDoc = state.fluids[today];
  const status = fluidStatus(state.profile, todayDoc && todayDoc.entries, today, new Date());
  const loggedDays = series.filter((row) => row.oz > 0);
  const avg = loggedDays.length ? loggedDays.reduce((sum, row) => sum + row.oz, 0) / loggedDays.length : null;
  let html = '<section class="card"><h2>Fluids</h2>';
  html += '<canvas id="fluid-chart" width="640" height="360"></canvas>';
  html += '<div class="legend"><span><i class="line"></i>Logged</span><span><i class="avg"></i>Day goal</span></div>';
  if (!series.length) html += '<p class="hint">No drinks logged yet. Add one on Today.</p>';
  html += '</section><div class="stats">';
  html += stat('Today', Math.round(status.consumed) + ' / ' + Math.round(status.goal) + ' oz');
  html += stat('Logged avg', avg == null ? '—' : Math.round(avg) + ' oz');
  html += '</div>';
  series.slice().reverse().slice(0, 10).forEach((row) => {
    if (!row.oz) return;
    html += '<div class="meal"><div><b>' + esc(formatLong(row.date)) + '</b><div class="hint">' + Math.round(row.oz) + ' / ' + Math.round(row.goal) + ' oz</div></div></div>';
  });
  return html;
}

function renderMeasures() {
  const today = todayISO();
  const existing = state.measurements.find((row) => row.date === today) || emptyMeasurement(today);
  let html = '<section class="card"><h2>Measurements</h2><p class="hint">Inches. Waist, arm, shoulder, calf. One entry per day.</p>';
  html += '<label class="stack" style="margin:8px 0;">Date<input class="text-input" type="date" id="measure-date" value="' + esc(existing.date || today) + '"></label>';
  html += '<div class="grid-2">';
  html += '<label class="stack">Waist<input class="text-input" id="m-waist" inputmode="decimal" value="' + esc(existing.waistIn ?? '') + '"></label>';
  html += '<label class="stack">Arm<input class="text-input" id="m-arm" inputmode="decimal" value="' + esc(existing.armIn ?? '') + '"></label>';
  html += '<label class="stack">Shoulder<input class="text-input" id="m-shoulder" inputmode="decimal" value="' + esc(existing.shoulderIn ?? '') + '"></label>';
  html += '<label class="stack">Calf<input class="text-input" id="m-calf" inputmode="decimal" value="' + esc(existing.calfIn ?? '') + '"></label>';
  html += '</div>';
  html += '<button type="button" class="primary" data-act="save-measure" style="width:100%;margin-top:10px;">Save measurements</button>';
  if (!state.measurements.length) {
    html += '<p class="hint" style="margin-top:8px;">No tape measurements yet.</p>';
  } else {
    state.measurements.forEach((row) => {
      const bits = [
        row.waistIn != null ? 'waist ' + row.waistIn : '',
        row.armIn != null ? 'arm ' + row.armIn : '',
        row.shoulderIn != null ? 'shoulder ' + row.shoulderIn : '',
        row.calfIn != null ? 'calf ' + row.calfIn : ''
      ].filter(Boolean).join(' · ');
      html += '<div class="meal"><div><b>' + esc(formatLong(row.date)) + '</b><div class="hint">' + esc(bits) + '</div></div>';
      html += '<button type="button" data-act="delete-measure" data-id="' + esc(row.id || row.date) + '" aria-label="Delete measurement" style="min-width:44px;min-height:44px;border-radius:10px;border:1px solid var(--line);background:var(--bg);">✕</button></div>';
    });
  }
  html += '</section>';
  return html;
}

function renderDexa() {
  let html = '<section class="card"><h2>DEXA</h2>';
  if (!state.dexa.length) html += '<p class="hint">No scans yet.</p>';
  state.dexa.forEach((scan) => {
    html += '<div style="margin-top:8px;"><b>' + esc(formatLong(scan.date)) + '</b>';
    html += '<div class="dexa-grid">';
    html += dexaCell('Weight', formatLb(scan.weightLb));
    html += dexaCell('Body fat', scan.bfPct + '%');
    html += dexaCell('Fat mass', formatGrams(scan.fatMassG));
    html += dexaCell('Lean + BMC', formatGrams(scan.leanBmcG));
    html += dexaCell('Visceral', formatGrams(scan.visceralFatG));
    html += dexaCell('Android / gynoid', scan.androidPct + '% / ' + scan.gynoidPct + '%');
    html += '</div>';
    if (scan.notes) html += '<p class="hint">' + esc(scan.notes) + '</p>';
    const gap = Math.round((Number(scan.bfPct) - Number(state.profile.targetBfPct)) * 10) / 10;
    if (gap > 0) html += '<p class="hint">' + esc(String(gap)) + ' points from the ' + esc(String(state.profile.targetBfPct)) + '% target.</p>';
    html += '</div>';
  });
  html += '<button type="button" class="ghost" data-act="toggle-dexa" style="width:100%;margin-top:10px;">' + (state.dexaOpen ? 'Close' : 'Add a scan') + '</button>';
  if (state.dexaOpen) {
    html += '<div class="grid-2" style="margin-top:8px;">';
    html += '<label class="stack" style="grid-column:1/-1;">Date<input class="text-input" type="date" id="dx-date" value="' + esc(todayISO()) + '"></label>';
    html += '<label class="stack">Weight lb<input class="text-input" id="dx-weight" inputmode="decimal"></label>';
    html += '<label class="stack">Body fat %<input class="text-input" id="dx-bf" inputmode="decimal"></label>';
    html += '<label class="stack">Fat mass g<input class="text-input" id="dx-fat" inputmode="numeric"></label>';
    html += '<label class="stack">Lean + BMC g<input class="text-input" id="dx-lean" inputmode="numeric"></label>';
    html += '<label class="stack">Visceral g<input class="text-input" id="dx-vis" inputmode="numeric"></label>';
    html += '<label class="stack">Android %<input class="text-input" id="dx-and" inputmode="decimal"></label>';
    html += '<label class="stack">Gynoid %<input class="text-input" id="dx-gyn" inputmode="decimal"></label>';
    html += '<label class="stack" style="grid-column:1/-1;">Notes<input class="text-input" id="dx-notes" maxlength="500"></label>';
    html += '</div>';
    html += '<button type="button" class="primary" data-act="save-dexa" style="width:100%;margin-top:8px;">Save scan</button>';
  }
  html += '</section>';
  return html;
}

function dexaCell(label, value) {
  return '<div><span>' + esc(label) + '</span><b>' + esc(value) + '</b></div>';
}

function renderStrength() {
  const rows = strengthRows(state.sessions, state.profile);
  const logged = rows.filter((row) => row.history.length);
  let html = '<section class="card"><h2>Strength</h2>';
  if (!logged.length) {
    html += '<p class="hint">Log a workout and the weights line up here.</p></section>';
    return html;
  }
  logged.forEach((row) => {
    const max = Math.max.apply(null, row.history.map((h) => h.weight));
    html += '<div style="margin-top:12px;"><b>' + esc(row.name) + '</b>';
    html += '<p class="hint">Latest ' + esc(formatSet(row.latest)) + ' · ' + esc(formatLong(row.latest.date)) + '</p>';
    html += '<div class="bars" aria-hidden="true">';
    row.history.slice(-8).forEach((h) => {
      const pct = Math.max(8, Math.round((h.weight / max) * 100));
      html += '<span style="height:' + pct + '%"></span>';
    });
    html += '</div></div>';
  });
  const quiet = rows.length - logged.length;
  if (quiet) html += '<p class="hint" style="margin-top:10px;">' + quiet + ' exercises show up after you log them.</p>';
  html += '</section>';
  return html;
}

function renderPlan() {
  const p = state.profile;
  const open = state.openDay == null ? weekdayMon0(todayISO()) : state.openDay;
  let html = '';
  html += '<p class="screen-kicker">Plan</p>';
  html += '<h1 class="screen-title">Edit the cut</h1>';
  html += '<p class="meta" id="save-state">Changes save on their own.</p>';
  html += '<div class="grid-4" style="margin-bottom:12px;">';
  html += miniMacro('Kcal', 'calories', p.calories);
  html += miniMacro('Protein', 'proteinG', p.proteinG);
  html += miniMacro('Carbs', 'carbsG', p.carbsG);
  html += miniMacro('Fat', 'fatG', p.fatG);
  html += '</div>';
  html += renderHydrationSettings();
  p.week.forEach((d, i) => {
    const isOpen = i === open;
    html += '<section class="day ' + (isOpen ? 'open' : '') + '" id="day-' + i + '">';
    html += '<button type="button" class="day-head" data-act="toggle-day" data-day="' + i + '">';
    html += '<span>' + esc(WEEKDAYS[i]) + (i === weekdayMon0(todayISO()) ? ' · today' : '') + '</span>';
    html += '<b>' + esc(d.name) + '</b></button>';
    if (isOpen) {
      html += '<div class="day-body">';
      html += '<label class="stack">Day name<input class="text-input" data-field="day-name" data-day="' + i + '" value="' + esc(d.name) + '" maxlength="80"></label>';
      html += '<label class="stack" style="margin-top:8px;">Type<select class="text-input" data-field="day-kind" data-day="' + i + '">';
      ['lift', 'recovery', 'rest'].forEach((kind) => {
        html += '<option value="' + kind + '"' + (d.kind === kind ? ' selected' : '') + '>' + kind + '</option>';
      });
      html += '</select></label>';
      html += '<label class="stack" style="margin-top:8px;">Day note<textarea class="text-input" data-field="day-notes" data-day="' + i + '" maxlength="500">' + esc(d.notes || '') + '</textarea></label>';
      (d.exercises || []).forEach((ex, n) => {
        html += renderExerciseEditor(i, ex, n);
      });
      html += '<button type="button" class="ghost" data-act="add-ex" data-day="' + i + '" style="width:100%;">Add exercise</button>';
      html += '</div>';
    }
    html += '</section>';
  });
  html += '<section class="card"><h2>Targets</h2><div class="grid-2" style="margin-top:8px;">';
  html += '<label class="stack">Height in<input class="text-input" data-field="heightIn" inputmode="numeric" value="' + esc(p.heightIn) + '"></label>';
  html += '<label class="stack">Now shown as<input class="text-input" value="' + esc(formatHeight(p.heightIn)) + '" disabled></label>';
  html += '<label class="stack">Start lb<input class="text-input" data-field="startWeightLb" inputmode="decimal" value="' + esc(p.startWeightLb) + '"></label>';
  html += '<label class="stack">Target lb<input class="text-input" data-field="targetWeightLb" inputmode="decimal" value="' + esc(p.targetWeightLb) + '"></label>';
  html += '<label class="stack">Target fat %<input class="text-input" data-field="targetBfPct" inputmode="decimal" value="' + esc(p.targetBfPct) + '"></label>';
  html += '<label class="stack">Steps<input class="text-input" data-field="stepsGoal" inputmode="numeric" value="' + esc(p.stepsGoal) + '"></label>';
  html += '<label class="stack">Walk min<input class="text-input" data-field="walkMin" inputmode="numeric" value="' + esc(p.walkMin) + '"></label>';
  html += '<label class="stack">Plunge gap h<input class="text-input" data-field="plungeGapHours" inputmode="numeric" value="' + esc(p.plungeGapHours) + '"></label>';
  html += '<label class="stack">Start<input class="text-input" type="date" data-field="startDate" value="' + esc(p.startDate) + '"></label>';
  html += '<label class="stack">Target date<input class="text-input" type="date" data-field="targetDate" value="' + esc(p.targetDate) + '"></label>';
  html += '<label class="stack">Vacation<input class="text-input" type="date" data-field="vacationDate" value="' + esc(p.vacationDate) + '"></label>';
  html += '<label class="stack">Deload start<input class="text-input" type="date" data-field="deloadStart" value="' + esc(p.deloadStart) + '"></label>';
  html += '<label class="stack">Deload end<input class="text-input" type="date" data-field="deloadEnd" value="' + esc(p.deloadEnd) + '"></label>';
  html += '</div></section>';
  html += renderFoodLibrary();
  html += '<section class="card"><h2>Garage</h2>';
  html += '<label class="stack">Equipment, one per line<textarea class="text-input" id="equipment-box" data-field="equipment">' + esc((p.equipment || []).join('\n')) + '</textarea></label>';
  html += '</section>';
  html += '<section class="card"><h2>Daily rules</h2>';
  html += '<label class="stack">One per line<textarea class="text-input" data-field="guidelines">' + esc((p.guidelines || []).join('\n')) + '</textarea></label>';
  html += '</section>';
  html += '<section class="card"><h2>Starter plan</h2>';
  html += '<p class="hint">Puts the week, macros, targets, and garage list back to the Nov 16 starter. Foods you added and your logs stay.</p>';
  if (!state.confirmRestore) {
    html += '<button type="button" class="danger-btn" data-act="ask-restore" style="width:100%;margin-top:8px;">Restore starter plan</button>';
  } else {
    html += '<div class="row-actions" style="margin-top:8px;"><button type="button" class="danger-btn" data-act="do-restore">Restore</button><button type="button" class="ghost" data-act="cancel-restore">Cancel</button></div>';
  }
  html += '</section>';
  if (state.user && state.user.email) html += '<p class="fine">Signed in as ' + esc(state.user.email) + '</p>';
  html += '<details class="rules"><summary>Where this data lives</summary><p>Logs stay under fitness/{your account}. Only that signed-in, verified account can read or write them, after the fitness rules are published.</p></details>';
  html += '<p class="fine">App ' + esc(APP_VERSION) + '</p>';
  return html;
}

function renderHydrationSettings() {
  const p = state.profile;
  const perm = (typeof Notification !== 'undefined' && Notification.permission) || 'unsupported';
  let html = '<section class="card"><h2>Fluids and reminders</h2>';
  html += '<p class="hint">Lift days default to 128 oz. Recovery and rest days default to 110. Pace runs from the start time to the end time.</p>';
  html += '<div class="grid-2" style="margin-top:8px;">';
  html += '<label class="stack">Training oz<input class="text-input" data-field="fluidTrainOz" inputmode="numeric" value="' + esc(p.fluidTrainOz) + '"></label>';
  html += '<label class="stack">Rest oz<input class="text-input" data-field="fluidRestOz" inputmode="numeric" value="' + esc(p.fluidRestOz) + '"></label>';
  html += '<label class="stack">Pace start<input class="text-input" type="time" data-field="paceStart" value="' + esc(p.paceStart) + '"></label>';
  html += '<label class="stack">Pace end<input class="text-input" type="time" data-field="paceEnd" value="' + esc(p.paceEnd) + '"></label>';
  html += '<label class="stack">Every min<input class="text-input" data-field="remindEveryMin" inputmode="numeric" value="' + esc(p.remindEveryMin) + '"></label>';
  html += '<label class="stack" style="justify-content:flex-end;">Reminders<label class="hint" style="display:flex;gap:8px;align-items:center;font-weight:700;color:var(--text);"><input type="checkbox" data-field="remindOn"' + (p.remindOn ? ' checked' : '') + '> ' + (p.remindOn ? 'On' : 'Off') + '</label></label>';
  html += '<label class="stack">Quiet start<input class="text-input" type="time" data-field="quietStart" value="' + esc(p.quietStart) + '"></label>';
  html += '<label class="stack">Quiet end<input class="text-input" type="time" data-field="quietEnd" value="' + esc(p.quietEnd) + '"></label>';
  html += '</div>';
  html += '<button type="button" class="ghost" data-act="allow-notifications" style="width:100%;margin-top:10px;">' + (perm === 'granted' ? 'Drink alerts are on' : 'Allow drink reminders') + '</button>';
  html += '<p class="hint">On iPhone, alerts arrive only after you add Dustin Fitness to your Home Screen and open it from that icon, on iOS 16.4 or later. While this tab is open, a reminder still shows here.</p>';
  html += '<p class="hint">Background alerts can fire when the browser wakes this app. Alerts on a closed phone need Firebase Cloud Messaging, which is not turned on.</p>';
  html += '</section>';
  return html;
}

function miniMacro(label, field, value) {
  return '<label class="stack">' + label + '<input class="text-input" data-field="' + field + '" inputmode="numeric" value="' + esc(value) + '" style="padding:10px 8px;text-align:center;"></label>';
}

function renderExerciseEditor(day, ex, n) {
  let html = '<div class="ex-edit">';
  html += '<div class="top"><strong>' + (n + 1) + '</strong><div class="mini">';
  html += '<button type="button" data-act="move-ex" data-day="' + day + '" data-ex="' + n + '" data-dir="-1" aria-label="Move up">↑</button>';
  html += '<button type="button" data-act="move-ex" data-day="' + day + '" data-ex="' + n + '" data-dir="1" aria-label="Move down">↓</button>';
  html += '<button type="button" data-act="delete-ex" data-day="' + day + '" data-ex="' + n + '" aria-label="Delete exercise">✕</button>';
  html += '</div></div>';
  html += '<label class="stack">Name<input class="text-input" data-field="ex-name" data-day="' + day + '" data-ex="' + n + '" value="' + esc(ex.name) + '" maxlength="80"></label>';
  html += '<div class="grid-2" style="margin-top:8px;">';
  html += '<label class="stack">Mode<select class="text-input" data-field="ex-mode" data-day="' + day + '" data-ex="' + n + '">';
  ['strength', 'timed', 'check'].forEach((mode) => {
    html += '<option value="' + mode + '"' + (ex.mode === mode ? ' selected' : '') + '>' + mode + '</option>';
  });
  html += '</select></label>';
  html += '<label class="stack">Sets<input class="text-input" data-field="ex-sets" data-day="' + day + '" data-ex="' + n + '" inputmode="numeric" value="' + esc(ex.sets ?? '') + '"></label>';
  html += '<label class="stack">Reps<input class="text-input" data-field="ex-reps" data-day="' + day + '" data-ex="' + n + '" value="' + esc(ex.reps || '') + '"></label>';
  html += '<label class="stack">Rest sec<input class="text-input" data-field="ex-rest" data-day="' + day + '" data-ex="' + n + '" inputmode="numeric" value="' + esc(ex.restSec ?? '') + '"></label>';
  html += '<label class="stack">Minutes<input class="text-input" data-field="ex-min" data-day="' + day + '" data-ex="' + n + '" inputmode="numeric" value="' + esc(ex.minutes ?? '') + '"></label>';
  html += '<label class="stack">Deload sets<input class="text-input" data-field="ex-deload" data-day="' + day + '" data-ex="' + n + '" inputmode="numeric" placeholder="auto" value="' + esc(ex.deloadSets ?? '') + '"></label>';
  html += '<label class="stack">Superset<input class="text-input" data-field="ex-super" data-day="' + day + '" data-ex="' + n + '" value="' + esc(ex.superset || '') + '" maxlength="8"></label>';
  html += '<label class="stack">Move to<select class="text-input" data-field="ex-move" data-day="' + day + '" data-ex="' + n + '"><option value="">Stay</option>';
  WEEKDAYS.forEach((name, i) => {
    if (i !== day) html += '<option value="' + i + '">' + name + '</option>';
  });
  html += '</select></label>';
  html += '</div>';
  html += '<label class="stack" style="margin-top:8px;">Note<input class="text-input" data-field="ex-notes" data-day="' + day + '" data-ex="' + n + '" value="' + esc(ex.notes || '') + '" maxlength="300"></label>';
  html += '</div>';
  return html;
}

function renderFoodLibrary() {
  let html = '<section class="card"><h2>Food list</h2>';
  html += '<p class="hint">Empty on purpose. Add foods as you decide what you’ll actually eat.</p>';
  (state.profile.foods || []).forEach((food, i) => {
    html += '<div class="meal"><div><b>' + esc(food.name) + '</b><div class="hint">' + esc([food.serving, food.kcal != null ? food.kcal + ' kcal' : '', food.protein != null ? food.protein + ' g' : ''].filter(Boolean).join(' · ')) + '</div></div>';
    html += '<button type="button" data-act="delete-food" data-food="' + i + '" aria-label="Delete food" style="min-width:44px;min-height:44px;border-radius:10px;border:1px solid var(--line);background:var(--bg);">✕</button></div>';
  });
  html += '<div class="grid-2" style="margin-top:8px;">';
  html += '<label class="stack" style="grid-column:1/-1;">Name<input class="text-input" id="food-name" maxlength="80"></label>';
  html += '<label class="stack">Serving<input class="text-input" id="food-serving" maxlength="40"></label>';
  html += '<label class="stack">Kcal<input class="text-input" id="food-kcal" inputmode="numeric"></label>';
  html += '<label class="stack">Protein<input class="text-input" id="food-protein" inputmode="decimal"></label>';
  html += '<label class="stack">Carbs<input class="text-input" id="food-carbs" inputmode="decimal"></label>';
  html += '<label class="stack">Fat<input class="text-input" id="food-fat" inputmode="decimal"></label>';
  html += '</div>';
  html += '<button type="button" class="ghost" data-act="add-food" style="width:100%;margin-top:8px;">Add to food list</button>';
  html += '</section>';
  return html;
}

function drawChart() {
  const canvas = $('weight-chart');
  if (!canvas || !state.profile) return;
  const model = chartModel(state.checkins, state.profile, todayISO());
  const dpr = window.devicePixelRatio || 1;
  const width = canvas.clientWidth || 360;
  const height = 220;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  const weights = model.target.map((p) => p.weight).concat(model.points.map((p) => p.weight), model.avg.map((p) => p.weight));
  let min = Math.min.apply(null, weights);
  let max = Math.max.apply(null, weights);
  const padY = Math.max(0.8, (max - min) * 0.18);
  min -= padY;
  max += padY;
  const pad = { l: 42, r: 10, t: 12, b: 26 };
  const span = Math.max(1, daysBetween(model.from, model.to));
  const xOf = (date) => pad.l + (daysBetween(model.from, date) / span) * (width - pad.l - pad.r);
  const yOf = (weight) => pad.t + (1 - (weight - min) / (max - min)) * (height - pad.t - pad.b);
  ctx.strokeStyle = 'rgba(230,237,245,.14)';
  ctx.fillStyle = '#8A97A8';
  ctx.font = '11px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif';
  ctx.lineWidth = 1;
  for (let i = 0; i < 3; i++) {
    const w = min + ((max - min) * i) / 2;
    const y = yOf(w);
    ctx.beginPath();
    ctx.moveTo(pad.l, y);
    ctx.lineTo(width - pad.r, y);
    ctx.stroke();
    ctx.fillText(String(Math.round(w)), 4, y + 4);
  }
  [model.from, model.to].forEach((date, i) => {
    ctx.fillText(formatLong(date).replace(/^[A-Za-z]+, /, ''), i === 0 ? pad.l : width - pad.r - 52, height - 8);
  });
  ctx.save();
  ctx.setLineDash([5, 4]);
  ctx.strokeStyle = '#00A3FF';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(xOf(model.target[0].date), yOf(model.target[0].weight));
  ctx.lineTo(xOf(model.target[1].date), yOf(model.target[1].weight));
  ctx.stroke();
  ctx.restore();
  model.points.forEach((point) => {
    ctx.beginPath();
    ctx.fillStyle = '#00A3FF';
    ctx.arc(xOf(point.date), yOf(point.weight), 3.5, 0, Math.PI * 2);
    ctx.fill();
  });
  if (model.avg.length) {
    ctx.beginPath();
    ctx.strokeStyle = '#E6EDF5';
    ctx.lineWidth = 2.4;
    model.avg.forEach((point, i) => {
      const x = xOf(point.date);
      const y = yOf(point.weight);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }
}

function drawFluidChart() {
  const canvas = $('fluid-chart');
  if (!canvas || !state.profile) return;
  const series = fluidSeries(state.fluids, state.profile, todayISO());
  const dpr = window.devicePixelRatio || 1;
  const width = canvas.clientWidth || canvas.parentElement.clientWidth || 320;
  const height = canvas.clientHeight || 200;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  if (!series.length) return;
  const max = Math.max(1, ...series.map((row) => Math.max(row.oz, row.goal)));
  const pad = { l: 36, r: 8, t: 12, b: 26 };
  const gap = 4;
  const barW = Math.max(4, (width - pad.l - pad.r - gap * series.length) / series.length);
  ctx.font = '11px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif';
  ctx.fillStyle = '#8A97A8';
  ctx.fillText(String(Math.round(max)), 2, pad.t + 4);
  ctx.strokeStyle = 'rgba(230,237,245,.14)';
  ctx.beginPath();
  ctx.moveTo(pad.l, height - pad.b);
  ctx.lineTo(width - pad.r, height - pad.b);
  ctx.stroke();
  series.forEach((row, i) => {
    const x = pad.l + i * (barW + gap);
    const h = ((height - pad.t - pad.b) * row.oz) / max;
    const y = height - pad.b - h;
    ctx.fillStyle = row.oz + 0.5 >= row.goal ? '#3DDC97' : '#00A3FF';
    ctx.fillRect(x, y, barW, Math.max(h, row.oz ? 2 : 0));
    const gy = height - pad.b - ((height - pad.t - pad.b) * row.goal) / max;
    ctx.strokeStyle = '#E6EDF5';
    ctx.beginPath();
    ctx.moveTo(x, gy);
    ctx.lineTo(x + barW, gy);
    ctx.stroke();
  });
  ctx.fillStyle = '#8A97A8';
  ctx.fillText(formatLong(series[0].date).replace(/^[A-Za-z]+, /, ''), pad.l, height - 8);
  const last = formatLong(series[series.length - 1].date).replace(/^[A-Za-z]+, /, '');
  ctx.fillText(last, width - pad.r - 48, height - 8);
}

let photoToken = 0;
async function hydratePhoto() {
  const row = state.checkins[state.viewDate];
  const img = $('photo-preview');
  if (!img) return;
  if (state.photoDraft && state.photoDraftDate === state.viewDate) {
    img.src = state.photoDraft;
    img.hidden = false;
    return;
  }
  if (!row || !row.photoPath || state.preview || !state.st) return;
  const token = ++photoToken;
  try {
    const url = await state.st.getDownloadURL(state.st.ref(state.storage, row.photoPath));
    if (token !== photoToken) return;
    const live = $('photo-preview');
    if (live) { live.src = url; live.hidden = false; }
  } catch (err) {
    console.warn('Photo', err);
  }
}

function compressImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const max = 1280;
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('unreadable image'));
    };
    img.src = url;
  });
}

function startTimer(seconds, label) {
  const total = Math.max(1, Math.round(seconds));
  state.timer = {
    endsAt: Date.now() + total * 1000,
    paused: false,
    remaining: total,
    label: label || 'Rest',
    ringing: false
  };
  tickTimer();
}

let timerHandle = 0;
function tickTimer() {
  clearInterval(timerHandle);
  timerHandle = setInterval(paintTimer, 250);
  paintTimer();
}

function paintTimer() {
  const t = state.timer;
  const el = $('timer');
  if (!t) {
    el.hidden = true;
    document.title = 'Dustin Fitness';
    return;
  }
  let left = t.paused ? t.remaining : Math.ceil((t.endsAt - Date.now()) / 1000);
  if (!t.paused && left <= 0) {
    finishTimer();
    return;
  }
  el.hidden = false;
  $('timer-clock').textContent = formatClock(left);
  $('timer-label').textContent = t.label || 'Rest';
  $('timer-pause').textContent = t.paused ? 'Resume' : 'Pause';
  document.title = formatClock(left) + ' · Dustin Fitness';
}

function finishTimer() {
  if (!state.timer || state.timer.ringing) return;
  state.timer.ringing = true;
  clearInterval(timerHandle);
  state.timer = null;
  $('timer').hidden = true;
  document.title = 'Dustin Fitness';
  beep();
  try { if (navigator.vibrate) navigator.vibrate([180, 80, 180]); } catch (e) {}
  toast('Rest done');
}

function beep() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 660;
    osc.type = 'sine';
    gain.gain.value = 0.05;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
    osc.stop(ctx.currentTime + 0.4);
  } catch (e) {}
}

function shiftDay(dir) {
  const next = addDays(state.viewDate, dir);
  if (dir > 0 && next > maxViewDate()) return;
  state.viewDate = next;
  state.expand = null;
  state.photoDraft = null;
  state.scrollTop = true;
  render();
}

const actions = {
  tab(btn) {
    state.tab = btn.dataset.tab;
    state.scrollTop = true;
    render();
  },
  'sign-out'() { signOut(); },
  'shift-day'(btn) { shiftDay(Number(btn.dataset.dir)); },
  'jump-today'() {
    state.viewDate = todayISO();
    state.expand = null;
    state.scrollTop = true;
    render();
  },
  'sip-oz'(btn) {
    state.sipOz = Number(btn.dataset.oz) || 16;
    render();
  },
  'food-mult'(btn) {
    state.foodMult = Number(btn.dataset.mult) || 1;
    render();
  },
  'add-usual'(btn) {
    usualMealEntries(btn.dataset.meal, activeFoodMultiplier()).forEach((entry) => addFoodToDay(entry));
  },
  'add-food-item'(btn) {
    const food = foodById(btn.dataset.food);
    if (!food) return;
    addFoodToDay(makeFoodEntry(food, activeFoodMultiplier()));
  },
  'add-custom-food'() {
    const name = (($('custom-food-name') && $('custom-food-name').value) || '').trim();
    if (!name) { toast('Name the food'); return; }
    const food = {
      id: 'custom',
      name: name,
      serving: (($('custom-food-serving') && $('custom-food-serving').value) || '').trim() || '1 serving',
      kcal: Number($('custom-food-kcal') && $('custom-food-kcal').value) || 0,
      protein: Number($('custom-food-protein') && $('custom-food-protein').value) || 0,
      carbs: Number($('custom-food-carbs') && $('custom-food-carbs').value) || 0,
      fat: Number($('custom-food-fat') && $('custom-food-fat').value) || 0
    };
    addFoodToDay(makeFoodEntry(food, activeFoodMultiplier()));
  },
  'remove-food-entry'(btn) {
    const doc = ensureFoodLog(state.viewDate);
    doc.entries = (doc.entries || []).filter((entry) => entry.id !== btn.dataset.id);
    saveFoodSoon();
    render();
  },
  'copy-food-totals'() {
    const totals = foodLogTotals((state.foodlog[state.viewDate] || {}).entries);
    const row = ensureCheckin(state.viewDate);
    row.calories = Math.round(totals.kcal);
    row.protein = Math.round(totals.protein);
    row.carbs = Math.round(totals.carbs);
    row.fat = Math.round(totals.fat);
    saveCheckinSoon();
    render();
    toast('Totals copied');
  },
  'add-drink'(btn) { addDrink(btn.dataset.name, btn.dataset.kind); },
  'add-custom'() {
    const name = (($('custom-drink') && $('custom-drink').value) || '').trim();
    if (!name) { toast('Name the drink'); return; }
    addDrink(name, 'custom');
  },
  'remove-drink'(btn) {
    const doc = ensureFluids(state.viewDate);
    doc.entries = (doc.entries || []).filter((entry) => entry.id !== btn.dataset.id);
    saveFluidsSoon();
    render();
  },
  'allow-notifications'() { allowNotifications(); },
  expand(btn) {
    const session = currentSession();
    state.expand = new Set();
    addExpand(session, session.exercises[Number(btn.dataset.ex)].id);
    render();
  },
  collapse(btn) {
    const session = currentSession();
    const ex = session.exercises[Number(btn.dataset.ex)];
    if (ex) state.expand.delete(ex.id);
    render();
  },
  'toggle-set'(btn) {
    const session = commitSession();
    const ex = session.exercises[Number(btn.dataset.ex)];
    const set = ex.sets[Number(btn.dataset.set)];
    set.done = !set.done;
    if (set.done && ex.restSec > 0) startTimer(ex.restSec, ex.name);
    if (set.done && isExerciseDone(ex)) {
      state.expand.delete(ex.id);
      const next = session.exercises[Number(btn.dataset.ex) + 1];
      if (next) addExpand(session, next.id);
    }
    saveSessionSoon();
    render();
  },
  rest(btn) {
    const ex = currentSession().exercises[Number(btn.dataset.ex)];
    if (ex && ex.restSec) startTimer(ex.restSec, ex.name);
  },
  'start-timed'(btn) {
    const session = commitSession();
    const ex = session.exercises[Number(btn.dataset.ex)];
    const minutes = Number(ex.minutes) || 0;
    if (minutes > 0) startTimer(minutes * 60, ex.name);
  },
  'toggle-done'(btn) {
    const session = commitSession();
    const ex = session.exercises[Number(btn.dataset.ex)];
    ex.done = !ex.done;
    saveSessionSoon();
    render();
  },
  'toggle-walk'() {
    const session = commitSession();
    session.walkDone = !session.walkDone;
    saveSessionSoon();
    render();
  },
  'timer-pause'() {
    const t = state.timer;
    if (!t) return;
    if (t.paused) {
      t.paused = false;
      t.endsAt = Date.now() + t.remaining * 1000;
    } else {
      t.remaining = Math.max(0, Math.ceil((t.endsAt - Date.now()) / 1000));
      t.paused = true;
    }
    paintTimer();
  },
  'timer-add'() {
    const t = state.timer;
    if (!t) return;
    if (t.paused) t.remaining += 30;
    else t.endsAt += 30000;
    paintTimer();
  },
  'timer-skip'() {
    clearInterval(timerHandle);
    state.timer = null;
    $('timer').hidden = true;
    document.title = 'Dustin Fitness';
  },
  'sleep-step'(btn) {
    const row = ensureCheckin(state.viewDate);
    const cur = row.sleepHours == null ? 7 : Number(row.sleepHours);
    const next = Math.round((cur + Number(btn.dataset.dir) * 0.5) * 2) / 2;
    if (next < 0 || next > 14) return;
    row.sleepHours = next;
    saveCheckinSoon();
    render();
  },
  'toggle-flag'(btn) {
    const row = ensureCheckin(state.viewDate);
    row[btn.dataset.flag] = !row[btn.dataset.flag];
    saveCheckinSoon();
    render();
  },
  'save-checkin'() { flushCheckin(true); },
  'add-meal'() { addMeal(); },
  'remove-meal'(btn) {
    const row = ensureCheckin(state.viewDate);
    row.meals.splice(Number(btn.dataset.meal), 1);
    saveCheckinSoon();
    render();
  },
  'use-totals'() {
    const row = ensureCheckin(state.viewDate);
    const totals = mealTotals(row.meals);
    row.calories = Math.round(totals.kcal);
    row.protein = Math.round(totals.protein);
    row.carbs = Math.round(totals.carbs);
    row.fat = Math.round(totals.fat);
    saveCheckinSoon();
    render();
    toast('Totals filled in');
  },
  'pick-photo'() { $('photo-input').click(); },
  'clear-photo'() {
    const row = ensureCheckin(state.viewDate);
    row.photoPath = '';
    state.photoDraft = null;
    saveCheckinSoon();
    render();
  },
  'save-measure'() { saveMeasure(); },
  'delete-measure'(btn) { deleteMeasure(btn.dataset.id); },
  'toggle-dexa'() { state.dexaOpen = !state.dexaOpen; render(); },
  'save-dexa'() { saveDexa(); },
  'load-photos'() { loadPhotos(); },
  'toggle-day'(btn) {
    const day = Number(btn.dataset.day);
    const current = state.openDay == null ? weekdayMon0(todayISO()) : state.openDay;
    state.openDay = current === day ? -1 : day;
    render();
  },
  'add-ex'(btn) {
    const day = state.profile.week[Number(btn.dataset.day)];
    day.exercises.push(newExercise(''));
    state.openDay = Number(btn.dataset.day);
    saveProfileSoon();
    render();
  },
  'move-ex'(btn) {
    const day = state.profile.week[Number(btn.dataset.day)];
    const index = Number(btn.dataset.ex);
    const next = index + Number(btn.dataset.dir);
    if (next < 0 || next >= day.exercises.length) return;
    const [item] = day.exercises.splice(index, 1);
    day.exercises.splice(next, 0, item);
    saveProfileSoon();
    render();
  },
  'delete-ex'(btn) {
    const day = state.profile.week[Number(btn.dataset.day)];
    day.exercises.splice(Number(btn.dataset.ex), 1);
    saveProfileSoon();
    render();
  },
  'add-food'() { addFood(); },
  'delete-food'(btn) {
    state.profile.foods.splice(Number(btn.dataset.food), 1);
    saveProfileSoon();
    render();
  },
  'ask-restore'() { state.confirmRestore = true; render(); },
  'cancel-restore'() { state.confirmRestore = false; render(); },
  'do-restore'() {
    const foods = state.profile.foods || [];
    const created = state.profile.createdAt;
    const next = seedProfile(new Date().toISOString());
    next.foods = foods;
    next.createdAt = created || next.createdAt;
    state.profile = next;
    state.drafts = {};
    state.confirmRestore = false;
    state.openDay = weekdayMon0(todayISO());
    saveProfileSoon();
    render();
    toast('Starter plan restored');
  }
};

function onInput(event) {
  const el = event.target;
  const field = el.dataset.field;
  if (!field) return;
  if (field === 'set-weight' || field === 'set-reps') {
    const session = commitSession();
    const set = session.exercises[Number(el.dataset.ex)].sets[Number(el.dataset.set)];
    const n = parseNum(el.value);
    if (field === 'set-weight') set.weight = n;
    else set.reps = n;
    saveSessionSoon();
    return;
  }
  if (field === 'timed-min') {
    const session = commitSession();
    session.exercises[Number(el.dataset.ex)].minutes = parseNum(el.value);
    saveSessionSoon();
    return;
  }
  if (field === 'view-date') {
    const next = el.value;
    if (next && next <= todayISO()) {
      state.viewDate = next;
      state.expand = null;
      state.photoDraft = null;
      state.tab = 'checkin';
      render();
    }
    return;
  }
  if (['weightLb', 'steps', 'calories', 'protein', 'carbs', 'fat', 'sleepHours'].includes(field)) {
    ensureCheckin(state.viewDate)[field] = parseNum(el.value);
    saveCheckinSoon();
    return;
  }
  if (field === 'notes' && state.tab === 'checkin') {
    ensureCheckin(state.viewDate).notes = el.value;
    saveCheckinSoon();
    return;
  }
  updatePlan(el, field);
}

function updatePlan(el, field) {
  const p = state.profile;
  const dayIndex = el.dataset.day != null ? Number(el.dataset.day) : null;
  const exIndex = el.dataset.ex != null && el.dataset.ex !== '' ? Number(el.dataset.ex) : null;
  const numeric = {
    calories: 1, proteinG: 1, carbsG: 1, fatG: 1, heightIn: 1, startWeightLb: 1,
    targetWeightLb: 1, targetBfPct: 1, stepsGoal: 1, walkMin: 1, plungeGapHours: 1,
    fluidTrainOz: 1, fluidRestOz: 1, remindEveryMin: 1
  };
  if (field === 'remindOn') {
    p.remindOn = !!el.checked;
    saveProfileSoon();
    render();
    return;
  }
  if (['paceStart', 'paceEnd', 'quietStart', 'quietEnd'].includes(field)) {
    if (el.value) p[field] = el.value;
    saveProfileSoon();
    return;
  }
  if (numeric[field]) {
    const n = parseNum(el.value);
    if (n != null) p[field] = n;
    saveProfileSoon();
    return;
  }
  if (['startDate', 'targetDate', 'vacationDate', 'deloadStart', 'deloadEnd'].includes(field)) {
    if (el.value) p[field] = el.value;
    saveProfileSoon();
    renderHeader();
    return;
  }
  if (field === 'equipment' || field === 'guidelines') {
    p[field] = el.value.split('\n').map((line) => line.trim()).filter(Boolean);
    saveProfileSoon();
    return;
  }
  if (dayIndex == null) return;
  const day = p.week[dayIndex];
  if (field === 'day-name') day.name = el.value;
  if (field === 'day-kind') { day.kind = el.value; render(); }
  if (field === 'day-notes') day.notes = el.value;
  if (exIndex == null) { saveProfileSoon(); return; }
  const ex = day.exercises[exIndex];
  if (field === 'ex-name') ex.name = el.value;
  if (field === 'ex-sets') { const n = parseNum(el.value); if (n != null) ex.sets = n; }
  if (field === 'ex-reps') ex.reps = el.value;
  if (field === 'ex-rest') { const n = parseNum(el.value); if (n != null) ex.restSec = n; }
  if (field === 'ex-min') ex.minutes = parseNum(el.value);
  if (field === 'ex-deload') ex.deloadSets = el.value.trim() === '' ? null : parseNum(el.value);
  if (field === 'ex-super') ex.superset = el.value.trim();
  if (field === 'ex-notes') ex.notes = el.value;
  if (field === 'ex-mode') { ex.mode = el.value; render(); }
  if (field === 'ex-move' && el.value !== '') {
    const dest = Number(el.value);
    const [item] = day.exercises.splice(exIndex, 1);
    p.week[dest].exercises.push(item);
    state.openDay = dest;
    el.value = '';
    saveProfileSoon();
    render();
    return;
  }
  saveProfileSoon();
}

async function flushCheckin(explicit) {
  const row = ensureCheckin(state.viewDate);
  const issue = checkinIssue(row);
  if (issue) { if (explicit) toast(issue); return; }
  clearTimeout(state.timers.checkin);
  if (state.photoDraft && state.photoDraftDate === row.date && !state.preview && state.user) {
    try {
      const path = 'fitness/' + state.user.uid + '/' + row.date + '-' + Date.now() + '.jpg';
      await state.st.uploadString(state.st.ref(state.storage, path), state.photoDraft, 'data_url');
      row.photoPath = path;
      state.photoDraft = null;
    } catch (err) {
      console.warn('Upload', err);
      toast(isPermissionDenied(err)
        ? 'Photo blocked. Publish storage.fitness.rules, then try again.'
        : 'Photo didn’t upload. The rest of the check-in can still save.');
    }
  }
  await putDoc(['checkins', row.date], row);
  const status = $('save-state');
  if (status) status.textContent = state.preview ? 'Preview only' : 'Saved';
  if (explicit) toast(state.preview ? 'Preview only — not saved' : 'Check-in saved');
}

function addMeal() {
  const row = ensureCheckin(state.viewDate);
  const pick = $('meal-pick');
  let meal = null;
  if (pick && pick.value) {
    const food = (state.profile.foods || []).find((item) => item.id === pick.value);
    if (!food) return;
    meal = { name: food.name, kcal: food.kcal, protein: food.protein, carbs: food.carbs, fat: food.fat };
  } else {
    const name = ($('meal-name').value || '').trim();
    if (!name) { toast('Name the food'); return; }
    meal = {
      name: name,
      kcal: parseNum($('meal-kcal').value),
      protein: parseNum($('meal-protein').value),
      carbs: null,
      fat: null
    };
    if ($('meal-remember') && $('meal-remember').checked) {
      state.profile.foods.push({
        id: slug(name) + '-' + Math.random().toString(36).slice(2, 6),
        name: name,
        serving: '',
        kcal: meal.kcal,
        protein: meal.protein,
        carbs: null,
        fat: null
      });
      saveProfileSoon();
    }
  }
  row.meals.push(meal);
  saveCheckinSoon();
  render();
}

function addFood() {
  const name = ($('food-name').value || '').trim();
  if (!name) { toast('Name the food'); return; }
  state.profile.foods.push({
    id: slug(name) + '-' + Math.random().toString(36).slice(2, 6),
    name: name,
    serving: ($('food-serving').value || '').trim(),
    kcal: parseNum($('food-kcal').value),
    protein: parseNum($('food-protein').value),
    carbs: parseNum($('food-carbs').value),
    fat: parseNum($('food-fat').value)
  });
  saveProfileSoon();
  render();
}

async function saveMeasure() {
  const row = {
    date: $('measure-date').value,
    waistIn: parseNum($('m-waist').value),
    armIn: parseNum($('m-arm').value),
    shoulderIn: parseNum($('m-shoulder').value),
    calfIn: parseNum($('m-calf').value),
    notes: '',
    updatedAt: ''
  };
  const issue = measurementIssue(row);
  if (issue) { toast(issue); return; }
  const existing = state.measurements.findIndex((item) => (item.id || item.date) === row.date);
  const stored = Object.assign({ id: row.date }, row);
  if (existing >= 0) state.measurements.splice(existing, 1, stored);
  else state.measurements.push(stored);
  state.measurements.sort(byDateDesc);
  await putDoc(['measurements', row.date], row);
  toast(state.preview ? 'Preview only — not saved' : 'Measurements saved');
  render();
}

async function deleteMeasure(id) {
  state.measurements = state.measurements.filter((row) => (row.id || row.date) !== id);
  if (!state.preview && state.user) {
    try { await state.fs.deleteDoc(state.fs.doc(state.db, 'fitness', state.user.uid, 'measurements', id)); }
    catch (err) { handleWriteError(err); }
  }
  if (state.user) writeCache(state.user.uid);
  render();
}

async function saveDexa() {
  const row = {
    date: $('dx-date').value,
    weightLb: parseNum($('dx-weight').value),
    bfPct: parseNum($('dx-bf').value),
    fatMassG: parseNum($('dx-fat').value),
    leanBmcG: parseNum($('dx-lean').value),
    visceralFatG: parseNum($('dx-vis').value),
    androidPct: parseNum($('dx-and').value),
    gynoidPct: parseNum($('dx-gyn').value),
    notes: ($('dx-notes').value || '').trim(),
    updatedAt: ''
  };
  const issue = dexaIssue(row);
  if (issue) { toast(issue); return; }
  const stored = Object.assign({ id: row.date }, row);
  const existing = state.dexa.findIndex((item) => (item.id || item.date) === row.date);
  if (existing >= 0) state.dexa.splice(existing, 1, stored);
  else state.dexa.push(stored);
  state.dexa.sort(byDateDesc);
  state.dexaOpen = false;
  await putDoc(['dexa', row.date], row);
  toast(state.preview ? 'Preview only — not saved' : 'Scan saved');
  render();
}

async function loadPhotos() {
  if (!state.st || state.preview) return;
  state.photoUrls = state.photoUrls || {};
  const paths = Object.keys(state.checkins)
    .map((date) => state.checkins[date] && state.checkins[date].photoPath)
    .filter(Boolean);
  await Promise.all(paths.map(async (path) => {
    if (state.photoUrls[path]) return;
    try { state.photoUrls[path] = await state.st.getDownloadURL(state.st.ref(state.storage, path)); }
    catch (err) { console.warn(err); }
  }));
  render();
}

async function onPhotoPicked(event) {
  const file = event.target.files && event.target.files[0];
  event.target.value = '';
  if (!file) return;
  if (!/^image\//.test(file.type) && !/\.(jpe?g|png|webp|heic)$/i.test(file.name)) {
    toast('Use a photo');
    return;
  }
  try {
    state.photoDraft = await compressImage(file);
    state.photoDraftDate = state.viewDate;
    const img = $('photo-preview');
    if (img) { img.src = state.photoDraft; img.hidden = false; }
    toast('Photo ready. Save the check-in.');
  } catch (err) {
    toast('Couldn’t read that photo. Try a JPEG.');
  }
}

async function signOut() {
  clearInterval(timerHandle);
  state.timer = null;
  const uid = state.user && state.user.uid;
  if (uid) localStorage.removeItem(cacheKey(uid));
  state.profile = null;
  state.checkins = {};
  state.sessions = {};
  state.measurements = [];
  state.dexa = [];
  state.fluids = {};
  state.foodlog = {};
  state.user = null;
  if (state.auth && state.authMod) {
    try { await state.authMod.signOut(state.auth); } catch (e) {}
  }
  show('login-screen');
  document.title = 'Dustin Fitness';
}

function fillLoginCountdown() {
  const count = countdown(todayISO(), VACATION_DATE);
  const num = $('login-count');
  const label = $('login-count-label');
  if (num) num.textContent = count.days > 0 ? String(count.days) : '0';
  if (label) label.textContent = count.label;
}

function saveFluidsSoon() {
  const doc = ensureFluids(state.viewDate);
  const bad = (doc.entries || []).map(fluidEntryIssue).find(Boolean);
  if (bad) { toast(bad); return; }
  schedule('fluids', () => putDoc(['fluids', doc.date], doc));
  pushHydrationSnapshot(false);
}

function addDrink(name, kind) {
  const entry = makeFluidEntry(name, kind, state.sipOz);
  const issue = fluidEntryIssue(entry);
  if (issue) { toast(issue); return; }
  const doc = ensureFluids(state.viewDate);
  doc.entries = (doc.entries || []).concat(entry);
  saveFluidsSoon();
  render();
}

function hydrationSnapshot(status, lastNotifiedAt) {
  return {
    localDate: todayISO(),
    consumed: status.consumed,
    goal: status.goal,
    behind: status.behind,
    phase: status.phase,
    remindOn: state.profile.remindOn === true,
    remindEveryMin: state.profile.remindEveryMin,
    quietStart: state.profile.quietStart,
    quietEnd: state.profile.quietEnd,
    lastNotifiedAt: lastNotifiedAt || '',
    title: 'Time to drink',
    body: status.behind >= 8 ? "You're " + Math.round(status.behind) + ' oz behind, drink some water' : ''
  };
}

function openHydrationDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('fitness-hydration', 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains('status')) req.result.createObjectStore('status');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function writeHydrationStatus(status) {
  try {
    const db = await openHydrationDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction('status', 'readwrite');
      tx.objectStore('status').put(status, 'latest');
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) { /* private mode */ }
}

function pushHydrationSnapshot(notify) {
  if (!state.profile) return;
  const date = todayISO();
  const doc = state.fluids[date] || emptyFluids(date);
  const status = fluidStatus(state.profile, doc.entries, date, new Date());
  const last = localStorage.getItem('fitness-nudge-at') || '';
  const snap = hydrationSnapshot(status, last);
  writeHydrationStatus(snap);
  const controller = navigator.serviceWorker && navigator.serviceWorker.controller;
  if (controller) {
    controller.postMessage({
      type: 'fitness-hydration',
      notify: !!notify,
      title: snap.title,
      body: snap.body,
      status: snap
    });
  }
}

async function checkHydrationNudge() {
  if (!state.profile || state.preview) return;
  const date = todayISO();
  const doc = state.fluids[date] || emptyFluids(date);
  const now = new Date();
  const status = fluidStatus(state.profile, doc.entries, date, now);
  const last = localStorage.getItem('fitness-nudge-at') || '';
  const due = reminderDue(state.profile, status, now, last || null);
  pushHydrationSnapshot(!!due);
  if (!due) return;
  const stamp = now.toISOString();
  localStorage.setItem('fitness-nudge-at', stamp);
  toast(due.body);
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    try {
      const reg = await navigator.serviceWorker.ready;
      await reg.showNotification(due.title, {
        body: due.body,
        icon: './icon-192.png',
        tag: 'fitness-hydration',
        renotify: true
      });
    } catch (e) { /* notification blocked */ }
  }
}

async function allowNotifications() {
  if (typeof Notification === 'undefined') {
    toast('This browser cannot show alerts');
    return;
  }
  const result = await Notification.requestPermission();
  if (result !== 'granted') {
    toast('Alerts stay off until you allow them');
    render();
    return;
  }
  try {
    const reg = await navigator.serviceWorker.ready;
    if (reg.periodicSync && reg.periodicSync.register) {
      await reg.periodicSync.register('fitness-hydration', { minInterval: 60 * 60 * 1000 });
    }
  } catch (e) { /* periodic sync is optional */ }
  toast('Drink reminders can alert while Fitness is open');
  pushHydrationSnapshot(false);
  render();
}

function startHydrationClock() {
  if (startHydrationClock.started) return;
  startHydrationClock.started = true;
  setInterval(checkHydrationNudge, 60000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkHydrationNudge();
  });
}

function bootPreview() {
  const bundle = previewBundle(todayISO());
  state.preview = true;
  state.profile = bundle.profile;
  state.checkins = bundle.checkins;
  state.sessions = bundle.sessions;
  state.fluids = bundle.fluids || {};
  state.foodlog = bundle.foodlog || {};
  state.measurements = bundle.measurements;
  state.dexa = bundle.dexa.map((row) => Object.assign({ id: row.date }, row));
  state.user = { email: 'preview@localhost', uid: 'preview' };
  applyQuery();
  show('shell');
  render();
}

async function boot() {
  fillLoginCountdown();
  document.title = 'Dustin Fitness';
  if (isPreview()) {
    bootPreview();
    return;
  }
  show('login-screen');
  startHydrationClock();
  try {
    await initFirebase();
  } catch (err) {
    console.warn(err);
    show('login-screen');
    $('login-error').textContent = 'Could not reach Firebase. Check the connection and refresh.';
  }
}

$('login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const btn = $('login-btn');
  const err = $('login-error');
  err.textContent = '';
  btn.disabled = true;
  btn.textContent = 'Signing in…';
  try {
    if (!state.auth) await initFirebase();
    const email = $('login-email').value.trim();
    const pass = $('login-pass').value;
    const cred = await state.authMod.signInWithEmailAndPassword(state.auth, email, pass);
    if (cred.user && !cred.user.emailVerified) {
      try { await state.authMod.sendEmailVerification(cred.user); } catch (e) {}
    }
  } catch (e) {
    err.textContent = authMessage(e && e.code);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Sign in';
  }
});

$('verify-done').addEventListener('click', async () => {
  $('verify-error').textContent = '';
  try {
    await state.authMod.reload(state.auth.currentUser);
    if (state.auth.currentUser.emailVerified) onAuth(state.auth.currentUser);
    else $('verify-error').textContent = 'Still not verified. Open the link, then try again.';
  } catch (e) {
    $('verify-error').textContent = 'Could not refresh the account. Check the connection.';
  }
});

$('verify-resend').addEventListener('click', async () => {
  try {
    await state.authMod.sendEmailVerification(state.auth.currentUser);
    toast('Verification email sent');
  } catch (e) {
    $('verify-error').textContent = 'Could not send the email. Wait a minute and try again.';
  }
});

$('verify-out').addEventListener('click', () => signOut());

document.addEventListener('click', (event) => {
  const btn = event.target.closest('[data-act]');
  if (!btn || btn.disabled) return;
  const fn = actions[btn.dataset.act];
  if (fn) fn(btn);
});

document.addEventListener('input', onInput);
document.addEventListener('change', (event) => {
  const field = event.target.dataset && event.target.dataset.field;
  if (!field) return;
  if (field === 'view-date' || field === 'remindOn' || field.startsWith('day-') || field.startsWith('ex-') || field === 'equipment' || field === 'guidelines' || field.indexOf('pace') === 0 || field.indexOf('quiet') === 0) {
    onInput(event);
  }
});

document.addEventListener('change', (event) => {
  if (event.target && event.target.id === 'photo-input') onPhotoPicked(event);
});

window.addEventListener('resize', () => { if (state.tab === 'progress') drawChart(); });

boot();
