const { google } = require('googleapis');
const express = require('express');
const app = express();
const path = require('path');
const fs = require('fs');
require('dotenv').config(); // Load environment variables from .env
const cors = require('cors');

// Middleware to parse JSON requests
app.use(express.json());

// Enable CORS for your frontend domain (adjust accordingly)
app.use(cors({
  origin: 'https://app.trendmysong.com',  // Change to your frontend URL
  methods: ['GET', 'POST'],
  allowedHeaders: ['Authorization', 'Content-Type']
}));

// Specific redirect for /demo to demo.html
app.get('/demo', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'demo.html'));
});

// Clean URL middleware - handle routes without .html extension (BEFORE static files)
app.use((req, res, next) => {
  // Skip if it's an API route or already has an extension
  if (req.path.startsWith('/') && !req.path.includes('.') && !req.path.startsWith('/check-email') && 
      !req.path.startsWith('/set-password') && !req.path.startsWith('/validate-login') && 
      !req.path.startsWith('/get-sheet-data') && !req.path.startsWith('/get-sheet-summary') && 
      !req.path.startsWith('/get-requests') && !req.path.startsWith('/current-core') && 
      !req.path.startsWith('/yt-claims') && !req.path.startsWith('/tracks-usage')) {
    
    const htmlPath = path.join(__dirname, 'public', req.path + '.html');
    
    // Check if the HTML file exists and prioritize it over folders
    if (fs.existsSync(htmlPath)) {
      return res.sendFile(htmlPath);
    }
  }
  next();
});


// 1. Serve static files (AFTER clean URL middleware)
app.use(express.static(path.join(__dirname, 'public')));


