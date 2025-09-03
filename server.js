// server.js

const { google } = require('googleapis');
const express = require('express');
const app = express();
const path = require('path');
const fs = require('fs');
require('dotenv').config();
const cors = require('cors');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');

// ---- Fetch polyfill for Node <18 ----
let _fetch = global.fetch;
if (typeof _fetch !== 'function') {
  _fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));
}

/* =========================
 *  CORE MIDDLEWARE (TOP)
 * ========================= */
app.disable('x-powered-by');

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});

// Parsers BEFORE any routes
app.use(cookieParser());
app.use(express.json({ limit: '50kb' }));

// CORS (keep only if you truly need cross-origin; same-origin panels don’t need this)
app.use(
  cors({
    origin: process.env.FRONTEND_ORIGIN || 'https://app.trendmysong.com',
    methods: ['GET', 'POST', 'PATCH'],
    allowedHeaders: ['Authorization', 'Content-Type'],
    credentials: true
  })
);

/* ===============
 *  GOOGLE SHEETS
 * =============== */
const auth = new google.auth.GoogleAuth({
  keyFile: process.env.GOOGLE_SHEET_KEY_FILE_PATH,
  scopes: ['https://www.googleapis.com/auth/spreadsheets']
});
const sheets = google.sheets({ version: 'v4', auth });
const spreadsheetId = process.env.SHEET_ID;

/* =============
 *  AUTH CONFIG
 * ============= */
const ADMIN_PASS = process.env.ADMIN_PASS || '';
const SESSION_SECRET = process.env.SESSION_SECRET || '';
const COOKIE_NAME = 'tms_admin';
const isProd = process.env.NODE_ENV === 'production';
const baseCookieOptions = {
  httpOnly: true,
  secure: isProd,       // must be true on HTTPS
  sameSite: 'strict',   // set to 'none' if doing cross-site cookies
  path: '/'
};

if (!ADMIN_PASS) console.warn('[WARN] ADMIN_PASS not set in .env');
if (!SESSION_SECRET || SESSION_SECRET.length < 32) {
  console.warn('[WARN] SESSION_SECRET missing/short (>=32 chars recommended)');
}

/* ==================
 *  AUTH HELPERS
 * ================== */
const sha256Hex = s => crypto.createHash('sha256').update(s, 'utf8').digest('hex');

function safeCompareHex(aHex, bHex) {
  const a = Buffer.from(aHex, 'hex');
  const b = Buffer.from(bHex, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function sign(payload, secret) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verify(token, secret) {
  if (!token || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

function getSession(req) {
  const token = req.cookies[COOKIE_NAME];
  return verify(token, SESSION_SECRET);
}

function isAdmin(req) {
  const s = getSession(req);
  return !!(s && s.sub === 'admin');
}

// APIs → 401 JSON
function requireAdminAPI(req, res, next) {
  if (isAdmin(req)) return next();
  return res.status(401).json({ ok: false, error: 'Unauthorized' });
}

// HTML → 302 redirect to login
function requireAdminHTML(req, res, next) {
  if (isAdmin(req)) return next();
  return res.redirect(302, '/admin.html');
}

/* ===================
 *  RATE LIMIT (login)
 * =================== */
const attempts = new Map();
function rateLimitLogin(req, res, next) {
  const ip = req.ip || req.connection?.remoteAddress || 'x';
  const now = Date.now();
  const windowMs = 10 * 60 * 1000;
  const rec = attempts.get(ip) || { count: 0, resetAt: now + windowMs };
  if (now > rec.resetAt) {
    rec.count = 0;
    rec.resetAt = now + windowMs;
  }
  if (rec.count >= 20) return res.status(429).json({ error: 'Too many attempts. Try again later.' });
  rec.count++;
  attempts.set(ip, rec);
  next();
}

/* ======================
 *  CLEAN URLS & STATIC
 * ====================== */

// /demo → demo.html
app.get('/demo', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'demo.html'));
});

// Clean-URL middleware (BEFORE static)
app.use((req, res, next) => {
  if (
    req.path.startsWith('/') &&
    !req.path.includes('.') &&
    !req.path.startsWith('/check-email') &&
    !req.path.startsWith('/set-password') &&
    !req.path.startsWith('/validate-login') &&
    !req.path.startsWith('/get-sheet-data') &&
    !req.path.startsWith('/get-sheet-summary') &&
    !req.path.startsWith('/get-requests') &&
    !req.path.startsWith('/current-core') &&
    !req.path.startsWith('/yt-claims') &&
    !req.path.startsWith('/tracks-usage') &&
    !req.path.startsWith('/api/')        // never intercept APIs
  ) {
    const htmlPath = path.join(__dirname, 'public', req.path + '.html');
    if (fs.existsSync(htmlPath)) return res.sendFile(htmlPath);
  }
  next();
});

// Public static
app.use(
  express.static(path.join(__dirname, 'public'), {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-store');
    }
  })
);

