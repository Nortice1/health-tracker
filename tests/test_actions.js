// Tests describeActions_ / applyCoachActions from the real .gs files against a writable fake sheet
const fs = require('fs');
const dir = __dirname + '/../app/';
const src = ['setup_health_tracker.gs', 'webapp.gs', 'coach.gs', 'coach_actions.gs', 'cardio.gs'].map(f => fs.readFileSync(dir + f, 'utf8')).join('\n');
const pad = n => String(n).padStart(2, '0');
const ymd = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const day = n => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - n); return d; };

function sheet(name, rows, maxRows) {
  const sh = {
    rows, setFrozenRows() {}, setColumnWidth() {},
    deleteRow(r) { rows.splice(r - 2, 1); },
    insertRowBefore(r) { rows.splice(r - 2, 0, []); },
    getMaxRows: () => maxRows,
    getLastRow: () => { let i = rows.length; while (i > 0 && !(rows[i - 1] || []).some(v => v !== '' && v !== undefined)) i--; return i + 1; },
    getRange(r, c, nr, nc) {
      if (typeof r === 'string') {
        const m = r.match(/^([A-Z])(\d+)(?::([A-Z])(\d*))?$/);
        c = m[1].charCodeAt(0) - 64; const r0 = +m[2];
        nr = m[4] ? +m[4] - r0 + 1 : (m[3] ? 1 : 1); nc = m[3] ? m[3].charCodeAt(0) - 64 - c + 1 : 1; r = r0;
      }
      nr = nr || 1; nc = nc || 1;
      const get = (i, j) => { const row = rows[r - 2 + i] || []; const v = row[c - 1 + j]; return v === undefined ? '' : v; };
      const set = (i, j, v) => { const k = r - 2 + i; if (k < 0) return; while (rows.length <= k) rows.push([]); rows[k][c - 1 + j] = v; };
      const rg = {
        getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => get(i, j))),
        getValue: () => get(0, 0),
        getDisplayValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => String(get(i, j)))),
        setValues: v => { v.forEach((row, i) => row.forEach((x, j) => set(i, j, x))); if (sh.recalc) sh.recalc(); return rg; },
        setValue: v => { set(0, 0, v); if (sh.recalc) sh.recalc(); return rg; },
        clearContent: () => { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) set(i, j, ''); if (sh.recalc) sh.recalc(); return rg; },
        setNumberFormat: () => rg, setFontWeight: () => rg, setBackground: () => rg, setFontColor: () => rg, setHorizontalAlignment: () => rg, getFormula: () => '=X', copyTo() {},
      };
      return rg;
    },
  };
  return sh;
}
const EX = [['Incline Bench Press', 'Push', 'Upper chest', 'Weight', 6, 10, 2.5, 3, '', 'Front delts', 'Triceps'],
  ['Pull-up', 'Pull', 'Lats', 'Bodyweight', 5, 10, 2.5, 3, '', 'Biceps', 'Upper back'],
  ['Leg Raise', 'Legs', 'Abs', 'Reps only', 10, 20, 0, 3, '', '', '']];
