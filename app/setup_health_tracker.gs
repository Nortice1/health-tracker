/**
 * HEALTH TRACKER - one-time setup script for Google Sheets
 *
 * How to install (on PC):
 *   1. Open https://sheets.new (a blank Google Sheet), name it "Health Tracker".
 *   2. Extensions > Apps Script. Delete the sample code, paste this whole file, press Save.
 *   3. In the function box at the top pick "setup", press Run, allow the permissions.
 *   4. Go back to the sheet. Done. Install the Google Sheets app on iPhone to log at the gym.
 *
 * Run it ONCE. Running again rebuilds every tab and erases logged data (it asks first).
 */

const MUSCLES = ['Upper chest', 'Mid chest', 'Lower chest', 'Front delts', 'Side delts', 'Rear delts',
  'Triceps', 'Biceps', 'Forearms', 'Lats', 'Upper back', 'Lower back',
  'Quads', 'Hamstrings', 'Glutes', 'Calves', 'Abs'];
// Body regions for the Dashboard chart: [name, first muscle index, count, header colour]
const REGIONS = [['Chest', 0, 3, '#1e3a8a'], ['Shoulders', 3, 3, '#6d28d9'], ['Arms', 6, 3, '#9d174d'],
  ['Back', 9, 3, '#065f46'], ['Legs', 12, 4, '#92400e'], ['Core', 16, 1, '#374151']];
// Old muscle names from the first version, for exercises you added yourself
const OLD_MUSCLE_MAP = { 'Chest': 'Mid chest', 'Shoulders': 'Front delts', 'Back': 'Lats', 'Core': 'Abs' };
const TYPES = ['Weight', 'Bodyweight', 'Reps only'];
const DAYS = ['Push', 'Pull', 'Legs', 'Other'];
const LOG_ROWS = 3000;
const BODY_ROWS = 1500;
const EX_ROWS = 200;
const WEEKS = 104;

// name, day, main muscle, type, rep min, rep max, increment kg, target sets, notes, secondary 1, secondary 2
const EXERCISES = [
  ['Incline Bench Press', 'Push', 'Upper chest', 'Weight', 6, 10, 2.5, 3, '', 'Front delts', 'Triceps'],
  ['Dip (lower chest)', 'Push', 'Lower chest', 'Bodyweight', 6, 12, 2.5, 3, 'Weight = added kg on belt, blank if none', 'Triceps', 'Front delts'],
  ['Machine Chest Press', 'Push', 'Mid chest', 'Weight', 8, 12, 2.5, 3, '', 'Triceps', 'Front delts'],
  ['Chest Fly Machine', 'Push', 'Mid chest', 'Weight', 10, 15, 2.5, 3, '', 'Front delts', ''],
  ['Lateral Raise', 'Push', 'Side delts', 'Weight', 12, 20, 1, 3, 'Log weight of ONE dumbbell', '', ''],
  ['Shoulder Press', 'Push', 'Front delts', 'Weight', 6, 10, 2.5, 3, '', 'Side delts', 'Triceps'],
  ['Triceps Extension', 'Push', 'Triceps', 'Weight', 10, 15, 2.5, 3, '', '', ''],
  ['Pull-up', 'Pull', 'Lats', 'Bodyweight', 5, 10, 2.5, 3, 'Weight = added kg on belt, blank if none', 'Biceps', 'Upper back'],
  ['Rear Delt Fly (machine)', 'Pull', 'Rear delts', 'Weight', 12, 20, 2.5, 3, '', 'Upper back', ''],
  ['Cable Rear Delt Fly', 'Pull', 'Rear delts', 'Weight', 12, 20, 1, 3, '', 'Upper back', ''],
  ['Seated Row', 'Pull', 'Upper back', 'Weight', 8, 12, 2.5, 3, '', 'Lats', 'Biceps'],
  ['Barbell Row', 'Pull', 'Upper back', 'Weight', 6, 10, 2.5, 3, '', 'Lats', 'Lower back'],
  ['Biceps Curl', 'Pull', 'Biceps', 'Weight', 8, 12, 1, 3, '', '', ''],
  ['Hammer Curl', 'Pull', 'Biceps', 'Weight', 8, 12, 1, 3, '', 'Forearms', ''],
  ['Leg Extension', 'Legs', 'Quads', 'Weight', 10, 15, 2.5, 3, '', '', ''],
  ['Leg Press', 'Legs', 'Quads', 'Weight', 8, 12, 5, 3, '', 'Glutes', ''],
  ['Prone Leg Curl', 'Legs', 'Hamstrings', 'Weight', 8, 12, 2.5, 3, '', '', ''],
  ['Deadlift', 'Legs', 'Hamstrings', 'Weight', 4, 8, 5, 3, '', 'Glutes', 'Lower back'],
  ['Leg Raise', 'Legs', 'Abs', 'Reps only', 10, 20, 0, 3, '', '', ''],
  ['Negative Dragon Flag', 'Legs', 'Abs', 'Reps only', 3, 8, 0, 3, 'Slow lowering, 3-5 s', '', ''],
];

// Log K: bodyweight lifts load = body weight (7-day avg of the latest weigh-in on/before that date) + added kg.
// MAXIFS + XLOOKUP so it still works if Body rows are not in date order.
const LOG_K_FORMULA = '=IF(D2="","",O2+IF(IFERROR(VLOOKUP(H2,Exercises!$A:$D,4,FALSE),"")="Bodyweight",' +
  'LET(d,MAXIFS(Body!$A:$A,Body!$A:$A,"<="&G2,Body!$B:$B,"<>"),' +
  'bw,IF(d=0,0,IFERROR(N(XLOOKUP(d,Body!$A:$A,Body!$C:$C)),0)),IF(bw>0,bw,DefaultBW)),0))';
// Log N: PR = beats every earlier set of this exercise, including earlier sets the same day,
// but only once there is a previous session to compare with.
// Sets on/after Settings "PR count from" (PRFrom) only compare with sets from that date (new gym = new baseline).
const LOG_N_FORMULA = '=IF(D2="","",LET(lo,IF(G2>=N(PRFrom),N(PRFrom),0),' +
  'IF(COUNTIFS(H$1:H1,H2,G$1:G1,"<"&G2,G$1:G1,">="&lo,D$1:D1,"<>")=0,"",' +
  'IF(L2<>"",IF(L2>MAXIFS(L$1:L1,H$1:H1,H2,G$1:G1,"<="&G2,G$1:G1,">="&lo),"PR",""),' +
  'IF(D2>MAXIFS(D$1:D1,H$1:H1,H2,G$1:G1,"<="&G2,G$1:G1,">="&lo,O$1:O1,">="&O2),"PR","")))))';
