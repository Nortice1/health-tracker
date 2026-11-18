# Health Tracker

A personal Google Sheets database with a mobile web app for strength training, body measurements, meals, cardio, and wearable data. Optional Gemini Coach can answer questions and propose log entries for you to confirm.

Each person installs their own copy in their Google account. This repository contains software, not a hosted service or a shared health database.

## Choose your setup guide

- **No coding agent, no terminal:** [Manual setup](docs/SETUP_MANUAL.md). Copy the files into Google's Apps Script editor.
- **With Codex, Claude Code, or another coding agent:** [Agent setup](docs/SETUP_AGENT.md). Includes a prompt and local development workflow.
- **After installation:** [Daily use](docs/USAGE.md).
- **Optional iPhone integration:** [Apple Health sync](docs/APPLE_HEALTH.md).
- **Before publishing your own fork:** [Privacy and release checks](docs/PRIVACY.md).

## Features

- Train: log sets, reps, weights and effort; rest timer and progression suggestions.
- Stats: lifting history, muscle volume, body trends and training calendar.
- Body: daily measurements and nutrition totals.
- Coach: text or food photos, proposed changes with confirmation cards, saved food favorites.
- Cardio: manual logging, TCX import, and a 4x4 interval timer.
- Optional receiver for Apple Health metrics sent by an iPhone Shortcut.

## Requirements and defaults

A Google account and a desktop browser for setup; a phone browser for daily logging. Node.js is only needed for local tests or clasp development. Gemini requires your own API key and is optional; availability, quotas and prices depend on Google.

Defaults are examples: kg, Bangkok time, English/Thai Coach replies, a Push/Pull/Legs-based rotation, and sample nutrition settings. Change them for yourself. Heart-rate calculations use an example age of 30 and resting HR of 60 until you edit them. These are not personalized training or nutrition prescriptions.

## Repository

| Folder | Purpose |
| --- | --- |
| `app/` | Sheet setup, mobile interface, Coach and cardio |
| `inbox/` | Optional separate Apple Health receiver |
| `tests/` | Offline Node.js tests with mock services and example fixtures |
| `docs/` | Setup, usage and privacy guides |

The main app must be deployed for **Only myself**. Do not make it public: it runs with the owner's access to their health database. The optional inbox has a different access model, explained in its guide.

## Validation

Run `node tests/run-tests.js` and `python tools/check_privacy.py` from this directory. Tests use mocks; they do not prove Google authorization, deployment, or Gemini connectivity. A fresh Google-account installation still needs the smoke check in the manual guide.

## Data and AI

Logs live in your Google Sheet; favorites, API key and some preferences live in Apps Script Properties. Coach requests send tracker context, chat text and attached images to Gemini. Context includes recent logs and older summaries, potentially including notes. Review Google's current API data terms before enabling it. Charts/fonts are loaded from external services in the browser. AI nutrition estimates need checking and this app is not medical advice.

This public copy excludes the original owner's identifiers, personal profile, local configuration, private notes, backups and generated previews. It has no inherited Git history. No license has been selected yet; public visibility alone does not grant an open-source license.
