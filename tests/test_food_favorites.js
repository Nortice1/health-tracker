// Offline only: server persistence, exact nutrition, failure paths and UI interactions.
const fs = require('fs'), assert = require('assert');
const dir = __dirname + '/../app/';
const src = ['setup_health_tracker.gs', 'webapp.gs', 'coach_actions.gs'].map(f => fs.readFileSync(dir + f, 'utf8')).join('\n');
let raw = '', failStore = false, failWrite = false, failBody = false, writes = [], totals = [], cache = 0, locked = false;
const meal = { date: '2026-11-04', time: '08:00', meal: 'Snack', food: '<img src=x onerror=alert(1)> นม', kcal: 121, protein: 24.3, carbs: 3.7, fat: 1.23, fiber: '', veg: 0, sodium: '' };
let meals = [meal];
const mocks = {
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => raw, setProperty: (k, v) => { if (failStore) throw Error('storage failed'); raw = v; } }) },
  Utilities: { getUuid: () => 'favorite-1', formatDate: (d, tz, fmt) => fmt === 'HH:mm' ? '17:42' : d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') },
  LockService: { getScriptLock: () => ({ waitLock() { assert(!locked); locked = true; }, releaseLock() { locked = false; } }) },
};
const api = new Function(...Object.keys(mocks), 'testMeals', 'testWrite', 'testBody', 'testCache', src + `
book_ = () => ({});
readMeals_ = () => testMeals();
getBody = d => ({ date: d, favorites: readFoodFavorites_() });
writeMeal_ = (ss, d, meal, food, t) => testWrite(d, meal, food, t);
addToBody_ = (ss, d, k, p) => testBody(d, k, p);
clearCoachCache_ = () => testCache();
return { saveFoodFavorite, removeFoodFavorite, logFoodFavorite, readFoodFavorites_ };
`)(...Object.values(mocks), () => meals,
(d, m, food, t) => { if (failWrite) throw Error('write failed'); writes.push({ d, m, food, t: { ...t } }); },
(d, k, p) => { assert(!locked); if (failBody) throw Error('body failed'); totals.push([d, k, p]); }, () => cache++);
assert.deepStrictEqual(api.readFoodFavorites_(), []);
api.saveFoodFavorite('2026-11-04', 1, meal);
const f = api.readFoodFavorites_()[0];
assert.equal(f.food, meal.food); assert.equal(f.fiber, ''); assert.equal(f.sodium, ''); assert.equal(f.veg, 0);
api.saveFoodFavorite('2026-11-04', 1, meal); assert.equal(api.readFoodFavorites_().length, 1);
api.logFoodFavorite(f.id, '2026-11-03');
assert.equal(writes[0].d, '2026-11-03'); assert.equal(writes[0].t.fat, 1.23); assert.equal(writes[0].t.fiber, '');
assert.deepStrictEqual(totals[0], ['2026-11-03', 121, 24.3]); assert.equal(cache, 1);
assert.throws(() => api.logFoodFavorite('missing', '2026-11-03'), /no longer exists/);
assert.throws(() => api.logFoodFavorite(f.id, 'not-a-date'));
assert.throws(() => api.logFoodFavorite(f.id, '2026-02-30'), /Bad date/);
assert.throws(() => api.logFoodFavorite(f.id, '2999-01-01'), /future/);
assert.throws(() => api.saveFoodFavorite('2026-11-04', 1, null), /changed/);
assert.throws(() => api.saveFoodFavorite('2026-11-04', 1, { ...meal, food: 'stale' }), /changed/);
meals = []; assert.throws(() => api.saveFoodFavorite('2026-11-04', 1, meal), /changed/); meals = [meal];
failStore = true; assert.throws(() => api.removeFoodFavorite(f.id, '2026-11-04'), /storage failed/); assert.equal(api.readFoodFavorites_().length, 1); failStore = false;
failWrite = true; const before = totals.length;
assert.throws(() => api.logFoodFavorite(f.id, '2026-11-03'), /write failed/); assert.equal(totals.length, before); assert(!locked); failWrite = false;
failBody = true; assert.throws(() => api.logFoodFavorite(f.id, '2026-11-03'), /Meal was logged.*Do not tap Log again/); failBody = false;
api.removeFoodFavorite(f.id, '2026-11-04'); assert.equal(api.readFoodFavorites_().length, 0); assert.equal(writes.length, 2);
// Size limit uses UTF-8 byte count, not JS string length.
raw = JSON.stringify([{ ...f, food: 'ก'.repeat(2800) }]);
assert.throws(() => api.saveFoodFavorite('2026-11-04', 1, meal), /full/);
raw = ''; meals = [{ ...meal, carbs: '', fat: '', fiber: '', veg: '', sodium: '' }];
api.saveFoodFavorite('2026-11-04', 1, meals[0]); api.logFoodFavorite(f.id, '2026-11-03');
['carbs', 'fat', 'fiber', 'veg', 'sodium'].forEach(k => assert.equal(writes.at(-1).t[k], ''));
let rowValues;
const writer = new Function('Utilities', src + `
mealSheet_ = () => ({ getLastRow: () => 5, getRange: (r, c) => ({ setNumberFormat() {}, setValues(v) { Utilities.capture(r, c, v); } }) });
return writeMeal_;
`)({ ...mocks.Utilities, capture(r, c, v) { assert.equal(r, 6); assert.equal(c, 1); rowValues = v[0]; } });
writer({}, '2026-11-03', meal.meal, meal.food, { ...meal, fiber: '', sodium: '' });
assert.equal(rowValues[0].getDate(), 3); assert.equal(rowValues[1], '17:42');
assert.equal(rowValues[7], 1.23); assert.equal(rowValues[8], ''); assert.equal(rowValues[10], '');
console.log('PASS server persistence, duplicate saves, exact/unknown nutrition, stale/missing foods, dates, capacity, shared writer and write failures');

