# Privacy and publication

## What this copy excludes

- Original spreadsheet, script and deployment IDs and live URLs.
- Owner name, education/profile text and original hard-coded age.
- Original README, agent memory/instructions and Shortcut history.
- `.clasp.json`, credentials, API keys, data exports, backups and generated previews.
- Existing Git history (the source project had no Git repository).

The code retains example exercises, nutrition defaults and offline mock fixtures. These are not a copy of the live Sheet. One detailed historical cardio fixture was replaced with a fictional example. This repository has not read or exported the live health database or Script Properties.

## Before publishing

Run `python tools/check_privacy.py`, run `node tests/run-tests.js`, and inspect the complete proposed file list and diff. The scanner detects common identifiers, credentials, paths and forbidden files; it cannot guarantee the absence of every kind of personal information. Keep personalized installations separate from the public source. A tracked source file can leak your Sheet ID or age even when `.clasp.json` is ignored.

Do not upload screenshots showing real records, keys or private deployment URLs. `.gitignore` does not remove files already committed. If credentials ever enter Git history, rotate them and clean history before publishing; deleting only the current file is insufficient.

The main web app must remain **Only myself**. The optional anonymous inbox requires a private key. Gemini is optional and receives tracker context, chat and any attached images when used. Treat access to the script and its Properties as access to secrets.

## Publication handoff

The owner chooses repository account/name, public/private visibility and license. No license is assumed. Initialize and commit only this sanitized folder, never the private working project. Inspect Git's staged file list and rerun the checks before pushing. Publishing code does not publish a working Google web app; each user deploys their own private instance.
