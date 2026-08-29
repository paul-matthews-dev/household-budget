# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

A household budget tracker for splitting expenses between two people. Names are configurable in the UI. Single-page PWA with a Node.js/Express backend that persists to a JSON file; runs as a Docker container.

## Architecture

- **Backend:** `server/index.js` — Express 5 server, REST API plus static files. No build step.
- **Frontend:** `public/index.html` — the entire app, one `<script type="module">` block. React 19 + ReactDOM are ES modules from a CDN via `<script type="importmap">`; SortableJS is a separate CDN `<script>` exposing a `Sortable` global.
- **Trading 212:** `server/trading212.js` — read-only client for the Trading 212 public API, tracking a Stocks & Shares ISA. Server-side only; the API key is never sent to the browser.
- **Data:** all budget state in one JSON file (`/data/budget.json` in the container, Docker volume `budget_data`), read/written directly with `fs`. `DEFAULT_DATA` in `server/index.js` is seeded on first run.
- **API:** `GET /api/budget`, `PUT /api/budget` (saves the entire state, debounced 500ms client-side), `GET /api/trading212` (`?refresh=1` bypasses the cache), `GET /api/backup`, `GET /api/backups`, `POST /api/restore`.
- **Backups:** one snapshot per day in `<data dir>/backups`, written by `snapshotIfNeeded()` on the first save of the day (so it captures the state the *previous* day ended in) and pruned to the last 14. A snapshot failure is logged and swallowed — it must never block a save. Restores snapshot first, so they're undoable.
- **Uploaded documents are untrusted.** `sanitise()` in `server/index.js` is an allow-list: unknown keys are dropped, types coerced, `dueDay`/`splitPercent` clamped, and anything without a `householdBills` array is rejected as not-a-budget. Snapshot names are matched against `budget-YYYY-MM-DD.json` and `basename`d before they touch the filesystem. Extend `sanitise()` whenever you add a field, or restores will silently drop it.

## Commands

```bash
npm start                        # http://localhost:3000
DATA_FILE=./budget.json npm start   # local run without writing to /data

docker compose up -d --build     # production, http://localhost:3001
docker compose down
docker compose logs -f budget
```

No test framework, no linter, no build step — the app is intentionally minimal.

## Frontend constraints

These are deliberate; don't "fix" them:

- **No JSX.** There is no transpiler, so every component is `React.createElement(...)`. Babel was removed because it transpiled nothing.
- **Keep the import map.** React 19 ships no UMD build, so it can't be a `<script src>` global. The import map is what makes the no-build-step approach work.
- **Inline styles only**, via the shared `s` object (CSS-in-JS) and the `c` colour palette it is built from — take colours from `c`, don't hardcode new hex values. The only CSS classes are `.font-mono`, `.drag-handle`, `.tabs`, and Sortable's `.sortable-ghost`.
- **Responsive without media queries** — grids use `repeat(auto-fit, minmax(...))` (`s.grid()`) and the hero figure uses `clamp()`, so there are no breakpoints to keep in sync.
- **Delete buttons live inside the card they delete from**, as the trailing child of `ItemRow` (or of the header row on a savings card). They are two-tap: the first tap arms `DeleteButton` for 3s.
- **PWA is manifest + icons only** — there is no service worker, so "offline" means whatever the browser cached.

## State model

