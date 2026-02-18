import { JSDOM } from "jsdom";
import type { InlinksBlock } from "./paragraphs";

export type BlockEdit = {
  blockId: string;
  targetUrl: string;
  anchor: string;
  originalBlockText: string;
  modifiedBlockText: string; // markdown with exactly one link [text](url)
  overwriteBlock: boolean;
};

export type ApplyEditsInput = {
  /**
   * HTML fragment produced by Readability (article.content) or equivalent.
   * It will be wrapped into a #root container for DOM operations.
   */
  htmlContent: string;

  /**
   * The parsed blocks from the SAME htmlContent, in the SAME DOM order.
   * Must include at least paragraphs/list items that will be edited.
   */
  blocks: InlinksBlock[];

  /**
   * Block edits produced by the block-graph.
   */
  edits: BlockEdit[];

  /**
   * If true, do NOT replace or alter existing <a> tags; only highlight in original column.
   * Linked column will skip applying link if the anchor is already linked in that block.
   */
  preserveExistingLinks?: boolean;

  /**
   * Root container id. Defaults to "root".
   */
  rootId?: string;
};

export type ApplyEditsOutput = {
  originalHtml: string; // column 1 (red marks)
  linkedHtml: string; // column 2 (green marks)
  modifiedHtml: string; // column 3 (diff marks in blue)
  applied: {
    totalEdits: number;
    appliedLinked: number;
    appliedModified: number;
    skippedAlreadyLinked: number;
    skippedBlockNotFound: number;
  };
};

const DEFAULT_ROOT_ID = "root";

const normalizeWhitespace = (value: string): string =>
  value
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const normalizeForSearch = (value: string): string =>
  normalizeWhitespace(value).toLowerCase();

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const markdownLinkToHtml = (markdown: string): string => {
  // Converts [text](url) to <a href="url">text</a> (target blank + rel).
  // Leaves other text as-is.
  return markdown.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    (_m, text: string, url: string) =>
      `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(
        text,
      )}</a>`,
  );
};

const tokenize = (value: string): string[] =>
  normalizeWhitespace(value).split(/\s+/).filter(Boolean);

const lcsUnchangedMask = (a: string[], b: string[]): boolean[] => {
  // LCS DP mask: returns which tokens in `b` are part of the LCS against `a`
  const dp: number[][] = Array.from({ length: a.length + 1 }, () =>
    Array(b.length + 1).fill(0),
  );

  for (let i = 1; i <= a.length; i++) {
    // Assert row existence under strict checks
    const row = dp[i];
    if (!row) continue;

    for (let j = 1; j <= b.length; j++) {
      const up = dp[i - 1]?.[j] ?? 0;
      const left = row[j - 1] ?? 0;
      const diag = dp[i - 1]?.[j - 1] ?? 0;

      row[j] = a[i - 1] === b[j - 1] ? diag + 1 : Math.max(up, left);
    }
  }

  const unchanged = new Array<boolean>(b.length).fill(false);
  let i = a.length;
  let j = b.length;

  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      unchanged[j - 1] = true;
      i--;
      j--;
    } else if ((dp[i - 1]?.[j] ?? 0) >= (dp[i]?.[j - 1] ?? 0)) {
      i--;
    } else {
      j--;
    }
  }

  return unchanged;
};

const highlightDiffWordsToHtml = (input: {
  originalText: string;
  modifiedMarkdown: string;
}): string => {
  const originalTokens = tokenize(input.originalText);
  const modifiedTokens = tokenize(input.modifiedMarkdown);

  const highlightAll =
    originalTokens.length === 0 ||
    normalizeWhitespace(input.originalText) === "[Trecho novo]";

  const unchangedMask = highlightAll
    ? new Array<boolean>(modifiedTokens.length).fill(false)
    : lcsUnchangedMask(originalTokens, modifiedTokens);

  const marked = modifiedTokens
    .map((t, idx) =>
      highlightAll || !unchangedMask[idx]
        ? `[[H]]${escapeHtml(t)}[[/H]]`
        : escapeHtml(t),
    )
    .join(" ");

  // Convert markdown link(s) to <a> and then wrap highlighted tokens with <mark>
  const withLinks = markdownLinkToHtml(marked);

  return withLinks
    .replace(/\[\[H\]\]/g, '<mark class="inlink-highlight-modified">')
    .replace(/\[\[\/H\]\]/g, "</mark>");
};

