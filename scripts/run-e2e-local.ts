import { spawn } from "node:child_process";
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const maskSecret = (value: string): string => {
    const v = value.trim();
    if (v.length <= 8) return "********";
    return `${v.slice(0, 6)}******${v.slice(-4)}`;
};

const nowStamp = (): string => new Date().toISOString().replace(/[:.]/g, "-");

const defaultServerLogPath = (): string =>
    resolve(process.cwd(), `./tmp/e2e-server-${nowStamp()}.log`);

const appendServerLog = (filePath: string, chunk: unknown) => {
    try {
        const text =
            typeof chunk === "string"
                ? chunk
                : Buffer.isBuffer(chunk)
                  ? chunk.toString("utf8")
                  : String(chunk);
        writeFileSync(filePath, text, { flag: "a" });
    } catch {
        // Best-effort logging; do not crash the harness if log writing fails.
    }
};

type RunOptions = {
    baseUrl: string;
    port: number;

    /**
     * Path used to confirm the server is "up enough" to start E2E tests.
     * IMPORTANT: this should not depend on external integrations (DB, LLM, etc.)
     * because those are what E2E tests are meant to validate and can fail for
     * reasons unrelated to server readiness.
     */
    healthPath: string;

    serverEntrypoint: string;

    /**
     * Extra env vars to pass to server/tests. By default we forward process.env.
     */
    env: Record<string, string | undefined>;

    /**
     * Where to write backend stdout/stderr for debugging E2E failures (ECONNRESET, 500s, etc).
     */
    serverLogPath: string;

    healthTimeoutMs: number;
    healthPollIntervalMs: number;
    e2eTests: string[];
};

const DEFAULTS: RunOptions = {
    baseUrl: "http://localhost:3333",
    port: 3333,

    // Default to "/" to avoid blocking on DB connectivity. The server already serves
    // an index HTML at "/". This is a safe "server is up" signal.
    healthPath: "/",

    serverEntrypoint: "src/http/server.ts",
    env: {},
    serverLogPath: defaultServerLogPath(),
    healthTimeoutMs: 90_000,
    healthPollIntervalMs: 750,
    e2eTests: [
        "scripts/e2e-strategist-inlinks.test.ts",
        "scripts/e2e-social-agent.test.ts",
        "scripts/e2e-content-reviewer.test.ts",
    ],
};

function parseArgs(argv: string[]) {
    const args = new Map<string, string>();
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (!a) continue;
        if (!a.startsWith("--")) continue;
        const key = a.slice(2);
        const next = argv[i + 1];
        if (next && !next.startsWith("--")) {
            args.set(key, next);
            i++;
        } else {
            args.set(key, "true");
        }
    }
    return args;
}

function parseDotenvFile(contents: string): Record<string, string> {
    // Minimal .env parser:
    // - supports KEY=VALUE and KEY="VALUE"
    // - ignores blank lines and # comments
    // - does not expand variables
    const env: Record<string, string> = {};
    const lines = contents.split(/\r?\n/);
    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#")) continue;

        const eq = line.indexOf("=");
        if (eq <= 0) continue;

        const key = line.slice(0, eq).trim();
        let value = line.slice(eq + 1).trim();

        // Strip surrounding quotes if present
        if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
        ) {
            value = value.slice(1, -1);
        }

        if (key) env[key] = value;
    }
    return env;
}

function envSourceForKey(
    key: string,
    fileEnv: Record<string, string>,
): "shell" | "file" | "missing" {
    const fromShell = process.env[key];
    if (typeof fromShell === "string" && fromShell.trim().length > 0)
        return "shell";

    const fromFile = fileEnv[key];
    if (typeof fromFile === "string" && fromFile.trim().length > 0) return "file";

    return "missing";
}

function loadEnvFromFileIfExists(filePath: string): Record<string, string> {
    if (!existsSync(filePath)) return {};
    const contents = readFileSync(filePath, "utf8");
    return parseDotenvFile(contents);
}

function loadDevelopmentEnv(): Record<string, string> {
    // Prefer .env.development, fallback to .env
    const cwd = process.cwd();
    const devPath = resolve(cwd, ".env.development");
    const envPath = resolve(cwd, ".env");

    const devExists = existsSync(devPath);
    const envExists = existsSync(envPath);

    const devEnv = loadEnvFromFileIfExists(devPath);
    const baseEnv = loadEnvFromFileIfExists(envPath);

    // Precedence: base < dev (dev overrides)
    const merged = { ...baseEnv, ...devEnv };

    // Diagnostics (safe): indicate which files were found and what keys exist (masked).
    console.log("[E2E] CWD:", cwd);
    console.log("[E2E] .env exists:", envExists ? "yes" : "no");
    console.log("[E2E] .env.development exists:", devExists ? "yes" : "no");

    const keysToShow = [
        "DATABASE_URL",
        "OPENAI_API_KEY",
        "SERPAPI_API_KEY",
    ] as const;
    for (const k of keysToShow) {
        const v = merged[k];
        if (typeof v === "string" && v.trim().length > 0) {
            if (k === "DATABASE_URL") {
                // Avoid printing credentials; show host/port/db-ish only
                const safe = v.replace(/:\/\/([^:]+):([^@]+)@/g, "://***:***@");
                console.log(`[E2E] file ${k}:`, safe);
            } else {
                console.log(`[E2E] file ${k}:`, maskSecret(v));
            }
        } else {
            console.log(`[E2E] file ${k}:`, "(missing)");
        }
    }

    return merged;
}

