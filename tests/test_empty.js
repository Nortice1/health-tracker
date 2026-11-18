// Server functions against an EMPTY tracker (fresh setup, nothing logged yet) and a 1-set tracker
const fs = require('fs');
const dir = __dirname + '/../app/';
const src = ['setup_health_tracker.gs', 'webapp.gs', 'coach.gs', 'coach_actions.gs', 'cardio.gs'].map(f => fs.readFileSync(dir + f, 'utf8')).join('\n');
function sheet(rows, maxRows, lastRowOverride) {
  return {
    getMaxRows: () => maxRows, getLastRow: () => lastRowOverride || Math.max(rows.length + 1, 1),
    getRange(r, c, nr, nc) {
      if (typeof r === 'string') return { getDisplayValues: () => Array.from({ length: 9 }, () => ['label', '–', '']), getValues: () => [[70], [2], [2100]], getValue: () => 7.5 };
      return {
        getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => { const row = rows[r - 2 + i] || []; return row[c - 1 + j] === undefined ? '' : row[c - 1 + j]; })),
        getFormula: () => '=X',
      };
    },
  };
}
function run(label, logRows, bodyRows) {
  const EX = [['Incline Bench Press', 'Push', 'Upper chest', 'Weight', 6, 10, 2.5, 3, '', 'Front delts', 'Triceps'], ['Leg Raise', 'Legs', 'Abs', 'Reps only', 10, 20, 0, 3, '', '', '']];
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const weekly = Array.from({ length: 104 }, (_, w) => { const d = new Date(today); d.setDate(d.getDate() - ((today.getDay() + 6) % 7) + w * 7); return [d].concat(Array(20).fill(w === 0 ? 0 : '')); });
  // formulas fill Log/Body to their max rows, so getLastRow is the full height even when empty
  const sheets = { Log: sheet(logRows, 3000, 3000), Exercises: sheet(EX, 200, 200), Body: sheet(bodyRows, 1500, 1500), Wearable: sheet([], 2000, 1), Weekly: sheet(weekly, 105, 105), Dashboard: sheet([], 20), Settings: sheet([], 10) };
  const pad = n => String(n).padStart(2, '0');
  const g = {
    SpreadsheetApp: { openById: () => ({ getSheetByName: n => sheets[n] }), flush() {} },
    Utilities: { formatDate: (d, tz, f) => f === 'yyyy-MM-dd' ? d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) : d.toDateString() },
    CacheService: { getScriptCache: () => ({ get: () => null, put() {}, remove() {} }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => '' }) },
    HtmlService: {}, LockService: {}, UrlFetchApp: {}, Logger: { log() {} }, Charts: {},
  };
  const api = new Function(...Object.keys(g), src + '\nreturn { coachContext_, getStats, getTrain, getBody };')(...Object.values(g));
  const ymd = today.getFullYear() + '-' + pad(today.getMonth() + 1) + '-' + pad(today.getDate());
  const out = {};
  for (const [name, f] of Object.entries({ getTrain: () => api.getTrain(ymd), getStats: () => api.getStats(), getBody: () => api.getBody(ymd), coach: () => api.coachContext_() })) {
    try {
      const v = f();
      const json = JSON.stringify(v);
      out[name] = 'ok' + (/NaN|Infinity|null,null/.test(json) ? ' (contains NaN/Infinity/null!)' : '') + ' ' + json.length + ' chars';
    } catch (e) { out[name] = 'THROWS: ' + e.message; }
  }
  console.log(label, out);
}
const d0 = new Date(); d0.setHours(0, 0, 0, 0);
run('EMPTY  ', [], []);
run('ONE SET', [[d0, 'Incline Bench Press', 50, 10, '', '', d0, 'Incline Bench Press', 1, 'Upper chest', 50, 66.7, 500, '', 50, 'Front delts', 'Triceps']], [[d0, 72, 72, '', '', '', '', '', '']]);