const highlightLinkedWordsToHtml = (markdown: string): string => {
  // Green highlight for the whole anchor text inside markdown link
  const html = markdownLinkToHtml(markdown);
  return html.replace(
    /<a href="([^"]+)" target="_blank" rel="noopener noreferrer">([\s\S]*?)<\/a>/g,
    '<mark class="inlink-highlight-linked"><a href="$1" target="_blank" rel="noopener noreferrer">$2</a></mark>',
  );
};

const buildDom = (htmlContent: string, rootId: string): JSDOM =>
  new JSDOM(`<div id="${rootId}">${htmlContent}</div>`);

const getRoot = (dom: JSDOM, rootId: string): HTMLElement | null =>
  dom.window.document.getElementById(rootId) as HTMLElement | null;

const blockElementsInOrder = (root: HTMLElement): Element[] =>
  Array.from(
    root.querySelectorAll("h1,h2,h3,h4,h5,h6,p,li,blockquote,pre,code"),
  );

const stableBlockIdForElement = (el: Element, ordinal: number): string => {
  // Mirrors the logic in paragraphs.ts (stable enough for same DOM/order).
  const tag = el.tagName.toLowerCase();

  const nodePath = (node: Element): string => {
    const parts: string[] = [];
    let current: Element | null = node;

    while (current) {
      const t = current.tagName.toLowerCase();

      let index = 0;
      let sibling = current.previousElementSibling;
      while (sibling) {
        if (sibling.tagName.toLowerCase() === t) index++;
        sibling = sibling.previousElementSibling;
      }

      parts.push(`${t}[${index}]`);

      const parentEl: Element | null = current.parentElement;
      if (!parentEl || parentEl.id === DEFAULT_ROOT_ID) break;
      current = parentEl;
    }

    return parts.reverse().join(" > ");
  };

  const path = nodePath(el)
    .replace(/\s*>\s*/g, "/")
    .replace(/\[|\]/g, "");
  return `b:${ordinal}:${tag}:${path}`;
};

const buildBlockIdMap = (root: HTMLElement): Map<string, Element> => {
  const els = blockElementsInOrder(root);
  const map = new Map<string, Element>();
  els.forEach((el, idx) => {
    map.set(stableBlockIdForElement(el, idx), el);
  });
  return map;
};

const anchorAlreadyLinkedInElement = (
  el: Element,
  anchorText: string,
): boolean => {
  const normalizedAnchor = normalizeForSearch(anchorText);
  const links = Array.from(el.querySelectorAll("a"));
  return links.some(
    (a) => normalizeForSearch(a.textContent ?? "") === normalizedAnchor,
  );
};

const wrapFirstOccurrenceInElementText = (
  dom: JSDOM,
  el: Element,
  anchorText: string,
  replacementHtml: string,
): boolean => {
  const document = dom.window.document;
  const nodeFilter = document.defaultView?.NodeFilter;
  if (!nodeFilter) return false;

  const normalizedAnchor = normalizeForSearch(anchorText);
  const walker = document.createTreeWalker(el, nodeFilter.SHOW_TEXT);
  let node = walker.nextNode();

  while (node) {
    const text = node.nodeValue ?? "";
    const normalizedText = normalizeForSearch(text);
    const index = normalizedText.indexOf(normalizedAnchor);

    if (index !== -1 && node.parentNode) {
      const before = text.slice(0, index);
      const after = text.slice(index + anchorText.length);
      const span = document.createElement("span");
      span.innerHTML = `${escapeHtml(before)}${replacementHtml}${escapeHtml(after)}`;
      // NOTE: We escaped before/after. replacementHtml is assumed to be safe HTML generated by us.
      node.parentNode.replaceChild(span, node);
      return true;
    }

    node = walker.nextNode();
  }

  return false;
};

