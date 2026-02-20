import {
  PeriodData,
  TrendItem,
  NewsResult,
  TrendsReport,
  TrendsPeriod,
} from "../types";

const WEEKDAYS = [
  "Domingo",
  "Segunda",
  "Terça",
  "Quarta",
  "Quinta",
  "Sexta",
  "Sábado",
];

const PERIOD_LABELS: Record<TrendsPeriod, string> = {
  diario: "Diário",
  semanal: "Semanal",
  mensal: "Mensal",
};

function getColetaLabel(hour: number): string {
  if (hour < 10) return "Coleta 1";
  if (hour < 13) return "Coleta 2";
  return "Coleta";
}

function safeMd(text: string): string {
  return (text || "—").replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function formatPeriodTable(
  sector: string,
  trends: TrendItem[],
  news: NewsResult[],
  now: Date
): string {
  const hora = now.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const diaSemana = WEEKDAYS[now.getDay()];
  const coleta = getColetaLabel(now.getHours());

  const lines: string[] = [];
  lines.push(`#### ${sector} - Análise (${coleta} - ${hora})\n`);
  lines.push(
    "| Palavra-chave | Tipo | Título | Fonte | Link | Data/Hora | Dia | Resumo |"
  );
  lines.push("|---|---|---|---|---|---|---|---|");

  const typeByKeyword = new Map<string, string>();
  for (const trend of trends) {
    if (trend.keyword) {
      typeByKeyword.set(trend.keyword, trend.type || "top");
    }
  }

  const newsByKeyword = new Map<string, NewsResult["articles"]>();
  for (const item of news) {
    newsByKeyword.set(item.keyword, item.articles);
  }

  for (const [keyword, type] of typeByKeyword) {
    const articles = newsByKeyword.get(keyword) || [];

    if (articles.length === 0) {
      lines.push(
        `| ${safeMd(keyword)} | ${safeMd(
          type
        )} | — | — | — | ${hora} | ${diaSemana} | — |`
      );
      continue;
    }

    for (const article of articles) {
      const title = article.title;
      const source = article.source;
      const link = article.link;
      const date = article.date || hora;
      const resumo = article.snippet || "";

      lines.push(
        `| ${safeMd(keyword)} | ${safeMd(type)} | ${safeMd(
          title
        )} | ${safeMd(source)} | ${safeMd(link)} | ${safeMd(
          date
        )} | ${diaSemana} | ${safeMd(resumo)} |`
      );
    }
  }

  if (typeByKeyword.size === 0) {
    lines.push("");
    lines.push("> Sem dados de tendências retornados para este período.");
  }

  return lines.join("\n");
}

export function generateReport(
  sector: string,
  periodsData: PeriodData[],
  summary: string
): string {
  const now = new Date();
  const dataFormatada = now.toLocaleDateString("pt-BR");

  const sections: string[] = [];
  sections.push(`# Relatório de Tendências - ${sector}`);
  sections.push(`**Data:** ${dataFormatada}\n`);
  sections.push(`## ${sector}\n`);

  for (const period of periodsData) {
    const label = period.label || PERIOD_LABELS[period.periodo];
    sections.push(`### ${label}\n`);
    sections.push(formatPeriodTable(sector, period.trends, period.news, now));
    sections.push("");
  }

  sections.push("## Resumo Geral\n");
  sections.push(summary || "Resumo não disponível.");
  sections.push("");

  return sections.join("\n");
}

export function createReport(
  sector: string,
  periodsData: PeriodData[],
  summary: string
): TrendsReport {
  return {
    sector,
    generatedAt: new Date(),
    periods: periodsData,
    summary,
    markdown: generateReport(sector, periodsData, summary),
  };
}
