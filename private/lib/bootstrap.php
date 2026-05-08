<?php

declare(strict_types=1);

require_once __DIR__ . '/../config.php';

date_default_timezone_set('Asia/Shanghai');

ini_set('session.gc_maxlifetime', (string) SESSION_LIFETIME_SECONDS);
session_set_cookie_params([
    'lifetime' => SESSION_LIFETIME_SECONDS,
    'path' => '/',
    'secure' => !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off',
    'httponly' => true,
    'samesite' => 'Lax',
]);
session_name('family_location_session');
session_start();

function db(): PDO
{
    static $pdo = null;

    if ($pdo instanceof PDO) {
        return $pdo;
    }

    $dsn = sprintf('mysql:host=%s;dbname=%s;charset=%s', DB_HOST, DB_NAME, DB_CHARSET);
    $pdo = new PDO($dsn, DB_USER, DB_PASS, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);

    ensure_schema($pdo);

    return $pdo;
}

function ensure_schema(PDO $pdo): void
{
    static $done = false;

    if ($done) {
        return;
    }

    $pdo->exec("
        CREATE TABLE IF NOT EXISTS users (
            id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            username VARCHAR(64) NOT NULL UNIQUE,
            password_hash VARCHAR(255) NOT NULL,
            display_name VARCHAR(100) NOT NULL DEFAULT '',
            group_name VARCHAR(100) NOT NULL,
            role ENUM('monitor', 'guardian') NOT NULL,
            report_interval_seconds INT UNSIGNED NOT NULL DEFAULT 300,
            is_active TINYINT(1) NOT NULL DEFAULT 1,
            failed_login_count TINYINT UNSIGNED NOT NULL DEFAULT 0,
            login_locked_at DATETIME NULL,
            terms_accepted_at DATETIME NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_users_group_role (group_name, role)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    ");

    $pdo->exec("
        CREATE TABLE IF NOT EXISTS family_groups (
            id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            group_name VARCHAR(100) NOT NULL UNIQUE,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    ");

    $pdo->exec("
        CREATE TABLE IF NOT EXISTS user_groups (
            id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            user_id INT UNSIGNED NOT NULL,
            group_name VARCHAR(100) NOT NULL,
            role ENUM('monitor', 'guardian') NOT NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uniq_user_group (user_id, group_name),
            INDEX idx_user_groups_group_role (group_name, role),
            CONSTRAINT fk_user_groups_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    ");

    $pdo->exec("
        CREATE TABLE IF NOT EXISTS locations (
            id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            user_id INT UNSIGNED NOT NULL,
            group_name VARCHAR(100) NOT NULL,
            role ENUM('monitor', 'guardian') NOT NULL,
            latitude DECIMAL(10, 7) NOT NULL,
            longitude DECIMAL(10, 7) NOT NULL,
            accuracy FLOAT NULL,
            heading FLOAT NULL,
            speed FLOAT NULL,
            address_diagnostics LONGTEXT NULL,
            address_mismatch TINYINT(1) NOT NULL DEFAULT 0,
            user_agent VARCHAR(255) NOT NULL DEFAULT '',
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_locations_group_created (group_name, created_at),
            INDEX idx_locations_user_created (user_id, created_at),
            CONSTRAINT fk_locations_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    ");

    $pdo->exec("
        CREATE TABLE IF NOT EXISTS latest_group_locations (
            user_id INT UNSIGNED NOT NULL,
            group_name VARCHAR(100) NOT NULL,
            role ENUM('monitor', 'guardian') NOT NULL,
            latitude DECIMAL(10, 7) NOT NULL,
            longitude DECIMAL(10, 7) NOT NULL,
            accuracy FLOAT NULL,
            heading FLOAT NULL,
            speed FLOAT NULL,
            latest_location_id BIGINT UNSIGNED NULL,
            address_diagnostics LONGTEXT NULL,
            address_mismatch TINYINT(1) NOT NULL DEFAULT 0,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (user_id, group_name),
            CONSTRAINT fk_latest_group_locations_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            INDEX idx_latest_location_id (latest_location_id),
            INDEX idx_latest_group_role (group_name, role),
            INDEX idx_latest_updated (updated_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    ");

    add_column_if_missing($pdo, 'users', 'failed_login_count', 'TINYINT UNSIGNED NOT NULL DEFAULT 0');
    add_column_if_missing($pdo, 'users', 'login_locked_at', 'DATETIME NULL');
    add_column_if_missing($pdo, 'users', 'terms_accepted_at', 'DATETIME NULL');
    add_column_if_missing($pdo, 'users', 'report_interval_seconds', 'INT UNSIGNED NOT NULL DEFAULT ' . DEFAULT_REPORT_INTERVAL_SECONDS);
    add_column_if_missing($pdo, 'locations', 'address_diagnostics', 'LONGTEXT NULL');
    add_column_if_missing($pdo, 'locations', 'address_mismatch', 'TINYINT(1) NOT NULL DEFAULT 0');
    add_column_if_missing($pdo, 'latest_group_locations', 'latest_location_id', 'BIGINT UNSIGNED NULL');
    add_column_if_missing($pdo, 'latest_group_locations', 'address_diagnostics', 'LONGTEXT NULL');
    add_column_if_missing($pdo, 'latest_group_locations', 'address_mismatch', 'TINYINT(1) NOT NULL DEFAULT 0');
    migrate_role_columns($pdo);

    $pdo->exec("
        INSERT IGNORE INTO family_groups (group_name)
        SELECT DISTINCT group_name
        FROM users
        WHERE group_name <> ''
    ");

    $pdo->exec("
        INSERT IGNORE INTO user_groups (user_id, group_name, role)
        SELECT id, group_name, role
        FROM users
        WHERE group_name <> ''
    ");

    $pdo->exec("
        INSERT IGNORE INTO family_groups (group_name)
        SELECT DISTINCT group_name
        FROM user_groups
        WHERE group_name <> ''
    ");

    if (table_exists($pdo, 'latest_locations')) {
        $pdo->exec("
            INSERT IGNORE INTO latest_group_locations
                (user_id, group_name, role, latitude, longitude, accuracy, heading, speed, updated_at)
            SELECT
                user_id,
                group_name,
                CASE WHEN role = 'parent' THEN 'monitor' ELSE role END,
                latitude,
                longitude,
                accuracy,
                heading,
                speed,
                updated_at
            FROM latest_locations
        ");
    }

    $done = true;
}

function table_exists(PDO $pdo, string $table): bool
{
    $stmt = $pdo->prepare("
        SELECT COUNT(*)
        FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = ?
    ");
    $stmt->execute([$table]);

    return (int) $stmt->fetchColumn() > 0;
}

function column_exists(PDO $pdo, string $table, string $column): bool
{
    $stmt = $pdo->prepare("
        SELECT COUNT(*)
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = ?
          AND COLUMN_NAME = ?
    ");
    $stmt->execute([$table, $column]);

    return (int) $stmt->fetchColumn() > 0;
}

function column_type(PDO $pdo, string $table, string $column): string
{
    $stmt = $pdo->prepare("
        SELECT COLUMN_TYPE
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = ?
          AND COLUMN_NAME = ?
        LIMIT 1
    ");
    $stmt->execute([$table, $column]);

    return (string) ($stmt->fetchColumn() ?: '');
}

function migrate_role_columns(PDO $pdo): void
{
    foreach (['users', 'user_groups', 'locations', 'latest_group_locations', 'latest_locations'] as $table) {
        migrate_role_column($pdo, $table);
    }
}

function migrate_role_column(PDO $pdo, string $table): void
{
    if (!table_exists($pdo, $table) || !column_exists($pdo, $table, 'role')) {
        return;
    }

    $type = strtolower(column_type($pdo, $table, 'role'));
    if (str_contains($type, "'parent'")) {
        $pdo->exec(sprintf("ALTER TABLE `%s` MODIFY `role` ENUM('parent', 'monitor', 'guardian') NOT NULL", $table));
        $pdo->exec(sprintf("UPDATE `%s` SET `role` = 'monitor' WHERE `role` = 'parent'", $table));
    }

    $type = strtolower(column_type($pdo, $table, 'role'));
    if ($type !== "enum('monitor','guardian')" && $type !== "enum('monitor', 'guardian')") {
        $pdo->exec(sprintf("ALTER TABLE `%s` MODIFY `role` ENUM('monitor', 'guardian') NOT NULL", $table));
    }
}

function add_column_if_missing(PDO $pdo, string $table, string $column, string $definition): void
{
    assert_safe_identifier($table);
    assert_safe_identifier($column);

    $stmt = $pdo->prepare("
        SELECT COUNT(*)
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = ?
          AND COLUMN_NAME = ?
    ");
    $stmt->execute([$table, $column]);

    if ((int) $stmt->fetchColumn() > 0) {
        return;
    }

    $pdo->exec(sprintf('ALTER TABLE `%s` ADD COLUMN `%s` %s', $table, $column, $definition));
}

function assert_safe_identifier(string $identifier): void
{
    if (!preg_match('/^[A-Za-z0-9_]+$/', $identifier)) {
        throw new RuntimeException('Unsafe SQL identifier.');
    }
}

function e(string $value): string
{
    return htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function redirect(string $url): never
{
    header('Location: ' . $url);
    exit;
}

function admin_base_path(): string
{
    if (!defined('ADMIN_PATH')) {
        throw new RuntimeException('ADMIN_PATH is not configured.');
    }

    $path = trim((string) ADMIN_PATH, " \t\n\r\0\x0B/");
    if ($path === '' || !preg_match('/^[A-Za-z0-9_-]+$/', $path)) {
        throw new RuntimeException('ADMIN_PATH must contain only letters, numbers, underscores or hyphens.');
    }

    return $path;
}

function admin_source_dir(): string
{
    if (!defined('ADMIN_SOURCE_DIR')) {
        throw new RuntimeException('ADMIN_SOURCE_DIR is not configured.');
    }

    $dir = trim((string) ADMIN_SOURCE_DIR, " \t\n\r\0\x0B/");
    if ($dir === '' || !preg_match('/^[A-Za-z0-9_-]+$/', $dir)) {
        throw new RuntimeException('ADMIN_SOURCE_DIR must contain only letters, numbers, underscores or hyphens.');
    }

    return $dir;
}

function admin_url_path(): string
{
    return admin_base_path() . '/';
}

function require_admin_path(): void
{
    $configured = '/' . admin_base_path();
    $requestPath = (string) (parse_url((string) ($_SERVER['REQUEST_URI'] ?? ''), PHP_URL_PATH) ?: '');
    $scriptPath = (string) ($_SERVER['SCRIPT_NAME'] ?? '');

    if (path_matches_admin_base($requestPath, $configured) || path_matches_admin_base($scriptPath, $configured)) {
        return;
    }

    http_response_code(404);
    exit('Not found.');
}

function path_matches_admin_base(string $path, string $configured): bool
{
    return $path === $configured || str_starts_with($path, $configured . '/');
}

function csrf_token(): string
{
    if (empty($_SESSION['csrf_token'])) {
        $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
    }

    return $_SESSION['csrf_token'];
}

function require_csrf(): void
{
    $token = $_POST['csrf_token'] ?? '';
    if (!is_string($token) || !hash_equals(csrf_token(), $token)) {
        http_response_code(400);
        exit('CSRF token invalid.');
    }
}

function is_admin_logged_in(): bool
{
    return !empty($_SESSION['admin_logged_in']);
}

function require_admin(): void
{
    if (!is_admin_logged_in()) {
        redirect('/');
    }
}

function current_user(): ?array
{
    if (empty($_SESSION['user_id'])) {
        return null;
    }

    $stmt = db()->prepare('SELECT * FROM users WHERE id = ? AND is_active = 1');
    $stmt->execute([(int) $_SESSION['user_id']]);
    $user = $stmt->fetch();

    return $user ?: null;
}

function require_user(): array
{
    require_app_user_agent();

    $user = current_user();
    if (!$user) {
        json_response(['ok' => false, 'message' => '请先登录。'], 401);
    }

    require_terms_accepted($user);

    return $user;
}

function require_terms_accepted(array $user): void
{
    if (user_terms_accepted($user)) {
        return;
    }

    json_response(['ok' => false, 'message' => '请先同意用户协议和隐私条约。'], 403);
}

function user_terms_accepted(array $user): bool
{
    return !empty($user['terms_accepted_at']);
}

function require_app_user_agent(): void
{
    $ua = (string) ($_SERVER['HTTP_USER_AGENT'] ?? '');
    if (stripos($ua, APP_USER_AGENT_TOKEN) === false) {
        json_response(['ok' => false, 'message' => 'Only loc-app client is allowed.'], 403);
    }
}

function require_loc_app_page(): void
{
    $ua = (string) ($_SERVER['HTTP_USER_AGENT'] ?? '');
    if (stripos($ua, APP_USER_AGENT_TOKEN) !== false) {
        return;
    }

    http_response_code(403);
    exit('Forbidden.');
}

function require_report_device_cookie(): string
{
    $cookieName = defined('APP_DEVICE_COOKIE_NAME') ? APP_DEVICE_COOKIE_NAME : 'loc_device';
    $deviceCookie = (string) ($_COOKIE[$cookieName] ?? '');

    if (!preg_match('/^[a-f0-9]{64}$/i', $deviceCookie)) {
        json_response(['ok' => false, 'message' => '请使用新版 App 上报位置。'], 403);
    }

    return strtolower($deviceCookie);
}

function json_response(array $data, int $status = 200): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function post_string(string $key, int $maxLength = 255): string
{
    $value = trim((string) ($_POST[$key] ?? ''));

    if (function_exists('mb_strlen') && mb_strlen($value, 'UTF-8') > $maxLength) {
        $value = mb_substr($value, 0, $maxLength, 'UTF-8');
    } elseif (!function_exists('mb_strlen') && strlen($value) > $maxLength * 4) {
        $value = substr($value, 0, $maxLength * 4);
    }

    return $value;
}

function request_data(): array
{
    static $data = null;

    if (is_array($data)) {
        return $data;
    }

    $contentType = (string) ($_SERVER['CONTENT_TYPE'] ?? '');
    if (stripos($contentType, 'application/json') !== false) {
        $raw = file_get_contents('php://input');
        $decoded = json_decode($raw === false ? '' : $raw, true);
        $data = is_array($decoded) ? $decoded : [];
        return $data;
    }

    $data = $_POST;
    return $data;
}

function input_string(string $key, int $maxLength = 255): string
{
    $data = request_data();
    $value = trim((string) ($data[$key] ?? ''));

    if (function_exists('mb_strlen') && mb_strlen($value, 'UTF-8') > $maxLength) {
        $value = mb_substr($value, 0, $maxLength, 'UTF-8');
    } elseif (!function_exists('mb_strlen') && strlen($value) > $maxLength * 4) {
        $value = substr($value, 0, $maxLength * 4);
    }

    return $value;
}

function input_float(string $key): ?float
{
    $data = request_data();
    if (!isset($data[$key]) || $data[$key] === '') {
        return null;
    }

    if (!is_numeric($data[$key])) {
        return null;
    }

    return (float) $data[$key];
}

function input_bool(string $key): bool
{
    $data = request_data();
    $value = $data[$key] ?? false;

    if (is_bool($value)) {
        return $value;
    }

    if (is_numeric($value)) {
        return (int) $value === 1;
    }

    return in_array(strtolower(trim((string) $value)), ['1', 'true', 'yes', 'on'], true);
}

function format_datetime(?string $value): string
{
    if (!$value) {
        return '';
    }

    return date('Y-m-d H:i:s', strtotime($value));
}

function role_label(string $role): string
{
    return normalize_role($role) === 'monitor' ? '监测端' : '监护端';
}

function normalize_role(string $role): string
{
    return $role === 'parent' ? 'monitor' : $role;
}

function is_valid_role(string $role): bool
{
    return in_array(normalize_role($role), ['monitor', 'guardian'], true);
}

function group_payload(array $group): array
{
    return [
        'id' => (int) ($group['id'] ?? 0),
        'group_name' => $group['group_name'],
        'role' => normalize_role((string) $group['role']),
        'role_label' => role_label((string) $group['role']),
    ];
}

function location_payload(?array $row): ?array
{
    if (!$row) {
        return null;
    }

    $diagnostics = null;
    if (!empty($row['address_diagnostics'])) {
        $decoded = json_decode((string) $row['address_diagnostics'], true);
        $diagnostics = is_array($decoded) ? $decoded : null;
    }

    return [
        'user_id' => (int) $row['user_id'],
        'username' => $row['username'],
        'display_name' => $row['display_name'],
        'role' => normalize_role((string) $row['role']),
        'role_label' => role_label($row['role']),
        'group_name' => $row['group_name'],
        'latitude' => (float) $row['latitude'],
        'longitude' => (float) $row['longitude'],
        'accuracy' => $row['accuracy'] === null ? null : (float) $row['accuracy'],
        'heading' => $row['heading'] === null ? null : (float) $row['heading'],
        'speed' => $row['speed'] === null ? null : (float) $row['speed'],
        'address_mismatch' => (int) ($row['address_mismatch'] ?? 0) === 1,
        'address_diagnostics' => $diagnostics,
        'updated_at' => format_datetime($row['updated_at']),
        'is_stale' => strtotime((string) $row['updated_at']) < time() - LOCATION_STALE_SECONDS,
    ];
}

function api_error_message(Throwable $error): string
{
    error_log('[family-location] ' . $error::class . ': ' . $error->getMessage());
    return '服务器错误，请稍后重试。';
}

function public_user_payload(array $user): array
{
    $groups = user_groups_for_user((int) $user['id']);
    $membership = $groups[0] ?? null;

    return [
        'id' => (int) $user['id'],
        'username' => $user['username'],
        'display_name' => $user['display_name'],
        'group_name' => $membership['group_name'] ?? '',
        'role' => $membership ? normalize_role((string) $membership['role']) : '',
        'role_label' => $membership ? role_label((string) $membership['role']) : '',
        'terms_accepted' => user_terms_accepted($user),
        'groups' => array_map('group_payload', $groups),
        'report_interval_seconds' => user_report_interval_seconds($user),
    ];
}

function public_user_payload_for_group(array $user, array $membership): array
{
    $payload = public_user_payload($user);
    $payload['group_name'] = $membership['group_name'];
    $payload['role'] = normalize_role((string) $membership['role']);
    $payload['role_label'] = role_label((string) $membership['role']);

    return $payload;
}

function normalize_report_interval_seconds(int $seconds): int
{
    return max(MIN_REPORT_INTERVAL_SECONDS, min(MAX_REPORT_INTERVAL_SECONDS, $seconds));
}

function user_report_interval_seconds(array $user): int
{
    return normalize_report_interval_seconds((int) ($user['report_interval_seconds'] ?? DEFAULT_REPORT_INTERVAL_SECONDS));
}

function user_groups_for_user(int $userId): array
{
    $stmt = db()->prepare('
        SELECT id, user_id, group_name, role
        FROM user_groups
        WHERE user_id = ?
        ORDER BY group_name ASC, id ASC
    ');
    $stmt->execute([$userId]);

    return $stmt->fetchAll();
}

function selected_group_name_from_request(): string
{
    $data = request_data();
    $groupName = trim((string) ($data['group_name'] ?? ($_GET['group_name'] ?? '')));

    if (function_exists('mb_strlen') && mb_strlen($groupName, 'UTF-8') > 100) {
        return mb_substr($groupName, 0, 100, 'UTF-8');
    }

    if (!function_exists('mb_strlen') && strlen($groupName) > 400) {
        return substr($groupName, 0, 400);
    }

    return $groupName;
}

function user_membership_for_group(array $user, string $groupName = ''): ?array
{
    $groups = user_groups_for_user((int) $user['id']);

    if ($groupName === '') {
        return $groups[0] ?? null;
    }

    foreach ($groups as $group) {
        if (hash_equals((string) $group['group_name'], $groupName)) {
            return $group;
        }
    }

    return null;
}

function require_user_membership(array $user, string $groupName = ''): array
{
    $membership = user_membership_for_group($user, $groupName);

    if ($membership) {
        return $membership;
    }

    if ($groupName === '') {
        json_response(['ok' => false, 'message' => '账号还没有家庭组。'], 409);
    }

    json_response(['ok' => false, 'message' => '无权访问该家庭组。'], 403);
}

function is_login_locked(array $user): bool
{
    if (empty($user['login_locked_at'])) {
        return false;
    }

    return strtotime((string) $user['login_locked_at']) > time() - LOGIN_LOCK_SECONDS;
}

function unlock_if_expired(PDO $pdo, array &$user): void
{
    if (empty($user['login_locked_at'])) {
        return;
    }

    if (strtotime((string) $user['login_locked_at']) > time() - LOGIN_LOCK_SECONDS) {
        return;
    }

    clear_failed_login($pdo, (int) $user['id']);
    $user['failed_login_count'] = 0;
    $user['login_locked_at'] = null;
}

function record_failed_login(PDO $pdo, array $user): void
{
    $failedCount = (int) ($user['failed_login_count'] ?? 0) + 1;

    if ($failedCount >= MAX_LOGIN_FAILURES) {
        $stmt = $pdo->prepare('
            UPDATE users
            SET failed_login_count = ?,
                login_locked_at = COALESCE(login_locked_at, ?)
            WHERE id = ?
        ');
        $stmt->execute([$failedCount, date('Y-m-d H:i:s'), (int) $user['id']]);
        return;
    }

    $stmt = $pdo->prepare('UPDATE users SET failed_login_count = ? WHERE id = ?');
    $stmt->execute([$failedCount, (int) $user['id']]);
}

function clear_failed_login(PDO $pdo, int $userId): void
{
    $stmt = $pdo->prepare('UPDATE users SET failed_login_count = 0, login_locked_at = NULL WHERE id = ?');
    $stmt->execute([$userId]);
}

function latest_locations_for_group(string $groupName): array
{
    $stmt = db()->prepare("
        SELECT
            ll.user_id,
            ll.group_name,
            ug.role AS role,
            ll.latitude,
            ll.longitude,
            ll.accuracy,
            ll.heading,
            ll.speed,
            ll.address_diagnostics,
            ll.address_mismatch,
            ll.updated_at,
            u.username,
            u.display_name
        FROM latest_group_locations ll
        INNER JOIN users u ON u.id = ll.user_id
        INNER JOIN user_groups ug ON ug.user_id = ll.user_id AND ug.group_name = ll.group_name
        WHERE ll.group_name = ? AND u.is_active = 1
        ORDER BY ug.role ASC, u.username ASC
    ");
    $stmt->execute([$groupName]);

    $locations = [];
    foreach ($stmt->fetchAll() as $row) {
        $locations[] = location_payload($row);
    }

    return $locations;
}
