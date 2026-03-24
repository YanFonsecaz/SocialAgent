import { db } from "../../db/connection";
import { trendsConfig } from "../../db/schema";
import { eq } from "drizzle-orm";
import type { TrendsConfig } from "../types";

const defaultConfig: TrendsConfig = {
  sector: "Autos",
  periods: ["diario", "semanal", "mensal"],
  topN: 10,
  risingN: 10,
  maxArticles: 3,
  emailRecipients: [],
  emailEnabled: false,
  emailMode: "smtp",
  emailApiProvider: undefined,
  customTopics: [],
};

export async function saveTrendsConfig(
  userId: string,
  config: TrendsConfig,
): Promise<boolean> {
  try {
    await db
      .insert(trendsConfig)
      .values({
        userId,
        sector: config.sector,
        periods: config.periods,
        topN: config.topN,
        risingN: config.risingN,
        maxArticles: config.maxArticles,
        emailRecipients: config.emailRecipients,
        emailEnabled: config.emailEnabled,
        emailMode: config.emailMode,
        emailApiProvider: config.emailApiProvider,
        customTopics: config.customTopics ?? [],
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: trendsConfig.userId,
        set: {
          sector: config.sector,
          periods: config.periods,
          topN: config.topN,
          risingN: config.risingN,
          maxArticles: config.maxArticles,
          emailRecipients: config.emailRecipients,
          emailEnabled: config.emailEnabled,
          emailMode: config.emailMode,
          emailApiProvider: config.emailApiProvider,
          customTopics: config.customTopics ?? [],
          updatedAt: new Date(),
        },
      });

    return true;
  } catch (error) {
    console.error("[Trends Config] Erro ao salvar:", error);
    return false;
  }
}

export async function loadTrendsConfig(userId: string): Promise<TrendsConfig> {
  const rows = await db
    .select()
    .from(trendsConfig)
    .where(eq(trendsConfig.userId, userId))
    .limit(1);

  const data = rows[0];
  if (!data) {
    return defaultConfig;
  }

  return {
    sector: data.sector,
    periods: data.periods as TrendsConfig["periods"],
    topN: data.topN,
    risingN: data.risingN,
    maxArticles: data.maxArticles,
    emailRecipients: (data.emailRecipients ?? []) as string[],
    emailEnabled: data.emailEnabled ?? false,
    emailMode: data.emailMode ?? "smtp",
    emailApiProvider: data.emailApiProvider ?? undefined,
    customTopics: (data.customTopics ?? []) as string[],
  };
}
