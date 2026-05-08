<?php

declare(strict_types=1);

require_once __DIR__ . '/../private/lib/bootstrap.php';

require_app_user_agent();

try {
    $user = require_user();
    $membership = require_user_membership($user, selected_group_name_from_request());

    json_response([
        'ok' => true,
        'user' => public_user_payload_for_group($user, $membership),
        'selected_group' => group_payload($membership),
        'report_interval_seconds' => user_report_interval_seconds($user),
        'server_time' => date('Y-m-d H:i:s'),
    ]);
} catch (Throwable $th) {
    json_response(['ok' => false, 'message' => api_error_message($th)], 500);
}
