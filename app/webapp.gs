/**
 * HEALTH TRACKER PHONE APP (web app). The Google Sheet stays the database:
 * the app only writes the same white columns you would type by hand.
 */

const SHEET_ID = 'YOUR_SPREADSHEET_ID';
const TZ = 'Asia/Bangkok';

function doGet() {
  return HtmlService.createTemplateFromFile('Index').evaluate()
    .setTitle('Health Tracker')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover');
}

function book_() { return SpreadsheetApp.openById(SHEET_ID); }
function ymd_(d) { return d instanceof Date ? Utilities.formatDate(d, TZ, 'yyyy-MM-dd') : ''; }
function parseYmd_(s) { const p = String(s).split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); }
function cell_(v) { return v instanceof Date ? '' : v; }
function num_(v) { return typeof v === 'number' ? v : (v === '' || v == null ? 0 : Number(v) || 0); }

// Last row (1-based) that has anything typed in Log A:F
function lastLogRow_(sh) {
  const vals = sh.getRange(2, 1, sh.getMaxRows() - 1, 6).getValues();
  for (let i = vals.length - 1; i >= 0; i--) {
    if (vals[i].some(v => v !== '')) return i + 2;
  }
  return 1;
}

function readLog_(ss) {
  const sh = ss.getSheetByName('Log');
  const last = lastLogRow_(sh);
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, 17).getValues()
    .map((r, i) => ({
      row: i + 2, date: ymd_(r[6]), ex: String(r[7]), w: num_(r[2]), r: num_(r[3]), rpe: cell_(r[4]),
      set: num_(r[8]), e1rm: num_(r[11]), pr: r[13] === 'PR', notes: String(cell_(r[5])),
    }))
    .filter(x => x.r > 0 && x.date && x.ex);
}

function readExercises_(ss) {
  return ss.getSheetByName('Exercises').getRange(2, 1, EX_ROWS - 1, 11).getValues()
    .filter(r => r[0] !== '')
    .map(r => ({
      name: String(r[0]), day: r[1], muscle: r[2], type: r[3] || 'Weight',
      repMin: num_(r[4]) || 8, repMax: num_(r[5]) || 12, step: num_(r[6]), sets: num_(r[7]) || 3,
      notes: String(r[8] || ''), sec: [r[9], r[10]].filter(String),
    }));
}

function weightText_(type, w) {
  w = Math.round(w * 100) / 100;
  if (type === 'Weight') return w + ' kg';
  return w ? 'BW +' + w + ' kg' : 'BW';
}

/** Everything the Train screen needs for one date. */
function getTrain(dateStr) {
  const ss = book_();
  const date = dateStr || ymd_(new Date());
  const log = readLog_(ss);
  const byEx = {};
  log.forEach(x => { (byEx[x.ex] = byEx[x.ex] || []).push(x); });
  // Settings "PR count from": best only counts sets from that date (same as the sheet's PR column)
  const prCell = ss.getRangeByName ? ss.getRangeByName('PRFrom') : null;
  const prFrom = prCell && prCell.getValue() instanceof Date ? ymd_(prCell.getValue()) : '';

  const exercises = readExercises_(ss).map(e => {
    const rows = byEx[e.name] || [];
    const past = rows.filter(x => x.date < date);
    const lastDate = past.reduce((m, x) => (x.date > m ? x.date : m), '');
    const lastSets = past.filter(x => x.date === lastDate);
    const today = rows.filter(x => x.date === date)
      .map(x => ({ row: x.row, set: x.set, w: x.w, r: x.r, rpe: x.rpe, pr: x.pr }));
    const best = rows.filter(x => x.date >= prFrom).reduce((m, x) => Math.max(m, e.type === 'Reps only' ? x.r : x.e1rm), 0);

    // Same double-progression rule as the Lift Stats sheet
    let sugW = e.type === 'Weight' ? 20 : 0, sugR = e.repMin, target;
    if (!lastSets.length) {
      target = 'First time: find a weight for ' + e.repMin + '-' + e.repMax + ' reps';
    } else {
      const top = Math.max.apply(null, lastSets.map(x => x.w));
      const atTop = lastSets.filter(x => x.w === top);
      const minR = Math.min.apply(null, atTop.map(x => x.r));
      sugW = top;
      if (minR >= e.repMax && atTop.length >= e.sets) {
        if (e.step > 0) { sugW = Math.round((top + e.step) * 100) / 100; sugR = e.repMin; target = weightText_(e.type, sugW) + ' x ' + sugR + '  (weight up!)'; }
        else { sugR = e.repMax; target = 'Top of range: try a harder variation'; }
      } else if (minR >= e.repMax) {
        sugR = e.repMax; target = weightText_(e.type, top) + ' x ' + e.repMax + ', reach ' + e.sets + ' sets';
      } else {
        sugR = minR + 1; target = weightText_(e.type, top) + ' x ' + sugR + '+ on every set';
      }
    }
    return Object.assign(e, {
      lastDate: lastDate, lastSets: lastSets.map(x => [x.w, x.r]), today: today,
      sugW: sugW, sugR: sugR, target: target, best: Math.round(best * 10) / 10,
    });
  });
  return { date: date, exercises: exercises, lastRow: lastLogRow_(ss.getSheetByName('Log')) };
}