// Lift Stats H: best e1RM (or reps) since PRFrom
const LIFT_BEST_FORMULA = '=IF(OR(A2="",C2="–"),"",IF(Exercises!D2="Reps only",' +
  'MAXIFS(Log!$D:$D,Log!$H:$H,A2,Log!$G:$G,">="&N(PRFrom))&" reps",' +
  'IFERROR(1/(1/MAXIFS(Log!$L:$L,Log!$H:$H,A2,Log!$G:$G,">="&N(PRFrom))),"")))';
const PR_SETTING = ['PR count from (date)', '', 'Only sets from this date count for PRs and best e1RM (blank = all)'];

// ChartData body list sorted by date, so "latest weight" and "4 weeks ago" stay right when a past day is added later
const CHARTDATA_BODY_FORMULA = '=IFERROR(SORT(FILTER(Body!A2:C,Body!B2:B<>""),1,TRUE),"")';
// Body fat from the latest date that has one, not the last row in the sheet
const BODYFAT_FORMULA = '=IFERROR(XLOOKUP(MAXIFS(Body!A2:A,Body!D2:D,"<>"),Body!A2:A,Body!D2:D),"–")';

const GUIDE_WEEKLY = 'Weekly tab: hard sets per muscle part per week (main muscle 1 set, secondary 0.5). ' +
  'Per part aim ~6-12; whole muscle (e.g. upper+mid+lower chest) ~10-20.';

const TABS = ['Dashboard', 'Log', 'Lift Stats', 'Weekly', 'Body', 'Wearable', 'Exercises', 'Settings', 'Guide', 'ChartData'];

function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let ui = null;
  try { ui = SpreadsheetApp.getUi(); } catch (e) { } // no popups when run from the script editor
  if (ss.getSheetByName('Log')) {
    if (!ui) throw new Error('Tracker already exists, stopped to protect your data. To rebuild anyway, delete the Log tab first.');
    const answer = ui.alert('Tracker already exists', 'Rebuilding ERASES all logged data. Continue?', ui.ButtonSet.YES_NO);
    if (answer !== ui.Button.YES) return;
  }
  ss.setSpreadsheetTimeZone('Asia/Bangkok');
  ss.setSpreadsheetLocale('en_GB'); // type dates as 29/9 or 29/9/2026, Gregorian year

  // Create all tabs first so cross-tab formulas never see a missing sheet
  const temp = ss.insertSheet('_building');
  ss.getSheets().forEach(s => {
    if (s.getName() === '_building') return;
    if (TABS.indexOf(s.getName()) >= 0 || s.getLastRow() === 0) ss.deleteSheet(s);
  });
  TABS.forEach(n => ss.insertSheet(n));
  ss.deleteSheet(temp);

  buildSettings(ss);
  buildExercises(ss);
  buildBody(ss);
  buildWearable(ss);
  buildLog(ss);
  buildLiftStats(ss);
  buildWeekly(ss);
  buildChartData(ss);
  buildDashboard(ss);
  buildGuide(ss);

  TABS.forEach((n, i) => {
    ss.setActiveSheet(ss.getSheetByName(n));
    ss.moveActiveSheet(i + 1);
  });
  ss.getSheetByName('ChartData').hideSheet();
  ss.setActiveSheet(ss.getSheetByName('Dashboard'));
  const done = 'Health Tracker ready. Read the Guide tab once, then start logging.';
  if (ui) ui.alert(done); else Logger.log(done);
}

// ---------- helpers ----------

function header(sh, cols, color) {
  sh.getRange(1, 1, 1, cols.length).setValues([cols])
    .setFontWeight('bold').setBackground(color || '#1f2937').setFontColor('#ffffff').setWrap(true);
  sh.setFrozenRows(1);
}

// Writes one formula down a column; relative references shift per row like fill-down
function fillDown(sh, col, firstRow, lastRow, formula) {
  sh.getRange(col + firstRow + ':' + col + lastRow).setFormula(formula);
}

function helperStyle(range) {
  range.setBackground('#f3f4f6').setFontColor('#4b5563');
}

function dateCol(range) {
  range.setNumberFormat('yyyy-mm-dd');
}

// ---------- tabs ----------

// Settings rows 5-8, added after the first setup. The app uses these values while a row is still blank.
const FOOD_SETTINGS = [
  ['Fat target (g per kg)', 0.8, 'Carbs fill the calories left after protein and fat'],
  ['Fiber target (g/day)', 30, 'At least 25 g a day (WHO)'],
  ['Veg + fruit target (servings/day)', 5, '1 serving = 80 g, about a fist (WHO: 400 g a day)'],
  ['Sodium limit (mg/day)', 2000, 'Under 2000 mg a day (WHO)'],
];

function buildSettings(ss) {
  const sh = ss.getSheetByName('Settings');
  header(sh, ['Setting', 'Value', 'Note']);
  sh.getRange('A2:C4').setValues([
    ['Default body weight (kg)', 70, 'Used for bodyweight lifts until you log weight in Body'],
    ['Protein target (g per kg)', 1.8, '1.6-2.2 is the usual range for muscle gain'],
    ['Calorie target (kcal/day)', 2200, 'Set to your own number'],
  ]);
  sh.getRange(5, 1, FOOD_SETTINGS.length, 3).setValues(FOOD_SETTINGS);
  sh.getRange('A9:C9').setValues([PR_SETTING]);
  ss.setNamedRange('PRFrom', sh.getRange('B9'));
  ss.setNamedRange('DefaultBW', sh.getRange('B2'));
  ss.setNamedRange('ProteinTarget', sh.getRange('B3'));
  ss.setNamedRange('CalorieTarget', sh.getRange('B4'));
  sh.setColumnWidth(1, 200);
  sh.setColumnWidth(3, 360);
}

