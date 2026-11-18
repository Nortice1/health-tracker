// A workout needs three distinct exercises, not three sets.
const assert = require('assert');
const fs = require('fs');
const src = fs.readFileSync(__dirname + '/../app/webapp.gs', 'utf8');
const api = new Function(src + '\nreturn { trainDays_, splitPlan_ };')();
const exercises = [
  { name: 'Rear delt', day: 'Pull' },
  { name: 'Row', day: 'Pull' },
  { name: 'Pulldown', day: 'Pull' },
  { name: 'Bench', day: 'Push' },
  { name: 'Squat', day: 'Legs' },
];
const date = '2026-11-11';
const sets = (ex, n = 1) => Array.from({ length: n }, () => ({ date, ex }));
const classify = log => api.trainDays_(log, exercises)[date];

assert.deepStrictEqual(classify(sets('Rear delt', 3)), [3, 'Other'], 'three rear-delt sets are not a Pull day');
assert.deepStrictEqual(classify([...sets('Rear delt', 6), ...sets('Row', 3)]), [9, 'Other'], 'two exercises stay accessory work');
assert.deepStrictEqual(classify([...sets('Rear delt'), ...sets('Row'), ...sets('Pulldown')]), [3, 'Pull'], 'three distinct exercises qualify');
assert.deepStrictEqual(classify([...sets('Bench', 3), ...sets('Row'), ...sets('Squat')]), [5, 'Push'], 'qualified mixed days keep the main type by sets');
assert.deepStrictEqual(api.trainDays_([], exercises), {}, 'empty log stays empty');
const nextDate = '2026-11-12';
const separateDays = [...sets('Rear delt'), { date: nextDate, ex: 'Row' }, { date: nextDate, ex: 'Pulldown' }];
assert.strictEqual(api.trainDays_(separateDays, exercises)[nextDate][1], 'Other', 'distinct exercises are counted per date');

// A complete P/P/L reaches the planned Rest on November 11.
const days = { '2026-11-08': [9, 'Push'], '2026-11-09': [9, 'Pull'], '2026-11-10': [9, 'Legs'], [date]: classify(sets('Rear delt', 3)) };
const utils = { formatDate: d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') };
const planApi = new Function('Utilities', src + '\nreturn { splitPlan_ };')(utils);
const plan = planApi.splitPlan_(days, nextDate, nextDate);
assert.strictEqual(plan[date], 'Rest', 'accessory work keeps the planned rest day');
assert.strictEqual(plan[nextDate], 'Push', 'accessory work on Rest does not delay the next workout');
const waiting = planApi.splitPlan_({ '2026-11-08': [3, 'Other'] }, '2026-11-09', '2026-11-09');
assert.strictEqual(waiting['2026-11-09'], 'Push', 'accessory work cannot complete a planned workout');
console.log('all passed: workout classification and rest-day progression');