/** Append one set to the Log. Returns set number, e1RM and PR flag computed by the sheet. */
function saveSet(p) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const sh = book_().getSheetByName('Log');
    const row = lastLogRow_(sh) + 1;
    ensureLogCapacity_(sh, row);
    const w = Number(p.w) > 0 ? Number(p.w) : '';
    sh.getRange(row, 6).setNumberFormat('@'); // note stays text, never a date or formula
    sh.getRange(row, 1, 1, 6).setValues([[parseYmd_(p.date), p.ex, w, Number(p.r), p.rpe ? Number(p.rpe) : '', p.notes || '']]);
    SpreadsheetApp.flush();
    clearCoachCache_();
    const v = sh.getRange(row, 9, 1, 6).getValues()[0]; // I..N
    return { row: row, set: num_(v[0]), w: num_(w), r: Number(p.r), rpe: p.rpe || '', e1rm: num_(v[3]), pr: v[5] === 'PR' };
  } finally {
    lock.releaseLock();
  }
}

// Formulas were pre-filled for LOG_ROWS rows; extend them by 500 when the log gets there
function ensureLogCapacity_(sh, row) {
  if (row <= sh.getMaxRows() && sh.getRange(row, 7).getFormula() !== '') return;
  if (row + 500 > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), row + 500 - sh.getMaxRows());
  sh.getRange(row - 1, 7, 1, 11).copyTo(sh.getRange(row, 7, 500, 11));
  // Typed columns A:F: bring the look and the date/RPE checks along, never the values
  const typed = sh.getRange(row - 1, 1, 1, 6), next = sh.getRange(row, 1, 500, 6);
  typed.copyTo(next, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
  typed.copyTo(next, SpreadsheetApp.CopyPasteType.PASTE_DATA_VALIDATION, false);
}

/** Undo: only the most recent set, so the Log never gets a gap. */
function deleteLastSet(row) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const sh = book_().getSheetByName('Log');
    if (Number(row) !== lastLogRow_(sh)) throw new Error('Only the most recent set can be deleted from the app.');
    sh.getRange(row, 1, 1, 6).clearContent();
    clearCoachCache_();
    return lastLogRow_(sh); // new newest row, so the set before can be undone too
  } finally {
    lock.releaseLock();
  }
}

/** Delete any set of the Log (not only the newest). date + ex must match the row, so a stale screen never deletes the wrong set. */
function deleteSet(row, dateStr, exName) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const ss = book_();
    const sh = ss.getSheetByName('Log');
    const x = readLog_(ss).find(s => s.row === Number(row));
    if (!x || x.date !== dateStr || x.ex !== exName) throw new Error('That set changed in the sheet. Close and reopen the exercise.');
    clearLogRow_(sh, x);
    clearCoachCache_();
    return lastLogRow_(sh);
  } finally {
    lock.releaseLock();
  }
}