/** Fills in Settings rows 5-8 (nutrition targets) that are still empty. A value already typed in B is kept. */
function addFoodSettings_(sh) {
  const cur = sh.getRange(5, 1, FOOD_SETTINGS.length, 3).getValues();
  FOOD_SETTINGS.forEach((row, i) => {
    if (cur[i][0] !== '') return;
    const r = 5 + i;
    sh.getRange(r, 1).setValue(row[0]);
    if (cur[i][1] === '') sh.getRange(r, 2).setValue(row[1]);
    sh.getRange(r, 2).setBackground('#fef9c3').setFontWeight('bold').setHorizontalAlignment('center');
    sh.getRange(r, 3).setValue(row[2]).setFontColor('#6b7280');
  });
}

function buildExercises(ss) {
  const sh = ss.getSheetByName('Exercises');
  header(sh, ['Exercise', 'Day', 'Muscle', 'Type', 'Rep min', 'Rep max', 'Increment (kg)', 'Target sets', 'Notes'], '#065f46');
  sh.getRange(2, 1, EXERCISES.length, 11).setValues(EXERCISES);
  const list = vals => SpreadsheetApp.newDataValidation().requireValueInList(vals, true).build();
  sh.getRange('B2:B' + EX_ROWS).setDataValidation(list(DAYS));
  sh.getRange('D2:D' + EX_ROWS).setDataValidation(list(TYPES));
  styleMuscleColumns(sh);
  sh.setColumnWidth(1, 190);
  sh.setColumnWidth(9, 280);
  sh.getRange('A1').setNote('Add new exercises at the bottom any time (new gym, variations). ' +
    'Do not rename an exercise that already has log entries, or its history splits in two.');
}

// Main muscle (C) + two secondary muscles (J, K) that count as half a set each
function styleMuscleColumns(sh) {
  const list = SpreadsheetApp.newDataValidation().requireValueInList(MUSCLES, true).build();
  sh.getRange('C1').setValue('Main muscle');
  sh.getRange('J1:K1').setValues([['Secondary 1', 'Secondary 2']])
    .setFontWeight('bold').setBackground('#065f46').setFontColor('#ffffff').setWrap(true);
  sh.getRange('C2:C' + EX_ROWS).setDataValidation(list);
  sh.getRange('J2:K' + EX_ROWS).setDataValidation(list);
  sh.setColumnWidth(3, 110);
  sh.setColumnWidth(10, 110);
  sh.setColumnWidth(11, 110);
  sh.getRange('J1').setNote('Muscles that also work in this exercise. Each set counts as 0.5 set for them in the Weekly tab. Leave blank if none.');
}

function buildBody(ss) {
  const sh = ss.getSheetByName('Body');
  header(sh, ['Date', 'Weight (kg)', '7-day avg', 'Body fat %', 'Calories', 'Protein (g)', 'Protein g/kg', 'Photo link', 'Notes'], '#1e3a8a');
  fillDown(sh, 'C', 2, BODY_ROWS,
    '=IF(A2="","",IFERROR(ROUND(AVERAGEIFS(B$2:B,A$2:A,">"&(A2-7),A$2:A,"<="&A2),2),""))');
  fillDown(sh, 'G', 2, BODY_ROWS, '=IF(OR(F2="",N(C2)=0),"",ROUND(F2/C2,2))');
  helperStyle(sh.getRange('C2:C' + BODY_ROWS));
  helperStyle(sh.getRange('G2:G' + BODY_ROWS));
  dateCol(sh.getRange('A2:A' + BODY_ROWS));
  sh.getRange('A2:A' + BODY_ROWS).setDataValidation(SpreadsheetApp.newDataValidation().requireDate().build());

  const g = sh.getRange('G2:G' + BODY_ROWS);
  sh.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=AND(ISNUMBER($G2),$G2<INDIRECT("Settings!B3"))')
      .setBackground('#fee2e2').setRanges([g]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=AND(ISNUMBER($G2),$G2>=INDIRECT("Settings!B3"))')
      .setBackground('#d1fae5').setRanges([g]).build(),
  ]);
  sh.getRange('A1').setNote('One row per day. Weigh in the morning after the toilet, before food. ' +
    'Leave cells blank if you skipped them. Photo link: upload the photo to Google Drive and paste the share link.');
}

function buildWearable(ss) {
  const sh = ss.getSheetByName('Wearable');
  header(sh, ['Date', 'Sleep (h)', 'Deep (h)', 'REM (h)', 'Resting HR', 'HRV (ms)', 'Steps', 'Active zone min', 'Calories out'], '#7c2d12');
  dateCol(sh.getRange('A2:A2000'));
  sh.getRange('A1').setNote('Will be filled automatically by the Fitbit sync (added once the Fitbit arrives). You can also type values by hand.');
}

function buildLog(ss) {
  const sh = ss.getSheetByName('Log');
  header(sh, ['Date', 'Exercise', 'Weight (kg)', 'Reps', 'RPE', 'Notes',
    'Date*', 'Exercise*', 'Set #', 'Muscle', 'Load (kg)', 'e1RM', 'Volume', 'PR', 'Added (kg)']);
  sh.getRange('G1:O1').setBackground('#6b7280');
  const n = LOG_ROWS;

  // Date/Exercise left blank = same as the row above
  fillDown(sh, 'G', 2, n, '=IF(A2<>"",A2,IF(ROW()=2,"",G1))');
  fillDown(sh, 'H', 2, n, '=IF(B2<>"",B2,IF(ROW()=2,"",H1))');
  fillDown(sh, 'I', 2, n, '=IF(D2="","",COUNTIFS(G$2:G2,G2,H$2:H2,H2,D$2:D2,"<>"))');
  fillDown(sh, 'J', 2, n, '=IF(D2="","",IFERROR(VLOOKUP(H2,Exercises!$A:$C,3,FALSE),"?"))');
  fillDown(sh, 'O', 2, n, '=IF(D2="","",N(C2))');
  // Bodyweight lifts: load = body weight (7-day avg on that date) + added weight
  fillDown(sh, 'K', 2, n, LOG_K_FORMULA);
  // Epley estimated 1-rep max
  fillDown(sh, 'L', 2, n,
    '=IF(OR(D2="",N(K2)=0,IFERROR(VLOOKUP(H2,Exercises!$A:$D,4,FALSE),"")="Reps only"),"",' +
    'ROUND(IF(D2=1,K2,K2*(1+D2/30)),1))');
  fillDown(sh, 'M', 2, n, '=IF(D2="","",K2*D2)');
  fillDown(sh, 'N', 2, n, LOG_N_FORMULA);

  helperStyle(sh.getRange('G2:O' + n));
  dateCol(sh.getRange('A2:A' + n));
  dateCol(sh.getRange('G2:G' + n));
  sh.getRange('A2:A' + n).setDataValidation(SpreadsheetApp.newDataValidation().requireDate().build());
  sh.getRange('B2:B' + n).setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInRange(ss.getSheetByName('Exercises').getRange('A2:A' + EX_ROWS), true).setAllowInvalid(true).build());
  sh.getRange('E2:E' + n).setDataValidation(SpreadsheetApp.newDataValidation()
    .requireNumberBetween(1, 10).setAllowInvalid(false).build());

  sh.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$N2="PR"')
      .setBackground('#bbf7d0').setBold(true).setRanges([sh.getRange('A2:F' + n)]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$J2="?"')
      .setBackground('#fde68a').setRanges([sh.getRange('B2:B' + n)]).build(),
  ]);
  sh.getRange('G1:O' + n).protect().setWarningOnly(true).setDescription('Auto-calculated columns');
  sh.setColumnWidth(1, 95);
  sh.setColumnWidth(2, 180);
  [3, 4, 5].forEach(c => sh.setColumnWidth(c, 70));
  sh.getRange('A1').setNote('Type the date only on the first set of the day, and the exercise only on its first set. ' +
    'Blank = same as above. Do not leave empty rows in the middle.');
  addLogSecondary(sh);
}

