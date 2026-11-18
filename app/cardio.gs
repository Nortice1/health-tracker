/**
 * CARDIO: one row per session (run, walk, bike, treadmill...). Filled from the app form,
 * from the coach ("Cardio: ..."), or automatically from Apple Health by the Health Inbox receiver.
 */

const CARDIO_HEAD = ['Date', 'Start', 'Type', 'Minutes', 'Distance km', 'Avg HR', 'Max HR', 'Calories', 'Source', 'Notes'];
const CARDIO_TARGET_MIN = 150; // per week, the usual health guideline

// Weight-training sessions with watch data (HR, kcal) live in their own tab with the same columns,
// so they can be compared with the lifting log but never count toward cardio minutes.
const GYM_TAB = 'Gym sessions';
const isGym_ = type => /^(weight training|gym|strength training|lifting)$/i.test(String(type || '').trim());
const tabFor_ = type => (isGym_(type) ? GYM_TAB : 'Cardio');

/** Cardio (or Gym sessions) tab, made on first use (the Health Inbox receiver makes the same layout). */
function cardioSheet_(ss, name) {
  name = name || 'Cardio';
  let sh = ss.getSheetByName(name);
  if (sh) return sh;
  sh = ss.insertSheet(name);
  sh.getRange(1, 1, 1, CARDIO_HEAD.length).setValues([CARDIO_HEAD]).setFontWeight('bold').setBackground('#ea580c').setFontColor('#ffffff');
  sh.setFrozenRows(1);
  sh.getRange('A2:A').setNumberFormat('yyyy-mm-dd');
  sh.getRange('B2:C').setNumberFormat('@'); // start time and type stay text
  sh.getRange('J2:J').setNumberFormat('@');
  sh.setColumnWidth(3, 150);
  sh.setColumnWidth(10, 260);
  return sh;
}

function readCardio_(ss, name) {
  const sh = ss.getSheetByName(name || 'Cardio');
  if (!sh || sh.getLastRow() < 2) return [];
  const n = sh.getLastRow() - 1;
  const starts = sh.getRange(2, 2, n, 1).getDisplayValues();
  return sh.getRange(2, 1, n, 10).getValues()
    .map((r, i) => ({
      row: i + 2, date: ymd_(r[0]), start: starts[i][0], type: String(r[2]), min: num_(r[3]), km: cell_(r[4]),
      avg: cell_(r[5]), max: cell_(r[6]), kcal: cell_(r[7]), source: String(r[8]), notes: String(r[9]),
    }))
    .filter(c => c.date && c.min > 0)
    .sort((a, b) => (a.date + a.start < b.date + b.start ? -1 : 1));
}

// Dates with a "HIIT 4x4" session: slot 7 of the split shows as done on those days
const isHiit_ = type => /^hiit 4x4$/i.test(String(type || '').trim());
function hiitDates_(ss) {
  const done = {};
  readCardio_(ss).forEach(c => { if (isHiit_(c.type)) done[c.date] = true; });
  return done;
}

// HIIT 4x4 timer: the note it writes is read back for the next session's start level, e.g.
// "4x4 Bike · level 8/8/9/9 · 4/4 done · peak HR 172/176/–/181" (a .tcx import adds the zones after it)
const HIIT_NOTE = /^4x4 (\w+) · (level|km\/h) ([\d.\/]+) · (\d)\/4 done(?: · peak HR ([\d\/–]+))?/;
const HIIT_MAX_KEY = 'HIIT_MAX_HR';

/** Last timer session per machine + his measured max HR ('' = the app uses 220 - age). */
function getHiit() {
  const last = {};
  readCardio_(book_()).filter(c => isHiit_(c.type)).forEach(c => {
    const m = HIIT_NOTE.exec(c.notes);
    if (m) last[m[1]] = { date: c.date, unit: m[2], levels: m[3].split('/').map(Number), done: Number(m[4]),
      peaks: m[5] ? m[5].split('/').map(Number).filter(p => p > 0) : [] };
  });
  return { last: last, maxHr: Number(PropertiesService.getScriptProperties().getProperty(HIIT_MAX_KEY)) || '' };
}

/** Max HR for the 4x4 targets only (the .tcx zone minutes keep 220 - age). Blank goes back to 220 - age. */
function saveHiitMaxHr(v) {
  const props = PropertiesService.getScriptProperties();
  if (has_(v)) props.setProperty(HIIT_MAX_KEY, String(Math.round(checkNum_(v, 140, 230, 'Max HR'))));
  else props.deleteProperty(HIIT_MAX_KEY);
  return getHiit();
}