// Rows typed in the sheet may leave Date/Exercise blank to mean "same as above": keep the next row's meaning, then clear A:F
function clearLogRow_(sh, x) {
  const next = sh.getRange(x.row + 1, 1, 1, 4).getValues()[0];
  if (next[2] !== '' || next[3] !== '') {
    if (next[0] === '') sh.getRange(x.row + 1, 1).setValue(parseYmd_(x.date));
    if (next[1] === '') sh.getRange(x.row + 1, 2).setValue(x.ex);
  }
  sh.getRange(x.row, 1, 1, 6).clearContent();
}

function readBody_(ss) {
  const sh = ss.getSheetByName('Body');
  return sh.getRange(2, 1, Math.max(sh.getLastRow() - 1, 1), 9).getValues()
    .map((r, i) => ({ row: i + 2, date: ymd_(r[0]), w: cell_(r[1]), avg: cell_(r[2]), bf: cell_(r[3]), kcal: cell_(r[4]), protein: cell_(r[5]), gkg: cell_(r[6]), notes: String(cell_(r[8])) }))
    .filter(x => x.date);
}

/** Settings B2:B8. Rows 5-8 (nutrition) came later: a blank one uses its value from FOOD_SETTINGS. */
function settings_(ss) {
  const v = ss.getSheetByName('Settings').getRange('B2:B8').getValues().map(r => r[0]);
  const food = i => (v[3 + i] === '' || v[3 + i] == null || !isFinite(Number(v[3 + i])) ? FOOD_SETTINGS[i][1] : Number(v[3 + i]));
  return { bw: num_(v[0]), proteinPerKg: num_(v[1]), kcal: num_(v[2]), fatPerKg: food(0), fiber: food(1), veg: food(2), sodium: food(3) };
}

/** A day's food targets: protein and fat per kg of body weight, carbs fill the calories left. */
function foodTargets_(s, bw) {
  const protein = Math.round(s.proteinPerKg * bw), fat = Math.round(s.fatPerKg * bw);
  return { kcal: s.kcal, protein: protein, carbs: Math.max(0, Math.round((s.kcal - 4 * protein - 9 * fat) / 4)), fat: fat, fiber: s.fiber, veg: s.veg, sodium: s.sodium };
}

/**
 * Meal totals for each of the 7 full days before today (today left out, like the Dashboard averages), the average
 * per day of each part over the days that have it (older meals have no fiber, veg or sodium), and today so far.
 */
function foodWeek_(meals, today) {
  const from = addDays_(today, -7), byDay = {};
  meals.forEach(m => { if (m.date >= from && m.date <= today) (byDay[m.date] = byDay[m.date] || []).push(m); });
  const days = Object.keys(byDay).filter(d => d < today).sort().map(d => [d, sumMeals_(byDay[d])]);
  const avg = {};
  FOOD_KEYS.forEach(k => {
    const v = days.map(d => d[1][k]).filter(x => x !== '');
    avg[k] = v.length ? r1_(v.reduce((s, x) => s + x, 0) / v.length) : '';
  });
  return { days: days, avg: avg, today: sumMeals_(byDay[today] || []) };
}

function getBody(dateStr) {
  const ss = book_();
  const rows = readBody_(ss);
  const day = rows.find(x => x.date === dateStr) || null;
  const series = rows.filter(x => x.w !== '').sort((a, b) => (a.date < b.date ? -1 : 1)).slice(-120).map(x => [x.date, num_(x.w), num_(x.avg)]);
  // Meals of the day + daily targets (protein and fat in grams from the latest 7-day average weight)
  const s = settings_(ss);
  const lastAvg = series.filter(x => x[0] <= dateStr && x[2]).slice(-1)[0];
  const bw = lastAvg ? lastAvg[2] : s.bw;
  const meals = readMeals_(ss).filter(m => m.date === dateStr)
    .map(m => ({ time: m.time, meal: m.meal, food: m.food, kcal: m.kcal, protein: m.protein, carbs: m.carbs, fat: m.fat, fiber: m.fiber, veg: m.veg, sodium: m.sodium }));
  return {
    day: day && { w: day.w, bf: day.bf, kcal: day.kcal, protein: day.protein, notes: day.notes, avg: day.avg, gkg: day.gkg },
    series: series, meals: meals, favorites: readFoodFavorites_(), target: foodTargets_(s, bw),
  };
}