/* =================
 *  ADMIN PANEL UI
 * =================
 * Serve /admin/panel/* from ./admin_panel but only if logged in
 * (Previously this used a single guard that produced 401 for HTML: fixed.)
 */
app.use(
  '/admin/panel',
  requireAdminHTML,
  express.static(path.join(__dirname, 'admin_panel'), {
    extensions: ['html'],
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-store');
    }
  })
);

// Convenience: /admin → login or panel
app.get('/admin', (req, res) => {
  if (isAdmin(req)) return res.redirect('/admin/panel');
  return res.redirect('/admin.html');
});

/* ================
 *  ADMIN SESSION
 * ================ */

// Login (set cookie)
app.post('/api/admin/login', rateLimitLogin, (req, res) => {
  const { password, remember } = req.body || {};
  if (typeof password !== 'string' || !password.length) {
    return res.status(400).json({ error: 'Password required' });
  }
  const provided = sha256Hex(password);
  const correct = sha256Hex(ADMIN_PASS);
  if (!safeCompareHex(provided, correct)) {
    return res.status(401).json({ error: 'Invalid password' });
  }
  const now = Date.now();
  const ttl = remember ? 30 * 24 * 60 * 60 * 1000 : 2 * 60 * 60 * 1000; // 30d vs 2h
  const token = sign({ sub: 'admin', iat: now, exp: now + ttl, v: 1 }, SESSION_SECRET);
  res.cookie(COOKIE_NAME, token, { ...baseCookieOptions, maxAge: ttl });
  res.json({ ok: true });
});

// Session probe
app.get('/api/admin/session', (req, res) => {
  return res.json({ ok: isAdmin(req) });
});

// Logout
app.post('/api/admin/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME, baseCookieOptions);
  res.json({ ok: true });
});

/* =========================
 *  ADMIN API (guarded 401)
 * ========================= */
async function forwardToMake(requestType, payload) {
  // HMAC body (kept compatible with your current webhook logic)
  const body = JSON.stringify({ request: requestType, ...payload });
  const sig = crypto
    .createHmac('sha256', process.env.MAKE_SIGNING_SECRET || 'dev')
    .update(body)
    .digest('hex');

  const r = await _fetch(process.env.MAKE_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Signature': sig },
    body
  });
  const text = (await r.text()).trim();
  return { ok: r.ok && text === 'approved', status: r.status, text };
}

app.post('/api/admin/remove', requireAdminAPI, async (req, res) => {
  const { user_id, email } = req.body || {};
  if (!user_id || !email) return res.status(400).json({ error: 'Missing fields' });
  try {
    const out = await forwardToMake('remove user', { user_id, email, requested_at_iso: new Date().toISOString() });
    return out.ok ? res.send('approved') : res.status(502).send(`upstream ${out.status}: ${out.text}`);
  } catch (e) {
    console.error('remove-user error', e);
    return res.status(500).json({ error: 'server error' });
  }
});

app.post('/api/admin/add-user', requireAdminAPI, async (req, res) => {
  const { email, total_paid_usd, track_count, date, services, services_raw, payment_method, payment_platform } =
    req.body || {};
  if (!email || !payment_method || !payment_platform) return res.status(400).json({ error: 'Missing fields' });
  try {
    const out = await forwardToMake('add user', {
      email,
      total_paid_usd,
      track_count,
      date,
      services,
      services_raw,
      payment_method,
      payment_platform,
      created_at_iso: new Date().toISOString()
    });
    return out.ok ? res.send('approved') : res.status(502).send(`upstream ${out.status}: ${out.text}`);
  } catch (e) {
    console.error('add-user error', e);
    return res.status(500).json({ error: 'server error' });
  }
});

app.post('/api/admin/reset-password', requireAdminAPI, async (req, res) => {
  const { user_id, email } = req.body || {};
  if (!user_id || !email) return res.status(400).json({ error: 'Missing fields' });
  try {
    const out = await forwardToMake('reset password', { user_id, email, requested_at_iso: new Date().toISOString() });
    return out.ok ? res.send('approved') : res.status(502).send(`upstream ${out.status}: ${out.text}`);
  } catch (e) {
    console.error('reset-pwd error', e);
    return res.status(500).json({ error: 'server error' });
  }
});

