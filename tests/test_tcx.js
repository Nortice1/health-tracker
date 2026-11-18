// Offline test for parseTcx() in app/Index.html (the .tcx import on the Log cardio form).
// Optional: node tests/test_tcx.js <real export.tcx> also prints the summary of a real file.
const fs = require('fs');
const html = fs.readFileSync(__dirname + '/../app/Index.html', 'utf8');
const pick = re => { const m = html.match(re); if (!m) throw new Error('not found: ' + re); return m[0]; };
eval(pick(/const AGE = [^\n]+/).replace('const ', 'var '));
eval(pick(/const TCX_SPORT = [^\n]+/).replace('const ', 'var '));
eval(pick(/function parseTcx\(text\) \{[\s\S]*?\n\}\n/));

let pass = 0, failN = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : failN++;
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want)));
};

// 10 minutes, one point every 5 s: first 5 min at 130 bpm, last 5 min at 160 bpm
function make(sport, startIso, lapKm) {
  let pts = '';
  const t0 = Date.parse(startIso);
  for (let s = 0; s <= 600; s += 5) {
    const t = new Date(t0 + s * 1000).toISOString();
    pts += '<Trackpoint><Time>' + t + '</Time><Position><LatitudeDegrees>1</LatitudeDegrees><LongitudeDegrees>2</LongitudeDegrees></Position>' +
      '<DistanceMeters>' + (s * 9) + '</DistanceMeters><HeartRateBpm><Value>' + (s < 300 ? 130 : 160) + '</Value></HeartRateBpm></Trackpoint>';
  }
  return '<?xml version="1.0"?><TrainingCenterDatabase><Activities><Activity Sport="' + sport + '"><Id>' + startIso + '</Id>' +
    '<Lap StartTime="' + startIso + '"><TotalTimeSeconds>600.0</TotalTimeSeconds><DistanceMeters>' + lapKm * 1000 + '</DistanceMeters>' +
    '<Calories>120</Calories><Track>' + pts + '</Track></Lap></Activity></Activities></TrainingCenterDatabase>';
}

const a = parseTcx(make('Running', '2026-10-04T18:27:29.000+07:00', 1.5));
eq('date (Bangkok)', a.date, '2026-10-04');
eq('start', a.start, '18:27');
eq('type mapped', a.type, 'Outdoor run');
eq('minutes', a.minutes, 10);
eq('km from lap, not GPS points', a.km, 1.5);
eq('kcal', a.kcal, 120);
eq('max HR', a.max, 160);
eq('avg HR', a.avg, Math.round((60 * 130 + 61 * 160) / 121));
// Example age 30/resting HR 60: reserve 130; 130 bpm is fat burn, 160 bpm is cardio.
eq('zones', a.zones, { fat: 5, cardio: 5, peak: 0, azm: 15 });

const b = parseTcx(make('Other', '2026-10-04T23:50:00Z', 0));
eq('UTC time turned into Bangkok date', [b.date, b.start], ['2026-10-05', '06:50']);
eq('unknown sport left blank', b.type, '');
eq('no lap distance', b.km, '');

let threw = '';
try { parseTcx('<gpx></gpx>'); } catch (e) { threw = e.message; }
eq('rejects a non-tcx file', threw, 'Not a .tcx workout file');

console.log('\n' + pass + ' passed, ' + failN + ' failed');
if (process.argv[2]) console.log('\nReal file:', parseTcx(fs.readFileSync(process.argv[2], 'utf8')));
process.exitCode = failN ? 1 : 0;
