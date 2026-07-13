const nacl = require('tweetnacl');
const config = require('./config');

const REQUEST_TIMEOUT_MS = 15000;

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

    const rawBody = await res.text();
    let data = null;
    try {
      data = JSON.parse(rawBody);
    } catch {}

    if (!data) {
      console.error(`License server returned a non-JSON response (status ${res.status}):`, rawBody.slice(0, 500));
      return { ok: false, error: 'bad_response', message: 'Received an unexpected response from the license server.' };
    }

    if (!res.ok) {
      return {
        ok: false,
        error: data.code || 'error',
        message: data.message || 'Could not verify your subscription.',
      };
    }

    const payload = verifyAndParseToken(data.token, data.signature);
    if (!payload) {
      return { ok: false, error: 'bad_signature', message: 'Received an invalid response from the license server.' };
    }

    return { ok: true, planExpiresAt: payload.plan_expires_at };
  } catch (e) {
    console.error('License server request failed:', e && e.cause ? e.cause : e);
    return { ok: false, networkError: true, error: 'network', message: 'Could not reach the license server.' };
  } finally {
    clearTimeout(timeout);
  }
}

// Used for the initial login: the browser calls WordPress's /validate
// directly (avoiding server-to-server bot-protection challenges some hosts
// apply) and relays the signed result here for local verification — no
// network call needed on our side.
function verifyClientSubmittedToken(email, licenseKey, token, signature) {
  if (!email || !licenseKey || !token || !signature) {
    return { ok: false, error: 'bad_request', message: 'Missing required fields.' };
  }

  const payload = verifyAndParseToken(token, signature);
  if (!payload) {
    return { ok: false, error: 'bad_signature', message: 'Received an invalid response from the license server.' };
  }
  if (String(payload.email).toLowerCase() !== email.trim().toLowerCase()) {
    return { ok: false, error: 'bad_signature', message: 'License response does not match the submitted email.' };
  }
  if (payload.status !== 'active') {
    return { ok: false, error: 'inactive_subscription', message: 'This access has expired or is not active.' };
  }
  if (payload.plan_expires_at && new Date(`${payload.plan_expires_at} UTC`).getTime() <= Date.now()) {
    return { ok: false, error: 'inactive_subscription', message: 'This access has expired or is not active.' };
  }

  return { ok: true, planExpiresAt: payload.plan_expires_at };
}

module.exports = { validateLicense, verifyClientSubmittedToken };