// Personal app: shared script property survives reloads/devices without adding sheet columns.
const FOOD_FAVORITES_KEY = 'FOOD_FAVORITES_V1';
function readFoodFavorites_() {
  const raw = PropertiesService.getScriptProperties().getProperty(FOOD_FAVORITES_KEY);
  if (!raw) return [];
  const list = JSON.parse(raw);
  if (!Array.isArray(list)) throw new Error('Saved foods could not be read.');
  return list;
}
function foodSnapshot_(m) {
  const x = { meal: String(m.meal), food: String(m.food) };
  FOOD_KEYS.forEach(k => { x[k] = m[k] == null ? '' : m[k]; });
  return x;
}
function foodSignature_(m) { return JSON.stringify(foodSnapshot_(m)); }
function storeFoodFavorites_(list) {
  const raw = JSON.stringify(list);
  // Apps Script allows 9 KB per property; leave room below the limit, including Thai text.
  if (encodeURIComponent(raw).replace(/%[A-F\d]{2}/gi, 'x').length > 8000) throw new Error('Saved foods are full. Remove a saved food first.');
  PropertiesService.getScriptProperties().setProperty(FOOD_FAVORITES_KEY, raw);
}
function saveFoodFavorite(dateStr, n, expected) {
  const d = checkDate_(dateStr), lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const m = readMeals_(book_()).filter(m => m.date === d)[Number(n) - 1];
    if (!m || !expected || !Number.isInteger(Number(n)) || foodSignature_(m) !== foodSignature_(expected)) throw new Error('That meal changed. Reload Body and try again.');
    const list = readFoodFavorites_(), food = foodSnapshot_(m);
    if (!list.some(f => foodSignature_(f) === foodSignature_(food))) {
      if (list.length >= 30) throw new Error('Save at most 30 foods. Remove one first.');
      list.push(Object.assign({ id: Utilities.getUuid() }, food));
      storeFoodFavorites_(list);
    }
  } finally { lock.releaseLock(); }
  return getBody(d);
}
function removeFoodFavorite(id, dateStr) {
  const d = checkDate_(dateStr), lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try { storeFoodFavorites_(readFoodFavorites_().filter(f => f.id !== id)); }
  finally { lock.releaseLock(); }
  return getBody(d);
}
function logFoodFavorite(id, dateStr) {
  const d = checkDate_(dateStr), ss = book_(), lock = LockService.getScriptLock();
  let f;
  lock.waitLock(15000);
  try {
    f = readFoodFavorites_().find(f => f.id === id);
    if (!f) throw new Error('That saved food no longer exists. Reload Body.');
    if (MEALS.indexOf(f.meal) < 0 || !has_(f.food)) throw new Error('Invalid saved food.');
    // Validate bounds without mealTotals_: it fits/rounds macros, but favorites must stay exact.
    const limits = [5000, 300, 800, 400, 100, 20, 20000];
    FOOD_KEYS.forEach((k, i) => {
      if (has_(f[k])) checkNum_(f[k], 0, limits[i], k);
      else if (i < 2) throw new Error('Saved food is missing ' + k + '.');
    });
    writeMeal_(ss, d, f.meal, f.food, f);
  } finally { lock.releaseLock(); }
  try { addToBody_(ss, d, f.kcal, f.protein, 1); }
  catch (e) {
    throw new Error('Meal was logged, but Body totals could not update. Do not tap Log again. Check the meal list and correct Body totals. ' + e.message);
  } finally { clearCoachCache_(); }
  try { return getBody(d); }
  catch (e) { throw new Error('Meal was logged. Do not tap Log again. Reload Body to see it. ' + e.message); }
}

