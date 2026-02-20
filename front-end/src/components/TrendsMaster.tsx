import React, { useEffect, useMemo, useState } from "react";
import {
  Sparkles,
  Loader2,
  AlertCircle,
  Save,
  Play,
  RefreshCcw,
  Mail,
  Tag,
  BarChart3,
  HelpCircle,
} from "lucide-react";
import { motion } from "framer-motion";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import clsx from "clsx";
import {
  runTrendsMaster,
  getTrendsMasterConfig,
  updateTrendsMasterConfig,
  type TrendsConfig,
  type TrendsReport,
} from "../lib/api";
import { AppHeader } from "./AppHeader";
import { HelpModal } from "./HelpModal";
import helpMarkdownRaw from "../docs/user/trends-master.md";

const PERIOD_OPTIONS: Array<{
  value: "diario" | "semanal" | "mensal";
  label: string;
}> = [
  { value: "diario", label: "Diário" },
  { value: "semanal", label: "Semanal" },
  { value: "mensal", label: "Mensal" },
];

const defaultConfig: TrendsConfig = {
  sector: "Tecnologia",
  periods: ["diario", "semanal", "mensal"],
  topN: 5,
  risingN: 5,
  maxArticles: 3,
  customTopics: [],
  emailEnabled: false,
  emailRecipients: [],
  emailMode: "smtp",
  emailApiProvider: undefined,
};

