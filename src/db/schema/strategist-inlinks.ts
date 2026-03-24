import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { authUsers } from "./auth";

export const strategistInlinks = pgTable("strategist_inlinks", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => authUsers.id, { onDelete: "cascade" }),
  principalUrl: text("principal_url").notNull(),
  analysisUrl: text("analysis_url").notNull(),
  sentence: text("sentence").notNull(),
  anchor: text("anchor").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});
