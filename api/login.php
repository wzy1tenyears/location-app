<?php

declare(strict_types=1);

require_once __DIR__ . '/../private/lib/bootstrap.php';

require_app_user_agent();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['ok' => false, 'message' => 'Method not allowed.'], 405);
}

try {
    $username = input_string('username', 64);
    $password = input_string('password', 255);
    $termsAccepted = input_bool('terms_accepted');

    if ($username === '' || $password === '') {
        json_response(['ok' => false, 'message' => '请输入账号和密码。'], 422);
    }

    if (hash_equals(ADMIN_USERNAME, $username)) {
        if (!hash_equals(ADMIN_PASSWORD, $password)) {
            json_response(['ok' => false, 'message' => '账号或密码错误。'], 401);
        }

        session_regenerate_id(true);
        unset($_SESSION['user_id']);
        $_SESSION['admin_logged_in'] = true;
        json_response(['ok' => true, 'redirect' => admin_url_path()]);
    }

    $pdo = db();
    $stmt = $pdo->prepare('SELECT * FROM users WHERE username = ? AND is_active = 1');
    $stmt->execute([$username]);
    $user = $stmt->fetch();

    if (!$user) {
        json_response(['ok' => false, 'message' => '账号或密码错误。'], 401);
    }

    unlock_if_expired($pdo, $user);

    if (is_login_locked($user)) {
        json_response(['ok' => false, 'message' => '账号已锁定 30 分钟，请稍后再试。'], 423);
    }

    if (!password_verify($password, (string) $user['password_hash'])) {
        record_failed_login($pdo, $user);

        $failedCount = (int) ($user['failed_login_count'] ?? 0) + 1;
        if ($failedCount >= MAX_LOGIN_FAILURES) {
            json_response(['ok' => false, 'message' => '账号已锁定 30 分钟，请稍后再试。'], 423);
        }

        json_response(['ok' => false, 'message' => '账号或密码错误。'], 401);
    }

    if (!$termsAccepted) {
        json_response(['ok' => false, 'message' => '请先同意用户协议和隐私条约。'], 403);
    }

    session_regenerate_id(true);
    $_SESSION['user_id'] = (int) $user['id'];
    clear_failed_login($pdo, (int) $user['id']);
    if (!user_terms_accepted($user)) {
        $stmt = $pdo->prepare('UPDATE users SET terms_accepted_at = NOW() WHERE id = ?');
        $stmt->execute([(int) $user['id']]);
        $user['terms_accepted_at'] = date('Y-m-d H:i:s');
    }

    json_response([
        'ok' => true,
        'user' => public_user_payload($user),
    ]);
} catch (Throwable $th) {
    json_response(['ok' => false, 'message' => api_error_message($th)], 500);
}
