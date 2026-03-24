import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { vector } from "drizzle-orm/pg-core";
import { authUsers } from "./auth";

export const storeContent = pgTable("store_content", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => authUsers.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  content: text("content").notNull(),
  embedding: vector("embedding", { dimensions: 1536 }).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});
