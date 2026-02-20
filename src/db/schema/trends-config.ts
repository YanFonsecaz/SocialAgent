import { pgTable, text, integer, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";

export const trendsConfig = pgTable("trends_config", {
  id: text("id").primaryKey(),
  sector: text("sector").notNull(),
  periods: jsonb("periods").notNull(),
  topN: integer("top_n").notNull(),
  risingN: integer("rising_n").notNull(),
  maxArticles: integer("max_articles").notNull(),
  emailRecipients: jsonb("email_recipients").notNull(),
  emailEnabled: boolean("email_enabled").notNull(),
  emailMode: text("email_mode"),
  emailApiProvider: text("email_api_provider"),
  customTopics: jsonb("custom_topics"),
  updatedAt: timestamp("updated_at").defaultNow(),
});
