import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const strategistInlinks = pgTable("strategist_inlinks", {
  id: uuid("id").defaultRandom().primaryKey(),
  principalUrl: text("principal_url").notNull(),
  analysisUrl: text("analysis_url").notNull(),
  sentence: text("sentence").notNull(),
  anchor: text("anchor").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});
