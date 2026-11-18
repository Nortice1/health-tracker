/**
 * COACH WRITES: the coach proposes changes as Gemini function calls, the app shows them on a
 * confirm card, and only after he taps Save does applyCoachActions() write to the sheet.
 * Every value is checked here again, so a bad model answer can never put junk in the sheet.
 */

// A function, not a constant: DAYS / MUSCLES live in another file that may load after this one
function coachTools_() {
  return [
  {
    name: 'log_sets', description: 'Log one or more sets of ONE exercise into the Log.',
    parameters: { type: 'OBJECT', required: ['exercise', 'sets'], properties: {
      date: { type: 'STRING', description: 'YYYY-MM-DD, default today' },
      exercise: { type: 'STRING', description: 'Exact name from EXERCISES' },
      sets: { type: 'ARRAY', items: { type: 'OBJECT', required: ['reps'], properties: {
        weight: { type: 'NUMBER', description: 'kg; for Bodyweight / Reps only exercises this is ADDED kg (0 if none)' },
        reps: { type: 'INTEGER' }, rpe: { type: 'NUMBER', description: '6-10, optional' }, note: { type: 'STRING' },
      } } },
    } },
  },
  {
    name: 'log_body', description: 'Save body data for a day (fields left out keep their current value).',
    parameters: { type: 'OBJECT', properties: {
      date: { type: 'STRING', description: 'YYYY-MM-DD, default today' },
      weight: { type: 'NUMBER', description: 'kg' }, body_fat: { type: 'NUMBER', description: '%' },
      kcal: { type: 'NUMBER' }, protein: { type: 'NUMBER', description: 'grams' }, note: { type: 'STRING' },
    } },
  },
  {
    name: 'set_targets', description: 'Change targets in Settings / Dashboard. Only include what changes.',
    parameters: { type: 'OBJECT', properties: {
      default_body_weight: { type: 'NUMBER', description: 'kg, used for bodyweight lifts before body weight is logged' },
      protein_g_per_kg: { type: 'NUMBER' }, calorie_target: { type: 'NUMBER', description: 'kcal per day' },
      fat_g_per_kg: { type: 'NUMBER', description: 'carbs then fill the calories left' },
      fiber_g: { type: 'NUMBER', description: 'per day, a minimum' }, veg_fruit_servings: { type: 'NUMBER', description: 'per day, a minimum' },
      sodium_mg: { type: 'NUMBER', description: 'per day, a limit' },
      sleep_hours: { type: 'NUMBER' },
    } },
  },
  {
    name: 'upsert_exercise', description: 'Add a new exercise to the plan, or change an existing one (only include what changes).',
    parameters: { type: 'OBJECT', required: ['name'], properties: {
      name: { type: 'STRING', description: 'Existing name to edit, or the new name to add' },
      rename_to: { type: 'STRING', description: 'Only for exercises with no logged sets yet' },
      day: { type: 'STRING', enum: DAYS },
      main_muscle: { type: 'STRING', enum: MUSCLES },
      type: { type: 'STRING', enum: TYPES },
      rep_min: { type: 'INTEGER' }, rep_max: { type: 'INTEGER' },
      step_kg: { type: 'NUMBER', description: 'weight added when the top of the rep range is reached' },
      target_sets: { type: 'INTEGER' }, notes: { type: 'STRING' },
      secondary_1: { type: 'STRING', enum: MUSCLES.concat(['none']) },
      secondary_2: { type: 'STRING', enum: MUSCLES.concat(['none']) },
    } },
  },
  {
    name: 'remove_exercise', description: 'Take an exercise out of the plan. If it has history it is moved to day Other and marked retired, so old stats stay correct.',
    parameters: { type: 'OBJECT', required: ['name'], properties: { name: { type: 'STRING' } } },
  },
  {
    name: 'edit_set', description: 'Fix a logged set. Only include fields that change.',
    parameters: { type: 'OBJECT', required: ['date', 'exercise', 'set_number'], properties: {
      date: { type: 'STRING' }, exercise: { type: 'STRING' }, set_number: { type: 'INTEGER' },
      weight: { type: 'NUMBER' }, reps: { type: 'INTEGER' }, rpe: { type: 'NUMBER' }, note: { type: 'STRING' },
    } },
  },
  {
    name: 'delete_set', description: 'Delete one logged set (duplicate or mistake).',
    parameters: { type: 'OBJECT', required: ['date', 'exercise', 'set_number'], properties: {
      date: { type: 'STRING' }, exercise: { type: 'STRING' }, set_number: { type: 'INTEGER' },
    } },
  },
  {
    name: 'log_meal', description: 'Save one meal: your estimate for each item in it. The app adds the items up and ADDS the meal to the day total in Body.',
    parameters: { type: 'OBJECT', required: ['food', 'items'], properties: {
      date: { type: 'STRING', description: 'YYYY-MM-DD, default today' },
      meal: { type: 'STRING', enum: MEALS },
      food: { type: 'STRING', description: 'Short description with portions, in his words' },
      items: { type: 'ARRAY', description: 'One entry per food or drink in the meal', items: { type: 'OBJECT',
        required: ['name', 'kcal', 'protein', 'carbs', 'fat', 'fiber', 'veg', 'sodium'], properties: {
          name: { type: 'STRING', description: 'Item with its portion, e.g. "sticky rice 1.5 packs (150 g)"' },
          kcal: { type: 'NUMBER', description: 'must match 4 x protein + 4 x carbs + 9 x fat + 7 x alcohol' },
          protein: { type: 'NUMBER', description: 'grams' },
          carbs: { type: 'NUMBER', description: 'grams of total carbohydrate, fiber included (like a nutrition label)' },
          fat: { type: 'NUMBER', description: 'grams' }, fiber: { type: 'NUMBER', description: 'grams' },
          veg: { type: 'NUMBER', description: 'servings of vegetables + fruit: 1 = 80 g, about a fist; herbs, chili and garnish = 0' },
          sodium: { type: 'NUMBER', description: 'mg' },
          alcohol: { type: 'NUMBER', description: 'grams of pure alcohol, for beer / wine / spirits only' },
        } } },
      breakdown: { type: 'STRING', description: 'Shown to him under the item list the app prints, in the language of his message: your portion assumption in one short line, plus at most one tip. Do not repeat the items or numbers, and do not work out what is left today: the app adds that itself' },
    } },
  },
  {
    name: 'log_cardio', description: 'Save one cardio session (run, walk, bike, treadmill, rowing, swim...). Watch data of a weight-training session also goes here with type "Weight training": it is saved in a separate Gym sessions tab and does not count as cardio.',
    parameters: { type: 'OBJECT', required: ['type', 'minutes'], properties: {
      date: { type: 'STRING', description: 'YYYY-MM-DD, default today' },
      type: { type: 'STRING', description: 'Short name, e.g. Treadmill run, Incline walk, Bike' },
      minutes: { type: 'NUMBER' }, distance_km: { type: 'NUMBER' },
      avg_hr: { type: 'NUMBER' }, max_hr: { type: 'NUMBER' }, kcal: { type: 'NUMBER' },
      note: { type: 'STRING' },
      breakdown: { type: 'STRING', description: 'Reply shown to him, in the language of his message: short summary of the session and this week cardio minutes vs 150' },
    } },
  },
  {
    name: 'delete_cardio', description: 'Delete one saved cardio session (or, with gym true, one gym session).',
    parameters: { type: 'OBJECT', required: ['date', 'cardio_number'], properties: {
      date: { type: 'STRING' }, cardio_number: { type: 'INTEGER', description: 'order in the list for that date (1 = first)' },
      gym: { type: 'BOOLEAN', description: 'true = a session from GYM SESSIONS, not CARDIO' },
    } },
  },
  {
    name: 'delete_meal', description: 'Delete one saved meal (its kcal and protein are taken off the day total).',
    parameters: { type: 'OBJECT', required: ['date', 'meal_number'], properties: {
      date: { type: 'STRING' }, meal_number: { type: 'INTEGER', description: 'order in the list for that date (1 = first)' },
    } },
  },
  ];
}

