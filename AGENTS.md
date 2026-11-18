# Instructions for coding agents

Read README.md and docs/PRIVACY.md first. app/ and inbox/ are separate Apps Script projects.
Never read or publish real health records, credentials or Script Properties. Keep secrets out of prompts and files.
Ask the owner before uploads, deployments, Git pushes, changing live Sheets, or destructive operations.
Never run setup() on an existing tracker. Use a new migration function for upgrades.
Preserve existing user edits and back up files before editing.
Run node tests/run-tests.js after source changes and python tools/check_privacy.py before publication.
Tests mock Google's services. Report live checks separately and honestly.
Keep the main app restricted to Only myself. Review optional inbox exposure with the owner.
Do not clone/create a clasp project over existing source. Keep private .clasp.json files untracked.