function addLogSecondary(sh) {
  const n = LOG_ROWS;
  sh.getRange('P1:Q1').setValues([['Secondary 1', 'Secondary 2']])
    .setFontWeight('bold').setBackground('#6b7280').setFontColor('#ffffff').setWrap(true);
  fillDown(sh, 'P', 2, n, '=IF(D2="","",IFERROR(VLOOKUP(H2,Exercises!$A:$J,10,FALSE)&"",""))');
  fillDown(sh, 'Q', 2, n, '=IF(D2="","",IFERROR(VLOOKUP(H2,Exercises!$A:$K,11,FALSE)&"",""))');
  helperStyle(sh.getRange('P2:Q' + n));
  sh.getRange('P1:Q' + n).protect().setWarningOnly(true).setDescription('Auto-calculated columns');
}

function buildLiftStats(ss) {
  const sh = ss.getSheetByName('Lift Stats');
  header(sh, ['Exercise', 'Day', 'Last session', 'Top weight (kg added)', 'Sets @ top', 'Lowest reps @ top',
    'Rep range', 'Best e1RM (kg) / reps', 'NEXT TARGET', 'Days since'], '#065f46');
  const n = EX_ROWS;
  fillDown(sh, 'A', 2, n, '=IF(Exercises!A2="","",Exercises!A2)');
  fillDown(sh, 'B', 2, n, '=IF(A2="","",Exercises!B2)');
  fillDown(sh, 'C', 2, n, '=IF(A2="","",IFERROR(1/(1/MAXIFS(Log!$G:$G,Log!$H:$H,A2,Log!$D:$D,"<>")),"–"))');
  fillDown(sh, 'D', 2, n, '=IF(OR(A2="",C2="–"),"",MAXIFS(Log!$O:$O,Log!$H:$H,A2,Log!$G:$G,C2))');
  fillDown(sh, 'E', 2, n, '=IF(D2="","",COUNTIFS(Log!$H:$H,A2,Log!$G:$G,C2,Log!$O:$O,D2))');
  fillDown(sh, 'F', 2, n, '=IF(D2="","",MINIFS(Log!$D:$D,Log!$H:$H,A2,Log!$G:$G,C2,Log!$O:$O,D2))');
  fillDown(sh, 'G', 2, n, '=IF(A2="","",Exercises!E2&"-"&Exercises!F2)');
  fillDown(sh, 'H', 2, n, LIFT_BEST_FORMULA);
  // Double progression: hit top of rep range on the target number of sets -> add weight
  fillDown(sh, 'I', 2, n,
    '=IF(OR(A2="",C2="–"),"",LET(wkg,D2,repsDone,F2,setsDone,E2,repMin,Exercises!E2,repMax,Exercises!F2,' +
    'step,Exercises!G2,setsTarget,Exercises!H2,wtxt,IF(wkg=0,"BW",wkg&" kg"),' +
    'IF(AND(repsDone>=repMax,setsDone>=setsTarget),' +
    'IF(step>0,IF(wkg=0,"BW +"&step&" kg",(wkg+step)&" kg")&" x "&repMin&"  (weight up)","Top of range: harder variation"),' +
    'IF(repsDone>=repMax,wtxt&" x "&repMax&", reach "&setsTarget&" sets",wtxt&" x "&(repsDone+1)&"+ on every set"))))');
  fillDown(sh, 'J', 2, n, '=IF(OR(A2="",C2="–"),"",TODAY()-C2)');
  dateCol(sh.getRange('C2:C' + n));
  sh.getRange('I2:I' + n).setFontWeight('bold').setFontColor('#065f46');
  sh.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=AND(ISNUMBER($J2),$J2>21)')
      .setFontColor('#9ca3af').setRanges([sh.getRange('A2:J' + n)]).build(),
  ]);
  sh.setColumnWidth(1, 190);
  sh.setColumnWidth(9, 260);
  sh.getRange('I1').setNote('What to aim for next time, based on your last session of this exercise.');
  sh.getRange('J1').setNote('Grey rows = not trained for 3+ weeks (rotated out).');
}

