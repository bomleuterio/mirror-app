const nacl = require('tweetnacl');
const config = require('./config');

const REQUEST_TIMEOUT_MS = 8000;

function verifyAndParseToken(token, signature) {
  try {
    const publicKey = Buffer.from(config.LICENSE_PUBLIC_KEY_HEX, 'hex');
    const message = Buffer.from(token, 'base64');
    const sig = Buffer.from(signature, 'base64');
    if (!nacl.sign.detached.verify(message, sig, publicKey)) return null;
    return JSON.parse(message.toString('utf8'));
  } catch {
    return null;
  }
}

// No machine_id is sent: the WordPress plugin skips single-device
// enforcement entirely when it's absent, which is what a browser session wants.
async function validateLicense(email, licenseKey) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${config.API_BASE_URL}/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, license_key: licenseKey }),
      signal: controller.signal,
    });

    let data = null;
    try {
      data = await res.json();
    } catch {}

    if (!res.ok) {
      return {
        ok: false,
        error: (data && data.code) || 'error',
        message: (data && data.message) || 'Could not verify your subscription.',
      };
    }

    const payload = verifyAndParseToken(data.token, data.signature);
    if (!payload) {
      return { ok: false, error: 'bad_signature', message: 'Received an invalid response from the license server.' };
    }

    return { ok: true, planExpiresAt: payload.plan_expires_at };
  } catch (e) {
    return { ok: false, networkError: true, error: 'network', message: 'Could not reach the license server.' };
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { validateLicense };
