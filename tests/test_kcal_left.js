// "Calories left" (and carbs / fat / fiber / veg+fruit / sodium) must come from the app's own math, never from Gemini's arithmetic.
// Data shaped like 2026-10-16: lunch 650/46 + rice 130/2 = 780 kcal / 48 g, target 2100 kcal, protein 2 g/kg x 69.4 kg = 139 g.
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
        if (r === 'B2:B8') return { getValues: () => [[72], [2], [2100], [0.8], [30], [5], [2000]] };
        if (r === 'C13') return { getValue: () => 7.5 };
        return { getDisplayValues: () => [['Avg calories, last 7 full days', '2051', '2100']] };
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

const EX = [['Incline Bench Press', 'Push', 'Upper chest', 'Weight', 6, 10, 2.5, 3, '', 'Front delts', 'Triceps']];
const sheets = {
  Log: sheet([[day(1), 'Incline Bench Press', 40, 8, 8, '', day(1), 'Incline Bench Press', 1, 'Upper chest', 40, 50.7, 320, '', 40, 'Front delts', 'Triceps']]),
  Exercises: sheet(EX, 200), Weekly: sheet([], 105), Dashboard: sheet([]), Settings: sheet([]), Cardio: sheet([]), Wearable: sheet([]),
  Body: sheet([[day(1), 69.9, 69.6, '', 2030, 136, 1.95], [day(0), 68.5, 69.4, '', 780, 48, 0.7]], 1500),
  Meals: sheet([[day(1), '19:39', 'Snack', 'Whey 1 scoop', 120, 24, 3, 1.5],
    [day(0), '11:02', 'Lunch', 'green curry salmon + brown rice', 650, 46, 55, 28], [day(0), '11:11', 'Lunch', 'extra rice', 130, 2, 28, 0.5]]),
};

// Fake Gemini: logs a 300 kcal / 20 g snack as two items and gets the "left" math wrong on purpose (forgets this meal)
const geminiReply = { candidates: [{ finishReason: 'STOP', content: { parts: [{ functionCall: { name: 'log_meal', args: {
  meal: 'Snack', food: 'banana + soy milk', items: [
    { name: 'banana 1 (120 g)', kcal: 105, protein: 1, carbs: 27, fat: 0.3, fiber: 3, veg: 1, sodium: 1 },
    { name: 'soy milk 1 glass (300 ml)', kcal: 195, protein: 19, carbs: 10, fat: 9, fiber: 1, veg: 0, sodium: 120 }],
  breakdown: 'Assumed a medium banana. You have 1320 kcal and 91 g protein left today.' } } }] } }] };

const g = {
  SpreadsheetApp: { openById: () => ({ getSheetByName: n => sheets[n] }), flush() {} },
  Utilities: {
    formatDate: (d, tz, f) => f === 'yyyy-MM-dd' ? d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
      : f === 'HH:mm' ? '15:00' : d.toDateString(),
  },
  CacheService: { getScriptCache: () => ({ get: () => null, put() {}, remove() {} }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k === 'GEMINI_API_KEY' ? 'k'.repeat(30) : ''), setProperty() {} }) },
  UrlFetchApp: { fetch: () => ({ getResponseCode: () => 200, getContentText: () => JSON.stringify(geminiReply) }) },
  HtmlService: {}, LockService: {}, Logger: { log() {} }, Charts: {},
};
const api = new Function(...Object.keys(g), src + '\nreturn { coachContext_, askCoach };')(...Object.values(g));

let fails = 0;
const check = (what, ok, show) => { console.log((ok ? 'PASS ' : 'FAIL ') + what); if (!ok) { fails++; console.log('   got: ' + show); } };

const ctx = api.coachContext_();
const leftLine = ctx.split('\n').find(l => /left/i.test(l) && /kcal/.test(l)) || '(no line)';
check('context states 1320 kcal left (2100 - 780)', /\b1320 kcal left/.test(leftLine), leftLine);
check('context states 91 g protein left (139 - 48)', /\b91 g protein left/.test(leftLine), leftLine);
// Targets: fat 0.8 x 69.4 = 56 g, carbs fill the rest: (2100 - 4 x 139 - 9 x 56) / 4 = 260 g. Meals today: carbs 55 + 28, fat 28 + 0.5
const macroLine = ctx.split('\n')[ctx.split('\n').indexOf(leftLine) + 1] || '(no line)';
check('context: carbs 83 / 260 g, 177 left', /^carbs 83 \/ 260 g \(177 left\)/.test(macroLine), macroLine);
check('context: fat 29 / 56 g, 27 left', /fat 29 \/ 56 g \(27 left\)/.test(macroLine), macroLine);
check('context: no fiber in old meals, 30 g still to go', /fiber 0 \/ 30 g \(30 to go\)/.test(macroLine), macroLine);
check('context: settings line has the new targets', /fat target 0.8 g\/kg .*fiber at least 30 g\/day, veg\+fruit at least 5 servings\/day, sodium under 2000 mg/.test(ctx), '(missing)');

const res = api.askCoach([{ role: 'user', text: 'Meal: banana and soy milk' }], '', null);
const lines = res.text.split('\n');
const appLine = lines.find(l => /^📊/.test(l)) || '(no line)';
check('meal reply says 1020 kcal left after this meal (2100 - 780 - 300)', /\b1020 kcal left/.test(appLine), appLine);
check('meal reply says 71 g protein left after this meal (139 - 48 - 20)', /\b71 g protein left/.test(appLine), appLine);
check('app lines come last, under Gemini\'s text', /📊 Today after Save: 1080 \/ 2100 kcal/.test(lines[lines.length - 2]) && /^carbs /.test(lines[lines.length - 1]), res.text.replace(/\n/g, ' | '));
// This meal adds carbs 37, fat 9.3, fiber 4, veg+fruit 1, sodium 121
check('meal reply: carbs 120 / 260 g, 140 left', /carbs 120 \/ 260 g \(140 left\)/.test(lines[lines.length - 1]), lines[lines.length - 1]);
check('meal reply: fat 38 / 56 g, 18 left', /fat 38 \/ 56 g \(18 left\)/.test(lines[lines.length - 1]), lines[lines.length - 1]);
check('meal reply: fiber, veg+fruit and sodium', /fiber 4 \/ 30 g \(26 to go\) · veg\+fruit 1 \/ 5 \(4 to go\) · sodium 121 \/ 2000 mg \(1879 left\)/.test(lines[lines.length - 1]), lines[lines.length - 1]);
check('the app prints the items first, then Gemini\'s note', /^• banana 1 \(120 g\): 105 kcal · P 1 · C 27 · F 0.3$/.test(lines[0]) && /^• soy milk/.test(lines[1]) && /^Assumed a medium banana/.test(lines[3]), res.text.replace(/\n/g, ' | '));
check('nothing adjusted when the items add up', !/adjusted/.test(res.text), res.text.replace(/\n/g, ' | '));
check('card shows the app totals', /→ 300 kcal · P 20 g · C 37 g · F 9.3 g · fiber 4 g · veg\+fruit 1 · sodium 121 mg$/.test(res.actions[0].label), res.actions[0].label);
check('Gemini is no longer asked to work out what is left', !/then what is left/.test(src) && /Do NOT work out what is left/.test(src), '(old instruction still there)');
check('save card still offered', res.actions.length === 1 && res.actions[0].name === 'log_meal' && !res.actions[0].bad, JSON.stringify(res.actions));

console.log(fails ? '\n' + fails + ' failed' : '\nall passed');
process.exitCode = fails ? 1 : 0;
