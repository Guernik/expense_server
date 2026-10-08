CREATE TABLE `classifier_rules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`definition` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_from_event_id` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_from_event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `classifier_rules_user` ON `classifier_rules` (`user_id`);--> statement-breakpoint
ALTER TABLE `events` ADD `extracted_by` text;