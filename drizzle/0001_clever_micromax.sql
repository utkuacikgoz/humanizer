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
CREATE INDEX `preview_guard_windows_start_idx` ON `preview_guard_windows` (`window_start`);
