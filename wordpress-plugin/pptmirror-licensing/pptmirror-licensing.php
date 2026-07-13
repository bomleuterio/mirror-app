<?php
/**
 * Plugin Name: PPT Mirror.ai Licensing
 * Description: Issues and validates PPT Mirror.ai license keys for a one-time-purchase access product, with expiry reminders.
 * Version: 2.0.0
 */

if (!defined('ABSPATH')) exit;

define('PPTMIRROR_TABLE', 'pptmirror_licenses');
define('PPTMIRROR_DEFAULT_ACCESS_DAYS', 365);
define('PPTMIRROR_REMINDER_WINDOW_DAYS', 7);

// ---- Setup ----------------------------------------------------------------

register_activation_hook(__FILE__, 'pptmirror_create_table');
register_activation_hook(__FILE__, 'pptmirror_schedule_cron');
register_deactivation_hook(__FILE__, 'pptmirror_unschedule_cron');

function pptmirror_create_table() {
    global $wpdb;
    $table = $wpdb->prefix . PPTMIRROR_TABLE;
    $charset_collate = $wpdb->get_charset_collate();

    require_once ABSPATH . 'wp-admin/includes/upgrade.php';
    dbDelta("CREATE TABLE {$table} (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        license_key VARCHAR(64) NOT NULL,
        order_id BIGINT UNSIGNED NOT NULL,
        customer_email VARCHAR(191) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'inactive',
        machine_id VARCHAR(191) DEFAULT NULL,
        machine_activated_at DATETIME DEFAULT NULL,
        plan_expires_at DATETIME DEFAULT NULL,
        reminder_sent_at DATETIME DEFAULT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY license_key (license_key),
        KEY customer_email (customer_email)
    ) {$charset_collate};");
}

function pptmirror_schedule_cron() {
    if (!wp_next_scheduled('pptmirror_daily_check')) {
        wp_schedule_event(time(), 'daily', 'pptmirror_daily_check');
    }
}

function pptmirror_unschedule_cron() {
    wp_clear_scheduled_hook('pptmirror_daily_check');
}

// ---- Helpers ----------------------------------------------------------------

function pptmirror_generate_license_key() {
    $groups = [];
    for ($i = 0; $i < 4; $i++) {
        $groups[] = strtoupper(bin2hex(random_bytes(2)));
    }
    return 'PPTM-' . implode('-', $groups);
}

// Prefers the wp-config.php constant if set; otherwise falls back to a
// value generated and stored via Settings -> PPT Mirror Licensing, which
// avoids ever having to hand-copy the secret through a file editor.
function pptmirror_get_secret_key() {
    $hex = null;
    if (defined('PPTMIRROR_LICENSE_SECRET_KEY') && PPTMIRROR_LICENSE_SECRET_KEY) {
        $hex = PPTMIRROR_LICENSE_SECRET_KEY;
    } else {
        $stored = get_option('pptmirror_license_secret_key_hex');
        if ($stored) $hex = $stored;
    }

    if (!$hex || !ctype_xdigit($hex) || strlen($hex) !== SODIUM_CRYPTO_SIGN_SECRETKEYBYTES * 2) {
        return null;
    }
    return hex2bin($hex);
}

function pptmirror_get_public_key_hex() {
    if (defined('PPTMIRROR_LICENSE_SECRET_KEY') && PPTMIRROR_LICENSE_SECRET_KEY) {
        $secret = hex2bin(PPTMIRROR_LICENSE_SECRET_KEY);
    } else {
        $stored = get_option('pptmirror_license_secret_key_hex');
        $secret = $stored ? hex2bin($stored) : null;
    }
    if (!$secret || strlen($secret) !== SODIUM_CRYPTO_SIGN_SECRETKEYBYTES) return null;
    return bin2hex(sodium_crypto_sign_publickey_from_secretkey($secret));
}

// ---- Admin settings page ---------------------------------------------------

add_action('admin_menu', function () {
    add_options_page(
        'PPT Mirror Licensing',
        'PPT Mirror Licensing',
        'manage_options',
        'pptmirror-licensing',
        'pptmirror_render_settings_page'
    );
});

