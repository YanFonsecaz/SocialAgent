CREATE TABLE "trends_config" (
	"id" text PRIMARY KEY NOT NULL,
	"sector" text NOT NULL,
	"periods" jsonb NOT NULL,
	"top_n" integer NOT NULL,
	"rising_n" integer NOT NULL,
	"max_articles" integer NOT NULL,
	"email_recipients" jsonb NOT NULL,
	"email_enabled" boolean NOT NULL,
	"email_mode" text,
	"email_api_provider" text,
	"custom_topics" jsonb,
	"updated_at" timestamp DEFAULT now()
);