export const applyBlockEditsToHtml = (
  input: ApplyEditsInput,
): ApplyEditsOutput => {
  const rootId = input.rootId ?? DEFAULT_ROOT_ID;
  const preserveExistingLinks = input.preserveExistingLinks ?? true;

  const originalDom = buildDom(input.htmlContent, rootId);
  const linkedDom = buildDom(input.htmlContent, rootId);
  const modifiedDom = buildDom(input.htmlContent, rootId);

  const originalRoot = getRoot(originalDom, rootId);
  const linkedRoot = getRoot(linkedDom, rootId);
  const modifiedRoot = getRoot(modifiedDom, rootId);

  if (!originalRoot || !linkedRoot || !modifiedRoot) {
    return {
      originalHtml: input.htmlContent,
      linkedHtml: input.htmlContent,
      modifiedHtml: input.htmlContent,
      applied: {
        totalEdits: input.edits.length,
        appliedLinked: 0,
        appliedModified: 0,
        skippedAlreadyLinked: 0,
        skippedBlockNotFound: input.edits.length,
      },
    };
  }

  const originalMap = buildBlockIdMap(originalRoot);
  const linkedMap = buildBlockIdMap(linkedRoot);
  const modifiedMap = buildBlockIdMap(modifiedRoot);

  let appliedLinked = 0;
  let appliedModified = 0;
  let skippedAlreadyLinked = 0;
  let skippedBlockNotFound = 0;

  for (const edit of input.edits) {
    const originalEl = originalMap.get(edit.blockId);
    const linkedEl = linkedMap.get(edit.blockId);
    const modifiedEl = modifiedMap.get(edit.blockId);

    if (!originalEl || !linkedEl || !modifiedEl) {
      skippedBlockNotFound++;
      continue;
    }

    // Column 1: always highlight anchor in red (visual only; do not remove/alter links)
    const redMark = `<mark class="inlink-highlight-original">${escapeHtml(
      edit.anchor,
    )}</mark>`;

    wrapFirstOccurrenceInElementText(
      originalDom,
      originalEl,
      edit.anchor,
      redMark,
    );

    // Column 2: rewrite the whole block using the same edit, but with GREEN link highlight.
    // This avoids fragile "find anchor in original DOM" and ensures consistency with block-based edits.
    const alreadyLinked = anchorAlreadyLinkedInElement(linkedEl, edit.anchor);

    if (alreadyLinked && preserveExistingLinks) {
      skippedAlreadyLinked++;
    } else {
      const linkedInner = highlightLinkedWordsToHtml(edit.modifiedBlockText);
      linkedEl.innerHTML = linkedInner;
      appliedLinked++;
    }

    // Column 3: apply block rewrite + diff highlights
    // We overwrite the entire block HTML based on markdown conversion + diff markers.
    // Note: This preserves the outer element (p/li), and replaces its innerHTML.
    const modifiedInner = highlightDiffWordsToHtml({
      originalText: edit.originalBlockText,
      modifiedMarkdown: edit.modifiedBlockText,
    });

    // The diff function returns HTML with <a> and <mark> tags already.
    modifiedEl.innerHTML = modifiedInner;
    appliedModified++;
  }

  return {
    originalHtml: originalRoot.innerHTML ?? input.htmlContent,
    linkedHtml: linkedRoot.innerHTML ?? input.htmlContent,
    modifiedHtml: modifiedRoot.innerHTML ?? input.htmlContent,
    applied: {
      totalEdits: input.edits.length,
      appliedLinked,
      appliedModified,
      skippedAlreadyLinked,
      skippedBlockNotFound,
    },
  };
};
