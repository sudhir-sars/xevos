CREATE TABLE `agent_memories` (
	`agent_id` text PRIMARY KEY NOT NULL,
	`messages` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `agents` (
	`id` text PRIMARY KEY NOT NULL,
	`role` text NOT NULL,
	`department` text NOT NULL,
	`objective` text NOT NULL,
	`kpis` text NOT NULL,
	`responsibilities` text NOT NULL,
	`manages` text NOT NULL,
	`reports_to` text NOT NULL,
	`tools` text NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `agents_by_status` ON `agents` (`status`);--> statement-breakpoint
CREATE INDEX `agents_by_reports_to` ON `agents` (`reports_to`);--> statement-breakpoint
CREATE TABLE `counters` (
	`key` text PRIMARY KEY NOT NULL,
	`value` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `events` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source` text NOT NULL,
	`target` text NOT NULL,
	`topic` text NOT NULL,
	`type` text NOT NULL,
	`body` text,
	`correlation_id` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `events_by_target` ON `events` (`target`);--> statement-breakpoint
CREATE INDEX `events_by_topic` ON `events` (`topic`);--> statement-breakpoint
CREATE TABLE `inbox` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`target` text NOT NULL,
	`event` text NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `inbox_by_target_status` ON `inbox` (`target`,`status`);--> statement-breakpoint
CREATE TABLE `memory_warehouse` (
	`rowid` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`memory_id` text NOT NULL,
	`task_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`outcome` text NOT NULL,
	`learning` text NOT NULL,
	`messages` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `warehouse_by_memory_id` ON `memory_warehouse` (`memory_id`);--> statement-breakpoint
CREATE INDEX `warehouse_by_agent` ON `memory_warehouse` (`agent_id`);--> statement-breakpoint
CREATE INDEX `warehouse_by_task` ON `memory_warehouse` (`task_id`);--> statement-breakpoint
CREATE TABLE `prompts` (
	`key` text PRIMARY KEY NOT NULL,
	`content` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`acceptance_criteria` text NOT NULL,
	`referce_task` text,
	`dependencies` text NOT NULL,
	`assigned_to` text,
	`priority` text NOT NULL,
	`deadline` integer,
	`budget` text NOT NULL,
	`review` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `tasks_by_assigned_to` ON `tasks` (`assigned_to`);--> statement-breakpoint
CREATE INDEX `tasks_by_status` ON `tasks` (`status`);