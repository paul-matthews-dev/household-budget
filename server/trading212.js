/**
 * Trading 212 public API client.
 *
 * Reads a Stocks & Shares ISA's cash position and open holdings. Read-only —
 * nothing here places or cancels orders.
 *
 * The API key is server-side only and is never included in anything returned
 * from this module, so it cannot leak to the browser.
 */

const fs = require('fs');
const path = require('path');

const API_KEY = process.env.T212_API_KEY || '';
const API_SECRET = process.env.T212_API_SECRET || '';
const ENV = process.env.T212_ENV === 'demo' ? 'demo' : 'live';
const BASE = `https://${ENV}.trading212.com/api/v0`;
const TTL = (Number(process.env.T212_CACHE_TTL) || 300) * 1000;

const DATA_DIR = path.dirname(process.env.DATA_FILE || '/data/budget.json');
const SNAPSHOT_FILE = path.join(DATA_DIR, 't212-cache.json');
const INSTRUMENTS_FILE = path.join(DATA_DIR, 't212-instruments.json');
const INSTRUMENTS_TTL = 24 * 60 * 60 * 1000;

const isConfigured = () => Boolean(API_KEY);

// Trading 212's docs describe Basic auth over key:secret; keys issued by older
// versions of the app are a single token sent raw. Support whichever is set.
function authHeader() {
  if (API_SECRET) {
    return 'Basic ' + Buffer.from(`${API_KEY}:${API_SECRET}`).toString('base64');
  }
  return API_KEY;
}

// --- cache state -------------------------------------------------------------

let cache = null;          // last good { cash, positions, fetchedAt }
let inFlight = null;       // single-flight promise, so concurrent callers share one fetch
let backoffUntil = 0;      // set when we get a 429
let backoffMs = 0;
let instruments = null;    // ticker -> display name
let instrumentsFetchedAt = 0;

// Restore the last snapshot so a cold start with the API down still shows figures.
try {
  const raw = JSON.parse(fs.readFileSync(SNAPSHOT_FILE, 'utf8'));
  if (raw && raw.cash) cache = raw;
} catch { /* no snapshot yet */ }

try {
  const raw = JSON.parse(fs.readFileSync(INSTRUMENTS_FILE, 'utf8'));
  if (raw && raw.map) {
    instruments = raw.map;
    instrumentsFetchedAt = raw.fetchedAt || 0;
  }
} catch { /* no instrument cache yet */ }

function writeJson(file, value) {
  try {
    fs.writeFileSync(file, JSON.stringify(value));
  } catch (err) {
    console.error('t212: could not write', file, err.message);
  }
}

// --- HTTP --------------------------------------------------------------------

class RateLimited extends Error {
  constructor(retryAfterMs) {
    super('Rate limited by Trading 212');
    this.retryAfterMs = retryAfterMs;
  }
}

async function get(endpoint) {
  const res = await fetch(`${BASE}/${endpoint}`, {
    headers: { Authorization: authHeader(), Accept: 'application/json' },
    signal: AbortSignal.timeout(15000),
  });

  if (res.status === 429) {
    const retryAfter = Number(res.headers.get('retry-after'));
    throw new RateLimited(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 0);
  }
  if (res.status === 401 || res.status === 403) {
    throw new Error('Trading 212 rejected the API key (check T212_API_KEY and its scopes)');
  }
  if (!res.ok) {
    throw new Error(`Trading 212 returned ${res.status} for ${endpoint}`);
  }
  return res.json();
}

/**
 * Ticker -> display name. Large payload behind a tight rate limit, so it is
 * fetched at most daily and treated as entirely optional: any failure just
 * leaves positions labelled by ticker.
 */
async function refreshInstruments() {
  if (instruments && Date.now() - instrumentsFetchedAt < INSTRUMENTS_TTL) return;
  try {
    const list = await get('equity/metadata/instruments');
    if (!Array.isArray(list)) return;
    const map = {};
    for (const item of list) {
      if (item && item.ticker && item.name) map[item.ticker] = item.name;
    }
    instruments = map;
    instrumentsFetchedAt = Date.now();
    writeJson(INSTRUMENTS_FILE, { fetchedAt: instrumentsFetchedAt, map });
  } catch (err) {
    console.warn('t212: instrument names unavailable —', err.message);
  }
}

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

function shapePosition(p) {
  const quantity = num(p.quantity);
  const currentPrice = num(p.currentPrice);
  const averagePrice = num(p.averagePrice);
  // ppl is the position's unrealised P/L; fxPpl is the currency component of it,
  // reported separately for holdings not priced in the account currency.
  const ppl = num(p.ppl) + num(p.fxPpl);
  const cost = quantity * averagePrice;
  return {
    ticker: p.ticker,
    name: (instruments && instruments[p.ticker]) || p.ticker,
    quantity,
    averagePrice,
    currentPrice,
    value: quantity * currentPrice,
    ppl,
    pplPercent: cost > 0 ? (ppl / cost) * 100 : 0,
  };
}

async function fetchFresh() {
  const [cash, portfolio] = await Promise.all([
    get('equity/account/cash'),
    get('equity/portfolio'),
  ]);

  // Names are a nicety — never let them delay or fail the figures.
  await refreshInstruments().catch(() => {});

  const free = num(cash.free);
  const total = num(cash.total);

  return {
    cash: {
      free,                            // uninvested cash, the interest-earning part
      invested: num(cash.invested),    // cost basis of holdings
      total,                           // whole account value
      holdingsValue: total - free,     // holdings at current market value
      ppl: num(cash.ppl),              // unrealised P/L across the account
      result: num(cash.result),        // realised P/L
      pieCash: num(cash.pieCash),
      blocked: num(cash.blocked),
    },
    positions: Array.isArray(portfolio) ? portfolio.map(shapePosition) : [],
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * Returns the ISA snapshot, serving from cache unless it has aged past the TTL.
 *
 * Never throws: on any upstream failure it falls back to the last good snapshot
 * marked `stale`, so a Trading 212 outage degrades the Savings tab rather than
 * breaking it.
 */
async function getSnapshot({ refresh = false } = {}) {
  if (!isConfigured()) return { configured: false };

  const fresh = cache && Date.now() - Date.parse(cache.fetchedAt) < TTL;
  if (cache && fresh && !refresh) return { configured: true, ...cache, stale: false };

  // Honour our own backoff rather than hammering a rate limit we've already hit.
  if (Date.now() < backoffUntil) {
    return {
      configured: true,
      ...(cache || {}),
      stale: true,
      error: 'Rate limited by Trading 212 — showing the last known figures',
    };
  }

  if (!inFlight) {
    inFlight = fetchFresh()
      .then((data) => {
        cache = data;
        backoffMs = 0;
        writeJson(SNAPSHOT_FILE, data);
        return data;
      })
      .finally(() => { inFlight = null; });
  }

  try {
    const data = await inFlight;
    return { configured: true, ...data, stale: false };
  } catch (err) {
    if (err instanceof RateLimited) {
      backoffMs = err.retryAfterMs || Math.min(Math.max(backoffMs * 2, 30000), 15 * 60 * 1000);
      backoffUntil = Date.now() + backoffMs;
    }
    console.error('t212: fetch failed —', err.message);
    return { configured: true, ...(cache || {}), stale: true, error: err.message };
  }
}

module.exports = { getSnapshot, isConfigured };
