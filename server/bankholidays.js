/**
 * UK bank holidays, from gov.uk's free feed (https://www.gov.uk/bank-holidays.json).
 *
 * England & Wales only — that's the division that decides when pay actually
 * lands for this household. No API key and no rate limit worth worrying about,
 * but the dates only change once a year, so this refreshes daily at most and
 * keeps a copy on disk beside the other caches. Like the Trading 212 client,
 * getHolidays() never throws: on any failure it returns the last known dates
 * with `stale: true`, so a payday still resolves (weekends only) rather than
 * the countdown breaking.
 */

const fs = require('fs');
const path = require('path');

const FEED = 'https://www.gov.uk/bank-holidays.json';
const DIVISION = 'england-and-wales';
const TTL = 24 * 60 * 60 * 1000;

const DATA_DIR = path.dirname(process.env.DATA_FILE || '/data/budget.json');
const CACHE_FILE = path.join(DATA_DIR, 'bank-holidays.json');

let cache = null;     // last good { dates, fetchedAt }
let inFlight = null;  // single-flight promise

// A cold start with the network down still knows last year's dates.
try {
  const raw = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
  if (raw && Array.isArray(raw.dates)) cache = raw;
} catch { /* no cache yet */ }

async function fetchFresh() {
  const res = await fetch(FEED, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`gov.uk returned ${res.status}`);
  const body = await res.json();
  const events = (body && body[DIVISION] && body[DIVISION].events) || [];
  const dates = events
    .map((e) => e && e.date)
    .filter((d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort();
  if (!dates.length) throw new Error('gov.uk returned no England & Wales dates');
  return { dates, fetchedAt: new Date().toISOString() };
}

async function getHolidays({ refresh = false } = {}) {
  const fresh = cache && Date.now() - Date.parse(cache.fetchedAt) < TTL;
  if (cache && fresh && !refresh) return { ...cache, stale: false };

  if (!inFlight) {
    inFlight = fetchFresh()
      .then((data) => {
        cache = data;
        try {
          fs.writeFileSync(CACHE_FILE, JSON.stringify(data));
        } catch (err) {
          console.error('bank holidays: could not write', CACHE_FILE, err.message);
        }
        return data;
      })
      .finally(() => { inFlight = null; });
  }

  try {
    return { ...(await inFlight), stale: false };
  } catch (err) {
    console.error('bank holidays: fetch failed —', err.message);
    return { dates: [], ...(cache || {}), stale: true, error: err.message };
  }
}

module.exports = { getHolidays };