// Log A:F typed; G..N like the sheet formulas (date/exercise fill-down, set number)
const log = [
  [day(1), 'Incline Bench Press', 60, 10, 8, ''], ['', '', 60, 9, '', ''], ['', '', 60, 8, 9, 'tired'],
  [day(0), 'Pull-up', 5, 8, '', ''], [day(0), 'Pull-up', 5, 8, '', ''],
];
const L = sheet('Log', log, 3000);
L.recalc = () => {
  let d = '', e = ''; const cnt = {};
  log.forEach(r => {
    for (let j = 0; j < 6; j++) if (r[j] === undefined) r[j] = '';
    const any = r[2] !== '' || r[3] !== '';
    if (r[0] !== '') d = r[0];
    if (r[1] !== '') e = r[1];
    if (!any) { r[6] = r[0]; r[7] = r[1]; r[8] = ''; return; }
    const k = ymd(d) + e; cnt[k] = (cnt[k] || 0) + 1;
    r[6] = d; r[7] = e; r[8] = cnt[k]; r[11] = r[2] * (1 + r[3] / 30); r[13] = '';
  });
};
L.recalc();
const body = [[day(2), 72.5, 72.5, '', 2100, 130, 1.8, '', '']];
const sheets = {
  Log: L, Exercises: sheet('Exercises', EX, 200), Body: sheet('Body', body, 1500),
  Settings: sheet('Settings', [['Default body weight (kg)', 70], ['Protein target', 1.8], ['Calorie target', 2200]], 10),
  Weekly: sheet('Weekly', [], 105), Wearable: sheet('Wearable', [], 2000),
  Dashboard: sheet('Dashboard', Array.from({ length: 13 }, (_, i) => (i === 11 ? ['Sleep', '', 7.5] : [])), 20),
};
const g = {
  SpreadsheetApp: { openById: () => ({ getSheetByName: n => sheets[n], insertSheet: n => (sheets[n] = sheet(n, [], 1000)) }), flush() {} },
  Utilities: { formatDate: (d, tz, f) => (f === 'yyyy-MM-dd' ? ymd(d) : d.toDateString().slice(0, 10)) },
  CacheService: { getScriptCache: () => ({ get: () => null, put() {}, remove() {} }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k === 'GEMINI_API_KEY' ? 'test-key' : ''), setProperty() {} }) },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  HtmlService: {}, UrlFetchApp: { fetch: (url, o) => { global.SENT = JSON.parse(o.payload); return { getResponseCode: () => 200, getContentText: () => JSON.stringify(global.REPLY) }; } }, Logger: { log() {} }, Charts: {},
};
const api = new Function(...Object.keys(g), src + '\nreturn { saveCardio, getCardio, deleteCardio, saveKcalOut, deleteSet, getBody, deleteMeal, askCoach, describeActions_, applyCoachActions, coachTools_, readLog_, book_ };')(...Object.values(g));
const T = ymd(day(0)), Y = ymd(day(1)), F = ymd(day(-1));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL:', m); } };

console.log('tools:', api.coachTools_().map(t => t.name).join(', '));
const calls = [
  { name: 'upsert_exercise', args: { name: 'Hack Squat', day: 'Legs', main_muscle: 'Quads', secondary_1: 'Glutes', rep_min: 8, rep_max: 12 } },
  { name: 'log_sets', args: { exercise: 'hack squat', sets: [{ weight: 80, reps: 10 }, { weight: 80, reps: 9, rpe: 9 }] } },
  { name: 'log_body', args: { weight: 72.1, kcal: 2050, protein: 140, note: 'chicken rice' } },
  { name: 'set_targets', args: { calorie_target: 2000, protein_g_per_kg: 2, sleep_hours: 8 } },
  { name: 'edit_set', args: { date: Y, exercise: 'Incline Bench Press', set_number: 3, reps: 7 } },
  { name: 'delete_set', args: { date: Y, exercise: 'Incline Bench Press', set_number: 1 } },
  { name: 'remove_exercise', args: { name: 'Leg Raise' } },
  { name: 'remove_exercise', args: { name: 'Pull-up' } },
];
const acts = api.describeActions_(calls);
acts.forEach(a => console.log('  card:', a.label));
ok(acts.every(a => !a.bad), 'all labels valid');
const res = api.applyCoachActions(acts.map(a => ({ name: a.name, args: a.args })));
res.forEach(r => console.log('  result:', r.ok ? 'OK ' : 'ERR', r.msg));
ok(res.length === calls.length && res.every(r => r.ok), 'all applied');
const lg = api.readLog_(api.book_());
ok(lg.filter(x => x.ex === 'Hack Squat' && x.date === T).length === 2, 'hack squat logged today');
const bench = lg.filter(x => x.ex === 'Incline Bench Press');
ok(bench.length === 2 && bench[0].r === 9 && bench[1].r === 7 && bench.every(x => x.date === Y), 'bench: set1 deleted, fill-down kept, set3 now 7: ' + JSON.stringify(bench.map(x => [x.date, x.r])));
ok(sheets.Settings.rows[2][1] === 2000 && sheets.Settings.rows[1][1] === 2 && sheets.Dashboard.rows[11][2] === 8, 'targets written');
const b = body.find(r => r[0] instanceof Date && ymd(r[0]) === T);
ok(b && b[1] === 72.1 && b[4] === 2050 && b[8] === 'chicken rice', 'body row today ' + JSON.stringify(b));
ok(!EX.some(r => r[0] === 'Leg Raise'), 'Leg Raise removed (no history)');
const pu = EX.find(r => r[0] === 'Pull-up');
ok(pu[1] === 'Other' && /^Retired/.test(pu[8]), 'Pull-up retired');
ok(EX.find(r => r[0] === 'Hack Squat')[9] === 'Glutes', 'hack squat secondary');