app.post('/api/admin/unblock', requireAdminAPI, async (req, res) => {
  const { user_id, email, reason } = req.body || {};
  if (!user_id || !email) return res.status(400).json({ error: 'Missing fields' });
  try {
    const out = await forwardToMake('unblock user', {
      user_id,
      email,
      reason,
      requested_at_iso: new Date().toISOString()
    });
    return out.ok ? res.send('approved') : res.status(502).send(`upstream ${out.status}: ${out.text}`);
  } catch (e) {
    console.error('unblock error', e);
    return res.status(500).json({ error: 'server error' });
  }
});

app.post('/api/admin/block', requireAdminAPI, async (req, res) => {
  const { user_id, email, reason } = req.body || {};
  if (!user_id || !email || !reason) return res.status(400).json({ error: 'Missing fields' });
  try {
    const out = await forwardToMake('block user', { user_id, email, reason, requested_at_iso: new Date().toISOString() });
    return out.ok ? res.send('approved') : res.status(502).send(`upstream ${out.status}: ${out.text}`);
  } catch (e) {
    console.error('block error', e);
    return res.status(500).json({ error: 'server error' });
  }
});

/* =======================================
 *  USER (PORTAL) ROUTES — unchanged
 * ======================================= */
const bcrypt = require('bcrypt');
const SALT_ROUNDS = 12;

async function getPortalRows(client) {
  const res = await sheets.spreadsheets.values.get({
    auth: client,
    spreadsheetId,
    range: 'portal!A:D'
  });
  return res.data.values || [];
}

function findUserByEmail(rows, email) {
  const idx = rows.findIndex(r => (r[0] || '').toLowerCase() === (email || '').toLowerCase());
  if (idx === -1) return null;
  const row = rows[idx];
  return {
    rowIndex: idx + 1,
    email: row[0] || '',
    storedPass: row[1] || '',
    key: row[2] || '',
    username: row[3] || ''
  };
}

