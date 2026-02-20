import {
  TrendsConfig,
  TrendsReport,
  PeriodData,
  TrendsPeriod,
  NewsResult,
} from "./types";
import { collectTrends } from "./services/trends-collector";
import { fetchNews } from "./services/news-fetcher";
import { summarizeTrends } from "./agents/content-analysis-agent";
import { createReport } from "./services/report-generator";
import { sendEmail } from "./services/email-sender";

const PERIOD_LABELS: Record<TrendsPeriod, string> = {
  diario: "Diário",
  semanal: "Semanal",
  mensal: "Mensal",
};

type TrendsRunResult =
  | { success: true; report: TrendsReport }
  | { success: false; error: string; details?: unknown };

export async function runTrendsMasterPipeline(
  config: TrendsConfig,
): Promise<TrendsRunResult> {
  const startTime = performance.now();

  try {
    console.log("[Trends Master] Pipeline start");

    const periodsData: PeriodData[] = [];
    const allNews: NewsResult[] = [];

    const periodsPromises = config.periods.map(async (periodo) => {
      console.log(`[Trends Master] Coletando trends (${periodo})`);

      const trends = await collectTrends(
        config.sector,
        periodo,
        config.topN,
        config.risingN,
        config.customTopics,
      );

      console.log(`[Trends Master] ${trends.length} trends para ${periodo}`);

      const keywords = trends
        .map((t) => t.keyword)
        .filter((k): k is string => Boolean(k && k.trim().length > 0));

      if (config.customTopics && config.customTopics.length > 0) {
        for (const topic of config.customTopics) {
          if (!keywords.includes(topic)) {
            keywords.unshift(topic);
          }
        }
      }

      const news = await fetchNews(keywords, config.maxArticles, periodo);

      console.log(
        `[Trends Master] Notícias coletadas (${periodo}): ${news.length} keywords`,
      );

      return {
        label: PERIOD_LABELS[periodo],
        periodo,
        trends,
        news,
      } satisfies PeriodData;
    });

    let customTopicsPromise: Promise<PeriodData | null> = Promise.resolve(null);

    if (config.customTopics && config.customTopics.length > 0) {
      console.log(
        `[Trends Master] Coletando notícias para tópicos personalizados (${config.customTopics.length})`,
      );

      customTopicsPromise = (async () => {
        const customNews = await fetchNews(
          config.customTopics!,
          config.maxArticles,
          "mensal",
        );

        if (customNews.length > 0) {
          return {
            label: "Tópicos Personalizados",
            periodo: "mensal",
            trends: config.customTopics!.map((t) => ({
              keyword: t,
              type: "rising",
            })),
            news: customNews,
          };
        }

        return null;
      })();
    }

    const [periodsResults, customTopicsResult] = await Promise.all([
      Promise.all(periodsPromises),
      customTopicsPromise,
    ]);

    periodsData.push(...periodsResults);

    periodsResults.forEach((p) => allNews.push(...p.news));

    if (customTopicsResult) {
      allNews.push(...customTopicsResult.news);
      periodsData.push(customTopicsResult);
    }

    console.log("[Trends Master] Gerando resumo com LLM");
    const summary = await summarizeTrends(config.sector, allNews);

    const reportTitle =
      config.customTopics && config.customTopics.length > 0
        ? config.customTopics.join(", ")
        : config.sector;

    const report = createReport(reportTitle, periodsData, summary);

    console.log("[Trends Master] Relatório gerado");

    if (config.emailEnabled && config.emailRecipients.length > 0) {
      console.log("[Trends Master] Enviando email");
      const emailSent = await sendEmail(report, config.emailRecipients);

      if (emailSent) {
        console.log("[Trends Master] ✅ Email enviado");
      } else {
        console.warn("[Trends Master] ⚠️ Falha ao enviar email");
      }
    }

    const durationSec = ((performance.now() - startTime) / 1000).toFixed(2);

    console.log(`[Trends Master] Pipeline concluída em ${durationSec}s`);

    return { success: true, report };
  } catch (error) {
    console.error("[Trends Master] Erro na pipeline:", error);

    return {
      success: false,
      error: error instanceof Error ? error.message : "Erro desconhecido",
      details: error,
    };
  }
}
