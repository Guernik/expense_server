ALTER TABLE `purchases` ADD `suggested_category_id` integer REFERENCES categories(id);--> statement-breakpoint
ALTER TABLE `purchases` ADD `suggested_category_name` text;--> statement-breakpoint
ALTER TABLE `purchases` ADD `suggested_group_name` text;