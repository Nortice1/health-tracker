# Setup without a coding agent

You need a Google account, a desktop browser, and about 20-30 minutes. No programming tools are required. Apple Health and Gemini are optional.

## 1. Download the code

On the repository page choose **Code > Download ZIP**, then extract it. Keep the `app` and `inbox` folders separate: they contain different Apps Script projects.

## 2. Create your database and bound script

1. Open [Google Sheets](https://sheets.new) and create a **blank** spreadsheet named Health Tracker.
2. Copy its ID: the part between `/d/` and `/edit` in the address. Keep it private.
3. Select **Extensions > Apps Script**. This creates a script bound to your new sheet.
4. Replace the default `Code.gs` contents with `app/setup_health_tracker.gs`. Rename it `setup_health_tracker` if desired.
5. Create four more **Script** files using the plus button. Copy the entire matching local file into each: `webapp.gs`, `coach.gs`, `coach_actions.gs`, and `cardio.gs`.

Exact script checklist: `setup_health_tracker`, `webapp`, `coach`, `coach_actions`, `cardio` — **five Script files total**. The editor adds `.gs` automatically. Do not add duplicates.

6. Create one **HTML** file named `Index`, and paste `app/Index.html` into it. Capitalization matters.
7. Under **Project Settings**, enable **Show appsscript.json manifest file in editor**. Replace its contents with `app/appsscript.json`.
8. In `webapp.gs`, replace `YOUR_SPREADSHEET_ID` with the ID from step 2, keeping the quotes.

## 3. Personalize before first use

- In `setup_health_tracker.gs`, find `buildSettings`. Its body weight, protein and calorie values are examples. You can change the Settings tab after setup instead.
- In `Index.html`, find `const AGE = 30, REST_HR = 60;` and replace both example values with your own before using heart-rate zones or TCX zone calculations. The timer also lets you save a measured max HR; that does not change the TCX age/resting-HR calculation.
- Time zone: the shipped default is `Asia/Bangkok`. If needed, replace it in `appsscript.json`, the `TZ` constant in `webapp.gs`, and `ss.setSpreadsheetTimeZone(...)` in `setup_health_tracker.gs`. Also replace the hard-coded `Asia/Bangkok` in `parseTcx` in `Index.html` so imported activities use your local day. Keep all time zones consistent.
- The default exercise list and training rotation are examples. Edit Exercises after setup. Advanced rotation changes are in `splitPlan_` in `webapp.gs` and the Coach prompt in `coach.gs`.

Save all files.

## 4. Initialize once

Select `setup` in the function dropdown and click **Run**. Review the requested Google permissions. If an unverified-app screen appears, confirm this is your own script and the code you just copied before continuing. Managed school/work accounts may block this; ask the administrator or use a permitted personal account.

Return to Sheets. You should see Dashboard, Log, Lift Stats, Weekly, Body, Wearable, Exercises, Settings, Guide and ChartData (hidden). Meals and Cardio are created when their features first need them.

**Run `setup()` only on this blank sheet, once. It can rebuild tabs and erase existing data.** Future upgrades must use dedicated migrations, never setup again.

## 5. Deploy the phone app

1. In Apps Script choose **Deploy > New deployment**.
2. Choose type **Web app**.
3. Set **Execute as: Me** and **Who has access: Only myself**.
4. Deploy and authorize as requested. Copy your web app URL ending in `/exec`.
5. Open it on your phone, signed in to the same Google account. Bookmark it or add it to your home screen.

Keep the sheet and script sharing private too. Do not select Anyone for the main app.

## 6. Optional Gemini Coach

Create your own API key in [Google AI Studio](https://aistudio.google.com/). Review [API terms](https://ai.google.dev/gemini-api/terms) and pricing first; a free quota is not guaranteed.

In the Apps Script editor, run `authorizeCoach` once. Open the app's Coach tab, paste your key into its setup field and save. The key is stored in Script Properties, not source code. Never commit or send it to a coding agent.

The model fallback list is `GEMINI_MODELS` in `coach.gs`; availability changes. If none works, consult the [current Gemini models](https://ai.google.dev/gemini-api/docs/models) and use an available text/image model supporting function calling. A previously working model is cached as `GEMINI_MODEL` in Script Properties; clear that property if it is obsolete. Redeploy after source changes.

## 7. Smoke check

- Open Train, Stats and Body; each should load with an empty database.
- Log one clearly marked test set and verify it appears in Log. Use the app's undo to remove it.
- Save a body entry and verify the matching Body date; inspect totals and dates in your own time zone.
- If Coach is enabled, ask a question, then propose a test meal. Confirm that nothing writes until you tap Save. Check the Meals row after saving; remove the test via the Coach's confirmation card if desired.
- Check that another account cannot open your main app. Do not share your real health data as test evidence.

## Updates and common problems

For updates, first copy your Sheet as a backup, and save the existing source. Replace only the files changed by the update. Never rerun setup. Choose **Deploy > Manage deployments > Edit > Version: New version > Deploy** to update the existing URL.

| Symptom | Check |
| --- | --- |
| Spreadsheet not found / cannot open | `SHEET_ID`, executing Google account and sheet permissions |
| Blank app or missing function | All five `.gs` files plus `Index.html`; no duplicate Code.gs; save and redeploy |
| Old interface | Update the deployment version, then reload the `/exec` URL |
| Wrong day | Script, sheet, code and optional inbox time zones |
| Coach missing key or permission | Save your own key and run `authorizeCoach` |
| Coach quota/model error | API project quota, billing and supported model IDs |
| Cannot deploy as Only myself | Organization policy; do not work around this by making health data public |

Google references: [web app deployment](https://developers.google.com/apps-script/guides/web), [deployment updates](https://developers.google.com/apps-script/concepts/deployments).
