// Slot 7 of the split = Rest + HIIT 4x4 (display only): plan, coach TRAINING PLAN lines, getStats fields.
// Also writes preview_hiit.html (real Index.html fed by the real getStats) for a Playwright look at the plan card.
const fs = require('fs');
const dir = __dirname + '/../app/';
const src = ['setup_health_tracker.gs', 'webapp.gs', 'coach.gs', 'coach_actions.gs', 'cardio.gs'].map(f => fs.readFileSync(dir + f, 'utf8')).join('\n');
const pad = n => String(n).padStart(2, '0');
const day = n => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + n); return d; };
const ymd = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());

function sheet(rows, maxRows) {
  return {
    getMaxRows: () => maxRows || Math.max(rows.length + 1, 3000),
    getLastRow: () => rows.length + 1,
    getRange(r, c, nr, nc) {
      if (typeof r === 'string') {
        if (r === 'B2:B8') return { getValues: () => [[70], [1.8], [2200]] };
        if (r === 'C13') return { getValue: () => 7.5 };
        return { getDisplayValues: () => [['Body weight, 7-day avg (kg)', '72.4', '']] };
      }
      return {
        getValues: () => Array.from({ length: nr }, (_, i) => {
          const row = rows[r - 2 + i] || [];
          return Array.from({ length: nc }, (_, j) => (row[c - 1 + j] === undefined ? '' : row[c - 1 + j]));
        }),
        getDisplayValues() { return this.getValues().map(r => r.map(v => (v instanceof Date ? '' : String(v)))); },
        getFormula: () => '=X',
      };
    },
  };
}

const EX = [['Incline Bench Press', 'Push', 'Upper chest', 'Weight', 6, 10, 2.5, 3, '', '', ''],
  ['Pull-up', 'Pull', 'Lats', 'Bodyweight', 5, 10, 2.5, 3, '', '', ''],
  ['Deadlift', 'Legs', 'Hamstrings', 'Weight', 4, 8, 5, 3, '', '', '']];
// Full-workout fixtures must meet the three-distinct-exercise threshold.
const exOf = {};
EX.slice().forEach(row => {
  exOf[row[1]] = [row[0], row[0] + ' variation 2', row[0] + ' variation 3'];
  exOf[row[1]].slice(1).forEach(name => EX.push([name, ...row.slice(1)]));
});
// Two clean cycles ending yesterday: day -7 and today land on slot 7, day -3 and -10 on slot 4
const LOG = { '-13': 'Push', '-12': 'Pull', '-11': 'Legs', '-9': 'Push', '-8': 'Pull', '-6': 'Push', '-5': 'Pull', '-4': 'Legs', '-2': 'Push', '-1': 'Pull' };
const log = [];
Object.keys(LOG).sort((a, b) => a - b).forEach(n => {
  const d = day(+n), ex = exOf[LOG[n]];
  ex.forEach(name => log.push([d, name, 50, 8, '', '', d, name, 1, '', 50, 63.3, 400, '', 50, '', '']));
});
const hiitRow = (n, type, note) => [day(n), '18:00', type || 'HIIT 4x4', 35, '', 160, 182, 400, 'Manual', note || ''];
const PROPS = {};

function run(cardioRows) {
  const sheets = { Log: sheet(log), Exercises: sheet(EX, 200), Body: sheet([], 1500), Wearable: sheet([], 2000), Weekly: sheet([], 105),
    Dashboard: sheet([]), Settings: sheet([]), Cardio: sheet(cardioRows), Meals: sheet([]) };
  const g = {
    SpreadsheetApp: { openById: () => ({ getSheetByName: n => sheets[n] }), flush() {} },
    Utilities: { formatDate: (d, tz, f) => (f === 'yyyy-MM-dd' ? ymd(d) : f === 'EEE d MMM' ? 'D' + Math.round((d - day(0)) / 86400000) : d.toDateString()) },
    CacheService: { getScriptCache: () => ({ get: () => null, put() {}, remove() {} }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => PROPS[k] || null, setProperty: (k, v) => { PROPS[k] = v; }, deleteProperty: k => { delete PROPS[k]; } }) },
    HtmlService: {}, LockService: {}, UrlFetchApp: {}, Logger: { log() {} }, Charts: {},
  };
  const api = new Function(...Object.keys(g), src + '\nreturn { coachContext_, getStats, getTrain, getBody, getCardio, getHiit, saveHiitMaxHr };')(...Object.values(g));
  const text = api.coachContext_();
  const plan = text.split('\n').filter(l => /^- (Today|Last 7 days|Next 7 days):/.test(l));
  return { api, plan, stats: api.getStats() };
}

let fails = 0;
const ok = (c, msg) => { console.log((c ? 'ok   ' : 'FAIL ') + msg); if (!c) fails++; };
const T = ymd(day(0));

