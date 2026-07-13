# PPT Mirror.ai Licensing (WordPress plugin)

Issues a license key for a one-time-purchase "access" product and exposes a REST API the desktop app and the web app use to check whether a customer's access is still valid. No subscriptions plugin required — access just runs for a fixed number of days from purchase, with an email reminder before it lapses. Customers renew by buying again; a renewal extends their existing expiry rather than losing remaining time.

## Requirements
- WordPress with WooCommerce (core only — no subscriptions extension needed)
- PHP with the `sodium` extension (bundled by default since PHP 7.2 — nearly every host has it)

## Setup

### 1. Install
Upload the `pptmirror-licensing` folder to `wp-content/plugins/` and activate it from **Plugins**. This creates a `wp_pptmirror_licenses` table and schedules a daily cron check.

If you're updating from the older Subscriptions-based version of this plugin, deactivate and reactivate it after uploading the new files — that re-runs the table setup so the new `reminder_sent_at` column and cron job get added.

### 2. Create the access product
In WooCommerce, add a regular (non-subscription) product — e.g. "PPT Mirror.ai — 1 Year Access". Two optional settings:
- **Restrict licensing to just this product**: add `define('PPTMIRROR_PRODUCT_ID', 123);` to `wp-config.php` (use the product's ID). Without this, *any* completed order is treated as an access purchase — fine if this is the only thing you sell, but set it once you add other products.
- **Custom access length**: on the product's edit screen, enable the "Custom Fields" panel (Screen Options, top right) and add a field named `_pptmirror_access_days` with the number of days (e.g. `30` for a monthly product). Without it, access defaults to 365 days.

When a customer's order reaches **Completed** status, the plugin issues (or renews) their license key and emails it to them.

### 3. Generate the signing keypair (once)
License validation responses are signed with Ed25519 so the desktop/web apps can verify them without ever holding a key that could forge one. Run this once, anywhere PHP with `sodium` is available:

```php
<?php
$kp = sodium_crypto_sign_keypair();
echo "Secret (put in wp-config.php):\n";
echo "define('PPTMIRROR_LICENSE_SECRET_KEY', '" . bin2hex(sodium_crypto_sign_secretkey($kp)) . "');\n\n";
echo "Public (paste into the Electron app's config.js and the ios-version env var):\n";
echo bin2hex(sodium_crypto_sign_publickey($kp)) . "\n";
```

Both values are hex-encoded (not base64) specifically because base64's `+`, `/`, `=` characters are prone to getting mangled when pasted through web-based file manager editors — hex only uses `0-9a-f`, which nothing mangles.

- Add the `define(...)` line to `wp-config.php`. **Never commit the secret key or put it in the database** — anyone with it can forge valid license tokens.
- Keep the public hex string handy; it's safe to commit and gets pasted into both the desktop app and the Render web app config.
- If you're running this as a plain PHP file dropped on the server, place it in the WordPress root (or anywhere outside `wp-content/` — hosts commonly block direct PHP execution inside `wp-content/` as a security hardening measure) and delete it immediately after copying both values.

### 4. Point the apps at this site
Both apps' `config.js` (or the matching env vars, `PPTMIRROR_API_BASE_URL` / `PPTMIRROR_LICENSE_PUBLIC_KEY`) need:
```
API_BASE_URL = https://yoursite.com/wp-json/pptmirror/v1
```

## REST API

All endpoints are public (the email + license key *are* the credentials) and use `POST` with JSON or form-encoded body.

### `POST /activate`
`{ email, license_key, machine_id }` — claims the single device slot for this license (overwrites any previously activated device). Used the first time the desktop app is unlocked on a machine.

### `POST /validate`
`{ email, license_key, machine_id? }` — checks access is still valid (status is `active` **and** `plan_expires_at` hasn't passed — the expiry date is authoritative regardless of what the daily cron has gotten around to flipping).
- Desktop app: pass its own `machine_id`. Returns `409 device_mismatch` if a *different* machine currently holds the slot.
- Web app: omit `machine_id` entirely — device enforcement is skipped, only access validity is checked.

### `POST /deactivate`
`{ email, license_key, machine_id }` — frees the device slot if `machine_id` matches the one currently stored.

### Response shape
Success (`200`):
```json
{ "token": "<base64 JSON payload>", "signature": "<base64 Ed25519 signature over the JSON payload>" }
```
The decoded payload is `{ email, status, plan_expires_at, issued_at }`. Verify the signature with the public key from step 3 before trusting it.

Failure: standard WP REST error shape, e.g. `{ "code": "invalid_license", "message": "...", "data": { "status": 404 } }`.

## Daily cron
Registered on activation as `pptmirror_daily_check`. Each run:
1. Emails a reminder to any license expiring within `PPTMIRROR_REMINDER_WINDOW_DAYS` (default 7) that hasn't already gotten one for this expiry (renewing resets this, so a future reminder can fire again).
2. Flips already-expired rows' `status` to `inactive` for admin bookkeeping — this doesn't affect enforcement, since `/validate` and `/activate` check the expiry date directly.

## Manual test checklist (run against a staging site)
1. Buy the access product with a test account → confirm the order reaches **Completed**, the customer receives the license key email, and a row appears in `wp_pptmirror_licenses` with `status = active` and `plan_expires_at` ~N days out.
2. `POST /activate` with that email/key and a fake `machine_id` → expect `200` with `token`/`signature`.
3. `POST /validate` with the same `machine_id` → expect `200`. With a *different* `machine_id` → expect `409 device_mismatch`.
4. `POST /validate` with no `machine_id` (simulating the web app) → expect `200` regardless of which device is activated.
5. Manually set a row's `plan_expires_at` to a past date → confirm `/validate` now returns `403 inactive_subscription` immediately (not waiting for the cron).
6. Buy again with the same email before expiry → confirm the *same* license key's `plan_expires_at` extends from its previous value (not from today) and no second email/key is issued.
7. Manually set `plan_expires_at` to within the reminder window and run `do_action('pptmirror_daily_check')` (e.g. via WP-CLI `wp eval "do_action('pptmirror_daily_check');"`) → confirm the reminder email sends once and `reminder_sent_at` gets set.