const MEALS = ['Breakfast', 'Lunch', 'Dinner', 'Snack', 'Drink'];
const MEAL_HEAD = ['Date', 'Time', 'Meal', 'Food', 'kcal', 'Protein g', 'Carbs g', 'Fat g', 'Fiber g', 'Veg+fruit', 'Sodium mg'];
const FOOD_KEYS = ['kcal', 'protein', 'carbs', 'fat', 'fiber', 'veg', 'sodium']; // Meals E:K
const r1_ = v => Math.round(v * 10) / 10;

/** Meals tab: one row per meal the coach estimated. Made on first use. */
function mealSheet_(ss) {
  let sh = ss.getSheetByName('Meals');
  if (!sh) {
    sh = ss.insertSheet('Meals');
    sh.setFrozenRows(1);
    sh.setColumnWidth(4, 320);
    sh.getRange('A2:A').setNumberFormat('yyyy-mm-dd');
    sh.getRange('B2:B').setNumberFormat('@'); // time as text, never turned into a time value
    sh.getRange('D2:D').setNumberFormat('@');
  }
  // A tab made before fiber / veg+fruit / sodium gets the new headers on its next meal
  if (sh.getRange(1, MEAL_HEAD.length).getValue() === '') {
    sh.getRange(1, 1, 1, MEAL_HEAD.length).setValues([MEAL_HEAD]).setFontWeight('bold').setBackground('#2563eb').setFontColor('#ffffff');
  }
  return sh;
}
function readMeals_(ss) {
  const sh = ss.getSheetByName('Meals');
  if (!sh || sh.getLastRow() < 2) return [];
  const n = sh.getLastRow() - 1;
  const times = sh.getRange(2, 2, n, 1).getDisplayValues(); // as shown, even if the cell became a time value
  return sh.getRange(2, 1, n, MEAL_HEAD.length).getValues()
    .map((r, i) => ({ row: i + 2, date: ymd_(r[0]), time: times[i][0], meal: String(r[2]), food: String(r[3]), kcal: num_(r[4]), protein: num_(r[5]),
      carbs: cell_(r[6]), fat: cell_(r[7]), fiber: cell_(r[8]), veg: cell_(r[9]), sodium: cell_(r[10]) }))
    .filter(m => m.date);
}

