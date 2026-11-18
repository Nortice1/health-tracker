/**
 * HEALTH INBOX: receives Apple Health numbers from the iPhone Shortcut and writes them
 * into the Health Tracker sheet (Wearable + Body tabs).
 * The Shortcut cannot sign in to Google, so this web app is open to anyone who knows
 * the secret key. It can only WRITE a few numbers for today / yesterday; it never returns sheet data.
 */

const SHEET_ID = 'YOUR_SPREADSHEET_ID';
const TZ = 'Asia/Bangkok';

/** Run once from the editor: makes the secret key and prints it. Run again to replace a leaked key. */
function setupInbox() {
  const key = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  PropertiesService.getScriptProperties().setProperty('INBOX_KEY', key);
  SpreadsheetApp.openById(SHEET_ID); // ask for the sheet permission now
  Logger.log('Secret key (paste it into the Shortcut, keep it private):\n' + key);
}

function doPost(e) {
  let p;
  try { p = JSON.parse(e.postData.contents); } catch (err) { return reply_({ ok: false, error: 'Body is not JSON' }); }
  const key = PropertiesService.getScriptProperties().getProperty('INBOX_KEY');
  if (!key || String(p.key || '') !== key) return reply_({ ok: false, error: 'Wrong key' });

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    return reply_(save_(p, new Date()));
  } catch (err) {
    return reply_({ ok: false, error: err.message });
  } finally {
    lock.releaseLock();
  }
}

function doGet() { return reply_({ ok: true, info: 'Health Inbox is running. Send data with POST.' }); }

function reply_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

const ymd_ = d => Utilities.formatDate(d, TZ, 'yyyy-MM-dd');
const r1_ = v => Math.round(v * 10) / 10;
const r2_ = v => Math.round(v * 100) / 100;

// A number inside [lo, hi], or null when missing / nonsense (Shortcuts sends "" for "no sample")
function num_(v, lo, hi) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(String(v).replace(',', '.').replace(/[^\d.\-]/g, ''));
  return isFinite(n) && n >= lo && n <= hi ? n : null;
}

/**
 * Sleep arrives as text, one sample per line: "Value|start ISO|end ISO" (Value = Core, Deep, REM, Awake, In Bed, Asleep...).
 * Overlapping samples (two sources, or "Asleep" + stages) are merged, so nothing is counted twice.
 */
function sleepFrom_(text, now) {
  const from = now.getTime() - 20 * 3600000; // only last night
  const kinds = { asleep: [], deep: [], rem: [] };
  String(text || '').split(/\r?\n/).forEach(line => {
    const f = line.split('|');
    if (f.length < 3) return;
    const v = f[0].toLowerCase(), s = new Date(f[1].trim()).getTime(), t = new Date(f[2].trim()).getTime();
    if (!(s < t) || t < from || t > now.getTime() + 600000 || /awake|in ?bed/.test(v)) return;
    kinds.asleep.push([s, t]);
    if (/deep/.test(v)) kinds.deep.push([s, t]);
    if (/rem/.test(v)) kinds.rem.push([s, t]);
  });
  const hours = list => {
    list.sort((a, b) => a[0] - b[0]);
    let total = 0, cur = null;
    list.forEach(iv => {
      if (cur && iv[0] <= cur[1]) cur[1] = Math.max(cur[1], iv[1]);
      else { if (cur) total += cur[1] - cur[0]; cur = iv.slice(); }
    });
    if (cur) total += cur[1] - cur[0];
    return total / 3600000;
  };
  const sleep = hours(kinds.asleep);
  if (!(sleep > 0.5 && sleep < 16)) return null;
  return { sleep: r2_(sleep), deep: kinds.deep.length ? r2_(hours(kinds.deep)) : null, rem: kinds.rem.length ? r2_(hours(kinds.rem)) : null };
}

/**
 * Today's row: sleep of last night, resting HR, HRV, weight, body fat.
 * Yesterday's row: steps, active zone minutes, calories out (yesterday is a full day; today is not over yet).
 */
function save_(p, now) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const today = ymd_(now), yesterday = ymd_(new Date(now.getTime() - 86400000));
  const wrote = {};

  const sl = sleepFrom_(p.sleep, now);
  const todayW = {};
  if (sl) { todayW[2] = sl.sleep; if (sl.deep !== null) todayW[3] = sl.deep; if (sl.rem !== null) todayW[4] = sl.rem; }
  const rhr = num_(p.rhr, 30, 120), hrv = num_(p.hrv, 5, 250);
  if (rhr !== null) todayW[5] = Math.round(rhr);
  if (hrv !== null) todayW[6] = r1_(hrv);
  if (Object.keys(todayW).length) { upsert_(ss.getSheetByName('Wearable'), today, todayW); wrote.wearable_today = todayW; }

  const yW = {};
  const steps = num_(p.steps, 0, 100000), azm = num_(p.azm, 0, 1000), kcal = num_(p.kcal, 0, 10000);
  if (steps !== null) yW[7] = Math.round(steps);
  if (azm !== null) yW[8] = Math.round(azm);
  if (kcal !== null) yW[9] = Math.round(kcal);
  if (Object.keys(yW).length) { upsert_(ss.getSheetByName('Wearable'), yesterday, yW); wrote.wearable_yesterday = yW; }

  const bodyV = {};
  const w = num_(p.weight, 30, 250);
  let bf = num_(p.bf, 0, 60);
  if (bf !== null && bf <= 1) bf *= 100; // Health can give 0.185 for 18.5 %
  if (w !== null) bodyV[2] = r2_(w);
  if (bf !== null && bf >= 3) bodyV[4] = r1_(bf);
  if (Object.keys(bodyV).length) { upsert_(ss.getSheetByName('Body'), today, bodyV, [3, 7]); wrote.body_today = bodyV; }

  const n = saveWorkouts_(ss, p.workouts, now);
  if (n) wrote.cardio_added = n;

  return { ok: true, date: today, wrote: wrote };
}

