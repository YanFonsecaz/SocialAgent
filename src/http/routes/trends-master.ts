import { Elysia } from "elysia";

import { TrendsConfigSchema } from "../../trends-master/types";
import { runTrendsMasterPipeline } from "../../trends-master/run-trends-master";
import {
  loadTrendsConfig,
  saveTrendsConfig,
} from "../../trends-master/repositories/config-repository";

const TrendsConfigUpdateSchema = TrendsConfigSchema;

type TrendsRunResponse =
  | { success: true; report: unknown }
  | { success: false; error: string; details?: unknown };

function toRunError(error: unknown, details?: unknown): TrendsRunResponse {
  return {
    success: false,
    error: error instanceof Error ? error.message : "Erro desconhecido",
    details,
  };
}

export const trendsMasterRoutes = new Elysia()
  .post(
    "/api/trends-master/run",
    async ({ body }) => {
      try {
        const parsed = TrendsConfigSchema.parse(body);
        return await runTrendsMasterPipeline(parsed);
      } catch (error) {
        return toRunError(error);
      }
    },
    {
      body: TrendsConfigSchema,
    },
  )
  .get("/api/trends-master/config", async () => {
    const config = await loadTrendsConfig();
    return { success: true, config };
  })
  .put(
    "/api/trends-master/config",
    async ({ body }) => {
      const parsed = TrendsConfigUpdateSchema.parse(body);
      const saved = await saveTrendsConfig(parsed);
      if (!saved) {
        return toRunError(new Error("Falha ao salvar configuração"));
      }
      return { success: true };
    },
    {
      body: TrendsConfigUpdateSchema,
    },
  );