// Bad proposals must be stopped
const bad = [
  [{ name: 'log_sets', args: { exercise: 'Moon Press', sets: [{ weight: 50, reps: 5 }] } }, 'not in your exercise list'],
  [{ name: 'log_sets', args: { exercise: 'Incline Bench Press', date: F, sets: [{ weight: 50, reps: 5 }] } }, 'future'],
  [{ name: 'log_sets', args: { exercise: 'Incline Bench Press', sets: [{ reps: 5 }] } }, 'needs a weight'],
  [{ name: 'log_sets', args: { exercise: 'Incline Bench Press', sets: [{ weight: 900, reps: 5 }] } }, 'between'],
  [{ name: 'set_targets', args: { calorie_target: 800 } }, 'between'],
  [{ name: 'edit_set', args: { date: Y, exercise: 'Incline Bench Press', set_number: 5, reps: 3 } }, 'no set 5'],
  [{ name: 'upsert_exercise', args: { name: 'Pull-up', rename_to: 'Chin-up' } }, 'already has logged sets'],
  [{ name: 'upsert_exercise', args: { name: 'Curl', day: 'Pull', main_muscle: 'Bicep' } }, 'not one of the muscle parts'],
  [{ name: 'upsert_exercise', args: { name: 'Curl' } }, 'needs a day'],
  [{ name: 'log_body', args: {} }, 'Nothing'],
];
bad.forEach(([c, want]) => {
  const r = api.applyCoachActions([c]);
  ok(!r[0].ok && r[0].msg.includes(want), c.name + ' should fail with "' + want + '", got: ' + r[0].msg);
});
ok(api.describeActions_([bad[0][0]])[0].bad, 'unknown exercise flagged on card');
const r3 = api.applyCoachActions([bad[0][0], { name: 'set_targets', args: { calorie_target: 2100 } }]);
ok(r3.length === 1 && sheets.Settings.rows[2][1] === 2000, 'stops at first error');
// Meals: added to the day total, delete takes it off again
const before = body.find(r => r[0] instanceof Date && ymd(r[0]) === T);
const k0 = before[4], p0 = before[5];
const md = api.describeActions_([{ name: 'log_meal', args: { meal: 'Lunch', food: 'kaprao moo sap + fried egg', kcal: 650, protein: 30, carbs: 70, fat: 28 } }]);
console.log('  card:', md[0].label);
let mr = api.applyCoachActions([{ name: 'log_meal', args: md[0].args }, { name: 'log_meal', args: { food: 'whey shake', kcal: 120, protein: 24 } }]);
mr.forEach(r => console.log('  result:', r.ok ? 'OK ' : 'ERR', r.msg));
ok(sheets.Meals && sheets.Meals.rows.length === 2 && sheets.Meals.rows[1][2] === 'Snack' && sheets.Meals.rows[0][2] === 'Lunch', 'meals tab made, 2 rows, default Snack');
ok(before[4] === k0 + 770 && before[5] === p0 + 54, 'body totals added: ' + before[4] + ' / ' + before[5]);
mr = api.applyCoachActions([{ name: 'delete_meal', args: { date: T, meal_number: 2 } }]);
ok(mr[0].ok && sheets.Meals.rows.length === 1 && before[4] === k0 + 650 && before[5] === p0 + 30, 'delete meal 2: ' + JSON.stringify(mr) + ' ' + before[4]);
ok(!api.applyCoachActions([{ name: 'log_meal', args: { food: 'x', kcal: 9000, protein: 10 } }])[0].ok, 'meal kcal limit');
const dm = api.describeActions_([{ name: 'delete_meal', args: { date: T, meal_number: 5 } }, { name: 'log_meal', args: { food: 'shrimp', kcal: 550, protein: 35 } }]);
ok(dm[0].bad && !dm[1].bad, 'impossible delete flagged, meal still ok: ' + dm[0].label);
ok(api.describeActions_([{ name: 'delete_set', args: { date: Y, exercise: 'Incline Bench Press', set_number: 9 } }])[0].bad, 'impossible delete_set flagged');
// Meal with items: the app adds them up; an item whose macros miss its kcal (2026-10-23: 1050 kcal but 42/80/32 g = 776) gets carbs/fat scaled
const k1 = before[4], p1 = before[5], nMeals = sheets.Meals.rows.length;
const items = [{ name: 'shrimp fried rice + pork curry', kcal: 1050, protein: 42, carbs: 80, fat: 32, fiber: 3, veg: 0.5, sodium: 1800 },
  { name: 'beer 1 glass', kcal: 150, protein: 1, carbs: 12, fat: 0, fiber: 0, veg: 0, sodium: 10, alcohol: 14 }];
