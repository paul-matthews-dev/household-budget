# Household Budget

A simple budget tracker for splitting expenses between two people. Runs as a single-page PWA with a Node.js backend that persists data to a JSON file.

![Node](https://img.shields.io/badge/node-20--alpine-green) ![Express](https://img.shields.io/badge/express-4.x-lightgrey) ![Docker](https://img.shields.io/badge/docker-compose-blue)

## Features

- **Customisable names** — set your own names on first use, editable any time from the overview tab
- **50/50 bill splitting** — household bills are split evenly, with per-person leftover calculations
- **Personal expenses** — separate expense tracking per person
- **Additional income** — add extra income lines (child benefit, side income, etc.) beyond base pay
- **Savings tracker** — track accounts with balances, interest rates, and annual/monthly earnings
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
public/index.html    — Single-file React 18 frontend (CDN-loaded, no build step)
server/index.js      — Express server with two API endpoints
/data/budget.json    — JSON file storing all budget state
```

### API

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/budget` | Load budget data |
| `PUT` | `/api/budget` | Save entire budget state |

### Stack

- **Backend:** Node.js + Express — serves static files and a REST API
- **Frontend:** React 18 + Babel (in-browser transpilation) — no bundler, no build step
- **Styling:** CSS-in-JS via a shared style object — no external CSS framework
- **Drag & drop:** [SortableJS](https://sortablejs.github.io/Sortable/) via CDN
- **Data:** Single JSON file on disk, read/written with `fs`

## Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `PORT` | `3000` | Server port |
| `DATA_FILE` | `/data/budget.json` | Path to the JSON data file |

The Docker Compose setup maps port `3001` on the host to `3000` in the container and uses a named volume (`budget_data`) for persistence.
