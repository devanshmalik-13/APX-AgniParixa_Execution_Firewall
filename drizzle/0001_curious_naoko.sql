ALTER TABLE `prompt_events` ADD `actor_id` text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE `prompt_events` ADD `actor_name` text DEFAULT 'Earlier demo runs' NOT NULL;--> statement-breakpoint
ALTER TABLE `prompt_events` ADD `attack_level` text;