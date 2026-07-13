// Throwaway stand-in for the real WordPress licensing REST API (see
// ../../wordpress-plugin/pptmirror-licensing). Lets the desktop app and the
// web app be built/tested end-to-end without a live WooCommerce site.
// Not shipped in the packaged Electron build.

import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import nacl from 'tweetnacl';

const PORT = Number(process.env.MOCK_PORT || 4321);

// Fixed seed so restarting the mock server doesn't change the public key the
// app is configured to trust. Real WordPress deploys generate a random keypair
// once (see wordpress-plugin/pptmirror-licensing/README.md) — this is dev-only.
const seedHex = process.env.MOCK_LICENSE_SEED_HEX;
const signingSeed = seedHex
  ? Buffer.from(seedHex, 'hex')
  : createHash('sha256').update('pptmirror-mock-license-server-dev-seed').digest();
const keyPair = nacl.sign.keyPair.fromSeed(signingSeed);
const publicKeyHex = Buffer.from(keyPair.publicKey).toString('hex');

const licenses = new Map(); // `${email}|${key}` -> { email, key, status, machineId, planExpiresAt }

function licenseMapKey(email, key) {
  return `${email.toLowerCase()}|${key}`;
}

function seed(email, key, status, planExpiresAt = null) {
  licenses.set(licenseMapKey(email, key), { email, key, status, machineId: null, planExpiresAt });
}

seed('active@example.com', 'PPTM-TEST-ACTV-0001', 'active');
seed('inactive@example.com', 'PPTM-TEST-INAC-0001', 'inactive');

function findLicense(email, key) {
  return licenses.get(licenseMapKey(email || '', key || ''));
}

function buildToken(row) {
  const payload = JSON.stringify({
    email: row.email,
    status: row.status,
    plan_expires_at: row.planExpiresAt,
    issued_at: Math.floor(Date.now() / 1000),
  });
  const message = Buffer.from(payload, 'utf8');
  const signature = nacl.sign.detached(message, keyPair.secretKey);
  return {
    token: Buffer.from(payload, 'utf8').toString('base64'),
    signature: Buffer.from(signature).toString('base64'),
  };
}

function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(data);
}

function sendError(res, status, code, message) {
  sendJson(res, status, { code, message, data: { status } });
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

const server = createServer(async (req, res) => {
  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    return sendError(res, 400, 'bad_request', 'Invalid JSON body.');
  }

  const email = String(body.email || '').trim().toLowerCase();
  const key = String(body.license_key || '').trim();
  const machineId = String(body.machine_id || '').trim();

  if (req.method === 'POST' && req.url === '/activate') {
    if (!email || !key) return sendError(res, 400, 'bad_request', 'email and license_key are required.');
    const row = findLicense(email, key);
    if (!row) return sendError(res, 404, 'invalid_license', 'Invalid email or license key.');
    if (row.status !== 'active') return sendError(res, 403, 'inactive_subscription', 'This subscription is not active.');
    row.machineId = machineId || null;
    return sendJson(res, 200, buildToken(row));
  }

  if (req.method === 'POST' && req.url === '/validate') {
    if (!email || !key) return sendError(res, 400, 'bad_request', 'email and license_key are required.');
    const row = findLicense(email, key);
    if (!row) return sendError(res, 404, 'invalid_license', 'Invalid email or license key.');
    if (row.status !== 'active') return sendError(res, 403, 'inactive_subscription', 'This subscription is not active.');
    if (machineId && row.machineId && row.machineId !== machineId) {
      return sendError(res, 409, 'device_mismatch', 'This license is activated on another device.');
    }
    return sendJson(res, 200, buildToken(row));
  }

  if (req.method === 'POST' && req.url === '/deactivate') {
    if (!email || !key) return sendError(res, 400, 'bad_request', 'email and license_key are required.');
    const row = findLicense(email, key);
    if (!row) return sendError(res, 404, 'invalid_license', 'Invalid email or license key.');
    if (row.machineId && row.machineId === machineId) row.machineId = null;
    return sendJson(res, 200, { ok: true });
  }

  // Dev-only helper to flip a seeded license's status without restarting the server.
  if (req.method === 'POST' && req.url === '/test/set-status') {
    const row = findLicense(email, key);
    if (!row) return sendError(res, 404, 'invalid_license', 'Invalid email or license key.');
    row.status = String(body.status || row.status);
    return sendJson(res, 200, { ok: true, status: row.status });
  }

  sendError(res, 404, 'not_found', 'Unknown route.');
});

server.listen(PORT, () => {
  console.log(`Mock license server listening on http://localhost:${PORT}`);
  console.log(`LICENSE_PUBLIC_KEY_HEX=${publicKeyHex}`);
  console.log('Seeded licenses:');
  console.log('  active@example.com   / PPTM-TEST-ACTV-0001 (active)');
  console.log('  inactive@example.com / PPTM-TEST-INAC-0001 (inactive)');
});