/** Delete one meal (n = 1 is the first meal of that date) from the Body screen. */
function deleteMeal(dateStr, n) {
  applyOne_('delete_meal', { date: dateStr, meal_number: n });
  clearCoachCache_();
  return getBody(dateStr);
}

/** Create or update the Body row for a date. Blank fields keep what is already there. */
function saveBody(p) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const ss = book_();
    const sh = ss.getSheetByName('Body');
    const rows = readBody_(ss);
    const found = rows.find(x => x.date === p.date);
    const row = found ? found.row : (rows.length ? Math.max.apply(null, rows.map(x => x.row)) + 1 : 2);
    if (row > 2 && sh.getRange(row, 3).getFormula() === '') {
      sh.getRange(row - 1, 3).copyTo(sh.getRange(row, 3));
      sh.getRange(row - 1, 7).copyTo(sh.getRange(row, 7));
    }
    sh.getRange(row, 1).setValue(parseYmd_(p.date));
    const put = (col, v, isText) => {
      if (v === '' || v == null) return;
      const c = sh.getRange(row, col);
      if (isText) c.setNumberFormat('@');
      c.setValue(isText ? String(v) : Number(v));
    };
    put(2, p.w); put(4, p.bf); put(5, p.kcal); put(6, p.protein); put(9, p.notes, true);
    SpreadsheetApp.flush();
    clearCoachCache_();
    return getBody(p.date);
  } finally {
    lock.releaseLock();
  }
}

/** Last n weeks of the Weekly tab (up to this week), oldest first. */
function readWeeks_(ss, today, n) {
  const nM = MUSCLES.length;
  return ss.getSheetByName('Weekly').getRange(2, 1, WEEKS, nM + 4).getValues()
    .filter(r => r[0] instanceof Date && ymd_(r[0]) <= today).slice(-n)
    .map(r => ({ week: ymd_(r[0]), sets: r.slice(1, nM + 1).map(num_), total: num_(r[nM + 1]), prs: num_(r[nM + 2]), tonnage: num_(r[nM + 3]) }));
}

/** Sets per date + main day type; fewer than 3 distinct exercises counts as Other. */
function trainDays_(log, exercises) {
  const dayOf = {};
  exercises.forEach(e => { dayOf[e.name] = e.day; });
  const cal = {};
  log.forEach(x => {
    const d = cal[x.date] = cal[x.date] || { sets: 0, kinds: {}, exercises: new Set() };
    d.sets++;
    d.exercises.add(x.ex);
    const k = dayOf[x.ex] || 'Other';
    d.kinds[k] = (d.kinds[k] || 0) + 1;
  });
  const days = {};
  Object.keys(cal).forEach(dt => {
    const k = cal[dt].kinds;
    const kind = cal[dt].exercises.size >= 3 ? Object.keys(k).sort((a, b) => k[b] - k[a])[0] : 'Other';
    days[dt] = [cal[dt].sets, kind];
  });
  return days;
}

function addDays_(dateStr, n) {
  const d = parseYmd_(dateStr);
  return ymd_(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n));
}

// Rolling split plan, shared by the Stats card and the coach. Train = move on to the slot after the one
// he did; miss a workout = it waits for him next day; rest day with no training = move on.
// Today (if not logged yet) and future days assume he follows the plan.
// hiit (optional) gets the dates that land on slot 7: still a Rest for the walk, shown as his weekly HIIT 4x4.
const SPLIT = ['Push', 'Pull', 'Legs', 'Rest', 'Push', 'Pull', 'Rest'];
const HIIT_SLOT = 6; // slot 7, the Rest after the 2nd Pull
function splitPlan_(days, today, end, hiit) {
  const logged = Object.keys(days).filter(d => d <= today).sort();
  const plan = {};
  let pos = 0;
  for (let dt = logged.length ? logged[0] : today; dt <= end; dt = addDays_(dt, 1)) {
    const slot = SPLIT[pos], v = dt <= today ? days[dt] : null;
    plan[dt] = slot;
    if (hiit && pos === HIIT_SLOT) hiit[dt] = true;
    if (v && SPLIT.indexOf(v[1]) >= 0) {
      let i = 0;
      while (SPLIT[(pos + i) % 7] !== v[1]) i++;
      pos = (pos + i + 1) % 7;
    } else if (v) {
      // Accessory work does not complete a workout, but still allows a planned Rest to pass.
      if (slot === 'Rest') pos = (pos + 1) % 7;
    } else if (dt >= today || slot === 'Rest') {
      pos = (pos + 1) % 7;
    }
  }
  return plan;
}

