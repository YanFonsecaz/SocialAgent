import { spawn } from "node:child_process";
import { Pool } from "pg";

const DEFAULT_DEV_DATABASE_URL =
    "postgres://postgres:postgres@localhost:5433/social_agent";

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"]);

const getDatabaseUrl = (): string => {
    const fromEnv = process.env.DATABASE_URL?.trim();
    if (fromEnv && fromEnv.length > 0) {
        return fromEnv;
    }

    console.warn(
        `[db:reset:dev] DATABASE_URL não definido. Usando padrão de dev: ${DEFAULT_DEV_DATABASE_URL}`,
    );
    return DEFAULT_DEV_DATABASE_URL;
};

const assertSafeResetTarget = (databaseUrl: string): URL => {
    const parsed = new URL(databaseUrl);

    if ((process.env.NODE_ENV ?? "").trim().toLowerCase() === "production") {
        throw new Error(
            "Reset bloqueado: NODE_ENV=production. Esse comando só pode rodar em desenvolvimento.",
        );
    }

    const allowNonLocal =
        (process.env.DB_RESET_ALLOW_NON_LOCAL ?? "").trim().toLowerCase() ===
        "true";
    if (!allowNonLocal && !LOCAL_HOSTNAMES.has(parsed.hostname)) {
        throw new Error(
            `Reset bloqueado: host "${parsed.hostname}" não é local. Para forçar, use DB_RESET_ALLOW_NON_LOCAL=true.`,
        );
    }

    const dbName = parsed.pathname.replace(/^\//, "").trim();
    if (!dbName) {
        throw new Error("Reset bloqueado: nome do banco não informado na DATABASE_URL.");
    }

    if (!allowNonLocal && ["postgres", "template0", "template1"].includes(dbName)) {
        throw new Error(
            `Reset bloqueado: banco "${dbName}" é reservado e não deve ser resetado.`,
        );
    }

    return parsed;
};

const runCommand = (command: string, args: string[], env: NodeJS.ProcessEnv) =>
    new Promise<void>((resolve, reject) => {
        const child = spawn(command, args, {
            stdio: "inherit",
            env,
        });

        child.on("error", (error) => {
            reject(error);
        });

        child.on("exit", (code) => {
            if (code === 0) {
                resolve();
                return;
            }
            reject(new Error(`Comando falhou (${command} ${args.join(" ")}), code=${code}`));
        });
    });

const resetSchema = async (databaseUrl: string) => {
    const pool = new Pool({
        connectionString: databaseUrl,
    });

    try {
        await pool.query(`
            DO $$
            DECLARE
                r RECORD;
            BEGIN
                FOR r IN (
                    SELECT tablename
                    FROM pg_tables
                    WHERE schemaname = 'public'
                ) LOOP
                    EXECUTE format('DROP TABLE IF EXISTS public.%I CASCADE', r.tablename);
                END LOOP;
            END $$;
        `);

        await pool.query(`DROP SCHEMA IF EXISTS drizzle CASCADE;`);
        await pool.query(`CREATE SCHEMA IF NOT EXISTS drizzle;`);

        await pool.query(`CREATE EXTENSION IF NOT EXISTS vector;`);
        await pool.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto;`);
    } finally {
        await pool.end();
    }
};

const main = async () => {
    const databaseUrl = getDatabaseUrl();
    const parsed = assertSafeResetTarget(databaseUrl);
    const dbName = parsed.pathname.replace(/^\//, "");

    console.log(`[db:reset:dev] Banco alvo: ${dbName}@${parsed.hostname}:${parsed.port || "5432"}`);
    console.log("[db:reset:dev] Limpando schema public e metadata de migrations...");

    await resetSchema(databaseUrl);

    console.log("[db:reset:dev] Reaplicando migrations...");
    await runCommand("bun", ["run", "db:migrate"], {
        ...process.env,
        DATABASE_URL: databaseUrl,
    });

    console.log("[db:reset:dev] Concluído com sucesso.");
};

main().catch((error) => {
    console.error("[db:reset:dev] Falhou:", error);
    process.exitCode = 1;
});
