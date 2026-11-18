// Offline test of Health Inbox: key check, sleep merging, row upserts
const fs = require('fs');
const src = fs.readFileSync(__dirname + '/../inbox/inbox.gs', 'utf8');
const pad = n => String(n).padStart(2, '0');
const ymd = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());

function sheet(rows) {
  const sh = {
    rows, formulas: {}, setFrozenRows() {},
    insertRowBefore: r => { rows.splice(r - 2, 0, []); },
    getLastRow: () => { let i = rows.length; while (i > 0 && !(rows[i - 1] || []).some(v => v !== '' && v !== undefined)) i--; return i + 1; },
    getRange(r, c, nr, nc) {
      nr = nr || 1; nc = nc || 1;
      const get = (i, j) => { const v = (rows[r - 2 + i] || [])[c - 1 + j]; return v === undefined ? '' : v; };
      return {
        getDisplayValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => String(get(i, j)))),
        setValues(v) { v.forEach((row, i) => row.forEach((x, j) => { if (r - 2 + i < 0) return; while (rows.length <= r - 2 + i) rows.push([]); rows[r - 2 + i][c - 1 + j] = x; })); return this; },
        setNumberFormat() { return this; }, setFontWeight() { return this; }, setBackground() { return this; }, setFontColor() { return this; },
        getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => get(i, j))),
        setValue: v => { while (rows.length <= r - 2) rows.push([]); rows[r - 2][c - 1] = v; },
        getFormula: () => sh.formulas[r + ':' + c] || '',
        copyTo: dst => { sh.formulas[dst._r + ':' + dst._c] = sh.formulas[r + ':' + c] || ''; },
        _r: r, _c: c,
      };
    },
  };
  return sh;
}
const now = new Date();
const today = new Date(now); today.setHours(0, 0, 0, 0);
const yday = new Date(today.getTime() - 86400000);
const wear = sheet([[yday, 7, 1, 1.5, 58, 45, 8000]]);
const body = sheet([[yday, 72.4]]);
body.formulas['2:3'] = '=AVG'; body.formulas['2:7'] = '=GKG';
const props = { INBOX_KEY: 'secret123' };
const g = {
  SpreadsheetApp: { openById: () => ({ getSheetByName: n => ({ Wearable: wear, Body: body, Cardio: global.CARDIO }[n]), insertSheet: () => (global.CARDIO = sheet([])) }) },
  Utilities: { formatDate: d => ymd(d), getUuid: () => 'ab-cd' },
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k], setProperty: (k, v) => (props[k] = v) }) },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  ContentService: { MimeType: { JSON: 'json' }, createTextOutput: t => ({ setMimeType: () => JSON.parse(t) }) },
  Logger: { log() {} },
};
const api = new Function(...Object.keys(g), src + '\nreturn { doPost, sleepFrom_ };')(...Object.values(g));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL:', m); } };

// Last night: 23:00-06:30, stages overlap an "Asleep" sample from a second source; one Awake gap
const t = h => new Date(today.getTime() + h * 3600000).toISOString();
const sleepText = [
  'In Bed|' + t(-1.2) + '|' + t(6.6),
  'Core|' + t(-1) + '|' + t(1),
  'Deep|' + t(1) + '|' + t(2.5),
  'Awake|' + t(2.5) + '|' + t(2.75),
  'REM|' + t(2.75) + '|' + t(4),
  'Core|' + t(4) + '|' + t(6.5),
  'Asleep|' + t(-1) + '|' + t(2.5), // overlapping duplicate from another app
  'Core|' + t(-30) + '|' + t(-28), // two nights ago, ignored
].join('\n');
const s = api.sleepFrom_(sleepText, new Date(today.getTime() + 7 * 3600000));
ok(s && s.sleep === 7.25 && s.deep === 1.5 && s.rem === 1.25, 'sleep merge: ' + JSON.stringify(s));

ok(api.doPost({ postData: { contents: JSON.stringify({ key: 'nope', rhr: 50 }) } }).error === 'Wrong key', 'wrong key refused');
ok(api.doPost({ postData: { contents: 'not json' } }).error === 'Body is not JSON', 'bad body refused');

const res = api.doPost({ postData: { contents: JSON.stringify({ key: 'secret123', sleep: sleepText, rhr: '57', hrv: '48.6', steps: '9215', kcal: '', weight: '72,1', bf: '0.185' }) } });
console.log('reply:', JSON.stringify(res));
ok(res.ok, 'saved');
const tw = wear.rows.find(r => r[0] instanceof Date ? ymd(r[0]) === ymd(today) : r[0] && ymd(r[0]) === ymd(today));
ok(tw && tw[4] === 57 && tw[5] === 48.6 && tw[1] > 0, 'wearable today row: ' + JSON.stringify(tw));
ok(wear.rows[0][6] === 9215 && wear.rows[0][4] === 58, 'yesterday steps updated, rest kept: ' + JSON.stringify(wear.rows[0]));
const tb = body.rows[1];
ok(tb && tb[1] === 72.1 && tb[3] === 18.5 && body.formulas['3:3'] === '=AVG' && body.formulas['3:7'] === '=GKG', 'body today + formulas copied: ' + JSON.stringify(tb));
// Second send the same morning updates the same rows, no duplicates
api.doPost({ postData: { contents: JSON.stringify({ key: 'secret123', rhr: 56 }) } });
ok(wear.rows.length === 2 && wear.rows[1][4] === 56, 'resend updates same row');
ok(api.doPost({ postData: { contents: JSON.stringify({ key: 'secret123', rhr: 400, weight: 5 }) } }).wrote.wearable_today === undefined, 'nonsense values ignored');
// Workouts: new sessions added to Cardio, resend skipped, too old ignored
const wk = ['Running|' + t(-14) + '|' + t(-13.45) + '|4.6|310|148|171', 'HKWorkoutActivityTypeWalking|' + t(-10) + '|' + t(-9.6) + '||||', 'Running|' + t(-24 * 9) + '|' + t(-24 * 9 + 0.5)].join(String.fromCharCode(10));
let wr = api.doPost({ postData: { contents: JSON.stringify({ key: 'secret123', workouts: wk }) } }); if (!wr.wrote) console.log('ERR', JSON.stringify(wr));
ok(wr.wrote.cardio_added === 2 && CARDIO.rows.length === 2 && CARDIO.rows[0][3] === 33 && CARDIO.rows[0][4] === 4.6 && CARDIO.rows[1][2] === 'Walking' && CARDIO.rows[1][8] === 'Fitbit', 'workouts added: ' + JSON.stringify(CARDIO.rows));
wr = api.doPost({ postData: { contents: JSON.stringify({ key: 'secret123', workouts: wk }) } });
ok(!wr.wrote.cardio_added && CARDIO.rows.length === 2, 'resend makes no duplicates');
// A date older than the last row (e.g. steps of a missed day) is inserted in date order, not appended
const d0 = new Date(today.getTime() - 3 * 86400000), d1 = new Date(today.getTime() - 2 * 86400000);
const w2 = sheet([[d0, 7], [today, 7.5]]);
const api2 = new Function(...Object.keys(g), src + '\nreturn { upsert_ };')(...Object.values(g));
api2.upsert_(w2, ymd(d1), { 7: 9000 });
ok(w2.rows.map(r => ymd(r[0])).join() === [d0, d1, today].map(ymd).join() && w2.rows[1][6] === 9000, 'older date inserted in order: ' + w2.rows.map(r => ymd(r[0])));
console.log(pass + ' passed, ' + fail + ' failed');
