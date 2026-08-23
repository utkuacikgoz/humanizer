CREATE TABLE `analytics_outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`event_name` text NOT NULL,
	`event_version` integer NOT NULL,
	`actor_id` text,
	`job_id` text,
	`properties` text DEFAULT '{}' NOT NULL,
	`occurred_at` integer NOT NULL,
	`delivery_status` text DEFAULT 'pending' NOT NULL,
	`delivered_at` integer,
	`delivery_attempts` integer DEFAULT 0 NOT NULL,
	CONSTRAINT "analytics_outbox_delivery_status_check" CHECK("analytics_outbox"."delivery_status" in ('pending', 'delivered', 'failed'))
);
--> statement-breakpoint
CREATE INDEX `analytics_outbox_delivery_status_idx` ON `analytics_outbox` (`delivery_status`);--> statement-breakpoint
CREATE TABLE `anonymous_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`capability_digest` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`expires_at` integer NOT NULL,
	`consumed_at` integer,
	`abuse_count` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `humanization_jobs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `anonymous_sessions_job_id_idx` ON `anonymous_sessions` (`job_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `anonymous_sessions_capability_digest_idx` ON `anonymous_sessions` (`capability_digest`);--> statement-breakpoint
CREATE TABLE `deletion_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`subject_type` text NOT NULL,
	`subject_id` text NOT NULL,
	`scope` text NOT NULL,
	`requested_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`completed_at` integer,
	`processor_status` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	CONSTRAINT "deletion_jobs_subject_type_check" CHECK("deletion_jobs"."subject_type" in ('user', 'job')),
	CONSTRAINT "deletion_jobs_scope_check" CHECK("deletion_jobs"."scope" in ('history_item', 'full_account')),
	CONSTRAINT "deletion_jobs_status_check" CHECK("deletion_jobs"."status" in ('pending', 'in_progress', 'completed', 'failed'))
);
--> statement-breakpoint
CREATE INDEX `deletion_jobs_subject_idx` ON `deletion_jobs` (`subject_id`);--> statement-breakpoint
CREATE TABLE `humanization_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text,
	`mode` text NOT NULL,
	`state` text DEFAULT 'received' NOT NULL,
	`client_fingerprint` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`content_fingerprint` text NOT NULL,
	`input_word_count` integer NOT NULL,
	`successful_word_count` integer,
	`pipeline_version` integer NOT NULL,
	`terminal_error_class` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "humanization_jobs_mode_check" CHECK("humanization_jobs"."mode" in ('natural', 'professional', 'academic', 'casual')),
	CONSTRAINT "humanization_jobs_state_check" CHECK("humanization_jobs"."state" in ('received', 'validated', 'analyzed', 'protected', 'rewriting', 'verifying', 'evaluating', 'succeeded', 'retryable_failed', 'terminal_failed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `humanization_jobs_client_idempotency_idx` ON `humanization_jobs` (`client_fingerprint`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `humanization_jobs_owner_idx` ON `humanization_jobs` (`owner_user_id`);--> statement-breakpoint
CREATE TABLE `job_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`stage` text NOT NULL,
	`section_key` text,
	`attempt_number` integer NOT NULL,
	`status` text NOT NULL,
	`provider_name` text,
	`provider_model` text,
	`prompt_version` text,
	`tokens_used` integer,
	`cost_usd` real,
	`latency_ms` integer,
	`failure_code` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `humanization_jobs`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "job_attempts_stage_check" CHECK("job_attempts"."stage" in ('extraction', 'analysis', 'rewrite', 'verification', 'evaluation')),
	CONSTRAINT "job_attempts_status_check" CHECK("job_attempts"."status" in ('succeeded', 'failed', 'aborted'))
);
--> statement-breakpoint
CREATE INDEX `job_attempts_job_id_idx` ON `job_attempts` (`job_id`);--> statement-breakpoint
CREATE TABLE `job_payloads` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`source_ref` text NOT NULL,
	`result_ref` text,
	`preview_projection` text,
	`encryption_key_id` text,
	`purged_at` integer,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `humanization_jobs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `job_payloads_job_id_idx` ON `job_payloads` (`job_id`);--> statement-breakpoint
CREATE TABLE `protected_items` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`item_key` text NOT NULL,
	`kind` text NOT NULL,
	`source_span_start` integer NOT NULL,
	`source_span_end` integer NOT NULL,
	`value_hash` text NOT NULL,
	`value_ref` text,
	`verification_status` text DEFAULT 'pending' NOT NULL,
	`purged_at` integer,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `humanization_jobs`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "protected_items_kind_check" CHECK("protected_items"."kind" in ('person', 'company', 'product', 'date', 'number', 'percentage', 'currency', 'quotation', 'citation', 'url', 'technical-term', 'code', 'reference')),
	CONSTRAINT "protected_items_verification_status_check" CHECK("protected_items"."verification_status" in ('pending', 'preserved', 'altered', 'missing'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `protected_items_job_item_idx` ON `protected_items` (`job_id`,`item_key`);--> statement-breakpoint
CREATE TABLE `result_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`parent_revision_id` text,
	`revision_type` text NOT NULL,
	`result_ref` text NOT NULL,
	`successful_word_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `humanization_jobs`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "result_revisions_type_check" CHECK("result_revisions"."revision_type" in ('original', 'sentence_regeneration', 'manual_edit', 'restore'))
);
--> statement-breakpoint
CREATE INDEX `result_revisions_job_id_idx` ON `result_revisions` (`job_id`);--> statement-breakpoint
CREATE TABLE `stripe_events` (
	`id` text PRIMARY KEY NOT NULL,
	`event_type` text NOT NULL,
	`object_id` text,
	`stripe_created_at` integer NOT NULL,
	`processing_status` text DEFAULT 'pending' NOT NULL,
	`processing_attempts` integer DEFAULT 0 NOT NULL,
	`received_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`processed_at` integer,
	CONSTRAINT "stripe_events_processing_status_check" CHECK("stripe_events"."processing_status" in ('pending', 'processed', 'failed', 'ignored'))
);
--> statement-breakpoint
CREATE INDEX `stripe_events_object_id_idx` ON `stripe_events` (`object_id`);--> statement-breakpoint
CREATE TABLE `subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`stripe_customer_id` text NOT NULL,
	`stripe_subscription_id` text NOT NULL,
	`plan_id` text NOT NULL,
	`catalog_version` integer NOT NULL,
	`status` text NOT NULL,
	`current_period_start` integer NOT NULL,
	`current_period_end` integer NOT NULL,
	`cancel_at_period_end` integer DEFAULT false NOT NULL,
	`last_stripe_event_id` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "subscriptions_plan_id_check" CHECK("subscriptions"."plan_id" in ('starter', 'pro')),
	CONSTRAINT "subscriptions_status_check" CHECK("subscriptions"."status" in ('active', 'trialing', 'past_due', 'unpaid', 'canceled', 'incomplete_expired'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `subscriptions_stripe_subscription_id_idx` ON `subscriptions` (`stripe_subscription_id`);--> statement-breakpoint
CREATE INDEX `subscriptions_user_id_idx` ON `subscriptions` (`user_id`);--> statement-breakpoint
CREATE TABLE `usage_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`subscription_id` text,
	`period_start` integer NOT NULL,
	`operation_key` text NOT NULL,
	`entry_type` text NOT NULL,
	`attempted_words` integer DEFAULT 0 NOT NULL,
	`successful_words` integer DEFAULT 0 NOT NULL,
	`job_id` text,
	`reason` text,
	`actor` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`subscription_id`) REFERENCES `subscriptions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`job_id`) REFERENCES `humanization_jobs`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "usage_entries_entry_type_check" CHECK("usage_entries"."entry_type" in ('reservation', 'commit', 'release', 'adjustment'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `usage_entries_operation_key_type_idx` ON `usage_entries` (`operation_key`,`entry_type`);--> statement-breakpoint
CREATE INDEX `usage_entries_user_period_idx` ON `usage_entries` (`user_id`,`period_start`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`external_subject` text NOT NULL,
	`contact_email` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_external_subject_idx` ON `users` (`external_subject`);