function buildWeekly(ss) {
  const sh = ss.getSheetByName('Weekly');
  header(sh, ['Week of (Mon)'].concat(MUSCLES).concat(['Total sets', 'PRs', 'Tonnage (kg)']), '#1e3a8a');
  REGIONS.forEach(r => sh.getRange(1, r[1] + 2, 1, r[2]).setBackground(r[3]));
  const last = WEEKS + 1;
  const lastM = colLetter(MUSCLES.length + 1);       // R
  const totCol = colLetter(MUSCLES.length + 2);      // S
  const prCol = colLetter(MUSCLES.length + 3);       // T
  const tonCol = colLetter(MUSCLES.length + 4);      // U
  const inWeek = 'Log!$G:$G,">="&$A2,Log!$G:$G,"<"&($A2+7)';
  sh.getRange('A2').setFormula('=IF(COUNT(Log!G2:G)=0,TODAY()-WEEKDAY(TODAY(),3),MIN(Log!G2:G)-WEEKDAY(MIN(Log!G2:G),3))');
  fillDown(sh, 'A', 3, last, '=A2+7');
  // Main muscle = 1 set, each secondary muscle = 0.5 set
  sh.getRange('B2:' + lastM + last).setFormula('=IF($A2>TODAY(),"",COUNTIFS(Log!$J:$J,B$1,' + inWeek + ')' +
    '+0.5*COUNTIFS(Log!$P:$P,B$1,' + inWeek + ')+0.5*COUNTIFS(Log!$Q:$Q,B$1,' + inWeek + '))');
  fillDown(sh, totCol, 2, last, '=IF($A2>TODAY(),"",COUNTIFS(Log!$I:$I,">0",' + inWeek + '))');
  fillDown(sh, prCol, 2, last, '=IF($A2>TODAY(),"",COUNTIFS(Log!$N:$N,"PR",' + inWeek + '))');
  fillDown(sh, tonCol, 2, last, '=IF($A2>TODAY(),"",SUMIFS(Log!$M:$M,' + inWeek + '))');
  sh.getRange('A2:A' + last).setNumberFormat('d mmm yyyy');
  sh.getRange(tonCol + '2:' + tonCol + last).setNumberFormat('#,##0');
  const sets = sh.getRange('B2:' + lastM + last);
  sh.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule().whenNumberBetween(0.5, 5.5).setBackground('#fef3c7').setRanges([sets]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenNumberBetween(6, 12).setBackground('#d1fae5').setRanges([sets]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenNumberGreaterThan(12).setBackground('#fed7aa').setRanges([sets]).build(),
  ]);
  sh.setColumnWidths(2, MUSCLES.length, 72);
  sh.setFrozenColumns(1);
  sh.getRange('B1').setNote('Hard sets per muscle per week. Main muscle = 1 set, secondary muscle = 0.5 set ' +
    '(set in the Exercises tab). Rough guide for each muscle part: yellow under 6, green 6-12, orange over 12. ' +
    'Add the parts together for the whole muscle (e.g. chest = upper + mid + lower, aim 10-20).');
}

function colLetter(n) {
  let s = '';
  for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + (n - 1) % 26) + s;
  return s;
}

// Region totals per week (Chest = upper + mid + lower, ...) for the Dashboard chart, at ChartData!Z1
function buildRegionData(cd) {
  cd.getRange(1, 26, 1, REGIONS.length + 1).setValues([['Week'].concat(REGIONS.map(r => r[0]))]);
  const keep = 'Weekly!A2:A<>"",Weekly!A2:A<=TODAY()';
  cd.getRange('Z2').setFormula('=IFERROR(FILTER(Weekly!A2:A,' + keep + '),"")');
  REGIONS.forEach((r, i) => {
    const parts = [];
    for (let m = r[1]; m < r[1] + r[2]; m++) {
      const c = colLetter(m + 2);
      parts.push('Weekly!' + c + '2:' + c);
    }
    cd.getRange(2, 27 + i).setFormula('=IFERROR(FILTER(' + parts.join('+') + ',' + keep + '),"")');
  });
  dateCol(cd.getRange('Z2:Z'));
}

function addWeeklyChart(ss) {
  const sh = ss.getSheetByName('Dashboard');
  const cd = ss.getSheetByName('ChartData');
  sh.getCharts().forEach(c => {
    if (String(c.getOptions().get('title')).indexOf('Weekly') === 0) sh.removeChart(c);
  });
  const lastCol = colLetter(26 + REGIONS.length);
  const bars = sh.newChart().setChartType(Charts.ChartType.COLUMN)
    .setHiddenDimensionStrategy(Charts.ChartHiddenDimensionStrategy.SHOW_BOTH)
    .addRange(cd.getRange('Z1:' + lastCol + '200')).setPosition(35, 5, 0, 0)
    .setOption('title', 'Weekly hard sets by body region (details in Weekly tab)').setOption('isStacked', true)
    .setOption('width', 620).setOption('height', 320).setOption('legend', { position: 'right' })
    .setOption('colors', REGIONS.map(r => r[3]));
  sh.insertChart(bars.build());
}

function buildChartData(ss) {
  const sh = ss.getSheetByName('ChartData');
  sh.getRange('A1:C1').setValues([['Date', 'Weight', '7-day avg']]);
  sh.getRange('A2').setFormula(CHARTDATA_BODY_FORMULA);
  buildRegionData(sh);
  sh.getRange('Q1').setValue('Date');
  sh.getRange('R1').setFormula('=Dashboard!B4');
  sh.getRange('Q2').setFormula(
    '=IFERROR(LET(ex,Dashboard!B4,ds,SORT(UNIQUE(FILTER(Log!G2:G,Log!H2:H=ex,Log!D2:D<>""))),' +
    'HSTACK(ds,MAP(ds,LAMBDA(d,LET(best,MAXIFS(Log!L2:L,Log!H2:H,ex,Log!G2:G,d),' +
    'IF(best>0,best,MAXIFS(Log!D2:D,Log!H2:H,ex,Log!G2:G,d))))))),"")');
  sh.getRange('T1:X1').setValues([['Date', 'Sleep (h)', 'Deep (h)', 'REM (h)', 'Resting HR']]);
  sh.getRange('T2').setFormula('=IFERROR(FILTER(Wearable!A2:E,Wearable!A2:A<>""),"")');
  ['A', 'Q', 'T'].forEach(c => dateCol(sh.getRange(c + '2:' + c)));
}

