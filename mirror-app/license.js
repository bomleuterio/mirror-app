const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const nacl = require('tweetnacl');
const { machineIdSync } = require('node-machine-id');
const config = require('./config');

const GRACE_PERIOD_MS = 365 * 24 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 8000;

function cachePath() {
  return path.join(app.getPath('userData'), 'license-cache.json');
}

function readCache() {
  try {
    return JSON.parse(fs.readFileSync(cachePath(), 'utf8'));
  } catch {
    return null;
  }
}

function writeCache(data) {
  fs.writeFileSync(cachePath(), JSON.stringify(data), 'utf8');
}

function clearCache() {
  try {
    fs.unlinkSync(cachePath());
  } catch {}
}

function getMachineId() {
  try {
    return machineIdSync(true);
  } catch {
    return 'unknown-machine';
  }
}

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

async function callApi(routePath, body) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${config.API_BASE_URL}${routePath}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const rawBody = await res.text();
    let data = null;
    try {
      data = JSON.parse(rawBody);
    } catch {}
    if (!data) {
      console.error(`License server returned a non-JSON response (status ${res.status}) from ${routePath}:`, rawBody.slice(0, 500));
    }
    return { networkError: false, ok: res.ok, status: res.status, data };
  } catch (e) {
    console.error(`License server request to ${routePath} failed:`, e && e.cause ? e.cause : e);
    return { networkError: true, ok: false, status: 0, data: null };
  } finally {
    clearTimeout(timeout);
  }
}

function errorFromResponse(result, fallbackMessage) {
  const code = result.data && result.data.code ? result.data.code : 'error';
  const message = result.data && result.data.message ? result.data.message : fallbackMessage;
  return { ok: false, needsLogin: true, error: code, message };
}

async function activateLicense({ email, licenseKey }) {
  if (!email || !licenseKey) {
    return { ok: false, needsLogin: true, error: 'bad_request', message: 'Enter your email and license key.' };
  }

  const machineId = getMachineId();
  const result = await callApi('/activate', { email, license_key: licenseKey, machine_id: machineId });

  if (result.networkError) {
    return {
      ok: false,
      needsLogin: true,
      error: 'network',
      message: 'Could not reach the license server. Check your internet connection and try again.',
    };
  }
  if (!result.ok) {
    return errorFromResponse(result, 'Activation failed.');
  }
  if (!result.data) {
    return { ok: false, needsLogin: true, error: 'bad_response', message: 'Received an unexpected response from the license server.' };
  }

  const payload = verifyAndParseToken(result.data.token, result.data.signature);
  if (!payload) {
    return { ok: false, needsLogin: true, error: 'bad_signature', message: 'Received an invalid response from the license server.' };
  }

  writeCache({
    email,
    licenseKey,
    machineId,
    planExpiresAt: payload.plan_expires_at,
    lastValidatedAt: Date.now(),
  });

  return { ok: true, status: payload.status, planExpiresAt: payload.plan_expires_at };
}

async function validateLicense() {
  const cache = readCache();
  if (!cache) {
    return { ok: false, needsLogin: true, error: 'no_license', message: 'Sign in with your subscription to continue.' };
  }

  const machineId = getMachineId();
  const result = await callApi('/validate', { email: cache.email, license_key: cache.licenseKey, machine_id: machineId });

  if (result.networkError) {
    const age = Date.now() - cache.lastValidatedAt;
    if (age < GRACE_PERIOD_MS) {
      return { ok: true, status: 'active', offline: true, planExpiresAt: cache.planExpiresAt };
    }
    return {
      ok: false,
      needsLogin: true,
      error: 'grace_expired',
      message: 'This app has been offline for too long. Connect to the internet to keep using it.',
    };
  }

  if (!result.ok) {
    if (result.data && result.data.code !== 'device_mismatch') {
      clearCache();
    }
    return errorFromResponse(result, 'Could not verify your subscription.');
  }
  if (!result.data) {
    return { ok: false, needsLogin: true, error: 'bad_response', message: 'Received an unexpected response from the license server.' };
  }

  const payload = verifyAndParseToken(result.data.token, result.data.signature);
  if (!payload) {
    return { ok: false, needsLogin: true, error: 'bad_signature', message: 'Received an invalid response from the license server.' };
  }

  writeCache({ ...cache, machineId, planExpiresAt: payload.plan_expires_at, lastValidatedAt: Date.now() });
  return { ok: true, status: payload.status, offline: false, planExpiresAt: payload.plan_expires_at };
}

async function clearLicense() {
  const cache = readCache();
  if (cache) {
    await callApi('/deactivate', { email: cache.email, license_key: cache.licenseKey, machine_id: cache.machineId });
  }
  clearCache();
  return { ok: true };
}

module.exports = { activateLicense, validateLicense, clearLicense };
