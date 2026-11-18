// Runs coachContext_() from the real .gs files against a fake spreadsheet (4 months of data)
const fs = require('fs');
const dir = __dirname + '/../app/';
const src = ['setup_health_tracker.gs', 'webapp.gs', 'coach.gs', 'coach_actions.gs', 'cardio.gs'].map(f => fs.readFileSync(dir + f, 'utf8')).join('\n');

const pad = n => String(n).padStart(2, '0');
const day = n => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - n); return d; };

function sheet(rows, maxRows) {
  return {
    rows,
    getMaxRows: () => maxRows || Math.max(rows.length + 1, 3000),
    getLastRow: () => Math.max(rows.length + 1, 1),
    getRange(r, c, nr, nc) {
      if (typeof r === 'string') {
        if (r === 'B2:B8') return { getValues: () => [[70], [1.8], [2200]] };
        if (r === 'C13') return { getValue: () => 7.5 };
        return { getDisplayValues: () => [['Body weight, 7-day avg (kg)', '72.4', ''], ['Change vs 4 weeks ago (kg)', '-0.8', ''],
          ['Body fat % (latest)', '18.5', ''], ['Workouts this week', '3', ''], ['PRs this week', '2', ''],
          ['Avg calories, last 7 days', '2180', '2200'], ['Avg protein g/kg, last 7 days', '1.72', '1.8'],
          ['Avg sleep h, last 7 days', '6.9', '7.5'], ['Avg resting HR, last 7 days', '58', '']] };
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

const EX = [['Incline Bench Press', 'Push', 'Upper chest', 'Weight', 6, 10, 2.5, 3, '', 'Front delts', 'Triceps'],
  ['Pull-up', 'Pull', 'Lats', 'Bodyweight', 5, 10, 2.5, 3, '', 'Biceps', 'Upper back'],
  ['Deadlift', 'Legs', 'Hamstrings', 'Weight', 4, 8, 5, 3, '', 'Glutes', 'Lower back'],
  ['Leg Raise', 'Legs', 'Abs', 'Reps only', 10, 20, 0, 3, '', '', '']];
const log = [], body = [], wear = [], weekly = [];
for (let n = 120; n >= 0; n--) {
  const d = day(n), kind = ['Push', 'Pull', 'Legs'][n % 3];
  EX.filter(e => e[1] === kind).forEach(e => {
    for (let s = 1; s <= 3; s++) {
      const w = e[3] === 'Weight' ? 40 + (120 - n) * 0.2 : 0, r = 8 + (s === 1 ? 1 : 0);
      const e1 = e[3] === 'Reps only' ? '' : Math.round((w + (e[3] === 'Bodyweight' ? 72 : 0)) * (1 + r / 30) * 10) / 10;
      log.push([d, e[0], w || '', r, 8, s === 3 && n % 10 === 0 ? 'ไหล่ตึงนิดหน่อย shoulder a bit tight' : '', d, e[0], s, e[2], w, e1, w * r, n % 9 === 0 && s === 1 ? 'PR' : '', w, e[9], e[10]]);
    }
  });
  body.push([d, 74 - (120 - n) * 0.015, 74 - (120 - n) * 0.015, n % 14 === 0 ? 18.5 : '', 2100 + n % 5 * 50, 120, 1.65, '', n % 20 === 0 ? 'slept badly' : '']);
  if (n < 20) wear.push([d, 7.1, 1.2, 1.5, 58, 45, 8000, 30, 2400]);
}
for (let w = 0; w < 104; w++) {
  const d = day(120 - w * 7);
  weekly.push([d].concat(Array.from({ length: 17 }, (_, i) => (i * 1.5) % 9), [60, 2, 21000]));
}
const sheets = { Log: sheet(log), Exercises: sheet(EX, 200), Body: sheet(body, 1500), Wearable: sheet(wear, 2000), Weekly: sheet(weekly, 105), Dashboard: sheet([]), Settings: sheet([]),
  Cardio: sheet([[day(1), '07:10', 'Treadmill run', 30, 4.2, 145, 168, 280, 'Fitbit', ''], [day(0), '18:00', 'Incline walk', 20, '', 120, '', '', 'Coach', 'easy']]),
  Meals: sheet([[day(0), '12:30', 'Lunch', 'kaprao + egg', 650, 30, 70, 28], [day(2), '19:00', 'Dinner', 'som tam + grilled chicken', 550, 40, '', '']]) };

const g = {
  SpreadsheetApp: { openById: () => ({ getSheetByName: n => sheets[n] }), flush() {} },
  Utilities: {
    formatDate: (d, tz, f) => f === 'yyyy-MM-dd' ? d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
      : d.toDateString(),
  },
  CacheService: { getScriptCache: () => ({ get: () => null, put: (k, v) => { if (v.length > 100000) throw new Error('too big'); }, remove() {} }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => '' }) },
  HtmlService: {}, LockService: {}, UrlFetchApp: {}, Logger: { log() {} }, Charts: {},
};
const fn = new Function(...Object.keys(g), src + '\nreturn { coachContext_, getStats, getTrain };');
const api = fn(...Object.values(g));
const t0 = Date.now();
const text = api.coachContext_();
console.log('chars:', text.length, '| approx tokens:', Math.round(text.length / 3.5), '| ms:', Date.now() - t0);
console.log(text.split('\n').map(l => (l.length > 230 ? l.slice(0, 230) + ' ...' : l)).join('\n'));
const st = api.getStats();
console.log('\ngetStats weeks:', st.weeks.length, '| strength exercises:', Object.keys(st.strength).length);
