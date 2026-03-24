import type { TrendsReport } from "../types";
import { sendEmail as sendTransactionalEmail } from "../../email/delivery";

function normalizeRecipients(recipients: string[]): string[] {
  return recipients
    .map((r) => r.trim())
    .filter((r) => r.length > 0 && r.includes("@"));
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderMarkdownHtml(markdown: string): string {
  const lines = markdown.split(/\r?\n/);
  const html: string[] = [];
  let inList = false;
  let inTable = false;
  let tableHeaders: string[] = [];
  let tableRows: string[][] = [];

  const flushList = () => {
    if (inList) {
      html.push("</ul>");
      inList = false;
    }
  };

  const flushTable = () => {
    if (!inTable) return;
    html.push(
      `<table style="width:100%; border-collapse:collapse; table-layout:fixed; font-family:Arial,Helvetica,sans-serif; font-size:13px; word-break:break-word;">`,
    );
    if (tableHeaders.length > 0) {
      html.push("<thead><tr>");
      tableHeaders.forEach((h) => {
        html.push(
          `<th style="border:1px solid #e5e7eb; text-align:left; padding:6px; background:#f9fafb; vertical-align:top; word-break:break-word;">${renderInline(h)}</th>`,
        );
      });
      html.push("</tr></thead>");
    }
    if (tableRows.length > 0) {
      html.push("<tbody>");
      tableRows.forEach((row) => {
        html.push("<tr>");
        row.forEach((cell) => {
          html.push(
            `<td style="border:1px solid #e5e7eb; padding:6px; vertical-align:top; word-break:break-word;">${renderInline(cell)}</td>`,
          );
        });
        html.push("</tr>");
      });
      html.push("</tbody>");
    }
    html.push("</table>");
    inTable = false;
    tableHeaders = [];
    tableRows = [];
  };

  const isTableSeparator = (line: string) => {
    const normalized = line.replace(/\s/g, "");
    return normalized.includes("|-") && normalized.includes("|");
  };

  const parseTableRow = (line: string) =>
    line
      .trim()
      .split("|")
      .map((cell) => cell.trim())
      .filter(
        (cell, idx, arr) =>
          !(idx === 0 && cell === "") && !(idx === arr.length - 1 && cell === ""),
      );

  const renderInline = (raw: string) => {
    const escaped = escapeHtml(raw);
    const withBold = escaped.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    return withBold.replace(
      /\[(.+?)\]\((https?:\/\/[^)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer" style="color:#2563eb; text-decoration:underline;">$1</a>',
    );
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmedLine = line.trim();

    if (!trimmedLine) {
      flushList();
      flushTable();
      continue;
    }

    const nextLine = lines[i + 1] ?? "";
    const nextTrimmed = nextLine.trim();
    if (trimmedLine.includes("|") && isTableSeparator(nextTrimmed)) {
      flushList();
      inTable = true;
      tableHeaders = parseTableRow(trimmedLine);
      i += 1;
      continue;
    }

    if (inTable && trimmedLine.includes("|")) {
      tableRows.push(parseTableRow(trimmedLine));
      continue;
    }

    flushTable();

    if (trimmedLine.startsWith("# ")) {
      flushList();
      html.push(
        `<h1 style="font-size:20px; margin:16px 0 8px;">${renderInline(trimmedLine.slice(2))}</h1>`,
      );
      continue;
    }

    if (trimmedLine.startsWith("## ")) {
      flushList();
      html.push(
        `<h2 style="font-size:18px; margin:14px 0 8px;">${renderInline(trimmedLine.slice(3))}</h2>`,
      );
      continue;
    }

    if (trimmedLine.startsWith("### ")) {
      flushList();
      html.push(
        `<h3 style="font-size:16px; margin:12px 0 6px;">${renderInline(trimmedLine.slice(4))}</h3>`,
      );
      continue;
    }

    if (trimmedLine.startsWith("#### ")) {
      flushList();
      html.push(
        `<h4 style="font-size:14px; margin:10px 0 6px;">${renderInline(trimmedLine.slice(5))}</h4>`,
      );
      continue;
    }

    if (trimmedLine.startsWith("- ") || trimmedLine.startsWith("* ")) {
      if (!inList) {
        html.push('<ul style="padding-left:18px; margin:6px 0;">');
        inList = true;
      }
      html.push(
        `<li style="margin:4px 0;">${renderInline(trimmedLine.slice(2))}</li>`,
      );
      continue;
    }

    flushList();
    html.push(`<p style="margin:6px 0;">${renderInline(trimmedLine)}</p>`);
  }

  flushList();
  flushTable();

  return `<div style="font-family:Arial,Helvetica,sans-serif; font-size:14px; line-height:1.6; color:#111827;">${html.join("")}</div>`;
}

export async function sendEmail(
  report: TrendsReport,
  recipients: string[],
): Promise<boolean> {
  const cleanRecipients = normalizeRecipients(recipients);
  if (cleanRecipients.length === 0) {
    console.warn("[Email] Nenhum destinatário válido.");
    return false;
  }

  const subject =
    process.env.EMAIL_SUBJECT || `Relatório de Tendências - ${report.sector}`;

  try {
    await sendTransactionalEmail({
      to: cleanRecipients,
      subject,
      text: report.markdown,
      html: renderMarkdownHtml(report.markdown),
    });

    console.log("[Email] ✅ Email enviado com sucesso.");
    return true;
  } catch (error) {
    console.error("[Email] ❌ Falha ao enviar email:", error);
    return false;
  }
}