// Google API Authentication using service account
const auth = new google.auth.GoogleAuth({
  keyFile: process.env.GOOGLE_SHEET_KEY_FILE_PATH, // Path to your service account key file
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const sheets = google.sheets({ version: 'v4', auth });
const spreadsheetId = process.env.SHEET_ID; // Spreadsheet ID from environment


// ---------------------- BCRYPT-------------------------------

const bcrypt = require('bcrypt');
const SALT_ROUNDS = 12;

// Helpers to read portal rows and find a user by email
async function getPortalRows(client) {
  const res = await sheets.spreadsheets.values.get({
    auth: client,
    spreadsheetId,
    range: 'portal!A:D', // A: email, B: password/hash, C: key, D: username
  });
  return res.data.values || [];
}

function findUserByEmail(rows, email) {
  const idx = rows.findIndex(r => (r[0] || '').toLowerCase() === (email || '').toLowerCase());
  if (idx === -1) return null;
  const row = rows[idx];
  return {
    // 1-based index for Sheets write operations
    rowIndex: idx + 1,
    email: row[0] || '',
    storedPass: row[1] || '',  // hash or legacy plain
    key: row[2] || '',
    username: row[3] || '',
  };
}


// ------------------ LOGIN & AUTHENTICATION ------------------

// Check if email exists and whether a password is set (no secrets returned)
app.post('/check-email', async (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'Email required' });

  try {
    const client = await auth.getClient();
    const rows = await getPortalRows(client);
    const user = findUserByEmail(rows, email);

    if (!user) return res.json({ exists: false });

    const hasPassword = !!user.storedPass;
    return res.json({
      exists: true,
      hasPassword,
      username: user.username || null, // optional (display only)
      // DO NOT return password or key here
    });
  } catch (err) {
    console.error('Error checking email:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});


// Requires: bcrypt, getPortalRows(), findUserByEmail() helpers from earlier
app.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  try {
    const client = await auth.getClient();
    const rows = await getPortalRows(client); // reads portal!A:D
    const user = findUserByEmail(rows, email);
    // user = { rowIndex, email, storedPass, key, username }

    // 1) Email check
    if (!user || !user.storedPass) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // 2) Username gate FIRST (no hashing/writes before this)
    if (user.username !== 'TMSP') {
      // Fail closed — don’t leak whether password is right or wrong
      return res.status(403).json({ error: 'Access denied' });
    }

    // 3) Password check
    let ok = false;
    const isBcryptHash =
      user.storedPass.startsWith('$2a$') ||
      user.storedPass.startsWith('$2b$') ||
      user.storedPass.startsWith('$2y$');

    if (isBcryptHash) {
      ok = await bcrypt.compare(password, user.storedPass);
    } else {
      // legacy plain text
      ok = password === user.storedPass;
      // Only upgrade to bcrypt *after* username gate passed AND password correct
      if (ok) {
        const newHash = await bcrypt.hash(password, SALT_ROUNDS);
        await sheets.spreadsheets.values.update({
          auth: client,
          spreadsheetId,
          range: `portal!B${user.rowIndex}:B${user.rowIndex}`,
          valueInputOption: 'RAW',
          resource: { values: [[newHash]] },
        });
      }
    }

    if (!ok) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Success — safe to return identity payload
    return res.json({ username: user.username, key: user.key });
  } catch (err) {
    console.error('Error during login:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});



// Update password for a given email
// Set/initialize password for an existing user (hash it)
app.post('/set-password', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  if (password.length < 8) return res.status(400).json({ error: 'Weak password' });

  try {
    const client = await auth.getClient();
    const rows = await getPortalRows(client);
    const user = findUserByEmail(rows, email);
    if (!user) return res.status(404).json({ error: 'Email not found' });

    // 🚨 Username gate BEFORE password hashing
    if (user.username !== 'TMSP') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const hash = await bcrypt.hash(password, SALT_ROUNDS);

    // Update password hash
    await sheets.spreadsheets.values.update({
      auth: client,
      spreadsheetId,
      range: `portal!B${user.rowIndex}:B${user.rowIndex}`,
      valueInputOption: 'RAW',
      resource: { values: [[hash]] },
    });

    // Return identity payload so the client can store/display
    return res.json({ success: true, username: user.username, key: user.key });
  } catch (err) {
    console.error('Error setting password:', err);
    return res.status(500).json({ error: 'Failed to update password' });
  }
});

// Validate login key and get sheet name
app.post('/validate-login', (req, res) => {
  const { loginKey } = req.body;

  let sheetName = process.env[loginKey];

  if (sheetName) {
    sheetName = sheetName.replace(/-/g, ' '); // Replace "-" with space
    res.json({ valid: true, sheetName });
  } else {
    res.json({ valid: false });
  }
});

// ------------------ CATALOG ------------------

// Get filtered catalog data based on sheetName and key
app.get('/get-sheet-data', async (req, res) => {
  const { sheetName, key } = req.query;

  if (!key) {
    res.status(400).send('Key query parameter is required');
    return;
  }

  try {
    // Note: Your code uses a fixed sheet "CSV", adjust if you want dynamic sheetName usage
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `CSV!A:I`,
    });

    const rows = response.data.values;

    if (!rows || rows.length === 0) {
      res.json({ data: [] });
      return;
    }

    // Filter rows where column C matches the key and no #N/A or N/A cells
    const filteredRows = rows.slice(1).filter(row =>
      row[2] === key &&
      row.some(cell => cell) &&
      !row.some(cell => cell === '#N/A' || cell === 'N/A')
    );

    res.json({ data: filteredRows });
  } catch (error) {
    console.error('Error: Catalog Fetching (Contact the Support Team)', error);
    res.status(500).send('Error catalog fetching');
  }
});

// ------------------ INSIGHTS ------------------

// Get summary data filtered by key
app.get('/get-sheet-summary', async (req, res) => {
  const key = req.query.key;

  if (!key) {
    res.status(400).send('Key query parameter is required');
    return;
  }

  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'portal!A:Q',
    });

    const rows = response.data.values || [];

    // Filter rows by key (column C)
    const filteredRows = rows.filter(row => row[2] === key);

    const structuredData = filteredRows.map(row => ({
      Copyrighted: row[4] === "Copyrighted" ? "Approved" : (row[4] || "N/A"),
      'In Progress': row[5] || 'N/A',
      'In Review': row[6] || 'N/A',
      Rejected: row[7] || 'N/A',
      Total: row[8] || 'N/A',
      Plan: row[9] || 'N/A',
      'Start Date': row[10] || 'N/A',
      'Due to': row[11] || 'N/A',
      'Total Revenue': row[12] || 'N/A',
      'Copyright Claims': row[13] || 'N/A',
      'UGC Videos': row[14] || 'N/A',
      Availability: row[15] || 'N/A',
      AvailabilityLimit: row[16] || 'N/A',
      Email: row[0] || 'N/A',
      Key: row[2] || 'N/A',
      User: row[3] || 'N/A',
    }));

    res.json(structuredData);
  } catch (error) {
    console.error('Error fetching data', error);
    res.status(500).send('Error fetching User Data');
  }
});