// A: HIIT done 7 days ago, nothing today
let r = run([hiitRow(-7)]);
console.log(r.plan.join('\n'));
ok(r.plan[1].indexOf('D-7 Rest + HIIT 4x4, did HIIT') >= 0, 'past slot 7 with a HIIT 4x4 row: "Rest + HIIT 4x4, did HIIT"');
ok(r.plan[1].indexOf('D-3 Rest;') >= 0, 'slot 4 stays a plain Rest');
ok(r.plan[0] === '- Today: Rest + HIIT 4x4 (not logged yet)', 'today on slot 7, no HIIT yet');
ok(/D7 Rest \+ HIIT 4x4/.test(r.plan[2]) && /D4 Rest;/.test(r.plan[2]), 'next 7 days: slot 7 labelled, slot 4 plain');
ok(r.plan.join(' ').indexOf('MISSED') < 0, 'nothing MISSED');
const st = r.stats;
ok(st.hiit[ymd(day(-7))] && st.hiit[T] && !st.hiit[ymd(day(-3))], 'getStats.hiit = slot-7 dates only');
ok(Object.keys(st.hiit).every(d => st.plan[d] === 'Rest'), 'every slot-7 date is still a Rest in the plan (upcoming skips it)');
ok(st.hiitDone[ymd(day(-7))] === true && !st.hiitDone[T], 'getStats.hiitDone from the Cardio tab');
const upcoming = Object.keys(st.plan).filter(d => d > T && st.plan[d] !== 'Rest').sort()[0];
ok(upcoming === ymd(day(1)) && st.plan[upcoming] === 'Push', 'next workout = Push tomorrow');

// B: no HIIT anywhere: skipped HIIT is fine
r = run([]);
ok(r.plan[1].indexOf('D-7 Rest + HIIT 4x4;') >= 0 && r.plan.join(' ').indexOf('did HIIT') < 0 && r.plan.join(' ').indexOf('MISSED') < 0, 'skipped HIIT: no "did HIIT", never MISSED');

// C: HIIT done today (lower case also counts)
r = run([hiitRow(0, 'hiit 4x4')]);
ok(r.plan[0] === '- Today: Rest + HIIT 4x4, did HIIT', 'today: ' + r.plan[0]);

// D: HIIT on a slot-4 Rest, plain "HIIT" on slot 7: neither counts
r = run([hiitRow(-3), hiitRow(-7, 'HIIT')]);
ok(r.plan.join(' ').indexOf('did HIIT') < 0, 'HIIT 4x4 off slot 7, or type "HIIT", is not "did HIIT"');

// 4x4 timer: the note it writes is read back per machine (newest wins), with or without peaks and .tcx zones
const N1 = '4x4 Bike · level 8/8/9/9 · 4/4 done · peak HR 172/176/–/181 · Zones: fat burn 5, cardio 20, peak 10 min (AZM 65)';
r = run([hiitRow(-14, '', '4x4 Bike · level 7/7/7/7 · 4/4 done'), hiitRow(-7, '', N1), hiitRow(-3, '', '4x4 Treadmill · km/h 9.5/9.5 · 1/4 done'),
  hiitRow(-2, 'HIIT', '4x4 Bike · level 20/20/20/20 · 4/4 done'), hiitRow(-1, '', 'felt great')]);
let h = r.api.getHiit();
ok(JSON.stringify(h.last.Bike) === JSON.stringify({ date: ymd(day(-7)), unit: 'level', levels: [8, 8, 9, 9], done: 4, peaks: [172, 176, 181] }), 'getHiit Bike: ' + JSON.stringify(h.last.Bike));
ok(JSON.stringify(h.last.Treadmill.levels) === '[9.5,9.5]' && h.last.Treadmill.done === 1 && h.last.Treadmill.peaks.length === 0, 'getHiit Treadmill km/h, no peaks');
ok(h.maxHr === '', 'no max HR saved yet');
ok(r.api.saveHiitMaxHr('188').maxHr === 188 && r.api.getHiit().maxHr === 188, 'saveHiitMaxHr 188');
let bad = '';
try { r.api.saveHiitMaxHr('300'); } catch (e) { bad = e.message; }
ok(/between 140 and 230/.test(bad) && r.api.getHiit().maxHr === 188, 'max HR 300 refused: ' + bad);
ok(r.api.saveHiitMaxHr('').maxHr === '' && !('HIIT_MAX_HR' in PROPS), 'blank max HR clears it');

// Preview: state A, plus today done so the pink tick shows; timer data = the Bike session above
const hiitData = h;
r = run([hiitRow(-7), hiitRow(0)]);
const data = { getStats: r.stats, getTrain: r.api.getTrain(T), getBody: r.api.getBody(T), getCardio: r.api.getCardio(T), getHiit: hiitData };
const mock = '<script>(function(){const D=' + JSON.stringify(data) + ';const fns={getTrain:()=>D.getTrain,getStats:()=>D.getStats,getBody:()=>D.getBody,getCardio:()=>D.getCardio,getCoachStatus:()=>({hasKey:true}),' +
  'getHiit:()=>D.getHiit,saveHiitMaxHr:v=>(D.getHiit.maxHr=v===""?"":+v,D.getHiit),saveCardio:p=>(window.__saved=p,D.getCardio)};' +
  'function runner(ok){return new Proxy({},{get:(o,k)=>k==="withSuccessHandler"?(f=>runner(f)):k==="withFailureHandler"?(()=>runner(ok)):((...a)=>setTimeout(()=>ok(fns[k](...a)),10))});}' +
  'window.google={script:{run:runner(()=>{})}};window.addEventListener("error",e=>{(window.__errs=window.__errs||[]).push(e.message)});})();</script>';
if (process.env.WRITE_PREVIEW === '1') fs.writeFileSync(__dirname + '/preview_hiit.html', fs.readFileSync(dir + 'Index.html', 'utf8').replace('<script>\nconst api', mock + '\n<script>\nconst api'));

console.log(fails ? fails + ' FAILED' : 'all passed');
process.exit(fails ? 1 : 0);
