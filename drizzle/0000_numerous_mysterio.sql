CREATE TABLE `audit_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`prompt_id` text NOT NULL,
	`created_at` text NOT NULL,
	`mode` text NOT NULL,
	`action_id` text NOT NULL,
	`action_json` text NOT NULL,
	`evaluation_json` text NOT NULL,
	`execution_json` text NOT NULL,
	`decision` text NOT NULL,
	`executed` integer NOT NULL,
	`risk_score` integer NOT NULL,
	`analyst_verdict` text,
	`receipt_hash` text NOT NULL,
	FOREIGN KEY (`prompt_id`) REFERENCES `prompt_events`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `prompt_events` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`prompt` text NOT NULL,
	`source` text NOT NULL,
	`scenario_id` text,
	`ground_truth` text NOT NULL,
	`status` text NOT NULL,
	`error` text
);
