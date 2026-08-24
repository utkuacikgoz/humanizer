CREATE TABLE `preview_guard_requests` (
	`request_key` text PRIMARY KEY NOT NULL,
	`client_key` text NOT NULL,
	`fingerprint` text NOT NULL,
	`window_start` integer NOT NULL,
	`status` text NOT NULL,
	`lease_expires_at` integer NOT NULL,
	`response_ciphertext` text,
	`response_iv` text,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "preview_guard_requests_status_check" CHECK("preview_guard_requests"."status" in ('active', 'succeeded', 'failed'))
);
--> statement-breakpoint
CREATE INDEX `preview_guard_requests_client_active_idx` ON `preview_guard_requests` (`client_key`,`status`,`lease_expires_at`);--> statement-breakpoint
CREATE INDEX `preview_guard_requests_expires_idx` ON `preview_guard_requests` (`expires_at`);--> statement-breakpoint
CREATE TABLE `preview_guard_windows` (
	`client_key` text NOT NULL,
	`window_start` integer NOT NULL,
	`request_count` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`client_key`, `window_start`),
	CONSTRAINT "preview_guard_windows_count_check" CHECK("preview_guard_windows"."request_count" >= 0)
);
--> statement-breakpoint
CREATE INDEX `preview_guard_windows_start_idx` ON `preview_guard_windows` (`window_start`);--> statement-breakpoint
CREATE TRIGGER `preview_guard_admit_insert`
BEFORE INSERT ON `preview_guard_requests`
BEGIN
	SELECT CASE WHEN COALESCE((
		SELECT `request_count` FROM `preview_guard_windows`
		WHERE `client_key` = NEW.`client_key` AND `window_start` = NEW.`window_start`
	), 0) >= 12 THEN RAISE(ABORT, 'preview_rate_limit') END;
	SELECT CASE WHEN (
		SELECT COUNT(*) FROM `preview_guard_requests`
		WHERE `client_key` = NEW.`client_key`
		  AND `status` = 'active'
		  AND `lease_expires_at` > NEW.`created_at`
	) >= 2 THEN RAISE(ABORT, 'preview_concurrency_limit') END;
END;--> statement-breakpoint
CREATE TRIGGER `preview_guard_count_insert`
AFTER INSERT ON `preview_guard_requests`
BEGIN
	INSERT INTO `preview_guard_windows` (`client_key`, `window_start`, `request_count`, `updated_at`)
	VALUES (NEW.`client_key`, NEW.`window_start`, 1, NEW.`updated_at`)
	ON CONFLICT(`client_key`, `window_start`) DO UPDATE SET
		`request_count` = `request_count` + 1,
		`updated_at` = excluded.`updated_at`;
END;--> statement-breakpoint
CREATE TRIGGER `preview_guard_admit_reactivation`
BEFORE UPDATE OF `status` ON `preview_guard_requests`
WHEN NEW.`status` = 'active' AND (OLD.`status` != 'active' OR OLD.`lease_expires_at` <= NEW.`updated_at`)
BEGIN
	SELECT CASE WHEN COALESCE((
		SELECT `request_count` FROM `preview_guard_windows`
		WHERE `client_key` = NEW.`client_key` AND `window_start` = NEW.`window_start`
	), 0) >= 12 THEN RAISE(ABORT, 'preview_rate_limit') END;
	SELECT CASE WHEN (
		SELECT COUNT(*) FROM `preview_guard_requests`
		WHERE `client_key` = NEW.`client_key`
		  AND `request_key` != NEW.`request_key`
		  AND `status` = 'active'
		  AND `lease_expires_at` > NEW.`updated_at`
	) >= 2 THEN RAISE(ABORT, 'preview_concurrency_limit') END;
END;--> statement-breakpoint
CREATE TRIGGER `preview_guard_count_reactivation`
AFTER UPDATE OF `status` ON `preview_guard_requests`
WHEN NEW.`status` = 'active' AND (OLD.`status` != 'active' OR OLD.`lease_expires_at` <= NEW.`updated_at`)
BEGIN
	INSERT INTO `preview_guard_windows` (`client_key`, `window_start`, `request_count`, `updated_at`)
	VALUES (NEW.`client_key`, NEW.`window_start`, 1, NEW.`updated_at`)
	ON CONFLICT(`client_key`, `window_start`) DO UPDATE SET
		`request_count` = `request_count` + 1,
		`updated_at` = excluded.`updated_at`;
END;
