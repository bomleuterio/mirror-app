const path = require('path');
const os = require('os');
const fs = require('fs').promises;
const express = require('express');
const multer = require('multer');
const cookieParser = require('cookie-parser');

const { mirrorPdf } = require(path.join(__dirname, '..', 'mirror-app', 'pdf-mirror'));
const { mirrorPptx } = require(path.join(__dirname, '..', 'mirror-app', 'ppt-mirror'));
const config = require('./config');
const { validateLicense } = require('./license-client');

if (process.env.NODE_ENV === 'production' && config.COOKIE_SECRET === 'dev-insecure-cookie-secret-change-me') {
  console.warn('WARNING: COOKIE_SECRET is not set — using the insecure dev default in production.');
}

const app = express();
app.set('trust proxy', 1); // Render terminates TLS at its proxy; needed for req.secure to reflect the original HTTPS request.
app.use(express.json());
app.use(cookieParser(config.COOKIE_SECRET));

const allowedOrigins = String(process.env.CORS_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

app.use((req, res, next) => {
  const origin = req.headers.origin;
  const allowAny = allowedOrigins.length === 0;
  const isAllowed = allowAny || (origin && allowedOrigins.includes(origin));

  if (origin && isAllowed) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
  }

  if (req.method === 'OPTIONS') {
    if (origin && !isAllowed) return res.status(403).end();
    return res.status(204).end();
  }

  next();
});

app.get('/health', (req, res) => {
  res.json({ ok: true });
});

// Subscription gate — everything below this point requires a valid session.
const SESSION_COOKIE = 'pptmirror_session';
const REVALIDATE_INTERVAL_MS = 24 * 60 * 60 * 1000;

// secure must reflect the actual connection (req.secure), not NODE_ENV — a
// static `NODE_ENV === 'production'` check marks the cookie Secure even when
// served over plain http:// (e.g. testing locally with NODE_ENV=production
// set), and browsers then silently refuse to ever send it back, breaking
// login with no visible error at the cookie layer.
function cookieOptions(req) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.secure,
    signed: true,
    maxAge: 30 * 24 * 60 * 60 * 1000,
  };
}

function wantsJson(req) {
  return req.path.startsWith('/api/') || (req.headers.accept || '').includes('application/json');
}

function denyAccess(req, res, message) {
  if (wantsJson(req)) {
    return res.status(401).json({ error: message || 'Sign in with your subscription to continue.' });
  }
  return res.redirect(`/login?redirect=${encodeURIComponent(req.originalUrl)}`);
}

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/api/login', async (req, res) => {
  const email = String((req.body && req.body.email) || '').trim();
  const licenseKey = String((req.body && req.body.licenseKey) || '').trim();
  if (!email || !licenseKey) {
    return res.status(400).json({ error: 'Enter your email and license key.' });
  }

  const result = await validateLicense(email, licenseKey);
  if (!result.ok) {
    return res.status(result.networkError ? 502 : 401).json({ error: result.message });
  }

  res.cookie(SESSION_COOKIE, { email, licenseKey, sessionCreatedAt: Date.now() }, cookieOptions(req));
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  res.clearCookie(SESSION_COOKIE);
  res.json({ ok: true });
});

app.use(async (req, res, next) => {
  const session = req.signedCookies && req.signedCookies[SESSION_COOKIE];
  if (!session || !session.email || !session.licenseKey) {
    return denyAccess(req, res);
  }

  const age = Date.now() - (session.sessionCreatedAt || 0);
  if (age < REVALIDATE_INTERVAL_MS) {
    return next();
  }

  const result = await validateLicense(session.email, session.licenseKey);
  if (result.ok) {
    res.cookie(SESSION_COOKIE, { ...session, sessionCreatedAt: Date.now() }, cookieOptions(req));
    return next();
  }
  if (result.networkError) {
    // Don't lock out paying users over a transient WordPress outage, but leave
    // sessionCreatedAt alone so the next request retries instead of trusting
    // this session indefinitely.
    return next();
  }
  res.clearCookie(SESSION_COOKIE);
  return denyAccess(req, res, result.message);
});

app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({
  storage: multer.diskStorage({
    destination: async (req, file, cb) => {
      try {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ppt-mirror-upload-'));
        cb(null, dir);
      } catch (e) {
        cb(e);
      }
    },
    filename: (req, file, cb) => {
      const safeName = (file.originalname || 'upload').replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_');
      cb(null, safeName);
    },
  }),
  limits: { fileSize: 200 * 1024 * 1024 },
});

async function cleanupDir(dirPath) {
  try {
    await fs.rm(dirPath, { recursive: true, force: true });
  } catch {}
}

app.post('/api/mirror', upload.single('file'), async (req, res) => {
  const mode = String(req.body && req.body.mode ? req.body.mode : '').toLowerCase();
  if (!req.file || !req.file.path) return res.status(400).json({ error: 'No file uploaded.' });
  if (mode !== 'pdf' && mode !== 'pptx') return res.status(400).json({ error: 'mode must be pdf or pptx.' });

  const inputPath = req.file.path;
  const inputDir = path.dirname(inputPath);
  const baseWithExt = path.basename(inputPath);
  const outputPath = path.join(inputDir, `mirrored_${baseWithExt}`);

  try {
    if (mode === 'pdf') {
      await mirrorPdf(inputPath, outputPath);
    } else {
      await mirrorPptx(inputPath, outputPath);
    }

    res.download(outputPath, path.basename(outputPath), async () => {
      await cleanupDir(inputDir);
    });
  } catch (e) {
    await cleanupDir(inputDir);
    res.status(500).json({ error: e && e.message ? e.message : 'Failed to mirror file.' });
  }
});

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '0.0.0.0';

app.listen(port, host, () => {
  const url = host === '0.0.0.0' ? `http://localhost:${port}` : `http://${host}:${port}`;
  console.log(`iOS web app server listening on ${url}`);
});