/** Everything the Stats screen needs. */
function getStats() {
  const ss = book_();
  const today = ymd_(new Date());
  const kpis = ss.getSheetByName('Dashboard').getRange('A6:C14').getDisplayValues()
    .map(r => ({ label: r[0], value: r[1], target: r[2] }));

  const weeks = readWeeks_(ss, today, 8);

  const log = readLog_(ss);
  const types = {};
  const exercises = readExercises_(ss);
  exercises.forEach(e => { types[e.name] = e.type; });

  // Training calendar: sets per date + the main day type (Push/Pull/Legs), and the plan to the end of next week
  const days = trainDays_(log, exercises);
  const hiit = {};
  const plan = splitPlan_(days, today, addDays_(mondayOf_(today), 13), hiit);
  const strength = {};
  log.forEach(x => {
    const v = types[x.ex] === 'Reps only' || !x.e1rm ? x.r : x.e1rm;
    const m = strength[x.ex] = strength[x.ex] || {};
    m[x.date] = Math.max(m[x.date] || 0, v);
  });
  Object.keys(strength).forEach(k => {
    strength[k] = Object.keys(strength[k]).sort().map(d => [d, Math.round(strength[k][d] * 10) / 10]);
  });
  const prs = log.filter(x => x.pr).slice(-12).reverse()
    .map(x => ({ date: x.date, ex: x.ex, w: x.w, r: x.r, e1rm: x.e1rm, type: types[x.ex] || 'Weight' }));

  const body = readBody_(ss).filter(x => x.w !== '').sort((a, b) => (a.date < b.date ? -1 : 1)).slice(-120).map(x => [x.date, num_(x.w), num_(x.avg)]);
  const sleep = (sh => sh.getRange(2, 1, Math.max(sh.getLastRow() - 1, 1), 5).getValues())(ss.getSheetByName('Wearable'))
    .filter(r => r[0] instanceof Date).sort((a, b) => a[0] - b[0]).slice(-60).map(r => [ymd_(r[0]), num_(r[1]), num_(r[4])]);
  // Carbs, fat, fiber, veg+fruit, sodium tiles: 7-day averages from the Meals tab, targets from the latest 7-day average weight
  const s = settings_(ss), lastAvg = body.filter(x => x[2]).slice(-1)[0], fw = foodWeek_(readMeals_(ss), today);

  return {
    todayFood: (b => ({ kcal: b ? num_(b.kcal) : 0, protein: b ? num_(b.protein) : 0 }))(readBody_(ss).find(x => x.date === today)),
    food: { avg: fw.avg, today: fw.today, target: foodTargets_(s, lastAvg ? lastAvg[2] : s.bw) },
    cardio: (c => ({ weekMin: c.filter(x => x.date >= mondayOf_(today)).reduce((t, x) => t + x.min, 0), target: CARDIO_TARGET_MIN }))(readCardio_(ss)),
    kpis: kpis, muscles: MUSCLES, regions: REGIONS.map(r => ({ name: r[0], start: r[1], count: r[2], color: r[3] })),
    weeks: weeks, strength: strength, prs: prs, body: body, sleep: sleep, types: types, days: days, plan: plan, today: today,
    hiit: hiit, hiitDone: hiitDates_(ss),
  };
}
