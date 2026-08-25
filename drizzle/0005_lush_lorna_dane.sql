CREATE TABLE `auth_magic_link_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`token_digest` text NOT NULL,
	`email` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`expires_at` integer NOT NULL,
	`consumed_at` integer,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	CONSTRAINT "auth_magic_link_tokens_attempt_check" CHECK("auth_magic_link_tokens"."attempt_count" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_magic_link_tokens_digest_idx` ON `auth_magic_link_tokens` (`token_digest`);--> statement-breakpoint
CREATE INDEX `auth_magic_link_tokens_email_idx` ON `auth_magic_link_tokens` (`email`);--> statement-breakpoint
CREATE INDEX `auth_magic_link_tokens_expires_idx` ON `auth_magic_link_tokens` (`expires_at`);--> statement-breakpoint
CREATE TABLE `auth_rate_limits` (
	`bucket_key` text NOT NULL,
	`window_start` integer NOT NULL,
	`request_count` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`bucket_key`, `window_start`),
	CONSTRAINT "auth_rate_limits_count_check" CHECK("auth_rate_limits"."request_count" >= 0)
);
--> statement-breakpoint
CREATE INDEX `auth_rate_limits_window_idx` ON `auth_rate_limits` (`window_start`);--> statement-breakpoint
CREATE TABLE `auth_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`session_digest` text NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`expires_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_sessions_digest_idx` ON `auth_sessions` (`session_digest`);--> statement-breakpoint
CREATE INDEX `auth_sessions_user_idx` ON `auth_sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `auth_sessions_expires_idx` ON `auth_sessions` (`expires_at`);