function buildDashboard(ss) {
  const sh = ss.getSheetByName('Dashboard');
  const cd = ss.getSheetByName('ChartData');
  sh.getRange('A1').setValue('Health Dashboard').setFontSize(18).setFontWeight('bold');
  sh.getRange('A4').setValue('Strength chart exercise ▸').setFontWeight('bold');
  sh.getRange('B4').setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInRange(ss.getSheetByName('Exercises').getRange('A2:A' + EX_ROWS), true).build())
    .setValue(EXERCISES[0][0]).setBackground('#fef9c3');

  const monday = '(TODAY()-WEEKDAY(TODAY(),3))';
  const kpis = [
    ['Body weight, 7-day avg (kg)', '=IF(COUNT(ChartData!A2:A)=0,"–",INDEX(ChartData!C2:C,COUNT(ChartData!A2:A)))', ''],
    ['Change vs 4 weeks ago (kg)', '=IFERROR(B6-VLOOKUP(TODAY()-28,ChartData!A2:C,3,TRUE),"–")', ''],
    ['Body fat % (latest)', BODYFAT_FORMULA, ''],
    ['Workouts this week', '=IFERROR(ROWS(UNIQUE(FILTER(Log!G2:G,Log!D2:D<>"",Log!G2:G>=' + monday + '))),0)', ''],
    ['PRs this week', '=COUNTIFS(Log!N:N,"PR",Log!G:G,">="&' + monday + ')', ''],
    // Full days only: today is not finished, so counting it drags the average down every morning
    ['Avg calories, last 7 full days', '=IFERROR(ROUND(AVERAGEIFS(Body!E:E,Body!A:A,">="&(TODAY()-7),Body!A:A,"<"&TODAY())),"–")', '=CalorieTarget'],
    ['Avg protein g, last 7 full days', '=IFERROR(ROUND(AVERAGEIFS(Body!F:F,Body!A:A,">="&(TODAY()-7),Body!A:A,"<"&TODAY())),"–")', '=ROUND(ProteinTarget*IF(N(B6)>0,B6,DefaultBW))'],
    ['Avg sleep h, last 7 days', '=IFERROR(ROUND(AVERAGEIFS(Wearable!B:B,Wearable!A:A,">"&(TODAY()-7)),1),"–")', 7.5],
    ['Avg resting HR, last 7 days', '=IFERROR(ROUND(AVERAGEIFS(Wearable!E:E,Wearable!A:A,">"&(TODAY()-7))),"–")', ''],
  ];
  sh.getRange('C5').setValue('Target').setFontWeight('bold');
  sh.getRange(6, 1, kpis.length, 3).setValues(kpis);
  sh.getRange('B6:B14').setFontWeight('bold').setFontSize(12).setHorizontalAlignment('right');
  sh.getRange('B7').setNumberFormat('+0.0;-0.0;0.0');
  sh.setColumnWidth(1, 230);
  sh.setColumnWidth(2, 110);
  sh.setColumnWidth(3, 70);

  const line = (title, ranges, row, col, w, h, vTitle) => {
    let b = sh.newChart().setChartType(Charts.ChartType.LINE)
      .setHiddenDimensionStrategy(Charts.ChartHiddenDimensionStrategy.SHOW_BOTH)
      .setPosition(row, col, 0, 0)
      .setOption('title', title).setOption('width', w).setOption('height', h)
      .setOption('pointSize', 4).setOption('legend', { position: 'bottom' })
      .setOption('vAxis', { title: vTitle || '' });
    ranges.forEach(r => { b = b.addRange(cd.getRange(r)); });
    sh.insertChart(b.build());
  };
  line('Strength trend: best e1RM per session (kg, or reps)', ['Q1:R500'], 3, 5, 620, 300, 'kg / reps');
  line('Body weight (kg)', ['A1:C1500'], 19, 5, 620, 300, 'kg');
  line('Sleep (h)', ['T1:U2000'], 17, 1, 410, 260, 'hours');
  line('Resting heart rate', ['T1:T2000', 'X1:X2000'], 32, 1, 410, 260, 'bpm');

  addWeeklyChart(ss);
}

function buildGuide(ss) {
  const sh = ss.getSheetByName('Guide');
  const lines = [
    ['HOW TO USE'],
    [''],
    ['AT THE GYM (Log tab, iPhone Sheets app)'],
    ['1. One row = one set. Fill only the white columns: Date, Exercise, Weight, Reps, (RPE), (Notes).'],
    ['2. Date only on the first set of the day, Exercise only on its first set. Blank = same as the row above.'],
    ['3. Weight = kg on the bar/machine. Bodyweight lifts (pull-up, dip): weight = ADDED kg, blank if none.'],
    ['4. Warm-up sets: do not log them (they would pull down the stats).'],
    ['5. Never leave an empty row between sets. Green row = new PR.'],
    ['6. Before a lift, check Lift Stats > NEXT TARGET for what weight/reps to aim for.'],
    [''],
    ['EVERY MORNING (Body tab)'],
    ['Weight after the toilet, before eating. Watch the 7-day avg, not the daily number.'],
    ['Evening: fill Calories and Protein totals for the day (from any food app or estimate).'],
    ['Weekly: body fat % and a progress photo (same light, same pose), paste the Drive link.'],
    [''],
    ['CHANGING EXERCISES / NEW GYM (Exercises tab)'],
    ['Add a new row at the bottom: name, day, muscle, type, rep range, weight step, target sets.'],
    ['Old exercises can stay; they turn grey in Lift Stats after 3 weeks unused.'],
    ['Never rename an exercise that already has history. Add a new one instead (e.g. "Leg Press (new gym)").'],
    [''],
    ['STATS'],
    ['e1RM = estimated 1-rep max = weight x (1 + reps/30). It compares a 5-rep set with a 10-rep set fairly.'],
    [GUIDE_WEEKLY],
    ['Dashboard: pick an exercise in the yellow cell to see its strength trend.'],
  ];
  sh.getRange(1, 1, lines.length, 1).setValues(lines);
  sh.getRange('A1').setFontSize(16).setFontWeight('bold');
  [3, 11, 16, 21].forEach(r => sh.getRange(r, 1).setFontWeight('bold').setFontColor('#065f46'));
  sh.setColumnWidth(1, 820);
}

/**
 * UPGRADE (run once on an existing tracker): detailed muscle groups.
 * Keeps every logged set, body entry and setting. Changes only:
 * Exercises muscles (+ Secondary 1/2 columns), Log secondary columns, Weekly tab, weekly chart.
 */
