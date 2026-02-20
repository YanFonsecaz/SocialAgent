import { z } from "zod";

export const TrendsPeriodSchema = z.enum(["diario", "semanal", "mensal"]);
export type TrendsPeriod = z.infer<typeof TrendsPeriodSchema>;

export const TrendItemSchema = z.object({
  keyword: z.string().min(1),
  type: z.enum(["top", "rising"]),
  score: z.union([z.number(), z.string()]).optional(),
});
export type TrendItem = z.infer<typeof TrendItemSchema>;

export const NewsArticleSchema = z.object({
  title: z.string().min(1),
  link: z.string().url(),
  source: z.string().min(1),
  date: z.string().min(1),
  snippet: z.string().optional(),
  thumbnail: z.string().optional(),
});
export type NewsArticle = z.infer<typeof NewsArticleSchema>;

export const NewsResultSchema = z.object({
  keyword: z.string().min(1),
  articles: z.array(NewsArticleSchema),
});
export type NewsResult = z.infer<typeof NewsResultSchema>;

export const PeriodDataSchema = z.object({
  label: z.string().min(1),
  periodo: TrendsPeriodSchema,
  trends: z.array(TrendItemSchema),
  news: z.array(NewsResultSchema),
});
export type PeriodData = z.infer<typeof PeriodDataSchema>;

export const TrendsReportSchema = z.object({
  sector: z.string().min(1),
  generatedAt: z.union([z.date(), z.string()]),
  periods: z.array(PeriodDataSchema),
  summary: z.string(),
  markdown: z.string(),
});
export type TrendsReport = z.infer<typeof TrendsReportSchema>;

export const TrendsConfigSchema = z.object({
  sector: z.string().min(1),
  periods: z.array(TrendsPeriodSchema).min(1),
  topN: z.number().min(0),
  risingN: z.number().min(0),
  maxArticles: z.number().min(0),
  customTopics: z.array(z.string().min(1)).optional(),
  emailEnabled: z.boolean(),
  emailRecipients: z.array(z.string().email()),
  emailMode: z.string().optional().default("smtp"),
  emailApiProvider: z.string().optional(),
});
export type TrendsConfig = z.infer<typeof TrendsConfigSchema>;

export const TrendsRunResponseSchema = z.object({
  success: z.boolean(),
  report: TrendsReportSchema.optional(),
  error: z.string().optional(),
  details: z.unknown().optional(),
});
export type TrendsRunResponse = z.infer<typeof TrendsRunResponseSchema>;
