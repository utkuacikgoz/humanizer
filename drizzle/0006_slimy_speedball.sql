CREATE TABLE `sentence_operations` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`operation_key` text NOT NULL,
	`sentence_index` integer NOT NULL,
	`kind` text NOT NULL,
	`outcome` text DEFAULT 'pending' NOT NULL,
	`charged_words` integer DEFAULT 0 NOT NULL,
	`revision_id` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `humanization_jobs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`revision_id`) REFERENCES `result_revisions`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "sentence_operations_kind_check" CHECK("sentence_operations"."kind" in ('regenerate', 'restore')),
	CONSTRAINT "sentence_operations_outcome_check" CHECK("sentence_operations"."outcome" in ('pending', 'applied', 'unchanged', 'rejected')),
	CONSTRAINT "sentence_operations_sentence_index_check" CHECK("sentence_operations"."sentence_index" >= 0),
	CONSTRAINT "sentence_operations_charged_words_check" CHECK("sentence_operations"."charged_words" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sentence_operations_key_idx` ON `sentence_operations` (`operation_key`);--> statement-breakpoint
CREATE INDEX `sentence_operations_job_sentence_idx` ON `sentence_operations` (`job_id`,`sentence_index`);--> statement-breakpoint
ALTER TABLE `result_revisions` ADD `sequence` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `result_revisions` ADD `sentence_index` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `result_revisions_job_sequence_idx` ON `result_revisions` (`job_id`,`sequence`);