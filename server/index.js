const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = process.env.DATA_FILE || '/data/budget.json';

const DEFAULT_DATA = {
  person1Name: "Person 1",
  person2Name: "Person 2",
  householdBills: [
    { name: "Rent / Mortgage", amount: 0, splitEvenly: true, subtitle: "" },
    { name: "Electric & Gas", amount: 0, splitEvenly: true, subtitle: "" },
    { name: "Water", amount: 0, splitEvenly: true, subtitle: "" },
    { name: "Internet", amount: 0, splitEvenly: true, subtitle: "" },
    { name: "Council Tax", amount: 0, splitEvenly: true, subtitle: "" },
    { name: "Food Shopping", amount: 0, splitEvenly: true, subtitle: "" },
  ],
  person1Expenses: [
    { name: "Phone Bill", amount: 0, subtitle: "" },
  ],
  person2Expenses: [
    { name: "Phone Bill", amount: 0, subtitle: "" },
  ],
  person1Pay: 0,
  person2Pay: 0,
  savings: [],
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
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
    res.json({ ok: true, savedAt: new Date().toISOString() });
  } catch (err) {
    console.error('Error saving budget:', err);
    res.status(500).json({ error: 'Failed to save' });
  }
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Budget tracker running on http://0.0.0.0:${PORT}`);
});
