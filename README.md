<p align="center">
  <img src="public/icons/icon-192.png" alt="Household Budget" width="96">
</p>

<h1 align="center">Household Budget</h1>

<p align="center">A simple budget tracker for splitting expenses between two people. Runs as a single-page PWA with a Node.js backend that persists data to a JSON file.</p>

![Node](https://img.shields.io/badge/node-24--alpine-green) ![Express](https://img.shields.io/badge/express-5.x-lightgrey) ![Docker](https://img.shields.io/badge/docker-compose-blue)

## Features

- **Customisable names** — set your own names on first use, editable any time from the overview tab
- **Adjustable bill splitting** — a household default split set with a slider, and a per-bill override for anything that shouldn't follow it, with per-person leftover calculations
- **Bill categories** — tag each bill (housing, utilities, food, transport, insurance, childcare, fun, health) and see where the money goes in a donut breakdown
- **Personal expenses** — separate expense tracking per person
- **Additional income** — add extra income lines (child benefit, side income, etc.) beyond base pay
- **Savings tracker** — track accounts with balances, interest rates, and annual/monthly earnings
- **Savings goals** — set a target, back it with one or more savings accounts (or track it by hand), and get a projected completion date that compounds the accounts' blended interest
- **Due dates** — give a bill the day it leaves the account and the overview lists what's due in the next 7 days
- **What-if mode** — try changes to pay, bills or splits without saving; keep them or throw them away
- **Backup & restore** — download the whole budget as a JSON file, restore from one, or roll back to an automatic daily snapshot (the last 14 are kept on the server)
- **Trading 212 ISA** — live Stocks & Shares ISA tracking via the Trading 212 API: uninvested cash, invested value, unrealised P/L, and a holdings breakdown. Interest on the uninvested cash rolls into the savings interest totals
- **Drag to reorder** — rearrange items in any list via drag handle (touch and mouse)
- **Inline editing** — tap any name, amount, or subtitle to edit in place
- **Delete confirmation** — two-step delete to prevent accidental removal
- **Auto-save** — changes are debounced and saved to disk automatically
- **PWA** — installable on mobile, works offline after first load

## Quick Start

### Docker (recommended)

```bash
docker compose up -d --build
```

The app will be available at `http://localhost:3001`.

### Local

```bash
npm install
npm start
```

The app will be available at `http://localhost:3000`. Data is saved to `/data/budget.json` by default — override with the `DATA_FILE` environment variable:

```bash
DATA_FILE=./budget.json npm start
```

## Architecture

```
public/index.html    — Single-file React 19 frontend (CDN ES modules, no build step)
server/index.js      — Express server and API endpoints
server/trading212.js — Read-only Trading 212 API client (cached, rate-limit aware)
/data/budget.json    — JSON file storing all budget state
/data/t212-cache.json — Last good Trading 212 snapshot, for offline/outage fallback
```

### API

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/budget` | Load budget data |
| `PUT` | `/api/budget` | Save entire budget state |
| `GET` | `/api/trading212` | Trading 212 ISA snapshot (`?refresh=1` bypasses the cache) |
| `GET` | `/api/backup` | Download the saved budget as a file (`?snapshot=budget-YYYY-MM-DD.json` for a daily snapshot) |
| `GET` | `/api/backups` | List the daily snapshots on disk |
| `POST` | `/api/restore` | Restore from an uploaded document (`{ data }`) or a snapshot (`{ snapshot }`) |

### Stack

- **Backend:** Node.js 24 + Express 5 — serves static files and a REST API
- **Frontend:** React 19 as ES modules via an import map — no bundler, no build step, no transpiler
- **Styling:** CSS-in-JS via a shared style object — no external CSS framework
- **Drag & drop:** [SortableJS](https://sortablejs.github.io/Sortable/) via CDN
- **Data:** Single JSON file on disk, read/written with `fs`

## Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `PORT` | `3000` | Server port |
| `DATA_FILE` | `/data/budget.json` | Path to the JSON data file |
| `T212_API_KEY` | _(unset)_ | Trading 212 API key. ISA tracking stays hidden until this is set |
| `T212_API_SECRET` | _(unset)_ | Only if your key was issued as a key/secret pair |
| `T212_ENV` | `live` | `live` or `demo` |
| `T212_CACHE_TTL` | `300` | Seconds to cache the Trading 212 response |

### Trading 212 setup

Generate a **read-only** API key in the Trading 212 app under Settings → API, then copy `.env.example` to `.env` and fill it in:

```bash
cp .env.example .env
$EDITOR .env
docker compose up -d --build
```

`.env` is gitignored, and the key is only ever read server-side — it is never sent to the browser.

The interest rate paid on uninvested ISA cash is not exposed by the Trading 212 API, so it's set by hand: tap the rate on the ISA card in the Savings tab.

The Docker Compose setup maps port `3001` on the host to `3000` in the container and uses a named volume (`budget_data`) for persistence.