const CARDIO_HEAD = ['Date', 'Start', 'Type', 'Minutes', 'Distance km', 'Avg HR', 'Max HR', 'Calories', 'Source', 'Notes'];

/**
 * Workouts arrive as text, one per line: "Type|start ISO|end ISO|km|kcal|avg HR|max HR" (last four optional).
 * Each new session becomes a Cardio row; a session already there (same date + start + type) is skipped,
 * so sending the same days again never makes duplicates. Only the last 7 days are accepted.
 */
function saveWorkouts_(ss, text, now) {
  const lines = String(text || '').split(/\r?\n/).filter(l => l.indexOf('|') > 0);
  if (!lines.length) return 0;
  let sh = ss.getSheetByName('Cardio');
  if (!sh) {
    sh = ss.insertSheet('Cardio');
    sh.getRange(1, 1, 1, CARDIO_HEAD.length).setValues([CARDIO_HEAD]).setFontWeight('bold').setBackground('#ea580c').setFontColor('#ffffff');
    sh.setFrozenRows(1);
    sh.getRange('B2:C').setNumberFormat('@');
  }
  const last = sh.getLastRow();
  const have = {};
  if (last > 1) {
    const dates = sh.getRange(2, 1, last - 1, 1).getValues();
    const rest = sh.getRange(2, 2, last - 1, 2).getDisplayValues();
    dates.forEach((r, i) => { if (r[0] instanceof Date) have[ymd_(r[0]) + '|' + rest[i][0] + '|' + rest[i][1].toLowerCase()] = 1; });
  }
  const opt = (v, lo, hi) => { const x = num_(v, lo, hi); return x === null || x === 0 ? '' : x; };
  let row = Math.max(last, 1), added = 0;
  lines.forEach(line => {
    const f = line.split('|').map(x => x.trim());
    const s = new Date(f[1]), e = new Date(f[2]);
    const min = (e - s) / 60000;
    if (!(min >= 1 && min <= 600) || s.getTime() < now.getTime() - 7 * 86400000 || e.getTime() > now.getTime() + 600000) return;
    const type = (f[0] || 'Workout').replace(/^HKWorkoutActivityType/, '').slice(0, 40);
    const date = ymd_(s), start = Utilities.formatDate(s, TZ, 'HH:mm');
    const k = date + '|' + start + '|' + type.toLowerCase();
    if (have[k]) return;
    have[k] = 1;
    const km = opt(f[3], 0.01, 300), kcal = opt(f[4], 1, 5000), avg = opt(f[5], 40, 230), max = opt(f[6], 40, 240);
    row++;
    sh.getRange(row, 2, 1, 2).setNumberFormat('@');
    const p = date.split('-').map(Number);
    sh.getRange(row, 1, 1, 10).setValues([[new Date(p[0], p[1] - 1, p[2]), start, type, Math.round(min),
      km === '' ? '' : r2_(km), avg === '' ? '' : Math.round(avg), max === '' ? '' : Math.round(max), kcal === '' ? '' : Math.round(kcal), 'Fitbit', '']]);
    added++;
  });
  return added;
}

/**
 * Write values {column: value} into the row for date (find it, or add the next row).
 * formulaCols: columns whose formula is copied from the row above when the row is new (Body C and G).
 */
function upsert_(sh, date, values, formulaCols) {
  const last = sh.getLastRow();
  const dates = last > 1 ? sh.getRange(2, 1, last - 1, 1).getValues().map(r => (r[0] instanceof Date ? ymd_(r[0]) : '')) : [];
  let row = dates.indexOf(date) + 2;
  if (row < 2) {
    let lastDated = 1;
    dates.forEach((d, i) => { if (d) lastDated = i + 2; });
    row = lastDated + 1;
    // Keep dates in order: a late day (e.g. yesterday's steps after today's sleep) goes above the later dates.
    // Only for tabs without formula columns; Body keeps appending so its formulas stay intact.
    const later = dates.findIndex(d => d && d > date);
    if (later >= 0 && !(formulaCols || []).length) { row = later + 2; sh.insertRowBefore(row); }
    const p = date.split('-').map(Number);
    sh.getRange(row, 1).setValue(new Date(p[0], p[1] - 1, p[2]));
  }
  (formulaCols || []).forEach(c => {
    if (row > 2 && sh.getRange(row, c).getFormula() === '') sh.getRange(row - 1, c).copyTo(sh.getRange(row, c));
  });
  Object.keys(values).forEach(c => sh.getRange(row, Number(c)).setValue(values[c]));
}