function upgradeMuscles() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ex = ss.getSheetByName('Exercises');
  if (!ex || !ss.getSheetByName('Log')) throw new Error('Tracker not found. Run setup first.');
  if (ex.getRange('J1').getValue() === 'Secondary 1') {
    throw new Error('Muscle upgrade is already done. Running it again would reset your muscle edits.');
  }

  // Exercises: new muscle names + secondaries (seeded exercises), old generic names mapped for your own ones
  const seed = {};
  EXERCISES.forEach(r => { seed[r[0]] = r; });
  const rows = Math.max(ex.getLastRow() - 1, 1);
  const muscleCol = ex.getRange(2, 3, rows, 1).getValues();
  const names = ex.getRange(2, 1, rows, 1).getValues();
  const secCols = ex.getRange(2, 10, rows, 2).getValues();
  const mapped = [];
  names.forEach((n, i) => {
    const name = n[0];
    if (!name) return;
    if (seed[name]) {
      muscleCol[i][0] = seed[name][2];
      secCols[i] = [seed[name][9], seed[name][10]];
    } else if (OLD_MUSCLE_MAP[muscleCol[i][0]]) {
      mapped.push(name + ': ' + muscleCol[i][0] + ' -> ' + OLD_MUSCLE_MAP[muscleCol[i][0]]);
      muscleCol[i][0] = OLD_MUSCLE_MAP[muscleCol[i][0]];
    }
  });
  ex.getRange('C2:C' + EX_ROWS).clearDataValidations();
  ex.getRange(2, 3, rows, 1).setValues(muscleCol);
  ex.getRange(2, 10, rows, 2).setValues(secCols);
  styleMuscleColumns(ex);

  addLogSecondary(ss.getSheetByName('Log'));

  const wk = ss.getSheetByName('Weekly');
  wk.clear();
  wk.setConditionalFormatRules([]);
  buildWeekly(ss);

  const cd = ss.getSheetByName('ChartData');
  cd.getRange('E1:O').clearContent();
  buildRegionData(cd);
  addWeeklyChart(ss);

  const guide = ss.getSheetByName('Guide');
  const text = guide.getRange('A1:A40').getValues();
  text.forEach((t, i) => {
    if (String(t[0]).indexOf('Weekly tab') === 0) guide.getRange(i + 1, 1).setValue(GUIDE_WEEKLY);
  });

  Logger.log('Muscle upgrade done.' + (mapped.length ? ' Check these (auto-mapped): ' + mapped.join('; ') : ''));
}

/**
 * POLISH (cosmetic only, safe to run any time): fonts, tab colours, banding, number formats,
 * phone-friendly Log (helper columns folded away), Dashboard cards. Never touches data or formulas
 * except the "As of" date line on the Dashboard.
 */
function polishLook() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const get = n => ss.getSheetByName(n);
  if (!get('Log')) throw new Error('Tracker not found. Run setup first.');

  const tabColors = { 'Dashboard': '#111827', 'Log': '#059669', 'Lift Stats': '#059669', 'Weekly': '#2563eb',
    'Body': '#2563eb', 'Wearable': '#ea580c', 'Exercises': '#6b7280', 'Settings': '#6b7280', 'Guide': '#6b7280' };
  Object.keys(tabColors).forEach(n => {
    const sh = get(n);
    if (!sh) return;
    sh.setTabColor(tabColors[n]);
    sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns())
      .setFontFamily('Roboto').setVerticalAlignment('middle');
    if (n !== 'Dashboard' && n !== 'Guide') {
      sh.setRowHeight(1, 42);
      sh.getRange(1, 1, 1, sh.getLastColumn()).setHorizontalAlignment('center').setFontSize(10);
    }
  });

  const band = (sh, a1) => {
    sh.getBandings().forEach(b => b.remove());
    sh.getRange(a1).applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, false, false);
  };

  // Log: clean phone view, helper columns folded into a +/- group
  const log = get('Log');
  band(log, 'A2:F' + LOG_ROWS);
  log.getRange('B2:B' + LOG_ROWS).setFontWeight('bold');
  log.getRange('C2:C' + LOG_ROWS).setNumberFormat('General'); // '0.##' shows "80." in Sheets
  log.getRange('K2:K' + LOG_ROWS).setNumberFormat('0.0');
  log.getRange('L2:L' + LOG_ROWS).setNumberFormat('0.0');
  log.getRange('M2:M' + LOG_ROWS).setNumberFormat('#,##0');
  log.getRange('C2:E' + LOG_ROWS).setHorizontalAlignment('center');
  [[1, 88], [2, 175], [3, 62], [4, 50], [5, 45], [6, 150]].forEach(w => log.setColumnWidth(w[0], w[1]));
  log.setColumnWidths(7, 11, 80);
  if (log.getColumnGroupDepth(7) === 0) log.getRange('G:Q').shiftColumnGroupDepth(1);
  log.getColumnGroup(7, 1).collapse();

  // Lift Stats
  const ls = get('Lift Stats');
  band(ls, 'A2:J' + EX_ROWS);
  ls.getRange('A2:A' + EX_ROWS).setFontWeight('bold');
  ls.getRange('B2:H' + EX_ROWS).setHorizontalAlignment('center');
  ls.getRange('H2:H' + EX_ROWS).setNumberFormat('0.0');
  ls.getRange('I2:I' + EX_ROWS).setBackground('#ecfdf5');
  ls.getRange('I1').setBackground('#047857');
  ls.setFrozenColumns(1);

  // Weekly
  const wk = get('Weekly');
  wk.getRange(2, 2, WEEKS, MUSCLES.length + 3).setHorizontalAlignment('center');
  wk.getRange(1, 1, 1, MUSCLES.length + 4).setWrap(true);
  wk.setRowHeight(1, 48);

  // Body
  const body = get('Body');
  band(body, 'A2:I' + BODY_ROWS);
  body.getRange('B2:C' + BODY_ROWS).setNumberFormat('0.0');
  body.getRange('D2:D' + BODY_ROWS).setNumberFormat('0.0');
  body.getRange('E2:E' + BODY_ROWS).setNumberFormat('#,##0');
  body.getRange('F2:F' + BODY_ROWS).setNumberFormat('0');
  body.getRange('B2:G' + BODY_ROWS).setHorizontalAlignment('center');
  body.getRange('C2:C' + BODY_ROWS).setFontWeight('bold');
  [[1, 95], [8, 160], [9, 200]].forEach(w => body.setColumnWidth(w[0], w[1]));

  // Wearable / Exercises / Settings
  band(get('Wearable'), 'A2:I2000');
  get('Wearable').getRange('B2:I2000').setHorizontalAlignment('center');
  const ex = get('Exercises');
  band(ex, 'A2:K' + EX_ROWS);
  ex.getRange('A2:A' + EX_ROWS).setFontWeight('bold');
  ex.getRange('E2:H' + EX_ROWS).setHorizontalAlignment('center');
  ex.setFrozenColumns(1);
  const st = get('Settings');
  st.getRange('B2:B8').setBackground('#fef9c3').setFontWeight('bold').setHorizontalAlignment('center');
  st.getRange('C2:C8').setFontColor('#6b7280');

  // Dashboard: no gridlines, title + date line, KPI "card"
  const db = get('Dashboard');
  db.setHiddenGridlines(true);
  db.getRange('A1').setFontSize(22).setFontColor('#111827');
  db.getRange('A2').setFormula('="As of "&TEXT(TODAY(),"ddd d mmm yyyy")').setFontColor('#6b7280').setFontSize(10);
  db.setRowHeight(1, 40);
  db.getRange('A4:B4').setFontSize(11);
  db.getRange('B4').setBorder(true, true, true, true, false, false, '#ca8a04', SpreadsheetApp.BorderStyle.SOLID);
  db.getRange('A5:C5').setBackground('#111827').setFontColor('#ffffff').setFontWeight('bold');
  db.getRange('A5').setValue('This week at a glance');
  db.getRange('A6:C14').setBackground('#f9fafb').setFontSize(11);
  db.getRange('A6:A14').setFontColor('#374151');
  db.getRange('B6:B14').setFontSize(14).setFontWeight('bold').setFontColor('#111827');
  db.getRange('C6:C14').setFontColor('#6b7280').setHorizontalAlignment('center');
  db.getRange('A5:C14').setBorder(true, true, true, true, false, true, '#e5e7eb', SpreadsheetApp.BorderStyle.SOLID);
  for (let r = 6; r <= 14; r++) db.setRowHeight(r, 30);
  const good = '#047857', bad = '#b91c1c';
  const rule = (f, color, a1) => SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied(f)
    .setFontColor(color).setRanges([db.getRange(a1)]).build();
  db.setConditionalFormatRules([
    rule('=AND(ISNUMBER($B$7),$B$7<0)', good, 'B7'),
    rule('=AND(ISNUMBER($B$7),$B$7>0)', bad, 'B7'),
    rule('=AND(ISNUMBER($B$10),$B$10>0)', good, 'B10'),
    rule('=AND(ISNUMBER($B$11),ISNUMBER($C$11),ABS($B$11-$C$11)<=150)', good, 'B11'),
    rule('=AND(ISNUMBER($B$11),ISNUMBER($C$11),ABS($B$11-$C$11)>150)', bad, 'B11'),
    rule('=AND(ISNUMBER($B$12),$B$12>=$C$12)', good, 'B12'),
    rule('=AND(ISNUMBER($B$12),$B$12<$C$12)', bad, 'B12'),
    rule('=AND(ISNUMBER($B$13),$B$13>=$C$13)', good, 'B13'),
    rule('=AND(ISNUMBER($B$13),$B$13<$C$13)', bad, 'B13'),
  ]);

  // Guide: readable text, no gridlines
  const gd = get('Guide');
  gd.setHiddenGridlines(true);
  gd.getRange('A2:A40').setFontSize(11).setWrap(true);
  gd.getRange('A1').setFontSize(20);

  Logger.log('Polish done.');
}

