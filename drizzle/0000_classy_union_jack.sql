-- Allow Drizzle to bootstrap migration tracking on databases where this table
-- was created before migrations were managed by Drizzle.
CREATE TABLE IF NOT EXISTS "store_content" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"url" text NOT NULL,
	"content" text NOT NULL,
	"embedding" vector(1536),
	"created_at" timestamp DEFAULT now()
);
