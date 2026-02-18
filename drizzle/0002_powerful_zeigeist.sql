CREATE TABLE "strategist_inlinks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"principal_url" text NOT NULL,
	"analysis_url" text NOT NULL,
	"sentence" text NOT NULL,
	"anchor" text NOT NULL,
	"created_at" timestamp DEFAULT now()
);