/**
 * FIX (run once, safe): rewrites the auto-calculated Log K (load) and N (PR) formulas.
 * Only touches grey formula columns; your typed sets are not changed.
 */
function fixFormulas() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Log');
  if (!sh) throw new Error('Tracker not found.');
  let last = LOG_ROWS;
  while (last < sh.getMaxRows() && sh.getRange(last + 1, 11).getFormula() !== '') last += 500;
  last = Math.min(last, sh.getMaxRows());
  fillDown(sh, 'K', 2, last, LOG_K_FORMULA);
  fillDown(sh, 'N', 2, last, LOG_N_FORMULA);
  Logger.log('Formulas fixed for rows 2-' + last + '.');
}

/**
 * FIX (run once, safe to repeat): Dashboard weight numbers stay right when you add a past day's weight,
 * body fat shows the value from the latest date, and Log weights never show "80." with a trailing dot.
 * Only touches formula/format cells; your typed data is not changed.
 */
function applyReviewFixes() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cd = ss.getSheetByName('ChartData'), db = ss.getSheetByName('Dashboard'), log = ss.getSheetByName('Log');
  if (!cd || !db || !log) throw new Error('Tracker not found.');
  cd.getRange('A2').setFormula(CHARTDATA_BODY_FORMULA);
  db.getRange('B8').setFormula(BODYFAT_FORMULA);
  log.getRange('C2:C' + log.getMaxRows()).setNumberFormat('General');
  log.getRange('K2:K' + log.getMaxRows()).setNumberFormat('0.0');
  Logger.log('Review fixes applied.');
}

/**
 * RESET PRs (run once, safe to repeat): new gym = new baseline. Puts the date in Settings B9 "PR count from"
 * (only if B9 is still empty), then rewrites the Log N (PR) and Lift Stats H (best) formulas to count only sets
 * from that date. Your typed sets are not changed. To reset again later, just type a new date in Settings B9.
 */
function resetPRs() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const st = ss.getSheetByName('Settings'), ls = ss.getSheetByName('Lift Stats');
  if (!st || !ls) throw new Error('Tracker not found.');
  if (st.getRange('A9').getValue() === '') st.getRange('A9:C9').setValues([PR_SETTING]);
  if (st.getRange('B9').getValue() === '') st.getRange('B9').setValue(new Date(2026, 9, 31));
  st.getRange('B9').setNumberFormat('yyyy-mm-dd').setBackground('#fef9c3').setFontWeight('bold').setHorizontalAlignment('center');
  st.getRange('C9').setFontColor('#6b7280');
  ss.setNamedRange('PRFrom', st.getRange('B9'));
  fixFormulas(); // Log K + N
  fillDown(ls, 'H', 2, EX_ROWS, LIFT_BEST_FORMULA);
  Logger.log('PRs now count from ' + st.getRange('B9').getDisplayValue() + '.');
}