export function TrendsMaster() {
  const [config, setConfig] = useState<TrendsConfig>(defaultConfig);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<TrendsReport | null>(null);
  const [isHelpOpen, setIsHelpOpen] = useState(false);

  const helpMarkdown = useMemo(
    () =>
      typeof helpMarkdownRaw === "string"
        ? helpMarkdownRaw
        : String(helpMarkdownRaw),
    [],
  );

  const customTopicsText = useMemo(
    () => (config.customTopics || []).join("\n"),
    [config.customTopics],
  );

  const emailRecipientsText = useMemo(
    () => (config.emailRecipients || []).join("\n"),
    [config.emailRecipients],
  );

  const handleTogglePeriod = (period: "diario" | "semanal" | "mensal") => {
    setConfig((prev) => {
      const exists = prev.periods.includes(period);
      return {
        ...prev,
        periods: exists
          ? prev.periods.filter((p) => p !== period)
          : [...prev.periods, period],
      };
    });
  };

  const handleLoadConfig = async () => {
    setError(null);
    try {
      const response = await getTrendsMasterConfig();
      if (response?.config) {
        setConfig(response.config);
      }
    } catch (err) {
      console.error(err);
      setError("Falha ao carregar configuração.");
    }
  };

  const handleSaveConfig = async () => {
    setIsSaving(true);
    setError(null);
    try {
      await updateTrendsMasterConfig(config);
    } catch (err) {
      console.error(err);
      setError("Falha ao salvar configuração.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleRun = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);
    setReport(null);

    try {
      const response = await runTrendsMaster(config);
      if (response.success && response.report) {
        setReport(response.report);
      } else {
        setError(response.error || "Falha ao executar pipeline.");
      }
    } catch (err) {
      console.error(err);
      setError("Falha ao executar pipeline. Verifique o backend.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    handleLoadConfig();
  }, []);

  return (
    <div className="flex flex-col h-screen bg-gray-50 text-gray-900 font-sans">
      <AppHeader />

      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <aside className="w-96 bg-white border-r border-gray-100 p-6 flex flex-col gap-6 overflow-y-auto hidden md:flex">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">
              Trends Master
            </h2>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setIsHelpOpen(true)}
                className="text-xs text-gray-600 hover:text-gray-800 flex items-center gap-1"
                title="Ajuda"
              >
                <HelpCircle className="w-3.5 h-3.5" />
                Ajuda
              </button>

              <button
                type="button"
                onClick={handleLoadConfig}
                className="text-xs text-primary flex items-center gap-1"
              >
                <RefreshCcw className="w-3.5 h-3.5" />
                Recarregar
              </button>
            </div>
          </div>

          <form onSubmit={handleRun} className="flex flex-col gap-4">
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">Setor</label>
              <input
                type="text"
                value={config.sector}
                onChange={(e) =>
                  setConfig((prev) => ({ ...prev, sector: e.target.value }))
                }
                placeholder="ex: Tecnologia"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary text-sm"
              />
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium text-gray-700">Períodos</p>
              <div className="grid grid-cols-3 gap-2">
                {PERIOD_OPTIONS.map((period) => (
                  <button
                    key={period.value}
                    type="button"
                    onClick={() => handleTogglePeriod(period.value)}
                    className={clsx(
                      "px-3 py-2 rounded-lg text-xs font-medium border transition-colors",
                      config.periods.includes(period.value)
                        ? "bg-orange-50 text-primary border-orange-200"
                        : "bg-white text-gray-500 border-gray-200 hover:bg-gray-50",
                    )}
                  >
                    {period.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1">
                <label className="text-xs text-gray-600">Mais populares</label>
                <input
                  type="number"
                  min={0}
                  value={config.topN}
                  onChange={(e) =>
                    setConfig((prev) => ({
                      ...prev,
                      topN: Number(e.target.value),
                    }))
                  }
                  className="w-full px-2 py-2 border border-gray-200 rounded-lg text-sm"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-gray-600">Em crescimento</label>
                <input
                  type="number"
                  min={0}
                  value={config.risingN}
                  onChange={(e) =>
                    setConfig((prev) => ({
                      ...prev,
                      risingN: Number(e.target.value),
                    }))
                  }
                  className="w-full px-2 py-2 border border-gray-200 rounded-lg text-sm"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-gray-600">Artigos</label>
                <input
                  type="number"
                  min={0}
                  value={config.maxArticles}
                  onChange={(e) =>
                    setConfig((prev) => ({
                      ...prev,
                      maxArticles: Number(e.target.value),
                    }))
                  }
                  className="w-full px-2 py-2 border border-gray-200 rounded-lg text-sm"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700 flex items-center gap-1">
                <Tag className="w-4 h-4" />
                Tópicos personalizados
              </label>
              <textarea
                rows={4}
                value={customTopicsText}
                onChange={(e) =>
                  setConfig((prev) => ({
                    ...prev,
                    customTopics: e.target.value
                      .split("\n")
                      .map((line) => line.trim())
                      .filter(Boolean),
                  }))
                }
                placeholder="um tópico por linha"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700 flex items-center gap-1">
                <Mail className="w-4 h-4" />
                Email
              </label>
              <div className="flex items-center gap-2">
                <input
                  id="emailEnabled"
                  type="checkbox"
                  checked={config.emailEnabled}
                  onChange={(e) =>
                    setConfig((prev) => ({
                      ...prev,
                      emailEnabled: e.target.checked,
                    }))
                  }
                  className="h-4 w-4"
                />
                <label htmlFor="emailEnabled" className="text-sm text-gray-600">
                  Enviar relatório por email
                </label>
              </div>

              <textarea
                rows={3}
                value={emailRecipientsText}
                onChange={(e) =>
                  setConfig((prev) => ({
                    ...prev,
                    emailRecipients: e.target.value
                      .split("\n")
                      .map((line) => line.trim())
                      .filter(Boolean),
                  }))
                }
                placeholder="emails (um por linha)"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
              />

              <input
                type="text"
                value={config.emailMode || "smtp"}
                onChange={(e) =>
                  setConfig((prev) => ({
                    ...prev,
                    emailMode: e.target.value,
                  }))
                }
                placeholder="smtp"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
              />
            </div>

            <div className="grid grid-cols-2 gap-3 pt-2">
              <button
                type="button"
                onClick={handleSaveConfig}
                disabled={isSaving}
                className={clsx(
                  "flex items-center justify-center gap-2 py-2.5 rounded-lg font-medium text-sm text-white",
                  isSaving
                    ? "bg-gray-300 cursor-not-allowed"
                    : "bg-gray-800 hover:bg-gray-900",
                )}
              >
                {isSaving ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Save className="w-4 h-4" />
                )}
                Salvar Config
              </button>

              <button
                type="submit"
                disabled={isLoading}
                className={clsx(
                  "flex items-center justify-center gap-2 py-2.5 rounded-lg font-medium text-sm text-white",
                  isLoading
                    ? "bg-gray-300 cursor-not-allowed"
                    : "bg-primary hover:bg-orange-600",
                )}
              >
                {isLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Play className="w-4 h-4" />
                )}
                Executar
              </button>
            </div>
          </form>

          <div className="mt-auto p-4 bg-orange-50 rounded-lg border border-orange-100 text-xs text-orange-700 leading-relaxed">
            <p className="font-semibold text-orange-800 mb-1">Dica</p>
            Use tópicos personalizados para forçar temas específicos e garantir
            notícias relevantes.
          </div>
        </aside>

        {/* Main */}
        <main className="flex-1 overflow-y-auto p-4 md:p-8 space-y-6">
          {error && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="max-w-4xl mx-auto w-full p-4 bg-red-50 border border-red-100 rounded-2xl flex items-center gap-3 text-red-800"
            >
              <AlertCircle className="w-5 h-5 flex-shrink-0" />
              <p className="text-sm">{error}</p>
            </motion.div>
          )}

          {!report && !isLoading && !error && (
            <div className="max-w-4xl mx-auto w-full bg-white rounded-2xl border border-gray-100 shadow-sm p-8 text-center">
              <div className="w-16 h-16 bg-orange-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <BarChart3 className="w-8 h-8 text-primary/70" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                Pronto para gerar o relatório?
              </h3>
              <p className="text-gray-500">
                Configure os parâmetros e clique em “Executar” para gerar as
                tendências e notícias.
              </p>
            </div>
          )}

          {isLoading && (
            <div className="max-w-4xl mx-auto w-full bg-white rounded-2xl border border-gray-100 shadow-sm p-6 flex items-center gap-3">
              <Loader2 className="w-5 h-5 animate-spin text-primary" />
              <p className="text-sm text-gray-600">
                Executando pipeline de trends...
              </p>
            </div>
          )}

          {report && (
            <div className="max-w-4xl mx-auto w-full space-y-6">
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
                <h2 className="text-xl font-semibold text-gray-900 mb-2">
                  {report.sector}
                </h2>
                <p className="text-sm text-gray-500">
                  Gerado em: {String(report.generatedAt)}
                </p>
              </div>

              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-primary" />
                  Resumo
                </h3>
                <div className="prose prose-sm max-w-none prose-orange">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {report.summary}
                  </ReactMarkdown>
                </div>
              </div>

              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">
                  Relatório (Markdown)
                </h3>
                <div className="prose prose-sm max-w-none prose-orange">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {report.markdown}
                  </ReactMarkdown>
                </div>
              </div>
            </div>
          )}

          <HelpModal
            open={isHelpOpen}
            title="Ajuda — Trends Master"
            markdown={helpMarkdown}
            onClose={() => setIsHelpOpen(false)}
          />
        </main>
      </div>
    </div>
  );
}
