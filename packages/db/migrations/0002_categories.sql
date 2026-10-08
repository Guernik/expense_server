CREATE TABLE `categories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`name` text NOT NULL,
	`group_id` integer NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `categories_user_name` ON `categories` (`user_id`,`name`);--> statement-breakpoint
CREATE TABLE `chat_state` (
	`chat_id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`state` text NOT NULL,
	`expires_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `groups` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`name` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `groups_user_name` ON `groups` (`user_id`,`name`);--> statement-breakpoint
CREATE TABLE `merchant_rules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`merchant_normalized` text NOT NULL,
	`category_id` integer NOT NULL,
	`source` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `merchant_rules_user_merchant` ON `merchant_rules` (`user_id`,`merchant_normalized`);--> statement-breakpoint
ALTER TABLE `purchases` ADD `category_id` integer REFERENCES categories(id);--> statement-breakpoint
ALTER TABLE `purchases` ADD `categorized_by` text;--> statement-breakpoint
ALTER TABLE `purchases` ADD `updated_at` text;--> statement-breakpoint
UPDATE `purchases` SET `updated_at` = `created_at`;