/**
 * Totals of one log_meal call, added up by the app (Gemini's own sums were often off).
 * The coach lists each item; an item whose macros miss its kcal by more than 10% gets its carbs and fat
 * scaled to fit, so the calories stay as estimated. A call without items (older cards) counts as one item.
 * A part no item gives (old cards had no fiber, veg or sodium) stays '' (unknown), never 0.
 */
function mealTotals_(a) {
  const items = Array.isArray(a.items) && a.items.length ? a.items : null;
  if (items && items.length > 20) throw new Error('Give at most 20 items in one meal.');
  const t = { kcal: 0, protein: 0, carbs: '', fat: '', fiber: '', veg: '', sodium: '', fitted: 0, items: [] };
  (items || [a]).forEach(it => {
    const what = items ? ' (' + (it.name || 'an item') + ')' : '';
    const opt = (v, hi, label) => (has_(v) ? checkNum_(v, 0, hi, label + what) : '');
    const x = {
      name: String(it.name || '').slice(0, 120),
      kcal: checkNum_(it.kcal, 0, 5000, 'Meal calories' + what), protein: checkNum_(it.protein, 0, 300, 'Meal protein' + what),
      carbs: opt(it.carbs, 800, 'Carbs'), fat: opt(it.fat, 400, 'Fat'), fiber: opt(it.fiber, 100, 'Fiber'),
      veg: opt(it.veg, 20, 'Veg+fruit servings'), sodium: opt(it.sodium, 20000, 'Sodium'), alcohol: opt(it.alcohol, 300, 'Alcohol') || 0,
    };
    if (items && (x.carbs === '' || x.fat === '')) throw new Error('Carbs and fat are needed for every item' + what + '.');
    if (x.carbs !== '' && x.fat !== '' && fitItem_(x)) t.fitted++;
    t.kcal += x.kcal;
    t.protein += x.protein;
    ['carbs', 'fat', 'fiber', 'veg', 'sodium'].forEach(k => { if (x[k] !== '') t[k] = (t[k] || 0) + x[k]; });
    t.items.push(x);
  });
  t.kcal = Math.round(t.kcal);
  if (t.kcal > 5000) throw new Error('Meal calories must be between 0 and 5000 (got ' + t.kcal + ').');
  ['protein', 'carbs', 'fat', 'fiber', 'veg'].forEach(k => { if (t[k] !== '') t[k] = r1_(t[k]); });
  if (t.sodium !== '') t.sodium = Math.round(t.sodium);
  return t;
}
// kcal per gram: protein and carbs 4, fat 9, alcohol 7, fiber (counted inside carbs) only 2
function fitItem_(x) {
  const fiber = Math.min(num_(x.fiber), x.carbs);
  const fixed = 4 * x.protein + 2 * fiber + 7 * x.alcohol; // never changed
  const flex = 4 * (x.carbs - fiber) + 9 * x.fat; // scaled to close the gap
  if (Math.abs(x.kcal - fixed - flex) <= Math.max(0.1 * x.kcal, 15)) return false;
  if (x.kcal > fixed && flex > 0) {
    const k = (x.kcal - fixed) / flex;
    x.carbs = r1_(fiber + (x.carbs - fiber) * k);
    x.fat = r1_(x.fat * k);
  } else {
    x.kcal = Math.round(fixed + flex); // nothing to scale, or protein alone is over the kcal: the macros win
  }
  return true;
}
// "650 kcal · P 30 g · C 70 g · F 28 g · fiber 4 g · veg+fruit 1 · sodium 1200 mg" for a meal or a day; unknown parts left out
function mealText_(m) {
  const f = [Math.round(num_(m.kcal)) + ' kcal', 'P ' + r1_(num_(m.protein)) + ' g'];
  const part = (k, label, unit) => { if (m[k] !== '' && m[k] != null) f.push(label + ' ' + (k === 'sodium' ? Math.round(m[k]) : r1_(num_(m[k]))) + unit); };
  part('carbs', 'C', ' g'); part('fat', 'F', ' g'); part('fiber', 'fiber', ' g'); part('veg', 'veg+fruit', ''); part('sodium', 'sodium', ' mg');
  return f.join(' · ');
}
// Totals of a list of meals; a part none of them has (e.g. sodium before it was tracked) stays ''
function sumMeals_(list) {
  const t = {};
  FOOD_KEYS.forEach(k => {
    const v = list.filter(m => m[k] !== '' && m[k] != null);
    t[k] = v.length ? r1_(v.reduce((s, m) => s + num_(m[k]), 0)) : '';
  });
  return t;
}
// The meal reply: one line per item as it will be saved (after any fit)
function mealItemsText_(t) {
  const lines = t.items.map(x => '• ' + (x.name || 'item') + ': ' + Math.round(x.kcal) + ' kcal · P ' + r1_(x.protein) + ' · C ' + x.carbs + ' · F ' + x.fat);
  if (t.fitted) lines.push('⚖️ Carbs and fat adjusted on ' + t.fitted + ' item' + (t.fitted > 1 ? 's' : '') + ' so they match the calories.');
  return lines.join('\n');
}
// Caller holds the script lock. Body uses the same lock internally, so update it after releasing.
function writeMeal_(ss, d, meal, food, t) {
  const sh = mealSheet_(ss);
  const row = Math.max(sh.getLastRow(), 1) + 1;
  sh.getRange(row, 2).setNumberFormat('@');
  sh.getRange(row, 1, 1, MEAL_HEAD.length).setValues([[parseYmd_(d), Utilities.formatDate(new Date(), TZ, 'HH:mm'), meal, String(food).slice(0, 300)]
    .concat(FOOD_KEYS.map(k => t[k]))]);
}