// ------------------ OTHER ROUTES ------------------

// Fetch filtered requests by key
app.get('/get-requests', async (req, res) => {
  const key = req.query.key;

  if (!key) {
    res.status(400).send('Key query parameter is required');
    return;
  }

  try {
    const client = await auth.getClient();

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Requests!F3:I',
      auth: client,
    });

    const rows = response.data.values || [];

    // Filter rows where first column (F) matches key
    const filteredRows = rows.filter(row => row[0] === key);

    res.json(filteredRows);
  } catch (error) {
    console.error('Error fetching requests:', error);
    res.status(500).send('Error: Fetching Requests');
  }
});

// Get current core value
app.get('/current-core', async (req, res) => {
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Multi-Core!J2',
    });

    const core = (response.data.values && response.data.values[0]) ? response.data.values[0][0] : 'N/A';

    res.json({ core });
  } catch (error) {
    console.error('Error: Profile Key Fetching (Contact the Support Team)', error.message);
    res.status(500).json({
      error: 'Unable to fetch the current core. Please contact support.',
    });
  }
});

// youtube claims fetching
app.get('/yt-claims', async (req, res) => {
  const key = req.query.key;

  if (!key) {
    res.status(400).send('Key query parameter is required');
    return;
  }

  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Analytics!A:G',
    });

    const rows = response.data.values || [];

    // Filter rows where:
    // A === key (column 0)
    // B === 'YT' (column 1)
    const filteredRows = rows.filter(row => row[0] === key && row[1] === 'YT');

    const structuredData = filteredRows.map(row => ({
      'Track Title': row[2] || 'N/A',
      Artist: row[3] || 'N/A',
      Views: row[4] || 'N/A',
      'Report Date': row[5] || 'N/A',
      Link: row[6] || 'N/A',
    }));

    res.json(structuredData);
  } catch (error) {
    console.error('Error fetching track usage data', error);
    res.status(500).send('Error fetching track usage data');
  }
});


// tracks usage fetching
app.get('/tracks-usage', async (req, res) => {
  const key = req.query.key;

  if (!key) {
    res.status(400).send('Key query parameter is required');
    return;
  }

  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Reports!A:J',
    });

    const rows = response.data.values || [];

    // Filter rows where column A (index 0) matches the key
    const filteredRows = rows.filter(row => row[0] === key);

    const structuredData = filteredRows.map(row => {
      const limit = row[7] && row[7].match(/\d+/g) ? row[7].match(/\d+/g).join('') : 'N/A';
      const usage = row[8] || 'N/A';

      // Initialize service status
      let YT = "Inactive";
      let SM = "Inactive";
      let DSP = "Inactive";
      let PM = "Inactive";

      const serviceCell = row[9] || '';
      if (serviceCell.includes('YT')) YT = "Active";
      if (serviceCell.includes('SM')) SM = "Active";
      if (serviceCell.includes('DSP')) DSP = "Active";
      if (serviceCell.includes('PM')) PM = "Active";

      return {
        limit,
        usage,
        service: { YT, SM, DSP, PM }
      };
    });

    res.json(structuredData);
  } catch (error) {
    console.error('Error fetching track usage data', error);
    res.status(500).send('Error fetching track usage data');
  }
});

// 404 handler - must be placed after all other routes and middleware
app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
});

// ------------------ START SERVER ------------------

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});