add_action('admin_post_pptmirror_generate_key', function () {
    if (!current_user_can('manage_options')) wp_die('Not allowed.');
    check_admin_referer('pptmirror_generate_key');

    $kp = sodium_crypto_sign_keypair();
    update_option('pptmirror_license_secret_key_hex', bin2hex(sodium_crypto_sign_secretkey($kp)), false);

    wp_redirect(add_query_arg(['page' => 'pptmirror-licensing', 'generated' => '1'], admin_url('options-general.php')));
    exit;
});

function pptmirror_render_settings_page() {
    if (!current_user_can('manage_options')) return;

    $using_constant = defined('PPTMIRROR_LICENSE_SECRET_KEY') && PPTMIRROR_LICENSE_SECRET_KEY;
    $public_key = pptmirror_get_public_key_hex();
    ?>
    <div class="wrap">
        <h1>PPT Mirror Licensing</h1>

        <?php if (isset($_GET['generated'])): ?>
            <div class="notice notice-success"><p>New signing key generated and saved.</p></div>
        <?php endif; ?>

        <?php if ($using_constant): ?>
            <p><strong>Signing key source:</strong> <code>PPTMIRROR_LICENSE_SECRET_KEY</code> constant in <code>wp-config.php</code> (takes priority over the generated key below).</p>
        <?php else: ?>
            <p><strong>Signing key source:</strong> generated and stored here.</p>
        <?php endif; ?>

        <?php if ($public_key): ?>
            <p><strong>Public key (paste into both apps' <code>config.js</code>):</strong><br>
            <code style="font-size:14px;user-select:all;"><?php echo esc_html($public_key); ?></code></p>
        <?php else: ?>
            <p><em>No signing key configured yet.</em></p>
        <?php endif; ?>

        <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" onsubmit="return confirm('This replaces the current signing key. Any app not yet updated with the new public key will fail to verify license responses until you update its config.js. Continue?');">
            <?php wp_nonce_field('pptmirror_generate_key'); ?>
            <input type="hidden" name="action" value="pptmirror_generate_key">
            <p><button type="submit" class="button button-primary">Generate <?php echo $public_key ? 'New' : ''; ?> Signing Key</button></p>
        </form>
    </div>
    <?php
}

function pptmirror_find_license($email, $license_key) {
    global $wpdb;
    $table = $wpdb->prefix . PPTMIRROR_TABLE;
    return $wpdb->get_row($wpdb->prepare(
        "SELECT * FROM {$table} WHERE customer_email = %s AND license_key = %s LIMIT 1",
        $email,
        $license_key
    ));
}

// The stored `status` column is bookkeeping updated by the daily cron; the
// authoritative check is always the expiry date, so access cuts off exactly
// on time rather than waiting for the next cron run.
function pptmirror_license_is_usable($row) {
    if ($row->status !== 'active') return false;
    if ($row->plan_expires_at && strtotime($row->plan_expires_at . ' UTC') <= time()) return false;
    return true;
}

function pptmirror_build_token($row) {
    $secret = pptmirror_get_secret_key();
    if (!$secret) {
        return new WP_Error('server_misconfigured', 'License signing key is not configured.', ['status' => 500]);
    }

    $payload = wp_json_encode([
        'email'           => $row->customer_email,
        'status'          => $row->status,
        'plan_expires_at' => $row->plan_expires_at,
        'issued_at'       => time(),
    ]);

    $signature = sodium_crypto_sign_detached($payload, $secret);

    return [
        'token'     => base64_encode($payload),
        'signature' => base64_encode($signature),
    ];
}

// ---- WooCommerce order hook (one-time purchase, no subscriptions plugin) --

add_action('woocommerce_order_status_completed', 'pptmirror_on_order_completed');

function pptmirror_on_order_completed($order_id) {
    $order = wc_get_order($order_id);
    if (!$order) return;

    $access_days = null;
    foreach ($order->get_items() as $item) {
        $product_id = $item->get_product_id();
        if (defined('PPTMIRROR_PRODUCT_ID') && (int) PPTMIRROR_PRODUCT_ID !== (int) $product_id) {
            continue;
        }
        $configured_days = (int) get_post_meta($product_id, '_pptmirror_access_days', true);
        $access_days = $configured_days > 0 ? $configured_days : PPTMIRROR_DEFAULT_ACCESS_DAYS;
        break;
    }

    // No line item in this order matches the access product — nothing to do.
    if ($access_days === null) return;

    global $wpdb;
    $table = $wpdb->prefix . PPTMIRROR_TABLE;
    $email = $order->get_billing_email();
    $now = time();

    $existing = $wpdb->get_row($wpdb->prepare(
        "SELECT * FROM {$table} WHERE customer_email = %s ORDER BY id DESC LIMIT 1",
        $email
    ));

    // Extend from the current expiry (not from today) if it's still in the
    // future, so renewing early doesn't waste already-paid-for time.
    $base = $now;
    if ($existing && $existing->plan_expires_at) {
        $existing_expiry = strtotime($existing->plan_expires_at . ' UTC');
        if ($existing_expiry && $existing_expiry > $now) {
            $base = $existing_expiry;
        }
    }
    $new_expiry = gmdate('Y-m-d H:i:s', $base + $access_days * DAY_IN_SECONDS);

    if ($existing) {
        $wpdb->update($table, [
            'status'           => 'active',
            'plan_expires_at'  => $new_expiry,
            'reminder_sent_at' => null,
            'order_id'         => $order_id,
        ], ['id' => $existing->id]);
        $license_key = $existing->license_key;
    } else {
        $license_key = pptmirror_generate_license_key();
        $wpdb->insert($table, [
            'license_key'     => $license_key,
            'order_id'        => $order_id,
            'customer_email'  => $email,
            'status'          => 'active',
            'plan_expires_at' => $new_expiry,
            'created_at'      => current_time('mysql'),
        ]);
    }

    wp_mail(
        $email,
        'Your PPT Mirror.ai license key',
        "Thanks for your purchase!\n\nYour license key:\n\n{$license_key}\n\nUse this together with your account email ({$email}) to activate the app.\n\nYour access is valid until {$new_expiry} UTC."
    );
}

// ---- Daily cron: expiry reminders + bookkeeping ----------------------------

add_action('pptmirror_daily_check', 'pptmirror_run_daily_check');

function pptmirror_run_daily_check() {
    global $wpdb;
    $table = $wpdb->prefix . PPTMIRROR_TABLE;
    $now_ts = time();
    $now = gmdate('Y-m-d H:i:s', $now_ts);
    $soon = gmdate('Y-m-d H:i:s', $now_ts + PPTMIRROR_REMINDER_WINDOW_DAYS * DAY_IN_SECONDS);

    $expiring_soon = $wpdb->get_results($wpdb->prepare(
        "SELECT * FROM {$table} WHERE status = 'active' AND plan_expires_at IS NOT NULL
         AND plan_expires_at <= %s AND plan_expires_at > %s AND reminder_sent_at IS NULL",
        $soon,
        $now
    ));

    foreach ($expiring_soon as $row) {
        wp_mail(
            $row->customer_email,
            'Your PPT Mirror.ai access is expiring soon',
            "Hi,\n\nYour PPT Mirror.ai access (license key {$row->license_key}) expires on {$row->plan_expires_at} UTC.\n\nRenew before then to keep uninterrupted access."
        );
        $wpdb->update($table, ['reminder_sent_at' => $now], ['id' => $row->id]);
    }

    // Bookkeeping only — pptmirror_license_is_usable() already cuts access
    // off exactly at plan_expires_at regardless of this flag.
    $wpdb->query($wpdb->prepare(
        "UPDATE {$table} SET status = 'inactive' WHERE status = 'active' AND plan_expires_at IS NOT NULL AND plan_expires_at <= %s",
        $now
    ));
}

// ---- REST API ---------------------------------------------------------------

// The web app's browser calls these routes directly (not from its own
// server) specifically to avoid datacenter-IP bot-protection challenges some
// hosts apply to server-to-server traffic. No cookies/credentials are
// involved in these requests, so a wildcard origin is safe here.
add_filter('rest_pre_serve_request', function ($served, $result, $request) {
    if (strpos($request->get_route(), '/pptmirror/v1/') === 0) {
        header('Access-Control-Allow-Origin: *');
        header('Access-Control-Allow-Methods: POST, OPTIONS');
        header('Access-Control-Allow-Headers: Content-Type');
    }
    return $served;
}, 10, 3);

add_action('rest_api_init', function () {
    register_rest_route('pptmirror/v1', '/activate', [
        'methods'             => 'POST',
        'callback'            => 'pptmirror_rest_activate',
        'permission_callback' => '__return_true',
    ]);
    register_rest_route('pptmirror/v1', '/validate', [
        'methods'             => 'POST',
        'callback'            => 'pptmirror_rest_validate',
        'permission_callback' => '__return_true',
    ]);
    register_rest_route('pptmirror/v1', '/deactivate', [
        'methods'             => 'POST',
        'callback'            => 'pptmirror_rest_deactivate',
        'permission_callback' => '__return_true',
    ]);
});

function pptmirror_extract_params(WP_REST_Request $request) {
    return [
        'email'       => sanitize_email((string) $request->get_param('email')),
        'license_key' => sanitize_text_field((string) $request->get_param('license_key')),
        'machine_id'  => sanitize_text_field((string) $request->get_param('machine_id')),
    ];
}

function pptmirror_rest_activate(WP_REST_Request $request) {
    global $wpdb;
    $table = $wpdb->prefix . PPTMIRROR_TABLE;
    ['email' => $email, 'license_key' => $license_key, 'machine_id' => $machine_id] = pptmirror_extract_params($request);

    if (!$email || !$license_key) {
        return new WP_Error('bad_request', 'email and license_key are required.', ['status' => 400]);
    }

    $row = pptmirror_find_license($email, $license_key);
    if (!$row) {
        return new WP_Error('invalid_license', 'Invalid email or license key.', ['status' => 404]);
    }
    if (!pptmirror_license_is_usable($row)) {
        return new WP_Error('inactive_subscription', 'This access has expired or is not active.', ['status' => 403]);
    }

    $wpdb->update($table, [
        'machine_id'            => $machine_id ?: null,
        'machine_activated_at'  => current_time('mysql'),
    ], ['id' => $row->id]);
    $row->machine_id = $machine_id ?: null;

    $token = pptmirror_build_token($row);
    if (is_wp_error($token)) return $token;
    return new WP_REST_Response($token, 200);
}

function pptmirror_rest_validate(WP_REST_Request $request) {
    ['email' => $email, 'license_key' => $license_key, 'machine_id' => $machine_id] = pptmirror_extract_params($request);

    if (!$email || !$license_key) {
        return new WP_Error('bad_request', 'email and license_key are required.', ['status' => 400]);
    }

    $row = pptmirror_find_license($email, $license_key);
    if (!$row) {
        return new WP_Error('invalid_license', 'Invalid email or license key.', ['status' => 404]);
    }
    if (!pptmirror_license_is_usable($row)) {
        return new WP_Error('inactive_subscription', 'This access has expired or is not active.', ['status' => 403]);
    }

    // machine_id is only sent by the desktop app; the web app calls without one
    // and skips single-device enforcement entirely.
    if ($machine_id && $row->machine_id && $row->machine_id !== $machine_id) {
        return new WP_Error('device_mismatch', 'This license is activated on another device.', ['status' => 409]);
    }

    $token = pptmirror_build_token($row);
    if (is_wp_error($token)) return $token;
    return new WP_REST_Response($token, 200);
}

function pptmirror_rest_deactivate(WP_REST_Request $request) {
    global $wpdb;
    $table = $wpdb->prefix . PPTMIRROR_TABLE;
    ['email' => $email, 'license_key' => $license_key, 'machine_id' => $machine_id] = pptmirror_extract_params($request);

    if (!$email || !$license_key) {
        return new WP_Error('bad_request', 'email and license_key are required.', ['status' => 400]);
    }

    $row = pptmirror_find_license($email, $license_key);
    if (!$row) {
        return new WP_Error('invalid_license', 'Invalid email or license key.', ['status' => 404]);
    }

    if ($row->machine_id && $row->machine_id === $machine_id) {
        $wpdb->update($table, [
            'machine_id'           => null,
            'machine_activated_at' => null,
        ], ['id' => $row->id]);
    }

    return new WP_REST_Response(['ok' => true], 200);
}
