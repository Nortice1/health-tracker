/**
 * AI COACH: Google Gemini (free tier) answering with a summary of your tracker data.
 * The API key lives in Script Properties (GEMINI_API_KEY), never in this code.
 */

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/';
const GEMINI_MODELS = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.8-flash'];
const COACH_CACHE_KEY = 'coachctx';

function geminiKey_() { return PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY') || ''; }

/** Run once from the editor after adding the coach, so Google asks for the "connect to external service" permission. */
function authorizeCoach() {
  UrlFetchApp.fetch('https://generativelanguage.googleapis.com/', { muteHttpExceptions: true });
  Logger.log('Coach can reach Gemini. API key saved: ' + (geminiKey_() ? 'yes' : 'not yet, paste it in the Coach tab of the app'));
}

function getCoachStatus() { return { hasKey: !!geminiKey_() }; }

function saveGeminiKey(key) {
  key = String(key || '').trim();
  if (!/^[A-Za-z0-9._\-]{20,}$/.test(key)) throw new Error('That does not look like a Gemini API key.');
  const test = callGemini_(key, 'Reply with OK.', [{ role: 'user', parts: [{ text: 'ping' }] }], 50);
  PropertiesService.getScriptProperties().setProperty('GEMINI_API_KEY', key);
  return { hasKey: true, model: test.model };
}

function clearCoachCache_() { CacheService.getScriptCache().remove(COACH_CACHE_KEY); }

/**
 * history: [{role: 'user'|'model', text}], focus: exercise name the user is looking at (optional),
 * image: {mime, data (base64)} photo attached to the latest message (optional, already shrunk by the app).
 */
function askCoach(history, focus, image) {
  const key = geminiKey_();
  if (!key) throw new Error('No Gemini API key yet. Paste it in the Coach tab.');

  // Gemini wants user/model turns alternating and starting with the user
  const contents = [];
  (history || []).slice(-12).forEach(m => {
    if (!m || !m.text || (m.role !== 'user' && m.role !== 'model')) return;
    const text = String(m.text).slice(0, 2000);
    const last = contents[contents.length - 1];
    if (last && last.role === m.role) last.parts[0].text += '\n' + text;
    else contents.push({ role: m.role, parts: [{ text: text }] });
  });
  while (contents.length && contents[0].role !== 'user') contents.shift();
  if (!contents.length || contents[contents.length - 1].role !== 'user') throw new Error('Type a question first.');
  if (image && image.data) {
    if (!/^image\/(jpeg|png|webp)$/.test(image.mime) || String(image.data).length > 2000000) throw new Error('That photo could not be sent. Try another one.');
    contents[contents.length - 1].parts.push({ inlineData: { mimeType: image.mime, data: String(image.data) } });
  }

  // "Meal: ..." (the 🍽️ button) must end in a save card, so force the meal tool instead of letting the model decide
  const lastUser = (history || []).filter(m => m && m.role === 'user').slice(-1)[0];
  const lastText = lastUser ? String(lastUser.text) : '';
  const forced = /^\s*(🍽️\s*)?meal\s*:/i.test(lastText) ? 'log_meal' : /^\s*(🏃\s*)?cardio\s*:/i.test(lastText) ? 'log_cardio' : '';
  const toolConfig = forced ? { functionCallingConfig: { mode: 'ANY', allowedFunctionNames: [forced] } } : undefined;

  let system = COACH_RULES + '\n\n=== DATA (from the tracker, today) ===\n' + coachContext_();
  if (focus) system += '\n\nThe user is looking at this exercise right now: ' + focus;
  // Thinking tokens count against this limit, so leave room; the rules keep the reply itself short
  const res = callGemini_(key, system, contents, 4096, coachTools_(), toolConfig);
  const actions = describeActions_(res.calls || []);
  // Meal: the app prints each item as it will be saved and adds the day totals itself, Gemini's own sums were often wrong
  const meals = actions.filter(a => a.name === 'log_meal' && !a.bad);
  const totals = meals.map(a => mealTotals_(a.args));
  const listed = totals.filter((t, i) => Array.isArray(meals[i].args.items) && meals[i].args.items.length).map(mealItemsText_).join('\n');
  if (!res.text && actions.length) {
    const withBreakdown = actions.find(a => a.args && a.args.breakdown);
    res.text = withBreakdown ? String(withBreakdown.args.breakdown) : listed ? '' : 'Here is what I will save. Check it and tap Save.';
  }
  if (listed) res.text = listed + (res.text ? '\n\n' + res.text : '');
  if (meals.length) {
    const d = checkDate_(meals[0].args.date);
    const add = {};
    totals.forEach((t, i) => {
      if (checkDate_(meals[i].args.date) === d) FOOD_KEYS.forEach(k => { add[k] = num_(add[k]) + num_(t[k]); });
    });
    res.text += '\n\n📊 ' + (d === ymd_(new Date()) ? 'Today' : d) + ' after Save: ' + foodLeft_(d, add);
  }
  if (!res.text) {
    throw new Error(res.finish === 'SAFETY' || res.finish === 'PROHIBITED_CONTENT' ? 'Gemini declined that question. Try rephrasing it.'
      : res.finish === 'MAX_TOKENS' ? 'Gemini ran out of room before answering. Ask a shorter question.' : 'Empty reply from Gemini. Try again.');
  }
  return { text: res.text, model: res.model, actions: actions };
}

/**
 * "780 / 2100 kcal → 1320 kcal left · protein 48 / 139 g → 91 g protein left" for one date, then a second line with
 * carbs, fat, fiber, veg+fruit and sodium from that day's meals. add = totals of meals not saved yet.
 */
function foodLeft_(date, add) {
  add = add || {};
  const b = getBody(date), t = b.target, day = sumMeals_(b.meals);
  const kcal = Math.round(num_(b.day && b.day.kcal) + num_(add.kcal));
  const protein = Math.round(num_(b.day && b.day.protein) + num_(add.protein));
  const part = (eaten, target, unit, what) => eaten + (target ? ' / ' + target + ' ' + unit + ' → ' +
    (eaten <= target ? (target - eaten) + ' ' + unit + what + ' left' : (eaten - target) + ' ' + unit + what + ' over') : ' ' + unit);
  const eaten = k => (k === 'veg' ? r1_ : Math.round)(num_(day[k]) + num_(add[k]));
  // Limits (carbs, fat, sodium) say what is left; minimums (fiber, veg+fruit) say what is still to go
  const limit = (label, k, unit) => label + ' ' + eaten(k) + (t[k] ? ' / ' + t[k] + unit + ' (' +
    (eaten(k) <= t[k] ? r1_(t[k] - eaten(k)) + ' left)' : r1_(eaten(k) - t[k]) + ' over)') : unit);
  const atLeast = (label, k, unit) => label + ' ' + eaten(k) + (t[k] ? ' / ' + t[k] + unit + (eaten(k) >= t[k] ? ' ✓' : ' (' + r1_(t[k] - eaten(k)) + ' to go)') : unit);
  return part(kcal, t.kcal, 'kcal', '') + ' · protein ' + part(protein, t.protein, 'g', ' protein') + '\n' +
    [limit('carbs', 'carbs', ' g'), limit('fat', 'fat', ' g'), atLeast('fiber', 'fiber', ' g'), atLeast('veg+fruit', 'veg', ''), limit('sodium', 'sodium', ' mg')].join(' · ');
}

const COACH_RULES = [
  'You are "Coach", a friendly, practical strength and health coach inside the user\'s Health Tracker app.',
  'Use the tracker data and the user\'s stated goals. Do not assume a personal background or goal.',
  'His split: Push / Pull / Legs / Rest / Push / Pull / Rest, and the exercises rotate a bit.',
  'For what to train today or next, use TRAINING PLAN (it follows his real log, not the weekday).',
  '',
  'How to answer:',
  '- Base advice on the DATA section and quote his real numbers (kg, reps, sets, g/kg, hours). Never invent data that is not there.',
  '- Keep it short for a phone screen: 2 to 6 sentences, or up to 5 short bullets. No long intro, no repeating the question.',
  '- Reply in the same language as his latest message (Thai or English). Plain, simple words.',
  '- If the data is missing or too thin to judge, say so and tell him what to log.',
  '- Text in quotes in the DATA is his own note (how a set felt, pain, sleep, mood, food). Take notes seriously, especially pain, fatigue or illness.',
  '- Recent weeks are given set by set; older history is one line per session (top set, number of sets, best e1RM). Use it to judge trends and plateaus.',
  '',
  'Rules the app uses:',
  '- Double progression: keep the weight until every target set reaches the top of the rep range, then add the weight step and restart at the bottom of the range.',
  '- Weekly hard sets: about 6-12 per muscle part, about 10-20 per whole muscle (main muscle counts 1 set, secondary 0.5).',
  '- e1RM = weight x (1 + reps/30). Bodyweight lifts include his body weight.',
  '- Fat loss pace: about 0.5-1% of body weight per week. Protein 1.6-2.2 g/kg. Fat not under about 0.6 g/kg for long.',
  '',
  'Changing data (tools):',
  '- You can propose changes with the tools: log sets, log body data, set targets, add/edit/remove exercises, fix or delete a logged set.',
  '- Nothing is saved until he taps Save on the card the app shows, so call the tool directly instead of asking "should I log it?".',
  '- Call tools only when he asks to log or change something, or says yes to your suggestion. Normal questions get a normal answer.',
  '- Always add one short sentence of text with a tool call.',
  '- Use exercise names exactly as in EXERCISES. If he did an exercise that is not there, call upsert_exercise first, then log_sets.',
  '- Dates are YYYY-MM-DD. Default to today; work out "yesterday" etc. from Today. Never a future date.',
  '- set_number = order of the set for that exercise on that date (1 = first).',
  '',
  'Meals (he often asks you to estimate a meal):',
  '- When he describes food he ate, call log_meal with one item per food or drink, each with kcal, protein, carbs (total, fiber included), fat, fiber, veg+fruit servings and sodium, plus alcohol for alcoholic drinks.',
  '- Use typical Thai portions: a plate of rice is about 1.5 cups / 300 kcal / 65 g carbs; street food is often oily; a bowl of noodle soup with broth has about 1500-2000 mg sodium; 1 veg+fruit serving is 80 g (about a fist), herbs and garnish count 0.',
  '- Every item must add up: kcal = 4 x protein + 4 x carbs + 9 x fat (+ 7 x alcohol). The app adds the items up itself and fixes items that do not add up.',
  '- breakdown = your portion assumption in one short line, plus at most one tip. The app prints the items and the day totals, so do not repeat the numbers. Do not ask about portions unless the size really changes the answer a lot; state your assumption instead.',
  '- Do NOT work out what is left for today in a meal reply: the app adds the exact totals under it. One tip is fine.',
  '- When he asks what is left, quote LEFT TODAY exactly. Never add up calories or macros yourself.',
  '- Targets are in SETTINGS: calories, carbs, fat and sodium are limits; protein, fiber and veg+fruit are minimums. For fat loss, calories and protein matter most; carbs vs fat is his choice within the targets.',
  '- A new meal is ONE log_meal call. Never call delete_meal, delete_set or edit_set unless he clearly asks to remove or fix something.',
  '- With a photo: identify each food and estimate the portion from the plate, cutlery and hands. Say what you assumed. A nutrition label: use its numbers times the amount eaten.',
  '- Pick the meal from the time now if he does not say: before 10:30 Breakfast, 10:30-15:00 Lunch, 15:00-17:00 Snack, after 17:00 Dinner. Use log_body for kcal/protein only when he gives a whole-day total.',
  '',
  'Cardio:',
  '- When he tells you about a cardio session (or sends a photo of a treadmill / Fitbit screen), call log_cardio with the numbers you can read. Do not guess HR or distance.',
  '- Weekly target about 150 min. Keep hard cardio away from the day before / after leg day when you can; easy walking is fine any day.',
  '- For fat loss, extra walking (steps) is the easiest win; count cardio calories conservatively, watches often overestimate.',
  '- For a calorie target you need his weight trend, height, age, sex and activity; ask for what is missing before calling set_targets.',
  '- Lines like [Changes proposed: ... | saved] in the chat show what happened to your earlier proposals (saved, cancelled or failed).',
  '',
  'Safety: you are not a doctor. For sharp or joint pain, chest pain, dizziness or injury, tell him to stop and see a professional.',
  'No crash diets, no supplements or drugs beyond basics (protein, creatine, caffeine).',
].join('\n');

/**
 * Text summary of the tracker for the model: full detail (with notes) for the last 28 days,
 * one line per session for the last year, 12 weeks of muscle volume, body + wearable history.
 * Cached 2 min (so edits made straight in the sheet show up soon), cleared whenever the app saves a set or body entry.
 */
function coachContext_() {
  const cache = CacheService.getScriptCache();
  const today = ymd_(new Date());
  const hit = cache.get(COACH_CACHE_KEY);
  if (hit) {
    const c = JSON.parse(hit);
    if (c.date === today) return c.text;
  }

  const ss = book_();
  const log = readLog_(ss);
  const train = getTrain(today);
  const types = {};
  train.exercises.forEach(e => { types[e.name] = e.type; });
  const setTxt = (ex, w, r) => {
    const t = types[ex] || 'Weight';
    w = Math.round(w * 100) / 100;
    if (t === 'Weight') return w + 'x' + r;
    if (t === 'Bodyweight') return (w ? 'BW+' + w : 'BW') + 'x' + r;
    return (w ? '+' + w + 'kg ' : '') + r + 'reps';
  };
  const daysAgo = n => ymd_(new Date(Date.now() - n * 86400000));
  const recentFrom = daysAgo(28), yearFrom = daysAgo(365);
  const note = s => (s ? ' "' + String(s).replace(/\s+/g, ' ').slice(0, 200) + '"' : '');
  const L = [];

  L.push('Today: ' + Utilities.formatDate(new Date(), TZ, 'EEE d MMM yyyy') + ' = ' + today + ', time now ' + Utilities.formatDate(new Date(), TZ, 'HH:mm') + ' (Bangkok)');

  // Rolling split plan (same as the app's Stats card): last 7 days, today, next 7 days
  const days = trainDays_(log, readExercises_(ss));
  const hiit = {}, hiitDone = hiitDates_(ss);
  const plan = splitPlan_(days, today, addDays_(today, 7), hiit);
  // Slot 7 is a Rest with his weekly HIIT 4x4 (a Cardio row, not a Log session)
  const planOf = d => (hiit[d] ? 'Rest + HIIT 4x4' : plan[d]);
  const didHiit = d => (hiit[d] && hiitDone[d] ? ', did HIIT' : '');
  const dayName = d => Utilities.formatDate(parseYmd_(d), TZ, 'EEE d MMM');
  const past = [];
  for (let i = 7; i >= 1; i--) {
    const d = addDays_(today, -i), v = days[d], p = plan[d];
    if (!p && !v) continue; // before his first logged workout
    past.push(dayName(d) + ' ' + (v ? 'did ' + v[1] + ' (' + v[0] + ' sets)' + (p !== v[1] ? ', plan was ' + planOf(d) : '') : p === 'Rest' ? planOf(d) : 'MISSED ' + p) + didHiit(d));
  }
  const next = [];
  for (let i = 1; i <= 7; i++) next.push(dayName(addDays_(today, i)) + ' ' + planOf(addDays_(today, i)));
  L.push('', 'TRAINING PLAN (rolling split re-planned from his log every day; a missed workout moves to the next day; the app shows him this same plan):');
  L.push('- Today: ' + (days[today] ? 'done, ' + days[today][1] + ' (' + days[today][0] + ' sets)' + didHiit(today) : planOf(today) + (didHiit(today) || ' (not logged yet)')));
  if (past.length) L.push('- Last 7 days: ' + past.join('; '));
  L.push('- Next 7 days: ' + next.join('; '));

  L.push('', 'DASHBOARD (this week / 7-day averages):');
  ss.getSheetByName('Dashboard').getRange('A6:C14').getDisplayValues().forEach(k => {
    if (k[0]) L.push('- ' + k[0] + ': ' + (k[1] || '-') + (k[2] ? ' (target ' + k[2] + ')' : ''));
  });

  const s = settings_(ss);
  L.push('', 'SETTINGS: default body weight ' + s.bw + ' kg, protein target ' + s.proteinPerKg + ' g/kg, fat target ' + s.fatPerKg +
    ' g/kg (carbs fill the remaining calories), calorie target ' + s.kcal + ' kcal/day, fiber at least ' + s.fiber + ' g/day, veg+fruit at least ' + s.veg +
    ' servings/day, sodium under ' + s.sodium + ' mg/day, sleep target ' + ss.getSheetByName('Dashboard').getRange('C13').getValue() + ' h');

  const allMeals = readMeals_(ss);
  const meals = allMeals.filter(m => m.date >= daysAgo(7));
  const todayMeals = meals.filter(m => m.date === today);
  L.push('', 'MEALS TODAY (number. time meal: food, kcal, protein P, carbs C, fat F, fiber, veg+fruit servings, sodium):' + (todayMeals.length ? '' : ' none yet'));
  todayMeals.forEach((m, i) => L.push((i + 1) + '. ' + m.time + ' ' + m.meal + ': ' + m.food + ', ' + mealText_(m)));
  if (todayMeals.length) L.push('Total today so far: ' + mealText_(sumMeals_(todayMeals)));
  L.push('LEFT TODAY (worked out by the app from the saved day total, quote it as is): ' + foodLeft_(today));
  const older = meals.filter(m => m.date < today);
  if (older.length) L.push('MEALS, last 7 days: ' + older.map(m => m.date + ' ' + m.meal + ' ' + m.food + ' ' + m.kcal + 'kcal/' + m.protein + 'g').join('; '));
  const fw = foodWeek_(allMeals, today);
  if (fw.days.length) {
    L.push('FOOD PER DAY from the meals, last 7 full days:');
    fw.days.forEach(d => L.push('- ' + d[0] + ': ' + mealText_(d[1])));
    L.push('Average per day: ' + mealText_(fw.avg) + ' (fiber, veg+fruit and sodium only over the days that have them)');
  }

  const cardio = readCardio_(ss).filter(c => c.date >= recentFrom);
  const cmon = mondayOf_(today);
  L.push('', 'CARDIO, last 28 days (number per date. start type: minutes, km, avg/max HR, kcal, source, "note"); this week so far: ' +
    cardio.filter(c => c.date >= cmon).reduce((s, c) => s + c.min, 0) + ' of ' + CARDIO_TARGET_MIN + ' min' + (cardio.length ? '' : '. None logged'));
  const cardioLine = (list) => {
    const perDay = {};
    list.forEach(c => {
      perDay[c.date] = (perDay[c.date] || 0) + 1;
      L.push('- ' + c.date + ' #' + perDay[c.date] + ' ' + (c.start ? c.start + ' ' : '') + c.type + ': ' + c.min + ' min' + (c.km !== '' ? ', ' + c.km + ' km' : '') +
        (c.avg !== '' ? ', HR ' + c.avg + (c.max !== '' ? '/' + c.max : '') : '') + (c.kcal !== '' ? ', ' + c.kcal + ' kcal' : '') + ', ' + c.source + note(c.notes));
    });
  };
  cardioLine(cardio);
  const gym = readCardio_(ss, GYM_TAB).filter(c => c.date >= recentFrom);
  if (gym.length) {
    L.push('', 'GYM SESSIONS (watch data for weight-training days, NOT cardio; compare with the sets logged that date), last 28 days, same format:');
    cardioLine(gym);
  }

  L.push('', 'HARD SETS PER MUSCLE PER WEEK, last 12 weeks, oldest first (main muscle 1, secondary 0.5).',
    'Columns: ' + MUSCLES.join(', ') + ' | total sets | PRs | tonnage kg');
  readWeeks_(ss, today, 12).forEach(w => {
    // The newest week is usually unfinished: say so, or a Monday looks like a week of skipped muscles
    const day = Math.round((parseYmd_(today) - parseYmd_(w.week)) / 86400000) + 1;
    const tag = day <= 7 ? ' (THIS WEEK, in progress: day ' + day + ' of 7)' : '';
    L.push('- week of ' + w.week + tag + ': ' + w.sets.join(', ') +
      ' | ' + w.total + ' | ' + w.prs + ' | ' + Math.round(w.tonnage));
  });

  L.push('', 'EXERCISES (plan, last session, next target, best ever):');
  train.exercises.forEach(e => {
    L.push('- ' + e.name + ' [' + e.day + ', ' + e.muscle + (e.sec.length ? ' + ' + e.sec.join('/') : '') + ', ' +
      e.repMin + '-' + e.repMax + ' reps x' + e.sets + ' sets, step ' + e.step + ' kg' + (e.notes ? ', note: ' + e.notes : '') + ']: ' +
      (e.lastDate ? 'last ' + e.lastDate + ' ' + e.lastSets.map(s => setTxt(e.name, s[0], s[1])).join(', ') : 'no history') +
      '; next: ' + e.target + (e.best ? '; best ' + (e.type === 'Reps only' ? e.best + ' reps' : 'e1RM ' + e.best + ' kg') : '') +
      (e.today.length ? '; TODAY ' + e.today.map(s => setTxt(e.name, s.w, s.r)).join(', ') : ''));
  });

  // Last 28 days: every set, with RPE, PR flag and his notes
  const byDate = {};
  log.filter(x => x.date >= recentFrom).forEach(x => {
    const d = byDate[x.date] = byDate[x.date] || {};
    (d[x.ex] = d[x.ex] || []).push(setTxt(x.ex, x.w, x.r) + (x.rpe ? '@' + x.rpe : '') + (x.pr ? ' PR' : '') + note(x.notes));
  });
  const dates = Object.keys(byDate).sort();
  L.push('', 'WORKOUTS, last 28 days, every set (weight x reps @RPE, "his note"):' + (dates.length ? '' : ' none logged'));
  dates.forEach(d => L.push('- ' + d + ': ' + Object.keys(byDate[d]).map(ex => ex + ' ' + byDate[d][ex].join(', ')).join('; ')));

  // Older history: one entry per session (top set, number of sets, best e1RM or reps)
  const sess = {}, oldNotes = [];
  log.filter(x => x.date < recentFrom && x.date >= yearFrom).forEach(x => {
    const byEx = sess[x.ex] = sess[x.ex] || {};
    const s = byEx[x.date] = byEx[x.date] || { n: 0, w: -1, r: 0, best: 0 };
    s.n++;
    if (x.w > s.w || (x.w === s.w && x.r > s.r)) { s.w = x.w; s.r = x.r; }
    s.best = Math.max(s.best, types[x.ex] === 'Reps only' || !x.e1rm ? x.r : x.e1rm);
    if (x.notes) oldNotes.push(x.date + ' ' + x.ex + note(x.notes));
  });
  const exNames = Object.keys(sess).sort();
  if (exNames.length) {
    L.push('', 'OLDER SESSIONS (28 days to 1 year ago), per exercise: date top-set xN sets, best e1RM kg (or reps):');
    exNames.forEach(ex => {
      const ds = Object.keys(sess[ex]).sort().slice(-40);
      L.push('- ' + ex + ': ' + ds.map(d => {
        const s = sess[ex][d];
        return d + ' ' + setTxt(ex, s.w, s.r) + ' x' + s.n + ' ' + (types[ex] === 'Reps only' ? s.best + 'reps' : Math.round(s.best * 10) / 10);
      }).join('; '));
    });
  }
  if (oldNotes.length) L.push('', 'OLDER SET NOTES: ' + oldNotes.slice(-60).join('; '));

  // Body: daily for 28 days, weekly averages before that, body fat and body notes for the year
  const body = readBody_(ss).filter(b => b.date >= yearFrom).sort((a, b) => (a.date < b.date ? -1 : 1));
  const recentBody = body.filter(b => b.date >= recentFrom);
  if (recentBody.length) {
    L.push('', 'BODY, last 28 days (date: weight / 7-day avg kg, body fat %, kcal, protein g, g/kg, "note"):');
    recentBody.forEach(b => L.push('- ' + b.date + ': ' + (b.w ? Math.round(b.w * 100) / 100 : '-') + '/' + (b.avg ? Number(b.avg).toFixed(1) : '-') +
      (b.bf ? ', BF ' + b.bf + '%' : '') + (b.kcal ? ', ' + b.kcal + ' kcal' : '') +
      (b.protein ? ', ' + b.protein + ' g protein' : '') + (b.gkg ? ' (' + b.gkg + ' g/kg)' : '') + note(b.notes)));
  }
  const olderBody = body.filter(b => b.date < recentFrom);
  if (olderBody.length) {
    const wk = {};
    olderBody.forEach(b => {
      const d = parseYmd_(b.date);
      const mon = ymd_(new Date(d.getFullYear(), d.getMonth(), d.getDate() - (d.getDay() + 6) % 7));
      const a = wk[mon] = wk[mon] || { w: [], kcal: [], p: [] };
      if (b.w !== '') a.w.push(Number(b.w));
      if (b.kcal !== '') a.kcal.push(Number(b.kcal));
      if (b.protein !== '') a.p.push(Number(b.protein));
    });
    const avg = a => (a.length ? Math.round(a.reduce((s, v) => s + v, 0) / a.length * 10) / 10 : '-');
    L.push('', 'BODY, weekly averages before that (week of: weight kg, kcal, protein g):');
    Object.keys(wk).sort().forEach(m => L.push('- ' + m + ': ' + avg(wk[m].w) + ', ' + avg(wk[m].kcal) + ', ' + avg(wk[m].p)));
    const bf = olderBody.filter(b => b.bf !== '').map(b => b.date + ' ' + b.bf + '%');
    if (bf.length) L.push('Body fat history: ' + bf.join(', '));
    const bn = olderBody.filter(b => b.notes).map(b => b.date + note(b.notes));
    if (bn.length) L.push('Older body notes: ' + bn.slice(-40).join('; '));
  }

  // Wearable (Fitbit): last 28 days
  const wsh = ss.getSheetByName('Wearable');
  const wear = wsh.getRange(2, 1, Math.max(wsh.getLastRow() - 1, 1), 9).getValues()
    .filter(r => r[0] instanceof Date && ymd_(r[0]) >= recentFrom).sort((a, b) => a[0] - b[0]);
  if (wear.length) {
    L.push('', 'WEARABLE, last 28 days (date: sleep h, deep h, REM h, resting HR, HRV ms, steps, active zone min, calories out kcal):');
    wear.forEach(r => L.push('- ' + ymd_(r[0]) + ': ' + [1, 2, 3, 4, 5, 6, 7, 8].map(i => (r[i] === '' ? '-' : cell_(r[i]))).join(', ')));
  }

  const prs = log.filter(x => x.pr).slice(-10).reverse();
  if (prs.length) L.push('', 'RECENT PRs: ' + prs.map(p => p.date + ' ' + p.ex + ' ' + setTxt(p.ex, p.w, p.r)).join('; '));

  const text = L.join('\n');
  try { cache.put(COACH_CACHE_KEY, JSON.stringify({ date: today, text: text }), 120); } catch (e) { } // too big for the cache: rebuild next time
  return text;
}

function callGemini_(key, system, contents, maxTokens, tools, toolConfig) {
  const props = PropertiesService.getScriptProperties();
  const preferred = props.getProperty('GEMINI_MODEL');
  const models = preferred ? [preferred].concat(GEMINI_MODELS.filter(m => m !== preferred)) : GEMINI_MODELS;
  let lastErr = '', busy = false, missing = false;
  for (let i = 0; i < models.length; i++) {
    const model = models[i];
    const res = UrlFetchApp.fetch(GEMINI_URL + model + ':generateContent', {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { 'x-goog-api-key': key },
      payload: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: contents,
        generationConfig: { maxOutputTokens: maxTokens || 800 },
        tools: tools ? [{ functionDeclarations: tools }] : undefined,
        toolConfig: toolConfig,
      }),
    });
    const code = res.getResponseCode();
    let body = {};
    try { body = JSON.parse(res.getContentText()); } catch (e) { }
    if (code === 200) {
      // Switch the default only when the old model is gone; a busy model stays first choice next time
      if (missing && preferred !== model) props.setProperty('GEMINI_MODEL', model);
      const cand = (body.candidates || [])[0];
      const parts = cand && cand.content && cand.content.parts ? cand.content.parts : [];
      return {
        text: parts.filter(p => p.text && !p.thought).map(p => p.text).join('').trim(),
        model: model,
        calls: parts.filter(p => p.functionCall).map(p => ({ name: p.functionCall.name, args: p.functionCall.args || {} })),
        finish: cand ? cand.finishReason : (body.promptFeedback && body.promptFeedback.blockReason),
      };
    }
    const msg = body.error && body.error.message ? body.error.message : 'HTTP ' + code;
    if (code === 404) { missing = true; lastErr = msg; continue; } // this model no longer exists, try the next one
    // Free quota is counted per model, and "overloaded" errors are common: try the next model
    if (code === 429 || code === 500 || code === 503) { busy = true; lastErr = msg; continue; }
    if (code === 400 && /api key/i.test(msg)) throw new Error('Gemini rejected the API key. Paste a new one in the Coach tab.');
    if (code === 403) throw new Error('This API key is not allowed to use Gemini: ' + msg);
    throw new Error('Gemini error: ' + msg);
  }
  if (busy) throw new Error('Gemini is busy or the free limit is used up on every model. Wait a minute and try again.');
  throw new Error('No Gemini model available: ' + lastErr);
}
