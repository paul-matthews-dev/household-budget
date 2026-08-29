const express = require('express');
const fs = require('fs');
const path = require('path');
const trading212 = require('./trading212');
const bankHolidays = require('./bankholidays');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = process.env.DATA_FILE || '/data/budget.json';

const DEFAULT_DATA = {
  person1Name: "Person 1",
  person2Name: "Person 2",
  // splitPercent is person1's share of a bill. Omitted on a bill means "use the
  // household default below"; the top-level splitPercent is that default.
  splitPercent: 50,
  householdBills: [
    { name: "Rent / Mortgage", amount: 0, category: "housing", subtitle: "" },
    { name: "Electric & Gas", amount: 0, category: "utilities", subtitle: "" },
    { name: "Water", amount: 0, category: "utilities", subtitle: "" },
    { name: "Internet", amount: 0, category: "utilities", subtitle: "" },
    { name: "Council Tax", amount: 0, category: "housing", subtitle: "" },
    { name: "Food Shopping", amount: 0, category: "food", subtitle: "" },
  ],
  person1Expenses: [
    { name: "Phone Bill", amount: 0, subtitle: "" },
  ],
  person2Expenses: [
    { name: "Phone Bill", amount: 0, subtitle: "" },
  ],
  person1Pay: 0,
  person2Pay: 0,
  // Day of month the pay lands, or 'last' for the last working day.
  person1PayDay: "last",
  person2PayDay: 25,
  savings: [],
  goals: [],
  // Projected from the balance, not from payment history.
  mortgage: { lender: "", balance: 0, balanceManual: false, originalAmount: 0, rate: 0, payment: 0, overpayment: 0, startDate: "", rateExpiry: "" },
  t212CashRate: 0,
  extraIncome: [],
  notes: "",
};

// Ensure data directory exists
const dataDir = path.dirname(DATA_FILE);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Initialise data file if it doesn't exist
if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(DEFAULT_DATA, null, 2));
  console.log('Created default budget data at', DATA_FILE);
}

// --- Backups -----------------------------------------------------------------
// One snapshot per day, kept for two weeks, written beside the live file. Saves
// land every few seconds while someone is editing, so snapshotting on every
// write would be pointless churn - the first write of a day captures the state
// the previous day ended in, which is what you actually want to roll back to.
const BACKUP_DIR = path.join(dataDir, 'backups');
const BACKUP_KEEP = 14;

function snapshotIfNeeded() {
  try {
    if (!fs.existsSync(DATA_FILE)) return;
    if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const name = `budget-${new Date().toISOString().slice(0, 10)}.json`;
    const target = path.join(BACKUP_DIR, name);
    if (fs.existsSync(target)) return;
    fs.copyFileSync(DATA_FILE, target);
    const stale = fs.readdirSync(BACKUP_DIR)
      .filter((f) => f.startsWith('budget-') && f.endsWith('.json'))
      .sort()
      .slice(0, -BACKUP_KEEP);
    stale.forEach((f) => fs.unlinkSync(path.join(BACKUP_DIR, f)));
  } catch (err) {
    // A failed snapshot must never block a save.
    console.error('Snapshot failed:', err.message);
  }
}

function listBackups() {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs.readdirSync(BACKUP_DIR)
    .filter((f) => /^budget-\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort()
    .reverse()
    .map((name) => {
      const stat = fs.statSync(path.join(BACKUP_DIR, name));
      return { name, date: name.slice(7, 17), size: stat.size, savedAt: stat.mtime.toISOString() };
    });
}

// An uploaded file is untrusted: keep only keys we know, coerce them to the
// right type, and let DEFAULT_DATA fill the rest. Anything unrecognised is
// dropped rather than written to disk.
const num = (v, fallback = 0) => (typeof v === 'number' && isFinite(v) ? v : fallback);
const str = (v, fallback = '') => (typeof v === 'string' ? v : fallback);
const list = (v) => (Array.isArray(v) ? v : []);
const isoDay = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '');
const payDay = (v, fallback) =>
  v === 'last' ? 'last' : (typeof v === 'number' && isFinite(v) && v >= 1 && v <= 31 ? Math.round(v) : fallback);

