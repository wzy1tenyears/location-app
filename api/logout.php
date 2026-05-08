<?php

declare(strict_types=1);

require_once __DIR__ . '/../private/lib/bootstrap.php';

require_app_user_agent();

unset($_SESSION['user_id']);
json_response(['ok' => true]);
