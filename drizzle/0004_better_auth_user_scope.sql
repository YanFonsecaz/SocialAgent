-- Safe auth migration for production. The original 0004 truncated legacy tables,
-- which would destroy production data on first deploy. This version preserves
-- existing rows and backfills them to a bootstrap auth user.

CREATE TABLE IF NOT EXISTS "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "session" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action,
	"token" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "account" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_settings" (
	"user_id" text PRIMARY KEY NOT NULL REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action,
	"tone" text,
	"language" text DEFAULT 'pt-BR',
	"defaults_json" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "llm_generations" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action,
	"tool" text NOT NULL,
	"model" text,
	"prompt" text,
	"output" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"tokens_in" integer,
	"tokens_out" integer,
	"latency_ms" integer,
	"cost_usd" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"approved_at" timestamp
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_email_unique_idx" ON "user" USING btree ("email");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "session_token_unique_idx" ON "session" USING btree ("token");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "account_provider_account_unique_idx" ON "account" USING btree ("provider_id","account_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "verification_identifier_value_unique_idx" ON "verification" USING btree ("identifier","value");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "llm_generations_user_created_idx" ON "llm_generations" USING btree ("user_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "llm_generations_user_tool_status_idx" ON "llm_generations" USING btree ("user_id","tool","status");
--> statement-breakpoint
INSERT INTO "user" (
	"id",
	"name",
	"email",
	"email_verified",
	"created_at",
	"updated_at"
)
SELECT
	'bootstrap-yan-fonseca-npbrasil-com',
	'Yan Fonseca',
	'yan.fonseca@npbrasil.com',
	true,
	now(),
	now()
WHERE NOT EXISTS (
	SELECT 1
	FROM "user"
	WHERE "email" = 'yan.fonseca@npbrasil.com'
);
--> statement-breakpoint
UPDATE "user"
SET
	"email_verified" = true,
	"updated_at" = now()
WHERE "email" = 'yan.fonseca@npbrasil.com';
--> statement-breakpoint
ALTER TABLE "store_content" ADD COLUMN IF NOT EXISTS "user_id" text;
--> statement-breakpoint
ALTER TABLE "strategist_inlinks" ADD COLUMN IF NOT EXISTS "user_id" text;
--> statement-breakpoint
ALTER TABLE "trends_config" ADD COLUMN IF NOT EXISTS "user_id" text;
--> statement-breakpoint
UPDATE "store_content"
SET "user_id" = (
	SELECT "id"
	FROM "user"
	WHERE "email" = 'yan.fonseca@npbrasil.com'
	LIMIT 1
)
WHERE "user_id" IS NULL;
--> statement-breakpoint
UPDATE "strategist_inlinks"
SET "user_id" = (
	SELECT "id"
	FROM "user"
	WHERE "email" = 'yan.fonseca@npbrasil.com'
	LIMIT 1
)
WHERE "user_id" IS NULL;
--> statement-breakpoint
UPDATE "trends_config"
SET "user_id" = (
	SELECT "id"
	FROM "user"
	WHERE "email" = 'yan.fonseca@npbrasil.com'
	LIMIT 1
)
WHERE "user_id" IS NULL;
--> statement-breakpoint
DO $$
DECLARE
	legacy_trends_rows integer;
BEGIN
	IF EXISTS (
		SELECT 1
		FROM information_schema.columns
		WHERE table_schema = 'public'
			AND table_name = 'trends_config'
			AND column_name = 'id'
	) THEN
		SELECT count(*)
		INTO legacy_trends_rows
		FROM "trends_config";

		IF legacy_trends_rows > 1 THEN
			RAISE EXCEPTION
				'Legacy trends_config has % rows; expected at most 1 before migrating to user_id primary key.',
				legacy_trends_rows;
		END IF;
	END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "store_content" ALTER COLUMN "user_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "strategist_inlinks" ALTER COLUMN "user_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "trends_config" ALTER COLUMN "user_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "store_content" DROP CONSTRAINT IF EXISTS "store_content_user_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "store_content"
	ADD CONSTRAINT "store_content_user_id_user_id_fk"
	FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "strategist_inlinks" DROP CONSTRAINT IF EXISTS "strategist_inlinks_user_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "strategist_inlinks"
	ADD CONSTRAINT "strategist_inlinks_user_id_user_id_fk"
	FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trends_config" DROP CONSTRAINT IF EXISTS "trends_config_user_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "trends_config"
	ADD CONSTRAINT "trends_config_user_id_user_id_fk"
	FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trends_config" DROP CONSTRAINT IF EXISTS "trends_config_pkey";
--> statement-breakpoint
ALTER TABLE "trends_config"
	ADD CONSTRAINT "trends_config_pkey" PRIMARY KEY ("user_id");
--> statement-breakpoint
ALTER TABLE "trends_config" DROP COLUMN IF EXISTS "id";
