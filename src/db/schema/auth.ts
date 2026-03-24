import {
    boolean,
    integer,
    pgTable,
    text,
    timestamp,
    uniqueIndex,
} from "drizzle-orm/pg-core";

export const authUsers = pgTable(
    "user",
    {
        id: text("id").primaryKey().notNull(),
        name: text("name").notNull(),
        email: text("email").notNull(),
        emailVerified: boolean("email_verified").notNull().default(false),
        image: text("image"),
        createdAt: timestamp("created_at").notNull().defaultNow(),
        updatedAt: timestamp("updated_at").notNull().defaultNow(),
    },
    (table) => ({
        userEmailUniqueIdx: uniqueIndex("user_email_unique_idx").on(table.email),
    }),
);

export const authSessions = pgTable(
    "session",
    {
        id: text("id").primaryKey().notNull(),
        userId: text("user_id")
            .notNull()
            .references(() => authUsers.id, { onDelete: "cascade" }),
        token: text("token").notNull(),
        expiresAt: timestamp("expires_at").notNull(),
        ipAddress: text("ip_address"),
        userAgent: text("user_agent"),
        createdAt: timestamp("created_at").notNull().defaultNow(),
        updatedAt: timestamp("updated_at").notNull().defaultNow(),
    },
    (table) => ({
        sessionTokenUniqueIdx: uniqueIndex("session_token_unique_idx").on(
            table.token,
        ),
    }),
);

export const authAccounts = pgTable(
    "account",
    {
        id: text("id").primaryKey().notNull(),
        userId: text("user_id")
            .notNull()
            .references(() => authUsers.id, { onDelete: "cascade" }),
        accountId: text("account_id").notNull(),
        providerId: text("provider_id").notNull(),
        accessToken: text("access_token"),
        refreshToken: text("refresh_token"),
        idToken: text("id_token"),
        accessTokenExpiresAt: timestamp("access_token_expires_at"),
        refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
        scope: text("scope"),
        password: text("password"),
        createdAt: timestamp("created_at").notNull().defaultNow(),
        updatedAt: timestamp("updated_at").notNull().defaultNow(),
    },
    (table) => ({
        accountProviderAccountUniqueIdx: uniqueIndex(
            "account_provider_account_unique_idx",
        ).on(table.providerId, table.accountId),
    }),
);

export const authVerifications = pgTable(
    "verification",
    {
        id: text("id").primaryKey().notNull(),
        identifier: text("identifier").notNull(),
        value: text("value").notNull(),
        expiresAt: timestamp("expires_at").notNull(),
        createdAt: timestamp("created_at").notNull().defaultNow(),
        updatedAt: timestamp("updated_at").notNull().defaultNow(),
    },
    (table) => ({
        verificationIdentifierValueUniqueIdx: uniqueIndex(
            "verification_identifier_value_unique_idx",
        ).on(table.identifier, table.value),
    }),
);

export const userSettings = pgTable("user_settings", {
    userId: text("user_id")
        .primaryKey()
        .notNull()
        .references(() => authUsers.id, { onDelete: "cascade" }),
    tone: text("tone"),
    language: text("language").default("pt-BR"),
    defaultsJson: text("defaults_json"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const llmGenerations = pgTable("llm_generations", {
    id: text("id").primaryKey().notNull(),
    userId: text("user_id")
        .notNull()
        .references(() => authUsers.id, { onDelete: "cascade" }),
    tool: text("tool").notNull(),
    model: text("model"),
    prompt: text("prompt"),
    output: text("output"),
    status: text("status").notNull().default("draft"),
    tokensIn: integer("tokens_in"),
    tokensOut: integer("tokens_out"),
    latencyMs: integer("latency_ms"),
    costUsd: text("cost_usd"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    approvedAt: timestamp("approved_at"),
});

