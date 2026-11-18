# Setup with a coding agent

Use Codex, Claude Code, or another agent that can read local files. You still own the Google account, authorize permissions, choose targets, and enter secrets yourself. An agent is optional for daily use; the app runs in Google's infrastructure.

## Give your agent this prompt

```text
Help me install this Health Tracker in my own Google account.
Read README.md, docs/SETUP_MANUAL.md, docs/PRIVACY.md and AGENTS.md first.
Check all app sources before uploading. Work only in my local copy.
Use a new blank Sheet and its bound Apps Script project, not an existing database.
Ask me for my spreadsheet ID, timezone, and which optional features I want.
Help me replace YOUR_SPREADSHEET_ID and set consistent timezones.
Show me where to enter my own age/resting HR locally; keep those private.
Explain sample nutrition settings and exercise rotation; let me choose my values.
Run the offline test suite and privacy scan before any upload.
Show the exact destination script and changed files before asking me to authorize
any clasp push, deployment or other external write. I handle sign-in and API keys.
Use docs/SETUP_MANUAL.md for setup and private web app deployment.
Never rerun setup on a sheet with data. Never read or publish personal logs,
credentials, API keys or Script Properties. Do not upload private config to GitHub.
Finish with the manual guide's smoke check, stating what was actually verified.
```

## Local development with clasp (optional)

Install a supported Node.js release and Git. Follow Google's [clasp guide](https://developers.google.com/apps-script/guides/clasp) for installation, login and enabling the Apps Script API. CLI commands can differ by version; check `clasp --help`.

1. Download or clone this repository and open it in your agent.
2. Create the blank Sheet and its **bound** script through **Extensions > Apps Script**. Find the script ID under Project Settings. Spreadsheet ID and script ID are different.
3. In `app/`, create an untracked `.clasp.json` using `.clasp.example.json` as a template. Replace the placeholder with **your new bound script ID**, and keep `rootDir` as `.`.
4. Personalize the code as described in the manual guide, including the spreadsheet ID in `webapp.gs`.
5. Run the tests from the repository root:

```sh
node tests/run-tests.js
python tools/check_privacy.py
```

6. Inspect `clasp status` from `app/`. It should include only that project's sources and manifest. Review the destination in `.clasp.json`. Once you authorize the upload, run `clasp push` there. Do not use `clasp create` inside these source folders; it can overwrite the manifest. Do not pull or clone over these sources.
7. Run `setup` in the Google editor once on the blank sheet; use the manual guide to deploy privately and finish setup. If using Coach, enter the API key yourself in the app or Script Properties; never put it in a prompt or source file.

The inbox uses its own standalone Apps Script project and separate `.clasp.json`. Never upload both folders to one project.

## Maintaining your installation

Ask the agent for a diff, offline checks, and a migration plan before an update. Back up the Sheet first. Keep your private installation separate from a sanitized public release. `.gitignore` cannot protect IDs you paste into a tracked `.gs` or `.html` file: the privacy scan intentionally flags a personalized installation before GitHub publishing.

The suite uses mocks. A passing run is not proof that a live upload, authorization, or model request works. Do not let an agent claim a live test without performing it in your own account with your permission.
