# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

A simple household budget tracker for splitting expenses between two people. Names are configurable in the UI. It runs as a Docker container and is a single-page PWA with a Node.js/Express backend that persists data to a JSON file.

## Architecture

- **Backend:** `server/index.js` — Express server serving a REST API and static files. No build step.
- **Frontend:** `public/index.html` — Single-file React app using CDN-loaded React 18, ReactDOM, and Babel (in-browser JSX transpilation via `text/babel` script). No bundler, no npm frontend deps.
- **Data:** Budget state is stored in a single JSON file (`/data/budget.json` in the container, Docker volume `budget_data`). The server reads/writes this file directly with `fs`. Default data is seeded on first run if the file doesn't exist.
- **API:** Two endpoints only — `GET /api/budget` (load) and `PUT /api/budget` (save entire state). The frontend debounces saves (500ms).

## Commands

```bash
# Local development
npm start                    # runs on http://localhost:3000

# Docker (production)
docker compose up -d --build # builds and starts on port 3001
docker compose down
docker compose logs -f budget
```

## Key Details

- No test framework, no linter, no build step — the app is intentionally minimal.
- All frontend code lives in a single `<script type="text/babel">` block in `public/index.html`. React components use `React.createElement()` calls, not JSX (despite Babel being loaded).
- The frontend uses inline styles via a shared `s` object (CSS-in-JS pattern) — no CSS classes beyond `.font-mono` and `.group`.
- Bills are split 50/50 between two configurable people. Personal expenses are separate per person.
- Data keys use `person1`/`person2` naming (e.g. `person1Pay`, `person1Expenses`). Names stored in `person1Name`/`person2Name`.- The Docker container exposes port 3000 internally, mapped to **3001** on the host.
- `DATA_FILE` env var controls where the JSON file is stored (defaults to `/data/budget.json`).