// Check if email exists / whether a password is set
app.post('/check-email', async (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'Email required' });
  try {
    const client = await auth.getClient();
    const rows = await getPortalRows(client);
    const user = findUserByEmail(rows, email);
    if (!user) return res.json({ exists: false });
    const hasPassword = !!user.storedPass;
    return res.json({ exists: true, hasPassword, username: user.username || null });
  } catch (err) {
    console.error('Error checking email:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// User login (Sheets-backed users, not admin cookie)
app.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  try {
    const client = await auth.getClient();
    const rows = await getPortalRows(client);
    const user = findUserByEmail(rows, email);
    if (!user || !user.storedPass) return res.status(401).json({ error: 'Invalid credentials' });

    // Gate by username first
    if (user.username !== 'TMSP') return res.status(403).json({ error: 'Access denied' });

    let ok = false;
    const isBcryptHash =
      user.storedPass.startsWith('$2a$') || user.storedPass.startsWith('$2b$') || user.storedPass.startsWith('$2y$');
    if (isBcryptHash) {
      ok = await bcrypt.compare(password, user.storedPass);
    } else {
      ok = password === user.storedPass;
      if (ok) {
        const newHash = await bcrypt.hash(password, SALT_ROUNDS);
        await sheets.spreadsheets.values.update({
          auth: client,
          spreadsheetId,
          range: `portal!B${user.rowIndex}:B${user.rowIndex}`,
          valueInputOption: 'RAW',
          resource: { values: [[newHash]] }
        });
      }
    }

    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
    return res.json({ username: user.username, key: user.key });
  } catch (err) {
    console.error('Error during login:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Set password for a user
app.post('/set-password', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  if (password.length < 8) return res.status(400).json({ error: 'Weak password' });

  try {
    const client = await auth.getClient();
    const rows = await getPortalRows(client);
    const user = findUserByEmail(rows, email);
    if (!user) return res.status(404).json({ error: 'Email not found' });
    if (user.username !== 'TMSP') return res.status(403).json({ error: 'Access denied' });

    const hash = await bcrypt.hash(password, SALT_ROUNDS);
    await sheets.spreadsheets.values.update({
      auth: client,
      spreadsheetId,
      range: `portal!B${user.rowIndex}:B${user.rowIndex}`,
      valueInputOption: 'RAW',
      resource: { values: [[hash]] }
    });

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
    sheetName = sheetName.replace(/-/g, ' ');
    res.json({ valid: true, sheetName });
  } else {
    res.json({ valid: false });
  }
});

/* ================
 *  CATALOG / DATA
 * ================ */

// get-sheet-data
app.get('/get-sheet-data', async (req, res) => {
  const { sheetName, key } = req.query;
  if (!key) return res.status(400).send('Key query parameter is required');
  try {
    const response = await sheets.spreadsheets.values.get({ spreadsheetId, range: `CSV!A:I` });
    const rows = response.data.values || [];
    const filteredRows = rows.slice(1).filter(
      row => row[2] === key && row.some(cell => cell) && !row.some(cell => cell === '#N/A' || cell === 'N/A')
    );
    res.json({ data: filteredRows });
  } catch (error) {
    console.error('Error: Catalog Fetching', error);
    res.status(500).send('Error catalog fetching');
  }
});

// get-sheet-summary
app.get('/get-sheet-summary', async (req, res) => {
  const key = req.query.key;
  if (!key) return res.status(400).send('Key query parameter is required');
  try {
    const response = await sheets.spreadsheets.values.get({ spreadsheetId, range: 'portal!A:Q' });
    const rows = response.data.values || [];
    const filteredRows = rows.filter(row => row[2] === key);
    const structured = filteredRows.map(row => ({
      Copyrighted: row[4] === 'Copyrighted' ? 'Approved' : row[4] || 'N/A',
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
      User: row[3] || 'N/A'
    }));
    res.json(structured);
  } catch (error) {
    console.error('Error fetching data', error);
    res.status(500).send('Error fetching User Data');
  }
});

// get-requests
app.get('/get-requests', async (req, res) => {
  const key = req.query.key;
  if (!key) return res.status(400).send('Key query parameter is required');
  try {
    const client = await auth.getClient();
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Requests!F3:I',
      auth: client
    });
    const rows = response.data.values || [];
    const filtered = rows.filter(row => row[0] === key);
    res.json(filtered);
  } catch (error) {
    console.error('Error fetching requests:', error);
    res.status(500).send('Error: Fetching Requests');
  }
});

// current-core
app.get('/current-core', async (req, res) => {
  try {
    const response = await sheets.spreadsheets.values.get({ spreadsheetId, range: 'Multi-Core!J2' });
    const core = response.data.values?.[0]?.[0] || 'N/A';
    res.json({ core });
  } catch (error) {
    console.error('Error: Profile Key Fetching', error.message);
    res.status(500).json({ error: 'Unable to fetch the current core. Please contact support.' });
  }
});

// yt-claims
app.get('/yt-claims', async (req, res) => {
  const key = req.query.key;
  if (!key) return res.status(400).send('Key query parameter is required');
  try {
    const response = await sheets.spreadsheets.values.get({ spreadsheetId, range: 'Analytics!A:G' });
    const rows = response.data.values || [];
    const filtered = rows.filter(row => row[0] === key && row[1] === 'YT');
    const structured = filtered.map(row => ({
      'Track Title': row[2] || 'N/A',
      Artist: row[3] || 'N/A',
      Views: row[4] || 'N/A',
      'Report Date': row[5] || 'N/A',
      Link: row[6] || 'N/A'
    }));
    res.json(structured);
  } catch (error) {
    console.error('Error fetching track usage data', error);
    res.status(500).send('Error fetching track usage data');
  }
});

// tracks-usage
app.get('/tracks-usage', async (req, res) => {
  const key = req.query.key;
  if (!key) return res.status(400).send('Key query parameter is required');
  try {
    const response = await sheets.spreadsheets.values.get({ spreadsheetId, range: 'Reports!A:J' });
    const rows = response.data.values || [];
    const filtered = rows.filter(row => row[0] === key);
    const structured = filtered.map(row => {
      const limit = row[7] && row[7].match(/\d+/g) ? row[7].match(/\d+/g).join('') : 'N/A';
      const usage = row[8] || 'N/A';
      let YT = 'Inactive',
        SM = 'Inactive',
        DSP = 'Inactive',
        PM = 'Inactive';
      const serviceCell = row[9] || '';
      if (serviceCell.includes('YT')) YT = 'Active';
      if (serviceCell.includes('SM')) SM = 'Active';
      if (serviceCell.includes('DSP')) DSP = 'Active';
      if (serviceCell.includes('PM')) PM = 'Active';
      return { limit, usage, service: { YT, SM, DSP, PM } };
    });
    res.json(structured);
  } catch (error) {
    console.error('Error fetching track usage data', error);
    res.status(500).send('Error fetching track usage data');
  }
});

/* =========================
 *  TMS DISTRO (example UI)
 * ========================= */
function mapReportsRow(row, rowNumber) {
  return {
    rowNumber,
    'User ID': row[0] ?? '',
    Email: row[1] ?? '',
    'Paid Amount': row[2] ?? '',
    Plan: row[3] ?? '',
    'Payment Platform': row[4] ?? '',
    Date: row[5] ?? '',
    'Account Status': row[6] ?? '',
    'track limit': row[7] ?? '',
    'uploaded tracks': row[8] ?? '',
    services: row[9] ?? ''
  };
}

app.get('/reports', async (req, res) => {
  try {
    const range = 'Reports!A259:J';
    const resp = await sheets.spreadsheets.values.get({ spreadsheetId, range, valueRenderOption: 'UNFORMATTED_VALUE' });
    const rows = resp.data.values || [];
    const startRow = 259;
    const userFilter = (req.query.user || '').trim();
    const data = rows
      .map((r, idx) => ({ r, rowNumber: startRow + idx }))
      .filter(({ r }) => (userFilter ? String(r[0] || '') === userFilter : true))
      .map(({ r, rowNumber }) => mapReportsRow(r, rowNumber));
    res.json({ success: true, range, count: data.length, data });
  } catch (err) {
    console.error('GET /reports error:', err?.response?.data || err);
    res.status(500).json({ success: false, error: 'Failed to fetch Reports data' });
  }
});

function mapRow(row, rowNumber) {
  return {
    rowNumber,
    'Distro-Status': row[0] ?? '',
    'Track ID': row[1] ?? '',
    'User ID': row[2] ?? '',
    date: row[3] ?? '',
    artist: row[4] ?? '',
    title: row[5] ?? '',
    'album title': row[6] ?? '',
    'audio url': row[7] ?? '',
    'track type': row[8] ?? ''
  };
}

app.get('/tms-distro-tracks', async (req, res) => {
  try {
    const range = 'CSV!A2:I';
    const resp = await sheets.spreadsheets.values.get({ spreadsheetId, range, valueRenderOption: 'UNFORMATTED_VALUE' });
    const rows = resp.data.values || [];
    const data = rows
      .map((r, idx) => ({ r, rowNumber: idx + 2 }))
      .filter(({ r }) => /^TM/i.test(String(r[2] ?? '').trim()))
      .map(({ r, rowNumber }) => mapRow(r, rowNumber));
    res.json({ success: true, count: data.length, data });
  } catch (err) {
    console.error('GET /tms-distro-tracks error:', err?.response?.data || err);
    res.status(500).json({ success: false, error: 'Failed to fetch tracks' });
  }
});


app.patch('/tms-distro-tracks/:rowNumber', async (req, res) => {
  try {
    const { rowNumber } = req.params;
    const { status } = req.body || {};
    const allowed = ['In Review', 'In Progress', 'Removed', 'Copyrighted'];
    if (!rowNumber || isNaN(+rowNumber)) return res.status(400).json({ success: false, error: 'Invalid rowNumber' });
    if (!status || !allowed.includes(status))
      return res.status(400).json({ success: false, error: `Invalid status. Allowed: ${allowed.join(', ')}` });

    const updateRange = `CSV!A${rowNumber}:A${rowNumber}`;
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: updateRange,
      valueInputOption: 'RAW',
      requestBody: { values: [[status]] }
    });

    res.json({ success: true, rowNumber: +rowNumber, 'Distro-Status': status });
  } catch (err) {
    console.error('PATCH /tms-distro-tracks error:', err?.response?.data || err);
    res.status(500).json({ success: false, error: 'Failed to update status' });
  }
});