/** Check and append one session. p: {date, start?, type, minutes, distance_km?, avg_hr?, max_hr?, kcal?, note?, source?} */
function addCardio_(ss, p) {
  const d = checkDate_(p.date);
  const type = String(p.type || '').trim().slice(0, 40);
  if (!type) throw new Error('What kind of cardio was it?');
  const min = Math.round(checkNum_(p.minutes, 1, 600, 'Minutes'));
  const opt = (v, lo, hi, what) => (has_(v) && Number(v) !== 0 ? checkNum_(v, lo, hi, what) : '');
  const km = opt(p.distance_km, 0.01, 300, 'Distance');
  const avg = opt(p.avg_hr, 40, 230, 'Average HR'), max = opt(p.max_hr, 40, 240, 'Max HR');
  const kcal = has_(p.kcal) && Number(p.kcal) !== 0 ? Math.round(checkNum_(p.kcal, 1, 5000, 'Calories')) : '';
  const start = /^\d{1,2}:\d{2}$/.test(String(p.start || '')) ? String(p.start)
    : (d === ymd_(new Date()) ? Utilities.formatDate(new Date(), TZ, 'HH:mm') : '');
  const sh = cardioSheet_(ss, tabFor_(type));
  const row = Math.max(sh.getLastRow(), 1) + 1;
  sh.getRange(row, 2, 1, 2).setNumberFormat('@');
  sh.getRange(row, 1, 1, 10).setValues([[parseYmd_(d), start, type, min, km, avg === '' ? '' : Math.round(avg), max === '' ? '' : Math.round(max),
    kcal, p.source || 'Manual', p.note ? String(p.note).slice(0, 200) : '']]);
  return type + ' ' + min + ' min saved' + (isGym_(type) ? ' (gym session, not counted as cardio)' : '');
}

// Monday of the week of a yyyy-MM-dd date
function mondayOf_(dateStr) {
  const d = parseYmd_(dateStr);
  return ymd_(new Date(d.getFullYear(), d.getMonth(), d.getDate() - (d.getDay() + 6) % 7));
}

/** Sessions of one date + minutes this week, for the app. */
function getCardio(dateStr) {
  const ss = book_();
  const all = readCardio_(ss);
  const mon = mondayOf_(ymd_(new Date()));
  const view = c => ({ start: c.start, type: c.type, min: c.min, km: c.km, avg: c.avg, max: c.max, kcal: c.kcal, source: c.source, notes: c.notes });
  return {
    sessions: all.filter(c => c.date === dateStr).map(view),
    gym: readCardio_(ss, GYM_TAB).filter(c => c.date === dateStr).map(view),
    weekMin: all.filter(c => c.date >= mon).reduce((s, c) => s + c.min, 0),
    target: CARDIO_TARGET_MIN,
    kcalOut: kcalOut_(ss, dateStr),
  };
}

// Whole-day calories burned (Wearable I). Google Health does not share it with Apple Health, so it is typed in the app.
const KCAL_OUT_COL = 9;

function wearableDates_(sh) {
  const n = sh.getLastRow() - 1;
  return n > 0 ? sh.getRange(2, 1, n, 1).getValues().map(r => ymd_(r[0])) : [];
}

function kcalOut_(ss, dateStr) {
  const sh = ss.getSheetByName('Wearable');
  const i = wearableDates_(sh).indexOf(dateStr);
  return i < 0 ? '' : cell_(sh.getRange(i + 2, KCAL_OUT_COL).getValue());
}

/** Save the calories out of a date; a blank clears it. */
function saveKcalOut(dateStr, kcal) {
  const d = checkDate_(dateStr);
  const v = has_(kcal) ? Math.round(checkNum_(kcal, 500, 10000, 'Calories out')) : '';
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const sh = book_().getSheetByName('Wearable');
    const dates = wearableDates_(sh);
    let row = dates.indexOf(d) + 2;
    if (row < 2 && v !== '') {
      // New day: keep dates in order like the Health Inbox receiver (a past day goes above the later dates)
      const later = dates.findIndex(x => x && x > d);
      row = later >= 0 ? later + 2 : dates.length + 2;
      if (later >= 0) sh.insertRowBefore(row);
      sh.getRange(row, 1).setValue(parseYmd_(d));
    }
    if (row >= 2) sh.getRange(row, KCAL_OUT_COL).setValue(v);
  } finally {
    lock.releaseLock();
  }
  clearCoachCache_();
  return getCardio(d);
}

function saveCardio(p) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const ss = book_();
    const fromFile = p.source === 'Fitbit file';
    // The same .tcx imported twice must not count the minutes twice
    if (fromFile && readCardio_(ss, tabFor_(p.type)).some(c => c.date === p.date && c.start === p.start))
      throw new Error('Already logged: a session on ' + p.date + ' at ' + p.start + '.');
    addCardio_(ss, Object.assign({}, p, { source: fromFile ? 'Fitbit file' : 'Manual' }));
  } finally {
    lock.releaseLock();
  }
  clearCoachCache_();
  return getCardio(p.date);
}

/** Delete the n-th session (1 = first) of a date; gym = true for the Gym sessions tab. */
function deleteCardio(dateStr, n, gym) {
  deleteCardio_(book_(), dateStr, n, gym);
  clearCoachCache_();
  return getCardio(dateStr);
}

function deleteCardio_(ss, dateStr, n, gym) {
  const tab = gym ? GYM_TAB : 'Cardio';
  const list = readCardio_(ss, tab).filter(c => c.date === checkDate_(dateStr));
  const c = list[Math.round(Number(n)) - 1];
  if (!c) throw new Error(dateStr + ' has ' + list.length + (gym ? ' gym' : ' cardio') + ' session(s), there is no number ' + n + '.');
  ss.getSheetByName(tab).deleteRow(c.row);
  return 'Deleted ' + c.type + ' ' + c.min + ' min';
}