async function sleep(ms: number) {
    await new Promise((r) => setTimeout(r, ms));
}

async function waitForHealth(opts: RunOptions): Promise<void> {
    const url = `${opts.baseUrl}${opts.healthPath}`;
    const start = Date.now();

    while (Date.now() - start < opts.healthTimeoutMs) {
        try {
            const res = await fetch(url, { method: "GET" });
            if (res.ok) return;
        } catch {
            // Server not up yet.
        }

        await sleep(opts.healthPollIntervalMs);
    }

    throw new Error(
        `Healthcheck timed out after ${opts.healthTimeoutMs}ms: ${url}`,
    );
}

function spawnBunServer(opts: RunOptions) {
    // Start the backend without --watch so we can control lifecycle.
    // Capture stdout/stderr to a file for post-mortem debugging (ECONNRESET, unexpected exits, etc.).
    const child = spawn("bun", [opts.serverEntrypoint], {
        stdio: ["ignore", "pipe", "pipe"],
        env: {
            ...process.env,
            ...opts.env,
            PORT: String(opts.port),
        },
    });

    // Ensure log header exists (best-effort)
    appendServerLog(
        opts.serverLogPath,
        `[${new Date().toISOString()}] [E2E] Backend logs -> ${opts.serverLogPath}\n`,
    );

    child.stdout?.on("data", (chunk) => {
        appendServerLog(opts.serverLogPath, chunk);
        // Also mirror to harness output so the user sees server start/errors live.
        try {
            process.stdout.write(chunk);
        } catch {
            // ignore
        }
    });

    child.stderr?.on("data", (chunk) => {
        appendServerLog(opts.serverLogPath, chunk);
        try {
            process.stderr.write(chunk);
        } catch {
            // ignore
        }
    });

    child.on("error", (err) => {
        appendServerLog(
            opts.serverLogPath,
            `\n[${new Date().toISOString()}] [E2E] Backend process error: ${String(
                err,
            )}\n`,
        );
    });

    return child;
}

function spawnBunTest(testPath: string, opts: RunOptions): Promise<number> {
    return new Promise((resolve) => {
        const child = spawn("bun", ["test", testPath], {
            stdio: "inherit",
            env: {
                ...process.env,
                ...opts.env,
                SOCIAL_AGENT_E2E_BASE_URL: opts.baseUrl,
            },
        });

        child.on("exit", (code) => resolve(code ?? 1));
    });
}