// ===== GET /admin-logs  -> read "AdminLogs!A1:E" =====
// Columns: A=Request, B=Description, C=Timestamp, (D is ignored), E=Status
app.get('/admin-logs', async (req, res) => {
  try {
    const range = 'AdminLogs!A1:E';
    const startRow = 1;

    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
      valueRenderOption: 'UNFORMATTED_VALUE',
    });
    const rows = resp.data.values || [];

    const requestFilter = (req.query.request || '').trim();

    const data = rows
      .map((r, idx) => ({ r, rowNumber: startRow + idx }))
      .filter(({ r }) =>
        requestFilter ? String(r?.[0] ?? '').trim() === requestFilter : true
      )
      .map(({ r, rowNumber }) => mapAdminLogRow(r, rowNumber));

    res.json({ success: true, range, count: data.length, data });
  } catch (err) {
    console.error('GET /admin-logs error:', err?.response?.data || err);
    res.status(500).json({ success: false, error: 'Failed to fetch AdminLogs data' });
  }
});

/**
 * Convert Google Sheets date/time to ISO string.
 * - If numeric (serial), convert from Excel epoch (1899-12-30).
 * - If string parsable by Date, return ISO.
 * - Otherwise return null.
 */
function toIsoFromSheets(v) {
  if (v === null || v === undefined || v === '') return null;

  if (typeof v === 'number') {
    // Sheets serial date -> ms since Unix epoch
    const ms = Math.round((v - 25569) * 86400 * 1000);
    const d = new Date(ms);
    return isNaN(d) ? null : d.toISOString();
  }

  const d = new Date(v);
  return isNaN(d) ? null : d.toISOString();
}