// Add (or with sign -1 take off) a meal's kcal / protein from the day total in Body
function addToBody_(ss, date, kcal, protein, sign) {
  const day = readBody_(ss).find(b => b.date === date) || {};
  const r1 = v => Math.max(0, Math.round(v * 10) / 10);
  saveBody({ date: date, kcal: r1(num_(day.kcal) + sign * kcal), protein: r1(num_(day.protein) + sign * protein) });
}

const has_ = v => v !== undefined && v !== null && v !== '';
function checkNum_(v, lo, hi, what) {
  const n = Number(v);
  if (!isFinite(n) || n < lo || n > hi) throw new Error(what + ' must be between ' + lo + ' and ' + hi + ' (got ' + v + ').');
  return Math.round(n * 100) / 100;
}
function checkDate_(d) {
  const today = ymd_(new Date());
  d = has_(d) ? String(d).trim() : today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || ymd_(parseYmd_(d)) !== d) throw new Error('Bad date: ' + d);
  if (d > today) throw new Error('Date ' + d + ' is in the future.');
  return d;
}
function findEx_(exs, name) {
  const key = String(name || '').trim().toLowerCase();
  return exs.find(e => e.name.trim().toLowerCase() === key) || null;
}
function needEx_(exs, name) {
  const e = findEx_(exs, name);
  if (!e) throw new Error('"' + name + '" is not in your exercise list.');
  return e;
}
// Rows of one exercise on one date, in logged order (set_number 1 = first)
function setsOn_(ss, date, exName) { return readLog_(ss).filter(x => x.date === date && x.ex === exName); }
function nthSet_(ss, a, exs) {
  const e = needEx_(exs, a.exercise);
  const d = checkDate_(a.date);
  const rows = setsOn_(ss, d, e.name);
  const n = Math.round(Number(a.set_number));
  if (!(n >= 1 && n <= rows.length)) throw new Error(e.name + ' on ' + d + ' has ' + rows.length + ' set(s), there is no set ' + a.set_number + '.');
  return { e: e, d: d, x: rows[n - 1], n: n };
}

