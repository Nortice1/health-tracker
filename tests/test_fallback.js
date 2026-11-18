// callGemini_ against a fake Gemini: each scenario lists the HTTP code returned per model, in call order
const fs = require('fs');
const dir = __dirname + '/../app/';
const src = ['setup_health_tracker.gs', 'webapp.gs', 'coach.gs', 'coach_actions.gs', 'cardio.gs'].map(f => fs.readFileSync(dir + f, 'utf8')).join('\n');
function scenario(name, codes, preferred) {
  const props = { GEMINI_MODEL: preferred || null }, calls = [];
  let i = 0;
  const g = {
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || '', setProperty: (k, v) => { props[k] = v; } }) },
    UrlFetchApp: { fetch: (url, opt) => {
      const code = codes[i++]; calls.push(url.split('/models/')[1].split(':')[0]);
      const body = JSON.parse(opt.payload);
      if (body.generationConfig.temperature !== undefined) throw new Error('temperature still sent');
      return { getResponseCode: () => code, getContentText: () => JSON.stringify(code === 200
        ? { candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }] } : { error: { message: 'err ' + code } }) };
    } },
    SpreadsheetApp: {}, Utilities: {}, CacheService: {}, HtmlService: {}, LockService: {}, Logger: { log() {} }, Charts: {},
  };
  const api = new Function(...Object.keys(g), src + '\nreturn { callGemini_ };')(...Object.values(g));
  let out;
  try { out = 'reply from ' + api.callGemini_('k', 's', [], 10).model; } catch (e) { out = 'ERROR: ' + e.message; }
  console.log(name.padEnd(34), '| tried:', calls.join(' > ').padEnd(62), '|', out, '| saved default:', props.GEMINI_MODEL);
}
scenario('first model works', [200]);
scenario('first rate-limited, second works', [429, 200]);
scenario('first gone (404), second works', [404, 200]);
scenario('all busy', [503, 429, 500]);
scenario('preferred busy, keeps preferred', [503, 200], 'gemini-3.8-flash');
