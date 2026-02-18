import { JSDOM } from "jsdom";

export type InlinksBlockType =
  | "heading"
  | "paragraph"
  | "list_item"
  | "blockquote"
  | "code"
  | "other";

export type InlinksBlock = {
  /**
   * Stable identifier for referencing a block across operations.
   * Derived from DOM position + tag semantics.
   */
  id: string;

  /**
   * The block classification to help downstream selection/insertion logic.
   */
  type: InlinksBlockType;

  /**
   * Original tag name from the source HTML (lowercase).
   * Example: "p", "h2", "li"
   */
  tag: string;

  /**
   * Human-readable text extracted from the block (normalized whitespace).
   * This is the canonical text used for matching and semantic selection.
   */
  text: string;

  /**
   * Raw HTML for the block (innerHTML of the element), used for reconstruction
   * and for applying link insertions with minimal drift.
   */
  html: string;

  /**
   * A lightweight selector-like "path" for debugging.
   * Not intended to be used as a true CSS selector.
   */
  path: string;

  /**
   * Whether the block already contains at least one anchor tag.
   * Used to skip "opportunities" that are already linked.
   */
  containsLink: boolean;

  /**
   * Approximate character offset of this block's text within the concatenated
   * document text (useful for reporting/UX).
   */
  charStart: number;
  charEnd: number;
};

export type ParseHtmlToBlocksOptions = {
  /**
   * Root container ID that wraps the input HTML. Defaults to "root".
   */
  rootId?: string;

  /**
   * Maximum text length per block. Oversized blocks are truncated in `text`
   * but keep full `html`.
   */
  maxTextLength?: number;

  /**
   * If true, strips empty blocks.
   */
  dropEmpty?: boolean;
};

const DEFAULT_OPTIONS: Required<ParseHtmlToBlocksOptions> = {
  rootId: "root",
  maxTextLength: 4000,
  dropEmpty: true,
};

const normalizeWhitespace = (value: string): string =>
  value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();

const isVisibleText = (value: string): boolean =>
  normalizeWhitespace(value).length > 0;

const classifyTag = (tag: string): InlinksBlockType => {
  if (/^h[1-6]$/.test(tag)) return "heading";
  if (tag === "p") return "paragraph";
  if (tag === "li") return "list_item";
  if (tag === "blockquote") return "blockquote";
  if (tag === "pre" || tag === "code") return "code";
  return "other";
};

const nodePath = (el: Element): string => {
  // Generates a deterministic, debug-friendly path based on tag names + sibling index.
  const parts: string[] = [];
  let current: Element | null = el;

  while (current) {
    const tag = current.tagName.toLowerCase();

    let index = 0;
    let sibling = current.previousElementSibling;
    while (sibling) {
      if (sibling.tagName.toLowerCase() === tag) index++;
      sibling = sibling.previousElementSibling;
    }

    parts.push(`${tag}[${index}]`);

    const parent = current.parentElement;
    if (!parent || parent.id === "root") break;
    current = parent;
  }

  return parts.reverse().join(" > ");
};

const stableId = (el: Element, ordinal: number): string => {
  // Ordinal makes ids stable even if paths collide in odd structures.
  const tag = el.tagName.toLowerCase();
  const path = nodePath(el)
    .replace(/\s*>\s*/g, "/")
    .replace(/\[|\]/g, "");
  return `b:${ordinal}:${tag}:${path}`;
};

/**
 * Extracts structured, paragraph-like blocks from an HTML fragment.
 *
 * This is meant to be the base layer for the "Option B" architecture:
 * - Run semantic scoring / LLM decisions on block.text
 * - Apply insertions to blocks and reconstruct the HTML from blocks
 * - Avoid fragile `indexOf` matching across Readability/Cheerio transformations
 */
export const parseHtmlToBlocks = (
  htmlContent: string,
  options?: ParseHtmlToBlocksOptions,
): { blocks: InlinksBlock[]; dom: JSDOM } => {
  const opts = { ...DEFAULT_OPTIONS, ...(options ?? {}) };

  const dom = new JSDOM(`<div id="${opts.rootId}">${htmlContent}</div>`);
  const root = dom.window.document.getElementById(opts.rootId);

  if (!root) {
    return { blocks: [], dom };
  }

  // We target elements that behave like "content blocks"
  // (paragraphs, headings, list items, blockquotes). This list can be extended.
  const candidates = Array.from(
    root.querySelectorAll("h1,h2,h3,h4,h5,h6,p,li,blockquote,pre,code"),
  );

  const blocks: InlinksBlock[] = [];
  let cursor = 0;

  candidates.forEach((el, idx) => {
    const tag = el.tagName.toLowerCase();
    const type = classifyTag(tag);

    // Text is derived from textContent for robust matching across nested nodes.
    const rawText = el.textContent ?? "";
    const text = normalizeWhitespace(rawText);
    if (opts.dropEmpty && !isVisibleText(text)) return;

    const truncatedText =
      text.length > opts.maxTextLength
        ? text.slice(0, opts.maxTextLength) + "…"
        : text;

    const html = el.innerHTML ?? "";
    const containsLink = el.querySelector("a") !== null;

    const start = cursor;
    const end = cursor + truncatedText.length;
    cursor = end + 1; // add a separator offset

    blocks.push({
      id: stableId(el, idx),
      type,
      tag,
      text: truncatedText,
      html,
      path: nodePath(el),
      containsLink,
      charStart: start,
      charEnd: end,
    });
  });

  return { blocks, dom };
};

/**
 * Reconstructs an HTML fragment from the current DOM root.
 * Useful after you apply block-level edits by manipulating the DOM nodes.
 */
export const serializeBlocksDom = (
  dom: JSDOM,
  rootId = DEFAULT_OPTIONS.rootId,
): string => {
  const root = dom.window.document.getElementById(rootId);
  return root?.innerHTML ?? "";
};

/**
 * Convenience method: rebuild an HTML fragment from a set of blocks by
 * replacing each element's innerHTML using its stored `id`.
 *
 * Note: This assumes the DOM used to produce the blocks is still available
 * and unchanged in terms of node ordering.
 */
export const applyBlockHtmlEdits = (
  dom: JSDOM,
  edits: Array<{ blockId: string; newHtml: string }>,
  rootId = DEFAULT_OPTIONS.rootId,
): { applied: number; html: string } => {
  const root = dom.window.document.getElementById(rootId);
  if (!root) return { applied: 0, html: "" };

  const all = Array.from(
    root.querySelectorAll("h1,h2,h3,h4,h5,h6,p,li,blockquote,pre,code"),
  );

  const map = new Map<string, Element>();
  all.forEach((el, idx) => {
    map.set(stableId(el, idx), el);
  });

  let applied = 0;
  for (const edit of edits) {
    const el = map.get(edit.blockId);
    if (!el) continue;
    el.innerHTML = edit.newHtml;
    applied++;
  }

  return { applied, html: root.innerHTML ?? "" };
};