/** Readable card line for each proposed call. A call that already fails a check shows the problem instead. */
function describeActions_(calls) {
  if (!calls.length) return [];
  const ss = book_();
  const exs = readExercises_(ss);
  const pending = {}; // exercises added earlier in the same answer
  return calls.slice(0, 10).map(c => {
    const a = c.args || {};
    let label;
    try {
      label = describe_(c.name, a, exs, pending, ss);
    } catch (e) {
      return { name: c.name, args: a, label: '⚠️ ' + e.message, bad: true };
    }
    return { name: c.name, args: a, label: label };
  });
}

function describe_(name, a, exs, pending, ss) {
  const day = d => Utilities.formatDate(parseYmd_(checkDate_(d)), TZ, 'EEE d MMM');
  const known = n => findEx_(exs, n) || pending[String(n).trim().toLowerCase()] || null;
  if (name === 'log_sets') {
    const ex = known(a.exercise);
    const t = ex && ex.type;
    if (!t) throw new Error('"' + a.exercise + '" is not in your exercise list.');
    const sets = (a.sets || []).map(s => weightText_(t, Number(s.weight) || 0).replace(' kg', '') + '×' + s.reps + (has_(s.rpe) ? ' @' + s.rpe : '') + (s.note ? ' "' + s.note + '"' : ''));
    if (!sets.length) throw new Error('No sets given.');
    return '🏋️ Log ' + ex.name + ', ' + day(a.date) + ': ' + sets.join(', ');
  }
  if (name === 'log_body') {
    const f = [];
    if (has_(a.weight)) f.push(a.weight + ' kg');
    if (has_(a.body_fat)) f.push('BF ' + a.body_fat + '%');
    if (has_(a.kcal)) f.push(a.kcal + ' kcal');
    if (has_(a.protein)) f.push(a.protein + ' g protein');
    if (has_(a.note)) f.push('"' + a.note + '"');
    if (!f.length) throw new Error('Nothing to save.');
    return '⚖️ Body, ' + day(a.date) + ': ' + f.join(', ');
  }
  if (name === 'set_targets') {
    const f = [];
    if (has_(a.calorie_target)) f.push('calories ' + a.calorie_target + ' kcal/day');
    if (has_(a.protein_g_per_kg)) f.push('protein ' + a.protein_g_per_kg + ' g/kg');
    if (has_(a.fat_g_per_kg)) f.push('fat ' + a.fat_g_per_kg + ' g/kg');
    if (has_(a.fiber_g)) f.push('fiber ' + a.fiber_g + ' g/day');
    if (has_(a.veg_fruit_servings)) f.push('veg+fruit ' + a.veg_fruit_servings + ' servings/day');
    if (has_(a.sodium_mg)) f.push('sodium under ' + a.sodium_mg + ' mg/day');
    if (has_(a.sleep_hours)) f.push('sleep ' + a.sleep_hours + ' h');
    if (has_(a.default_body_weight)) f.push('default body weight ' + a.default_body_weight + ' kg');
    if (!f.length) throw new Error('No targets given.');
    return '🎯 Targets: ' + f.join(', ');
  }
  if (name === 'upsert_exercise') {
    const old = findEx_(exs, a.name);
    const f = [];
    if (has_(a.rename_to)) f.push('rename to ' + a.rename_to);
    if (has_(a.day)) f.push(a.day);
    if (has_(a.main_muscle)) f.push(a.main_muscle);
    if (has_(a.secondary_1) || has_(a.secondary_2)) f.push('+ ' + [a.secondary_1, a.secondary_2].filter(m => has_(m)).join('/'));
    if (has_(a.type)) f.push(a.type);
    if (has_(a.rep_min) || has_(a.rep_max)) f.push((a.rep_min || (old ? old.repMin : 8)) + '-' + (a.rep_max || (old ? old.repMax : 12)) + ' reps');
    if (has_(a.target_sets)) f.push(a.target_sets + ' sets');
    if (has_(a.step_kg)) f.push('step ' + a.step_kg + ' kg');
    if (has_(a.notes)) f.push('note "' + a.notes + '"');
    if (!old) pending[String(a.name).trim().toLowerCase()] = { name: String(a.name).trim(), type: a.type || 'Weight' };
    return (old ? '✏️ Edit ' + old.name : '➕ Add exercise ' + a.name) + (f.length ? ': ' + f.join(', ') : '');
  }
  if (name === 'remove_exercise') {
    return '🗑️ Remove ' + (findEx_(exs, a.name) || { name: a.name }).name + ' from the plan';
  }
  if (name === 'edit_set' || name === 'delete_set') {
    const e = nthSet_(ss, a, exs).e; // the set must exist, or the card says so before he taps Save
    if (name === 'delete_set') return '🗑️ Delete ' + e.name + ' set ' + a.set_number + ', ' + day(a.date);
    const f = [];
    if (has_(a.weight)) f.push(weightText_(e.type, Number(a.weight) || 0));
    if (has_(a.reps)) f.push(a.reps + ' reps');
    if (has_(a.rpe)) f.push('RPE ' + a.rpe);
    if (has_(a.note)) f.push('note "' + a.note + '"');
    if (!f.length) throw new Error('No change given.');
    return '✏️ ' + e.name + ' set ' + a.set_number + ', ' + day(a.date) + ' → ' + f.join(', ');
  }
  if (name === 'log_meal') {
    return '🍽️ ' + (a.meal || 'Meal') + ', ' + day(a.date) + ': ' + a.food + ' → ' + mealText_(mealTotals_(a));
  }
  if (name === 'log_cardio') {
    const f = [a.minutes + ' min'];
    if (has_(a.distance_km)) f.push(a.distance_km + ' km');
    if (has_(a.avg_hr)) f.push('avg HR ' + a.avg_hr);
    if (has_(a.max_hr)) f.push('max ' + a.max_hr);
    if (has_(a.kcal)) f.push(a.kcal + ' kcal');
    if (has_(a.note)) f.push('"' + a.note + '"');
    return (isGym_(a.type) ? '🏋️ ' : '🏃 ') + a.type + ', ' + day(a.date) + ': ' + f.join(', ') + (isGym_(a.type) ? ' (gym session, not cardio)' : '');
  }
  if (name === 'delete_cardio') {
    const what = a.gym === true ? 'gym session' : 'cardio';
    const c = readCardio_(ss, a.gym === true ? GYM_TAB : 'Cardio').filter(x => x.date === checkDate_(a.date))[Math.round(Number(a.cardio_number)) - 1];
    if (!c) throw new Error('No ' + what + ' ' + a.cardio_number + ' on ' + checkDate_(a.date) + ' to delete.');
    return '🗑️ Delete ' + what + ' ' + a.cardio_number + ' (' + c.type + ', ' + c.min + ' min), ' + day(a.date);
  }
  if (name === 'delete_meal') {
    const list = readMeals_(ss).filter(m => m.date === checkDate_(a.date));
    const m = list[Math.round(Number(a.meal_number)) - 1];
    if (!m) throw new Error('No meal ' + a.meal_number + ' on ' + checkDate_(a.date) + ' to delete.');
    return '🗑️ Delete meal ' + a.meal_number + ' (' + m.food + ', ' + m.kcal + ' kcal), ' + day(a.date);
  }
  throw new Error('Unknown action ' + name);
}

