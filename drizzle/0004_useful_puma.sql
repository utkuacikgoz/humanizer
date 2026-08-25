CREATE TABLE `deletion_audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`deletion_job_id` text,
	`subject_type` text NOT NULL,
	`subject_id` text NOT NULL,
	`scope` text NOT NULL,
	`actor_user_id` text,
	`event` text NOT NULL,
	`processor` text,
	`detail` text DEFAULT '{}' NOT NULL,
	`occurred_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	CONSTRAINT "deletion_audit_events_subject_type_check" CHECK("deletion_audit_events"."subject_type" in ('user', 'job')),
	CONSTRAINT "deletion_audit_events_scope_check" CHECK("deletion_audit_events"."scope" in ('history_item', 'full_account')),
	CONSTRAINT "deletion_audit_events_event_check" CHECK("deletion_audit_events"."event" in ('requested', 'claimed', 'propagated', 'completed', 'retry_scheduled', 'parked'))
);
--> statement-breakpoint
CREATE INDEX `deletion_audit_events_subject_idx` ON `deletion_audit_events` (`subject_id`);--> statement-breakpoint
CREATE INDEX `deletion_audit_events_job_idx` ON `deletion_audit_events` (`deletion_job_id`);--> statement-breakpoint
ALTER TABLE `deletion_jobs` ADD `requested_by_user_id` text;--> statement-breakpoint
ALTER TABLE `deletion_jobs` ADD `attempts` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `deletion_jobs` ADD `lease_expires_at` integer;--> statement-breakpoint
ALTER TABLE `deletion_jobs` ADD `failure_code` text;--> statement-breakpoint
CREATE INDEX `deletion_jobs_status_idx` ON `deletion_jobs` (`status`,`requested_at`);