ALTER TABLE `purchases` ADD `source_event_id` integer REFERENCES events(id);--> statement-breakpoint
CREATE UNIQUE INDEX `purchases_source_event` ON `purchases` (`source_event_id`);