const im = api.describeActions_([{ name: 'log_meal', args: { meal: 'Dinner', food: 'fried rice, curry, beer', items: items } }]);
console.log('  card:', im[0].label);
ok(!im[0].bad && /→ 1200 kcal · P 43 g · C 128.2 g · F 47 g · fiber 3 g · veg\+fruit 0.5 · sodium 1810 mg$/.test(im[0].label), 'items card: fried rice carbs/fat fitted to 1050 kcal, beer kept (alcohol): ' + im[0].label);
mr = api.applyCoachActions([{ name: 'log_meal', args: im[0].args }]);
const row = sheets.Meals.rows[sheets.Meals.rows.length - 1];
ok(mr[0].ok && sheets.Meals.rows.length === nMeals + 1 && JSON.stringify(row.slice(4)) === '[1200,43,128.2,47,3,0.5,1810]', 'items row E:K: ' + JSON.stringify(row));
ok(before[4] === k1 + 1200 && before[5] === p1 + 43, 'items added to body day total: ' + before[4] + ' / ' + before[5]);
api.applyCoachActions([{ name: 'delete_meal', args: { date: T, meal_number: nMeals + 1 } }]); // the checks below expect the earlier meals only
ok(before[4] === k1 && before[5] === p1 && sheets.Meals.rows.length === nMeals, 'items meal deleted again');
ok(api.describeActions_([{ name: 'log_meal', args: { food: 'x', items: [{ name: 'chicken breast', kcal: 100, protein: 31, carbs: 0, fat: 1, fiber: 0, veg: 0, sodium: 70 }] } }])[0].label.indexOf('→ 133 kcal') > 0, 'protein alone over the kcal: the macros win');
const noCarbs = { name: 'log_meal', args: { food: 'x', items: [{ name: 'rice', kcal: 300, protein: 6, fat: 1 }] } };
ok(api.describeActions_([noCarbs])[0].bad && /Carbs and fat are needed/.test(api.applyCoachActions([noCarbs])[0].msg), 'item without carbs refused');
ok(!api.applyCoachActions([{ name: 'log_meal', args: { food: 'x', items: [items[0], items[0], items[0], items[0], items[0]] } }])[0].ok, 'meal total kcal limit');
// Fat / fiber / veg+fruit / sodium targets: Settings rows 5-8 get their labels, carbs fill the calories left
ok(api.describeActions_([{ name: 'set_targets', args: { fat_g_per_kg: 1, sodium_mg: 2300 } }])[0].label === '🎯 Targets: fat 1 g/kg, sodium under 2300 mg/day', 'nutrition targets card');
ok(api.applyCoachActions([{ name: 'set_targets', args: { fat_g_per_kg: 1, sodium_mg: 2300 } }])[0].ok, 'nutrition targets applied');
const S = sheets.Settings.rows;
ok(S[3][0] === 'Fat target (g per kg)' && S[3][1] === 1 && S[4][1] === 30 && S[5][1] === 5 && S[6][0] === 'Sodium limit (mg/day)' && S[6][1] === 2300, 'Settings rows 5-8: ' + JSON.stringify(S.slice(3)));
ok(!api.applyCoachActions([{ name: 'set_targets', args: { fat_g_per_kg: 3 } }])[0].ok && S[3][1] === 1, 'fat target limit');
const tg = api.getBody(T).target;
ok(tg.fat === 73 /* 1 g/kg x 72.5 kg, the latest 7-day avg */ && Math.abs(4 * tg.protein + 9 * tg.fat + 4 * tg.carbs - tg.kcal) <= 4 && tg.sodium === 2300 && tg.fiber === 30, 'getBody targets add up to the calories: ' + JSON.stringify(tg));
// Train screen: delete any set of today
api.applyCoachActions([{ name: 'log_sets', args: { exercise: 'Incline Bench Press', sets: [{ weight: 50, reps: 10 }, { weight: 50, reps: 9 }, { weight: 50, reps: 8 }] } }]);
let todays = api.readLog_(api.book_()).filter(x => x.ex === 'Incline Bench Press' && x.date === T);
const mid = todays[1];
let threw = '';
try { api.deleteSet(mid.row, T, 'Pull-up'); } catch (e) { threw = e.message; }
ok(/changed in the sheet/.test(threw), 'wrong exercise refused: ' + threw);
api.deleteSet(mid.row, T, 'Incline Bench Press');
todays = api.readLog_(api.book_()).filter(x => x.ex === 'Incline Bench Press' && x.date === T);
ok(todays.length === 2 && todays[0].r === 10 && todays[1].r === 8 && todays[1].set === 2, 'middle set deleted, renumbered: ' + JSON.stringify(todays.map(x => [x.r, x.set])));
const ybench = api.readLog_(api.book_()).filter(x => x.ex === 'Incline Bench Press' && x.date === Y);
ok(ybench.length === 2, 'yesterday untouched');
// Body screen: meals of the day + targets, delete from the app
api.applyCoachActions([{ name: 'log_meal', args: { meal: 'Dinner', food: 'som tam', kcal: 300, protein: 10 } }]);
let gb = api.getBody(T);
console.log('  getBody meals:', JSON.stringify(gb.meals), 'target:', JSON.stringify(gb.target));
ok(gb.meals.length === 2 && gb.meals[1].food === 'som tam' && gb.target.kcal === 2000 && gb.target.protein > 100, 'getBody meals + targets');
gb = api.deleteMeal(T, 2);
ok(gb.meals.length === 1 && gb.day.kcal === k0 + 650, 'deleteMeal from app: kcal ' + gb.day.kcal);
// Meal: forces the log_meal tool; a call with no text uses its breakdown as the reply
global.REPLY = { candidates: [{ finishReason: 'STOP', content: { parts: [{ functionCall: { name: 'log_meal', args: { meal: 'Lunch', food: 'fried shrimp x9 + salad', kcal: 550, protein: 35, breakdown: 'Fried shrimp 9: 400 kcal / 30 g' } } }] } }] };
let ac = api.askCoach([{ role: 'user', text: 'Meal: fried shrimp 9 with salad' }]);
ok(SENT.toolConfig && SENT.toolConfig.functionCallingConfig.mode === 'ANY' && SENT.toolConfig.functionCallingConfig.allowedFunctionNames[0] === 'log_meal', 'Meal: forces log_meal ' + JSON.stringify(SENT.toolConfig));
ok(ac.actions.length === 1 && !ac.actions[0].bad && ac.text.indexOf('Fried shrimp') === 0, 'card + breakdown text: ' + ac.text + ' | ' + ac.actions[0].label);
global.REPLY = { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'Hi' }] } }] };
ac = api.askCoach([{ role: 'user', text: 'how was my week?' }]);
ok(SENT.toolConfig === undefined && ac.actions.length === 0, 'normal question stays AUTO');
// Photo: attached as inlineData to the latest user turn, meal tool still forced
global.REPLY = { candidates: [{ finishReason: 'STOP', content: { parts: [{ functionCall: { name: 'log_meal', args: { meal: 'Lunch', food: 'pad thai (photo)', kcal: 600, protein: 22 } } }] } }] };
ac = api.askCoach([{ role: 'user', text: 'hi' }, { role: 'model', text: 'hello' }, { role: 'user', text: 'Meal: estimate the food in this photo' }], '', { mime: 'image/jpeg', data: 'QUJD' });
const lastTurn = SENT.contents[SENT.contents.length - 1];
ok(lastTurn.role === 'user' && lastTurn.parts.length === 2 && lastTurn.parts[1].inlineData.mimeType === 'image/jpeg' && SENT.contents[0].parts.length === 1, 'photo on latest turn only');
ok(SENT.toolConfig && ac.actions.length === 1, 'photo meal forced + card');
let perr = '';
try { api.askCoach([{ role: 'user', text: 'x' }], '', { mime: 'application/pdf', data: 'QUJD' }); } catch (e) { perr = e.message; }
ok(/could not be sent/.test(perr), 'bad photo type refused');
// Cardio: app form, coach card, week total, delete, forced card, limits
let cg = api.saveCardio({ date: T, type: 'Treadmill run', minutes: '32', distance_km: '4.6', avg_hr: '148', max_hr: '171', kcal: '', note: 'easy' });
ok(cg.sessions.length === 1 && cg.sessions[0].min === 32 && cg.sessions[0].source === 'Manual' && cg.weekMin === 32 && cg.target === 150, 'saveCardio: ' + JSON.stringify(cg));
const cd = api.describeActions_([{ name: 'log_cardio', args: { type: 'Incline walk', minutes: 20, avg_hr: 125 } }]);
console.log('  card:', cd[0].label);
const cr = api.applyCoachActions([{ name: 'log_cardio', args: cd[0].args }]);
cg = api.getCardio(T);
ok(cr[0].ok && cg.sessions.length === 2 && cg.sessions[1].source === 'Coach' && cg.weekMin === 52, 'coach log_cardio: ' + JSON.stringify(cr));
cg = api.deleteCardio(T, 1);
ok(cg.sessions.length === 1 && cg.sessions[0].type === 'Incline walk' && cg.weekMin === 20, 'deleteCardio');
ok(api.describeActions_([{ name: 'delete_cardio', args: { date: T, cardio_number: 4 } }])[0].bad, 'impossible delete_cardio flagged');
ok(!api.applyCoachActions([{ name: 'log_cardio', args: { type: 'Run', minutes: 900 } }])[0].ok, 'cardio minutes limit');
ok(!api.applyCoachActions([{ name: 'log_cardio', args: { type: 'Run', minutes: 30, avg_hr: 300 } }])[0].ok, 'cardio HR limit');
global.REPLY = { candidates: [{ finishReason: 'STOP', content: { parts: [{ functionCall: { name: 'log_cardio', args: { type: 'Bike', minutes: 40, breakdown: 'Bike 40 min. This week 60/150.' } } }] } }] };
ac = api.askCoach([{ role: 'user', text: 'Cardio: bike 40 min' }]);
ok(SENT.toolConfig.functionCallingConfig.allowedFunctionNames[0] === 'log_cardio' && ac.text.indexOf('Bike 40') === 0 && ac.actions.length === 1, 'Cardio: forced + breakdown');
// .tcx import: keeps its own date/start, source 'Fitbit file', second import of the same file refused
const tcx = { date: '2025-01-15', start: '18:00', type: 'Walk', minutes: '30', distance_km: '2', avg_hr: '120', max_hr: '140', kcal: '150', note: 'Zones: fat burn 34', source: 'Fitbit file' };
cg = api.saveCardio(tcx);
ok(cg.sessions.length === 1 && cg.sessions[0].start === '18:27' && cg.sessions[0].source === 'Fitbit file', 'tcx import saved: ' + JSON.stringify(cg.sessions));
let dup = '';
try { api.saveCardio(tcx); } catch (e) { dup = e.message; }
ok(/Already logged/.test(dup) && api.getCardio('2026-09-30').sessions.length === 1, 'tcx import twice refused: ' + dup);
ok(api.saveCardio(Object.assign({}, tcx, { source: 'Coach' })).sessions[1].source === 'Manual', 'form cannot fake another source');
// Weight training: own tab, shown as gym, never in cardio minutes (form, file import and coach)
const cardioBefore = api.getCardio(T).weekMin;
cg = api.saveCardio({ date: T, type: 'Weight training', minutes: '65', avg_hr: '112', max_hr: '158', kcal: '380', start: '17:30', source: 'Fitbit file' });
ok(cg.gym.length === 1 && cg.gym[0].min === 65 && cg.weekMin === cardioBefore && !cg.sessions.some(s => s.type === 'Weight training'), 'weight training kept out of cardio: ' + JSON.stringify(cg));
const gd = api.describeActions_([{ name: 'log_cardio', args: { type: 'weight training', minutes: 50 } }]);
ok(/not cardio/.test(gd[0].label) && !gd[0].bad, 'coach card says gym: ' + gd[0].label);
api.applyCoachActions([{ name: 'log_cardio', args: gd[0].args }]);
cg = api.getCardio(T);
ok(cg.gym.length === 2 && cg.weekMin === cardioBefore, 'coach weight training to gym tab');
ok(api.describeActions_([{ name: 'delete_cardio', args: { date: T, cardio_number: 3, gym: true } }])[0].bad, 'impossible gym delete flagged');
cg = api.deleteCardio(T, 1, true);
ok(cg.gym.length === 1 && cg.gym[0].min === 50 && cg.weekMin === cardioBefore, 'delete gym session leaves cardio alone');
// Calories out typed in the app: Wearable I, one row per date, dates kept in order
const W = sheets.Wearable.rows, wDates = () => W.filter(r => r[0] instanceof Date).map(r => ymd(r[0])).join(',');
ok(api.getCardio(T).kcalOut === '', 'no calories out yet');
ok(api.saveKcalOut(Y, '2450').kcalOut === 2450 && W.length === 1, 'calories out saved to a new row');
W[0][1] = 7.5; // sleep from the receiver on the same row must survive
ok(api.saveKcalOut(Y, 2500).kcalOut === 2500 && W.length === 1 && W[0][1] === 7.5, 'calories out updated in place');
api.saveKcalOut(T, 2300);
api.saveKcalOut(ymd(day(3)), 2200);
ok(wDates() === [ymd(day(3)), Y, T].join(','), 'past day inserted above later dates: ' + wDates());
ok(api.saveKcalOut(Y, '').kcalOut === '' && W.length === 3, 'blank clears');
api.saveKcalOut(ymd(day(5)), '');
ok(W.length === 3, 'blank on a day with no row adds nothing');
let kerr = '';
try { api.saveKcalOut(T, 50); } catch (e) { kerr = e.message; }
ok(/between 500 and 10000/.test(kerr), 'calories out limit: ' + kerr);
kerr = '';
try { api.saveKcalOut(F, 2400); } catch (e) { kerr = e.message; }
ok(/future/.test(kerr), 'future date refused');
console.log(pass + ' passed, ' + fail + ' failed');
