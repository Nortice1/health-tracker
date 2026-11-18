# Optional Apple Health sync

Skip this entirely if you do not use an iPhone. The main app works independently. The receiver accepts metrics already present in Apple Health; connecting a particular wearable depends on that device/app's current integration.

## Deploy a separate receiver

1. Finish main app setup first. Create a **new standalone** project at [Apps Script](https://script.google.com/).
2. Paste `inbox/inbox.gs` into its script file. Show the manifest in Project Settings and paste `inbox/appsscript.json` into it. Do not use the main app's script project.
3. Replace `YOUR_SPREADSHEET_ID` in `inbox.gs` with your own Sheet ID. Set its `TZ` and manifest timeZone to match the main app.
4. Run `setupInbox`, authorize Sheet access, and copy the generated `INBOX_KEY` from the execution log privately. This secret authorizes writes. Do not share logs/screenshots containing it.
5. Deploy as a Web app, **execute as Me**, accessible to **Anyone** (including callers without sign-in). This is required because the Shortcut cannot sign in to Google. If your organization blocks this, skip the receiver.
6. Save the receiver's `/exec` URL privately. Never reuse this access setting on the main app.

This endpoint is internet-accessible and relies on its secret key. It accepts writes to today's/yesterday's health rows and does not return stored Sheet data. It is an optional personal integration, not a general public API. To rotate a leaked key, rerun `setupInbox` and update every Shortcut that uses it.

## Build the Shortcut, start small

1. On iPhone open Shortcuts, add a shortcut called Health Sync.
2. Add **Find Health Samples** for Steps, filtering yesterday 00:00 through today 00:00. Disable Limit. Choose one source to avoid counting phone and wearable steps twice.
3. Use **Calculate Statistics > Sum**, and store the result as `Steps`.
4. Add **URL** with your receiver's `/exec` URL, then **Get Contents of URL**. Set method **POST**, request body **JSON**. Add text field `key` with your secret and numeric field `steps` with the Steps variable. Do not paste the example placeholder key below literally.
5. Read the response and confirm `ok: true`, then verify the **yesterday** row in Wearable. The receiver uses its current date/time, not a client-supplied date.

Example request shape (illustrative values only):

```json
{"key":"YOUR_PRIVATE_INBOX_KEY","steps":5000}
```

After this works, add other fields. Missing values can be omitted. Do not send zero for a missing measurement. Send optional fields in separate requests if a missing Health sample interrupts your Shortcut.

| JSON field | Apple Health value | Receiver writes |
| --- | --- | --- |
| `steps` | Yesterday's total steps | Yesterday, Wearable |
| `azm` | Yesterday's exercise minutes | Yesterday, Wearable active-minutes column; exercise minutes are not necessarily the same as a wearable's weighted zone minutes |
| `kcal` | Yesterday's energy total in kcal, using a consistent source/definition | Yesterday, Wearable calories-out column |
| `rhr` | Latest resting HR, bpm | Today, Wearable |
| `hrv` | Latest HRV, ms | Today, Wearable; definitions can differ between devices |
| `weight` | Latest weight in kg | Today, Body |
| `bf` | Latest body fat, percent (fraction also supported) | Today, Body |
| `sleep` | Stage text described below | Today, Wearable sleep/deep/REM |

For sleep, Find Health Samples for Sleep in the last day, **Limit off**. Repeat through all samples. In each iteration create `Value|StartDateISO|EndDateISO`, using ISO 8601 timestamps including time zone; join the results with newlines. Send the combined text as `sleep`. The receiver merges overlapping intervals in its recent-night window and excludes Awake/In Bed. Test with your own source; localized stage names may need mapping to Asleep/Core/Deep/REM/Awake/In Bed.

Prefer current samples for weight and resting HR because the receiver assigns them to today. For energy, do not label active-only calories as total daily expenditure. After manual tests pass, create a daily personal automation at a suitable time and allow required Health/network permissions. iOS action wording and background permissions vary by version; verify a scheduled run in your Sheet before relying on it.

If you get Wrong key, check the Shortcut against the current `INBOX_KEY`. If nothing arrives, inspect the Shortcut response and Apps Script execution log privately. A `GET` response saying the inbox is running proves reachability only; it does not test authenticated writes.