/** Called after he taps Save. Runs in order and stops at the first problem. */
function applyCoachActions(actions) {
  const results = [];
  for (let i = 0; i < (actions || []).length; i++) {
    const a = actions[i];
    try {
      results.push({ ok: true, msg: applyOne_(a.name, a.args || {}) });
    } catch (e) {
      results.push({ ok: false, msg: e.message });
      break;
    }
  }
  clearCoachCache_();
  return results;
}

function applyOne_(name, a) {
  const ss = book_();
  const exs = readExercises_(ss);

  if (name === 'log_sets') {
    const e = needEx_(exs, a.exercise);
    const d = checkDate_(a.date);
    const sets = (a.sets || []).map(s => {
      const w = has_(s.weight) ? checkNum_(s.weight, 0, 500, 'Weight') : 0;
      if (e.type === 'Weight' && !(w > 0)) throw new Error(e.name + ' needs a weight for every set.');
      return { date: d, ex: e.name, w: w, r: checkNum_(s.reps, 1, 100, 'Reps'), rpe: has_(s.rpe) ? checkNum_(s.rpe, 1, 10, 'RPE') : '', notes: s.note ? String(s.note).slice(0, 300) : '' };
    });
    if (!sets.length || sets.length > 20) throw new Error('Give 1 to 20 sets.');
    sets.forEach(s => saveSet(s));
    return 'Logged ' + sets.length + ' set(s) of ' + e.name;
  }

  if (name === 'log_body') {
    const p = { date: checkDate_(a.date) };
    if (has_(a.weight)) p.w = checkNum_(a.weight, 30, 250, 'Weight');
    if (has_(a.body_fat)) p.bf = checkNum_(a.body_fat, 3, 60, 'Body fat');
    if (has_(a.kcal)) p.kcal = checkNum_(a.kcal, 0, 10000, 'Calories');
    if (has_(a.protein)) p.protein = checkNum_(a.protein, 0, 500, 'Protein');
    if (has_(a.note)) p.notes = String(a.note).slice(0, 300);
    if (Object.keys(p).length < 2) throw new Error('Nothing to save.');
    saveBody(p);
    return 'Body data saved for ' + p.date;
  }

  if (name === 'set_targets') {
    const st = ss.getSheetByName('Settings');
    const put = [];
    if (has_(a.default_body_weight)) put.push([st.getRange('B2'), checkNum_(a.default_body_weight, 30, 250, 'Default body weight')]);
    if (has_(a.protein_g_per_kg)) put.push([st.getRange('B3'), checkNum_(a.protein_g_per_kg, 1.2, 3, 'Protein target')]);
    if (has_(a.calorie_target)) put.push([st.getRange('B4'), Math.round(checkNum_(a.calorie_target, 1200, 5000, 'Calorie target'))]);
    // Settings B5:B8, same order as FOOD_SETTINGS
    const food = [['fat_g_per_kg', 0.5, 2, 'Fat target'], ['fiber_g', 10, 70, 'Fiber target'], ['veg_fruit_servings', 1, 15, 'Veg + fruit target'], ['sodium_mg', 1000, 5000, 'Sodium limit']]
      .map((f, i) => (has_(a[f[0]]) ? [st.getRange(5 + i, 2), checkNum_(a[f[0]], f[1], f[2], f[3])] : null)).filter(p => p);
    if (has_(a.sleep_hours)) put.push([ss.getSheetByName('Dashboard').getRange('C13'), checkNum_(a.sleep_hours, 5, 10, 'Sleep target')]);
    if (!put.length && !food.length) throw new Error('No targets given.');
    if (food.length) addFoodSettings_(st); // labels for rows 5-8 if the tab is older than them
    put.concat(food).forEach(p => p[0].setValue(p[1]));
    return 'Targets updated';
  }

  if (name === 'upsert_exercise' || name === 'remove_exercise') {
    const lock = LockService.getScriptLock();
    lock.waitLock(15000);
    try { return name === 'upsert_exercise' ? upsertExercise_(ss, exs, a) : removeExercise_(ss, exs, a); }
    finally { lock.releaseLock(); }
  }

  if (name === 'edit_set') {
    const t = nthSet_(ss, a, exs);
    const sh = ss.getSheetByName('Log');
    if (has_(a.weight)) {
      const w = checkNum_(a.weight, 0, 500, 'Weight');
      if (t.e.type === 'Weight' && !(w > 0)) throw new Error(t.e.name + ' needs a weight.');
      sh.getRange(t.x.row, 3).setValue(w > 0 ? w : '');
    }
    if (has_(a.reps)) sh.getRange(t.x.row, 4).setValue(checkNum_(a.reps, 1, 100, 'Reps'));
    if (has_(a.rpe)) sh.getRange(t.x.row, 5).setValue(checkNum_(a.rpe, 1, 10, 'RPE'));
    if (has_(a.note)) sh.getRange(t.x.row, 6).setNumberFormat('@').setValue(String(a.note).slice(0, 300));
    return 'Fixed ' + t.e.name + ' set ' + t.n;
  }

  if (name === 'delete_set') {
    const lock = LockService.getScriptLock();
    lock.waitLock(15000);
    try {
      const t = nthSet_(ss, a, exs);
      clearLogRow_(ss.getSheetByName('Log'), t.x);
      return 'Deleted ' + t.e.name + ' set ' + t.n;
    } finally { lock.releaseLock(); }
  }

  if (name === 'log_meal') {
    const d = checkDate_(a.date);
    if (!has_(a.food)) throw new Error('What was the meal?');
    const t = mealTotals_(a);
    const meal = MEALS.indexOf(a.meal) >= 0 ? a.meal : 'Snack';
    const lock = LockService.getScriptLock();
    lock.waitLock(15000);
    try { writeMeal_(ss, d, meal, a.food, t); }
    finally { lock.releaseLock(); }
    addToBody_(ss, d, t.kcal, t.protein, 1);
    return 'Saved ' + meal.toLowerCase() + ' (' + t.kcal + ' kcal, ' + t.protein + ' g protein)';
  }

  if (name === 'log_cardio') {
    const lock = LockService.getScriptLock();
    lock.waitLock(15000);
    try { return addCardio_(ss, Object.assign({}, a, { source: 'Coach' })); } finally { lock.releaseLock(); }
  }
  if (name === 'delete_cardio') return deleteCardio_(ss, a.date, a.cardio_number, a.gym === true);

  if (name === 'delete_meal') {
    const d = checkDate_(a.date);
    const list = readMeals_(ss).filter(m => m.date === d);
    const n = Math.round(Number(a.meal_number));
    if (!(n >= 1 && n <= list.length)) throw new Error(d + ' has ' + list.length + ' meal(s), there is no meal ' + a.meal_number + '.');
    const m = list[n - 1];
    ss.getSheetByName('Meals').deleteRow(m.row);
    addToBody_(ss, d, m.kcal, m.protein, -1);
    return 'Deleted ' + m.food;
  }

  throw new Error('Unknown action ' + name);
}

