import { eq } from "drizzle-orm";
import { sql } from "drizzle-orm";

process.env.DATABASE_URL ??=
    "postgres://postgres:postgres@localhost:5433/social_agent";
process.env.OPENAI_API_KEY ??= "test-openai-key";
process.env.SERPAPI_API_KEY ??= "test-serpapi-key";
process.env.APP_BASE_URL ??=
    process.env.SOCIAL_AGENT_E2E_BASE_URL ?? "http://localhost:3333";
process.env.BETTER_AUTH_SECRET ??= "e2e-dev-secret";

type CreateE2eAuthSessionInput = {
    email?: string;
    name?: string;
};

type E2eAuthSession = {
    userId: string;
    email: string;
    sessionToken: string;
    cookieHeader: string;
    expiresAt: Date;
};

const EIGHT_HOURS_MS = 8 * 60 * 60 * 1000;

type DbDeps = {
    db: typeof import("../src/db/connection").db;
    authUsers: typeof import("../src/db/schema/auth").authUsers;
    authSessions: typeof import("../src/db/schema/auth").authSessions;
};

let cachedDeps: DbDeps | null = null;
let schemaEnsured = false;

const getDbDeps = async (): Promise<DbDeps> => {
    if (cachedDeps) {
        return cachedDeps;
    }

    const [{ db }, { authUsers, authSessions }] = await Promise.all([
        import("../src/db/connection"),
        import("../src/db/schema/auth"),
    ]);

    cachedDeps = {
        db,
        authUsers,
        authSessions,
    };
    return cachedDeps;
};

const ensureE2eSchema = async (): Promise<void> => {
    if (schemaEnsured) {
        return;
    }

    const { db } = await getDbDeps();

    await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "user" (
            "id" text PRIMARY KEY NOT NULL,
            "name" text NOT NULL,
            "email" text NOT NULL,
            "email_verified" boolean NOT NULL DEFAULT false,
            "image" text,
            "created_at" timestamp NOT NULL DEFAULT now(),
            "updated_at" timestamp NOT NULL DEFAULT now()
        );
    `);

    await db.execute(sql`
        CREATE UNIQUE INDEX IF NOT EXISTS "user_email_unique_idx"
        ON "user" ("email");
    `);

    await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "session" (
            "id" text PRIMARY KEY NOT NULL,
            "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
            "token" text NOT NULL,
            "expires_at" timestamp NOT NULL,
            "ip_address" text,
            "user_agent" text,
            "created_at" timestamp NOT NULL DEFAULT now(),
            "updated_at" timestamp NOT NULL DEFAULT now()
        );
    `);

    await db.execute(sql`
        CREATE UNIQUE INDEX IF NOT EXISTS "session_token_unique_idx"
        ON "session" ("token");
    `);

    await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "llm_generations" (
            "id" text PRIMARY KEY NOT NULL,
            "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
            "tool" text NOT NULL,
            "model" text,
            "prompt" text,
            "output" text,
            "status" text NOT NULL DEFAULT 'draft',
            "tokens_in" integer,
            "tokens_out" integer,
            "latency_ms" integer,
            "cost_usd" text,
            "created_at" timestamp NOT NULL DEFAULT now(),
            "approved_at" timestamp
        );
    `);

    schemaEnsured = true;
};

const makeHmacSignature = async (
    value: string,
    secret: string,
): Promise<string> => {
    const key = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(secret),
        {
            name: "HMAC",
            hash: "SHA-256",
        },
        false,
        ["sign"],
    );

    const signatureBuffer = await crypto.subtle.sign(
        "HMAC",
        key,
        new TextEncoder().encode(value),
    );

    const signatureBytes = new Uint8Array(signatureBuffer);
    let binary = "";
    for (const byte of signatureBytes) {
        binary += String.fromCharCode(byte);
    }

    return btoa(binary);
};

const signCookieValue = async (
    value: string,
    secret: string,
): Promise<string> => {
    const signature = await makeHmacSignature(value, secret);
    return encodeURIComponent(`${value}.${signature}`);
};

const ensureUser = async (email: string, name: string): Promise<string> => {
    const { db, authUsers } = await getDbDeps();
    const normalizedEmail = email.trim().toLowerCase();

    const [existing] = await db
        .select({ id: authUsers.id })
        .from(authUsers)
        .where(eq(authUsers.email, normalizedEmail))
        .limit(1);

    if (existing?.id) {
        return existing.id;
    }

    const userId = crypto.randomUUID();

    await db.insert(authUsers).values({
        id: userId,
        name,
        email: normalizedEmail,
        emailVerified: true,
        image: null,
        createdAt: new Date(),
        updatedAt: new Date(),
    });

    return userId;
};

export async function createE2eAuthSession(
    input: CreateE2eAuthSessionInput = {},
): Promise<E2eAuthSession> {
    const { db, authSessions } = await getDbDeps();
    await ensureE2eSchema();
    const email =
        input.email?.trim().toLowerCase() ??
        `e2e-${Date.now()}@npbrasil.com`;
    const name = input.name?.trim() || "E2E User";

    if (!email.endsWith("@npbrasil.com")) {
        throw new Error("E2E auth requer e-mail @npbrasil.com");
    }

    const userId = await ensureUser(email, name);

    const sessionToken = crypto.randomUUID().replace(/-/g, "");
    const expiresAt = new Date(Date.now() + EIGHT_HOURS_MS);

    await db.insert(authSessions).values({
        id: crypto.randomUUID(),
        userId,
        token: sessionToken,
        expiresAt,
        ipAddress: "127.0.0.1",
        userAgent: "bun-e2e",
        createdAt: new Date(),
        updatedAt: new Date(),
    });

    const signedToken = await signCookieValue(
        sessionToken,
        process.env.BETTER_AUTH_SECRET as string,
    );

    return {
        userId,
        email,
        sessionToken,
        expiresAt,
        cookieHeader: `better-auth.session_token=${signedToken}`,
    };
}