const html = fs.readFileSync(dir + 'Index.html', 'utf8');
const bodyCode = html.slice(html.indexOf('let foodFavoriteBusy'), html.indexOf("$('b-save').onclick"));
const elements = new Map();
function button(dataset) { return { dataset, disabled: false }; }
const container = { innerHTML: '', buttons: [], querySelectorAll(sel) {
  if (sel.includes(',')) return this.buttons;
  const key = sel.match(/data-([a-z]+)/)[1]; return this.buttons.filter(b => key in b.dataset);
} };
Object.defineProperty(container, 'innerHTML', { set(v) {
  this.markup = v; this.buttons = [...v.matchAll(/data-(savefood|logfood|removefood)="(\d+)"/g)].map(m => button({ [m[1]]: m[2] }));
}, get() { return this.markup; } });
elements.set('b-meals', container); elements.set('b-addmeal', {});
let calls = [], pending, confirms = 0, allowRemove = false, errors = 0, rendered = 0;
const state = { date: '2026-11-05', stats: {} };
const ui = new Function('$', 'S', 'esc', 'css', 'api', 'renderBody', 'toast', 'fail', 'confirm', bodyCode + '\nreturn {renderMeals};')(
  id => elements.get(id), state, v => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'), () => '#fff',
  (...args) => { calls.push(args); return new Promise((resolve, reject) => { pending = { resolve, reject }; }); },
  () => rendered++, () => {}, () => errors++, () => { confirms++; return allowRemove; });
(async () => {
  ui.renderMeals({ meals: [meal], favorites: [f] });
  assert(!container.markup.includes('<img')); assert(container.markup.includes('&lt;img'));
  let log = container.buttons.find(b => 'logfood' in b.dataset);
  const first = log.onclick(); log.onclick(); assert.equal(calls.length, 1); assert(log.disabled);
  assert.deepStrictEqual(calls[0], ['logFoodFavorite', f.id, '2026-11-05']);
  state.date = '2026-11-06'; ui.renderMeals({ meals: [], favorites: [f] });
  assert(container.buttons.every(b => b.disabled)); pending.resolve({}); await first; assert.equal(rendered, 0);
  assert(container.buttons.every(b => !b.disabled));
  container.buttons.find(b => 'removefood' in b.dataset).onclick(); assert.equal(confirms, 1); assert.equal(calls.length, 1);
  log = container.buttons.find(b => 'logfood' in b.dataset); const failed = log.onclick(); pending.reject(Error('offline')); await failed;
  assert.equal(errors, 1); assert(!log.disabled);
  allowRemove = true;
  const removed = container.buttons.find(b => 'removefood' in b.dataset).onclick();
  assert.deepStrictEqual(calls.at(-1), ['removeFoodFavorite', f.id, '2026-11-06']); pending.resolve({}); await removed;
  ui.renderMeals({ meals: [meal], favorites: [] });
  const saved = container.buttons.find(b => 'savefood' in b.dataset).onclick();
  assert.deepStrictEqual(calls.at(-1), ['saveFoodFavorite', '2026-11-06', 1, meal]); pending.resolve({}); await saved;
  ui.renderMeals({ meals: [], favorites: [] }); assert(container.markup.includes('Tap Save food'));
  // The shared writer timestamps new entries, not the original meal time.
  assert(/Utilities\.formatDate\(new Date\(\), TZ, 'HH:mm'\)/.test(src));
  new Function(html.match(/<script>([\s\S]*?)<\/script>/)[1]);
  console.log('PASS UI escaping, selected date, in-flight guard across rerenders, date navigation, confirmed removal, failures and empty state');
})().catch(e => { console.error(e); process.exitCode = 1; });
