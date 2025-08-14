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

// ------------------ LOGIN & AUTHENTICATION ------------------

// Check if email exists and fetch password, key, username
app.post('/check-email', async (req, res) => {
  const { email } = req.body;

  try {
    const client = await auth.getClient();

    // Get email list from "portal" sheet
    const result = await sheets.spreadsheets.values.get({
      auth: client,
      spreadsheetId,
      range: 'portal!A:A',
    });

    const emailList = result.data.values || [];
    const emailRow = emailList.findIndex(row => row[0] === email);

    if (emailRow !== -1) {
      // Get password (col B), key (col C), username (col D)
      const [passwordResult, keyResult, usernameResult] = await Promise.all([
        sheets.spreadsheets.values.get({ auth: client, spreadsheetId, range: `portal!B${emailRow + 1}:B${emailRow + 1}` }),
        sheets.spreadsheets.values.get({ auth: client, spreadsheetId, range: `portal!C${emailRow + 1}:C${emailRow + 1}` }),
        sheets.spreadsheets.values.get({ auth: client, spreadsheetId, range: `portal!D${emailRow + 1}:D${emailRow + 1}` }),
      ]);

      const password = passwordResult.data.values?.[0]?.[0] || null;
      const key = keyResult.data.values?.[0]?.[0] || null;
      const username = usernameResult.data.values?.[0]?.[0] || null;

      res.json({ exists: true, password, key, username });
    } else {
      res.json({ exists: false });
    }
  } catch (error) {
    console.error('Error checking email:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Update password for a given email
app.post('/set-password', async (req, res) => {
  const { email, password } = req.body;

  try {
    const client = await auth.getClient();

    const result = await sheets.spreadsheets.values.get({
      auth: client,
      spreadsheetId,
      range: 'portal!A:A',
    });

    const emailList = result.data.values || [];
    const emailRow = emailList.findIndex(row => row[0] === email);

    if (emailRow !== -1) {
      const range = `portal!B${emailRow + 1}:B${emailRow + 1}`;
      const resource = { values: [[password]] };

      await sheets.spreadsheets.values.update({
        auth: client,
        spreadsheetId,
        range,
        valueInputOption: 'RAW',
        resource,
      });

      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'Email not found' });
    }
  } catch (error) {
    console.error('Error setting password:', error);
    res.status(500).json({ error: 'Failed to update password' });
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