function upsertExercise_(ss, exs, a) {
  const sh = ss.getSheetByName('Exercises');
  const old = findEx_(exs, a.name);
  const muscle = (m, what) => { if (MUSCLES.indexOf(m) < 0) throw new Error(what + ' "' + m + '" is not one of the muscle parts.'); return m; };
  const sec = m => (m === 'none' ? '' : muscle(m, 'Secondary muscle'));

  let row, cur;
  const names = sh.getRange(2, 1, EX_ROWS - 1, 1).getValues().map(r => String(r[0]).trim().toLowerCase());
  if (old) {
    row = names.indexOf(old.name.trim().toLowerCase()) + 2;
    cur = sh.getRange(row, 1, 1, 11).getValues()[0];
  } else {
    if (!has_(a.day) || !has_(a.main_muscle)) throw new Error('A new exercise needs a day and a main muscle.');
    row = names.indexOf('') + 2;
    if (row < 2) throw new Error('The Exercises tab is full.');
    cur = [String(a.name).trim().slice(0, 60), '', '', 'Weight', 8, 12, 2.5, 3, '', '', ''];
  }

  if (has_(a.rename_to)) {
    if (!old) throw new Error('Cannot rename an exercise that does not exist.');
    const to = String(a.rename_to).trim().slice(0, 60);
    if (findEx_(exs, to)) throw new Error('"' + to + '" already exists.');
    if (readLog_(ss).some(x => x.ex === old.name)) throw new Error(old.name + ' already has logged sets. Renaming would split its history; add a new exercise instead.');
    cur[0] = to;
  }
  if (has_(a.day)) { if (DAYS.indexOf(a.day) < 0) throw new Error('Day must be ' + DAYS.join(', ')); cur[1] = a.day; }
  if (has_(a.main_muscle)) cur[2] = muscle(a.main_muscle, 'Main muscle');
  if (has_(a.type)) { if (TYPES.indexOf(a.type) < 0) throw new Error('Type must be ' + TYPES.join(', ')); cur[3] = a.type; }
  if (has_(a.rep_min)) cur[4] = checkNum_(a.rep_min, 1, 50, 'Rep min');
  if (has_(a.rep_max)) cur[5] = checkNum_(a.rep_max, 1, 50, 'Rep max');
  if (Number(cur[4]) > Number(cur[5])) throw new Error('Rep min is higher than rep max.');
  if (has_(a.step_kg)) cur[6] = checkNum_(a.step_kg, 0, 20, 'Step');
  if (has_(a.target_sets)) cur[7] = checkNum_(a.target_sets, 1, 10, 'Target sets');
  if (has_(a.notes)) cur[8] = String(a.notes).slice(0, 200);
  if (has_(a.secondary_1)) cur[9] = sec(a.secondary_1);
  if (has_(a.secondary_2)) cur[10] = sec(a.secondary_2);

  sh.getRange(row, 1, 1, 11).setValues([cur]);
  return (old ? 'Updated ' : 'Added ') + cur[0];
}

function removeExercise_(ss, exs, a) {
  const e = needEx_(exs, a.name);
  const sh = ss.getSheetByName('Exercises');
  const names = sh.getRange(2, 1, EX_ROWS - 1, 1).getValues().map(r => String(r[0]).trim().toLowerCase());
  const row = names.indexOf(e.name.trim().toLowerCase()) + 2;
  // Old sets look up their muscle in this row, so an exercise with history is retired, never deleted
  if (readLog_(ss).some(x => x.ex === e.name)) {
    sh.getRange(row, 2).setValue('Other');
    if (!/^retired/i.test(e.notes)) sh.getRange(row, 9).setValue('Retired' + (e.notes ? '. ' + e.notes : ''));
    return e.name + ' moved to Other (kept for its history)';
  }
  sh.getRange(row, 1, 1, 11).clearContent();
  return 'Removed ' + e.name;
}
