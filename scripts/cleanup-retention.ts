import { lt } from "drizzle-orm";
import { connection, db } from "../src/db/connection";
import { authSessions, authVerifications, llmGenerations } from "../src/db/schema";

const retentionDays = 180;

async function run() {
    const now = new Date();
    const llmCutoff = new Date(
        now.getTime() - retentionDays * 24 * 60 * 60 * 1000,
    );

    await db.delete(authSessions).where(lt(authSessions.expiresAt, now));
    await db.delete(authVerifications).where(lt(authVerifications.expiresAt, now));
    await db.delete(llmGenerations).where(lt(llmGenerations.createdAt, llmCutoff));

    console.log(
        `[cleanup-retention] done (sessions/verifications expired + llm_generations older than ${retentionDays} days)`,
    );
}

run()
    .catch((error) => {
        console.error("[cleanup-retention] failed:", error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await connection.end();
    });

