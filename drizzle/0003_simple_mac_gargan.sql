DROP TRIGGER IF EXISTS `preview_guard_admit_insert`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `preview_guard_count_insert`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `preview_guard_admit_reactivation`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `preview_guard_count_reactivation`;--> statement-breakpoint
ALTER TABLE `preview_guard_windows` ADD `admission_token` text;