/**
 * Map a single AdminLogs row to an object.
 * r[0]=Request, r[1]=Description, r[2]=Timestamp, r[4]=Status
 * (r[3] is intentionally ignored)
 */
function mapAdminLogRow(r = [], rowNumber) {
  return {
    rowNumber,
    request: r[0] ?? '',
    description: r[1] ?? '',
    timestamp: toIsoFromSheets(r[2]),
    status: r[4] ?? '',
    // raw row included for debugging/optional client use
    _raw: r,
  };
}


// Tiny UI for the above (unchanged)
app.get('/tms-distro-tracks-ui', (req, res) => {
  res.type('html').send(`<!doctype html><html><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>TMS Distro Tracks</title>
<style>
  body{font-family:system-ui,Segoe UI,Roboto,Inter,sans-serif;background:#0b0f14;color:#e6f0ff;padding:24px}
  table{width:100%;border-collapse:collapse}
  th,td{padding:8px 10px;border-bottom:1px solid #1f2a37;font-size:14px}
  th{background:#111827;color:#a5b4fc;position:sticky;top:0;text-align:left}
  tr:hover{background:#0f172a}
  select{background:#0b1220;color:#e6f0ff;border:1px solid #263042;border-radius:8px;padding:6px 8px}
</style>
</head><body>
<h1>CSV!A2:I — filtered where User ID (C) starts with "TM"</h1>
<div id="msg"></div>
<div style="max-height:80vh;overflow:auto">
<table id="t"><thead><tr>
<th>Distro-Status (editable)</th><th>Track ID</th><th>User ID</th><th>Date</th>
<th>Artist</th><th>Title</th><th>Album Title</th><th>Audio URL</th><th>Track Type</th><th>Sheet Row</th>
</tr></thead><tbody></tbody></table>
</div>
<script>
const allowed=["In Review","In Progress","Removed","Copyrighted"];
async function load(){
  const r=await fetch('/tms-distro-tracks'); const j=await r.json();
  if(!j.success){document.getElementById('msg').textContent='Failed to load';return}
  const tb=document.querySelector('#t tbody'); tb.innerHTML='';
  j.data.forEach(row=>{
    const tr=document.createElement('tr');
    const tdA=document.createElement('td'); const s=document.createElement('select');
    allowed.forEach(x=>{const o=document.createElement('option');o.value=x;o.textContent=x;if((row["Distro-Status"]||"")===x)o.selected=true;s.appendChild(o);});
    s.onchange=async()=>{try{
      const rr=await fetch('/tms-distro-tracks/'+row.rowNumber,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:s.value})});
      const jj=await rr.json(); if(!jj.success) alert('Update failed: '+(jj.error||'Unknown'));
    }catch(e){alert('Network error')}}; tdA.appendChild(s); tr.appendChild(tdA);
    const td=(t,l)=>{const d=document.createElement('td'); if(l&&t){const a=document.createElement('a');a.href=t;a.target='_blank';a.rel='noopener';a.textContent=t;d.appendChild(a)} else d.textContent=t??''; return d;}
    tr.appendChild(td(row["Track ID"])); tr.appendChild(td(row["User ID"])); tr.appendChild(td(row["date"]));
    tr.appendChild(td(row["artist"])); tr.appendChild(td(row["title"])); tr.appendChild(td(row["album title"]));
    tr.appendChild(td(row["audio url"],true)); tr.appendChild(td(row["track type"])); tr.appendChild(td(String(row.rowNumber)));
    tb.appendChild(tr);
  });
}
load();
</script>
</body></html>`);
});

/* =========
 *  404
 * ========= */
app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
});

/* =========
 *  START
 * ========= */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