- `App` holds the whole budget in one `data` object and calls `save(newData)` for every edit — an immutable spread of the previous state, then a debounced PUT of the whole document.
- Data keys use `person1`/`person2` naming (`person1Pay`, `person1Expenses`, `person1Name`), which is what lets `PersonTab` and `updatePersonalExpense(who, ...)` be shared by both people via `who + "Expenses"` key building.
- Lists in `data`: `householdBills`, `person1Expenses`, `person2Expenses`, `savings`, `extraIncome`, `goals`. All are reordered through the generic `reorderList(key, oldIndex, newIndex)` and rendered inside `SortableList`.
- Savings accounts carry a generated `id`. A one-off effect in `App` back-fills ids on older documents, because **goals reference accounts by id** (`goal.accountIds`) — never by index or name, both of which move. The Trading 212 ISA can back a goal too: it appears in the account picker as a virtual account with the reserved id `t212-isa` (`T212_ACCOUNT_ID`), balance = the ISA total and a blended rate of cash-rate diluted over the whole balance. Only that id is saved — the live figures stay in `t212`. If a goal links the ISA while the figures are missing, `isaPending` is set and it counts as 0 rather than falling back to the stale manual `saved`. A goal with no linked accounts tracks its own `saved` figure instead; `goalState()` resolves the two and blends the linked accounts' interest rate for the projection.
- A bill's optional `dueDay` is a day-of-month, not a date. `nextDueDate()` clamps it to short months, so a 31st bill lands on the 28th in February rather than skipping it.
- Bills are split by percentage, personal expenses are per person. `data.splitPercent` is the household default (person1's share, 50 if absent) and a bill's own `splitPercent` overrides it; `splitOf(bill)` in `App` resolves the two. Person2 always takes the remainder, so the shares add back up to the bill exactly. The legacy `splitEvenly` flag on old bills is ignored. A bill only shows a split chip when it overrides the default; otherwise the per-person figure under the amount is the button that opens `SplitSlider`.
- The donut on the Bills tab draws its slices in `CATEGORIES` order, not by size — that fixed order is what keeps adjacent slices colourblind-safe. It caps at six slices plus Other. The hues are the validated dark-mode categorical slots; if you change them, re-run the data-viz palette validator against the card surface (`#141d30`) before shipping.
- Each bill has a `category` id from the module-level `CATEGORIES` list. **The ids are a contract with saved data** — relabel or recolour them freely, but don't rename an id. Unknown or missing ids fall back to `other` via `categoryOf()`.
- Derived totals are computed inline in `App` on each render, not stored.
- Tabs: `overview`, `bills`, `savings`, `person1`, `person2`.
- The backup panel opens from a 🗄 icon button in the header (not the Overview tab) and closes on Escape or a backdrop click. It downloads via a plain `<a href="/api/backup" download>` and restores through the server, which reads and writes the file itself — the client never exports its own in-memory copy, so a what-if session can't export invented figures. Restore is disabled while `sandbox` is set.
- **What-if mode**: `sandbox` holds the real document while the user experiments. `save()` checks `sandboxRef` and returns before the PUT, so sandboxed edits render but never reach the disk; discard restores the snapshot, keep PUTs the current state. Entering flushes any pending debounced save first, so nothing half-written is lost.
- **Live Trading 212 figures live in a separate `t212` state, never in `data`.** `data` is PUT back wholesale, so anything merged into it would be written to disk and would clobber server-side values.

## Trading 212

- Config is env-only: `T212_API_KEY`, `T212_API_SECRET` (only for key/secret pairs), `T212_ENV` (`live`|`demo`), `T212_CACHE_TTL`. Set them in `.env` beside `docker-compose.yml` — see `.env.example`. `.env` is gitignored; never commit the key.
- `getSnapshot()` never throws. On any upstream failure it returns the last good snapshot with `stale: true` and an `error` string, so an outage degrades the Savings tab rather than breaking it. Preserve that contract.
- Caching is layered: in-memory cache with TTL, single-flight `inFlight` promise, exponential backoff on 429s, and last-good snapshots persisted to `/data/t212-cache.json` (survives cold starts) plus a daily instrument-name cache in `/data/t212-instruments.json`. These are deliberately *not* in `budget.json`.
- Instrument names are optional garnish — a failure there must never fail or delay the figures.
- The uninvested-cash interest rate is not available from the API. It's stored as `t212CashRate` in `budget.json` and edited on the ISA card in the Savings tab.

## Gotchas

- Express 5's router rejects `'*'` as a path, so the SPA fallback in `server/index.js` is a terminal `app.use()` middleware, not a wildcard route.
- The container listens on 3000 and is mapped to **3001** on the host.
- `DATA_FILE` controls the JSON path (default `/data/budget.json`); `server/trading212.js` derives its cache paths from that same directory.