function sanitise(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  if (!Array.isArray(input.householdBills)) return null; // not a budget document
  return {
    person1Name: str(input.person1Name, DEFAULT_DATA.person1Name),
    person2Name: str(input.person2Name, DEFAULT_DATA.person2Name),
    person1Pay: num(input.person1Pay),
    person2Pay: num(input.person2Pay),
    person1PayDay: payDay(input.person1PayDay, DEFAULT_DATA.person1PayDay),
    person2PayDay: payDay(input.person2PayDay, DEFAULT_DATA.person2PayDay),
    splitPercent: Math.min(100, Math.max(0, num(input.splitPercent, 50))),
    t212CashRate: num(input.t212CashRate),
    notes: str(input.notes),
    householdBills: list(input.householdBills).map((b) => ({
      name: str(b && b.name, 'Untitled'),
      amount: num(b && b.amount),
      subtitle: str(b && b.subtitle),
      category: str(b && b.category, 'other'),
      ...(typeof b?.splitPercent === 'number' ? { splitPercent: Math.min(100, Math.max(0, b.splitPercent)) } : {}),
      ...(typeof b?.dueDay === 'number' ? { dueDay: Math.min(31, Math.max(1, Math.round(b.dueDay))) } : {}),
    })),
    person1Expenses: list(input.person1Expenses).map((e) => ({ name: str(e && e.name, 'Untitled'), amount: num(e && e.amount), subtitle: str(e && e.subtitle) })),
    person2Expenses: list(input.person2Expenses).map((e) => ({ name: str(e && e.name, 'Untitled'), amount: num(e && e.amount), subtitle: str(e && e.subtitle) })),
    extraIncome: list(input.extraIncome).map((e) => ({ name: str(e && e.name, 'Untitled'), amount: num(e && e.amount), subtitle: str(e && e.subtitle) })),
    savings: list(input.savings).map((a) => ({
      id: str(a && a.id) || Math.random().toString(36).slice(2, 10),
      name: str(a && a.name, 'Untitled'),
      holder: str(a && a.holder, 'Joint'),
      balance: num(a && a.balance),
      interestRate: num(a && a.interestRate),
      subtitle: str(a && a.subtitle),
    })),
    mortgage: {
      lender: str(input.mortgage && input.mortgage.lender),
      balance: num(input.mortgage && input.mortgage.balance),
      balanceManual: input.mortgage && input.mortgage.balanceManual === true,
      originalAmount: num(input.mortgage && input.mortgage.originalAmount),
      rate: num(input.mortgage && input.mortgage.rate),
      payment: num(input.mortgage && input.mortgage.payment),
      overpayment: num(input.mortgage && input.mortgage.overpayment),
      startDate: isoDay(input.mortgage && input.mortgage.startDate),
      rateExpiry: isoDay(input.mortgage && input.mortgage.rateExpiry),
    },
    goals: list(input.goals).map((g) => ({
      id: str(g && g.id) || Math.random().toString(36).slice(2, 10),
      name: str(g && g.name, 'Untitled'),
      target: num(g && g.target),
      saved: num(g && g.saved),
      monthly: num(g && g.monthly),
      accountIds: list(g && g.accountIds).filter((id) => typeof id === 'string'),
      subtitle: str(g && g.subtitle),
    })),
  };
}

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// GET budget data
app.get('/api/budget', (req, res) => {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    res.json(JSON.parse(raw));
  } catch (err) {
    console.error('Error reading budget:', err);
    res.json(DEFAULT_DATA);
  }
});

// PUT (save) budget data
app.put('/api/budget', (req, res) => {
  try {
    const data = req.body;
    snapshotIfNeeded();
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
    res.json({ ok: true, savedAt: new Date().toISOString() });
  } catch (err) {
    console.error('Error saving budget:', err);
    res.status(500).json({ error: 'Failed to save' });
  }
});

// Download the live document as a file. Deliberately reads from disk rather than
// taking the client's copy, so a what-if session can't export made-up figures.
app.get('/api/backup', (req, res) => {
  try {
    let file = DATA_FILE;
    let name = `budget-${new Date().toISOString().slice(0, 10)}.json`;

    // ?snapshot=budget-YYYY-MM-DD.json downloads one of the daily snapshots.
    if (req.query.snapshot) {
      name = path.basename(String(req.query.snapshot));
      if (!/^budget-\d{4}-\d{2}-\d{2}\.json$/.test(name)) {
        return res.status(400).json({ error: 'Unknown snapshot' });
      }
      file = path.join(BACKUP_DIR, name);
      if (!fs.existsSync(file)) return res.status(404).json({ error: 'That snapshot no longer exists' });
    }

    const raw = fs.readFileSync(file, 'utf8');
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.send(raw);
  } catch (err) {
    console.error('Error reading budget for backup:', err);
    res.status(500).json({ error: 'Could not read the budget file' });
  }
});

// Daily snapshots available to roll back to.
app.get('/api/backups', (req, res) => {
  try {
    res.json({ backups: listBackups(), keep: BACKUP_KEEP });
  } catch (err) {
    console.error('Error listing backups:', err);
    res.json({ backups: [], keep: BACKUP_KEEP });
  }
});

// Restore, from either an uploaded document ({ data }) or a daily snapshot
// ({ snapshot }). The current file is snapshotted first, so a restore is itself
// undoable. Responds with the document now on disk.
app.post('/api/restore', (req, res) => {
  try {
    let incoming = req.body && req.body.data;

    if (req.body && req.body.snapshot) {
      const name = path.basename(String(req.body.snapshot));
      if (!/^budget-\d{4}-\d{2}-\d{2}\.json$/.test(name)) {
        return res.status(400).json({ error: 'Unknown snapshot' });
      }
      const file = path.join(BACKUP_DIR, name);
      if (!fs.existsSync(file)) return res.status(404).json({ error: 'That snapshot no longer exists' });
      incoming = JSON.parse(fs.readFileSync(file, 'utf8'));
    }

    const clean = sanitise(incoming);
    if (!clean) return res.status(400).json({ error: "That doesn't look like a budget backup" });

    snapshotIfNeeded();
    fs.writeFileSync(DATA_FILE, JSON.stringify(clean, null, 2));
    res.json({ ok: true, data: clean, restoredAt: new Date().toISOString() });
  } catch (err) {
    console.error('Error restoring budget:', err);
    res.status(400).json({ error: 'Could not read that file' });
  }
});

// England & Wales bank holidays, so a payday can roll back off one.
app.get('/api/bank-holidays', async (req, res) => {
  res.json(await bankHolidays.getHolidays({ refresh: req.query.refresh === '1' }));
});

// Trading 212 ISA snapshot. Read-only, cached server-side; the API key stays here.
app.get('/api/trading212', async (req, res) => {
  const snapshot = await trading212.getSnapshot({ refresh: req.query.refresh === '1' });
  res.json(snapshot);
});

// SPA fallback. Express 5's router no longer accepts '*' as a path, so this is
// a terminal middleware rather than a wildcard route.
app.use((req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Budget tracker running on http://0.0.0.0:${PORT}`);
  console.log(`Trading 212: ${trading212.isConfigured() ? 'configured' : 'not configured (set T212_API_KEY)'}`);
});