async function main() {
    const args = parseArgs(process.argv.slice(2));

    const port = Number(args.get("port") ?? DEFAULTS.port);
    const baseUrl =
        args.get("baseUrl") ??
        `http://localhost:${Number.isFinite(port) ? port : 3333}`;

    // Default to "/" (server up), but allow overriding to "/health/db" if you want.
    const healthPath = args.get("healthPath") ?? DEFAULTS.healthPath;

    const serverEntrypoint = args.get("server") ?? DEFAULTS.serverEntrypoint;

    // Allow selecting which tests to run. Example:
    //   --tests scripts/e2e-strategist-inlinks.test.ts,scripts/e2e-social-agent.test.ts
    const testsArg = args.get("tests");
    const e2eTests = testsArg
        ? testsArg
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
        : DEFAULTS.e2eTests;

    const healthTimeoutMs = Number(
        args.get("healthTimeoutMs") ?? DEFAULTS.healthTimeoutMs,
    );
    const healthPollIntervalMs = Number(
        args.get("healthPollIntervalMs") ?? DEFAULTS.healthPollIntervalMs,
    );

    // Load .env.development/.env automatically (dev overrides base),
    // then merge with the current process.env (shell vars still win if explicitly set).
    const fileEnv = loadDevelopmentEnv();

    // Forward commonly required env vars into the child processes.
    // Precedence: fileEnv < process.env (explicit exports win)
    const forwardedEnvKeys = [
        "DATABASE_URL",
        "OPENAI_API_KEY",
        "SERPAPI_API_KEY",
        "CORS_ORIGIN",
        "PORT",
        "NODE_ENV",
    ] as const;

    const forwardedEnv: Record<string, string | undefined> = {};
    for (const k of forwardedEnvKeys) {
        forwardedEnv[k] = process.env[k] ?? fileEnv[k];
    }

    // Diagnostics: show where critical vars came from (shell vs file) and their masked values.
    const critical = [
        "DATABASE_URL",
        "OPENAI_API_KEY",
        "SERPAPI_API_KEY",
    ] as const;
    for (const k of critical) {
        const source = envSourceForKey(k, fileEnv);
        const finalValue = forwardedEnv[k] ?? "";
        if (k === "DATABASE_URL") {
            const safe = String(finalValue).replace(
                /:\/\/([^:]+):([^@]+)@/g,
                "://***:***@",
            );
            console.log(`[E2E] env ${k}: source=${source} value=${safe}`);
        } else {
            console.log(
                `[E2E] env ${k}: source=${source} value=${
                    finalValue ? maskSecret(String(finalValue)) : "(missing)"
                }`,
            );
        }
    }

    const serverLogPath =
        args.get("serverLogPath") ??
        DEFAULTS.serverLogPath ??
        defaultServerLogPath();

    const opts: RunOptions = {
        ...DEFAULTS,
        port,
        baseUrl,
        healthPath,
        serverEntrypoint,
        serverLogPath,
        healthTimeoutMs: Number.isFinite(healthTimeoutMs)
            ? healthTimeoutMs
            : DEFAULTS.healthTimeoutMs,
        healthPollIntervalMs: Number.isFinite(healthPollIntervalMs)
            ? healthPollIntervalMs
            : DEFAULTS.healthPollIntervalMs,
        e2eTests,
        env: forwardedEnv,
    };

    // Basic validation (friendly errors)
    if (!Number.isFinite(opts.port) || opts.port <= 0) {
        throw new Error(`Invalid --port: ${String(args.get("port"))}`);
    }
    if (
        !opts.baseUrl.startsWith("http://") &&
        !opts.baseUrl.startsWith("https://")
    ) {
        throw new Error(`Invalid --baseUrl: ${opts.baseUrl}`);
    }
    if (opts.e2eTests.length === 0) {
        throw new Error(
            "No E2E tests specified. Provide --tests or use defaults.",
        );
    }

    // Friendly early checks for required env vars (prevents confusing Zod errors).
    // Keep this minimal: we only check the envs that are mandatory per envSchema.ts.
    const missing: string[] = [];
    if (!opts.env.DATABASE_URL || opts.env.DATABASE_URL.trim().length === 0)
        missing.push("DATABASE_URL");
    if (!opts.env.OPENAI_API_KEY || opts.env.OPENAI_API_KEY.trim().length === 0)
        missing.push("OPENAI_API_KEY");
    if (!opts.env.SERPAPI_API_KEY || opts.env.SERPAPI_API_KEY.trim().length === 0)
        missing.push("SERPAPI_API_KEY");

    if (missing.length > 0) {
        throw new Error(
            `[E2E] Missing required env vars: ${missing.join(
                ", ",
            )}. Export them before running the harness.`,
        );
    }

    console.log("[E2E] Starting backend:", opts.serverEntrypoint);
    console.log("[E2E] Base URL:", opts.baseUrl);
    console.log("[E2E] Healthcheck:", `${opts.baseUrl}${opts.healthPath}`);
    console.log("[E2E] Tests:", opts.e2eTests.join(", "));

    const server = spawnBunServer(opts);

    let shuttingDown = false;
    const shutdown = async (reason: string) => {
        if (shuttingDown) return;
        shuttingDown = true;

        console.log(`[E2E] Shutting down server (${reason})...`);
        try {
            server.kill("SIGTERM");
        } catch {
            // ignore
        }

        // Give it a moment to exit gracefully.
        await sleep(750);

        try {
            server.kill("SIGKILL");
        } catch {
            // ignore
        }
    };

    // Ensure we shutdown on Ctrl+C / termination.
    process.on("SIGINT", () => void shutdown("SIGINT"));
    process.on("SIGTERM", () => void shutdown("SIGTERM"));

    // If server exits unexpectedly, fail fast.
    server.on("exit", (code) => {
        if (!shuttingDown) {
            console.error(
                `[E2E] Server exited unexpectedly with code ${code ?? "null"}.`,
            );
            process.exit(code ?? 1);
        }
    });

    try {
        console.log("[E2E] Waiting for healthcheck...");
        await waitForHealth(opts);
        console.log("[E2E] Healthcheck OK. Running tests...");

        const failures: Array<{ test: string; code: number }> = [];

        for (const testPath of opts.e2eTests) {
            console.log(`\n[E2E] bun test ${testPath}`);
            const code = await spawnBunTest(testPath, opts);
            if (code !== 0) failures.push({ test: testPath, code });
        }

        if (failures.length > 0) {
            console.error("\n[E2E] Failures:");
            for (const f of failures) {
                console.error(`- ${f.test} (exit code ${f.code})`);
            }
            await shutdown("tests failed");
            process.exit(1);
        }

        console.log("\n[E2E] All E2E tests passed.");
        await shutdown("success");
        process.exit(0);
    } catch (err) {
        console.error("[E2E] Harness failed:", err);
        await shutdown("error");
        process.exit(1);
    }
}

void main();
