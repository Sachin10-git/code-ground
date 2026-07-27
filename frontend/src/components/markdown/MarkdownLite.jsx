/**
 * MarkdownLite.jsx — Code Ground shared lightweight Markdown renderer
 *
 * Used by both TeamChatMessage.jsx (human-to-human chat) and
 * AIChatMessage.jsx (AI responses) so the two chat surfaces render
 * Markdown identically instead of maintaining two parsers. Fully
 * self-contained: brings its own spacing between rendered blocks
 * (`.root > * + *`), so a consumer only needs to give it a `text`
 * string and place it inside whatever bubble/wrapper styling it wants.
 *
 * Supports: headings (#..######), bold/italic/strikethrough, inline
 * code, bare-URL auto-linking, unordered/ordered lists, GFM-style pipe
 * tables, and fenced code blocks with syntax highlighting (via
 * highlight.js) + a copy button.
 *
 * Deliberately NOT a full CommonMark implementation — no nested
 * blockquotes, no nested lists, no HTML passthrough. This covers what
 * an LLM or a developer actually types in a chat message; anything
 * more elaborate falls back to rendering as plain text, which is safe
 * (never garbled, never unescaped HTML).
 */

import React, { useMemo, useState } from 'react';
import hljs from 'highlight.js/lib/common';
import styles from './MarkdownLite.module.css';

/* ─────────────────────────────────────────────────────────────────────
   ICONS
───────────────────────────────────────────────────────────────────── */
const CopyIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round"
    strokeLinejoin="round" aria-hidden="true">
    <rect x="9" y="9" width="13" height="13" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

function CopyButton({ text, label, className }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <button type="button" className={className} onClick={handleCopy} aria-label={label}>
      <CopyIcon />
      {copied ? 'Copied!' : 'Copy'}
    </button>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   CODE BLOCK — fenced ```lang ... ``` content, highlighted via
   highlight.js's "common" language bundle.
───────────────────────────────────────────────────────────────────── */
function CodeBlock({ lang, content }) {
  const highlighted = useMemo(() => {
    const language = lang && hljs.getLanguage(lang) ? lang : null;
    try {
      return language
        ? hljs.highlight(content, { language, ignoreIllegals: true }).value
        : hljs.highlightAuto(content).value;
    } catch {
      /* Fall back to escaped plain text — never risk unescaped HTML
         reaching dangerouslySetInnerHTML below. */
      return content.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    }
  }, [lang, content]);

  return (
    <div className={styles.code_block}>
      <div className={styles.code_block_header}>
        <span className={styles.code_lang}>{lang && lang !== 'plaintext' ? lang : 'code'}</span>
        <CopyButton text={content} label={`Copy ${lang || 'code'} snippet`} className={styles.code_copy_btn} />
      </div>
      <pre className={styles.code_content}>
        {/* highlight.js escapes the source itself before wrapping
            tokens in spans, so this HTML is safe to inject. */}
        <code className="hljs" dangerouslySetInnerHTML={{ __html: highlighted }} />
      </pre>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   BLOCK SPLIT — fenced code vs. everything else.
───────────────────────────────────────────────────────────────────── */
function splitCodeBlocks(text) {
  const segments = [];
  const FENCE_RE = /```(\w*)\n?([\s\S]*?)```/g;
  let lastIndex = 0;
  let match;

  while ((match = FENCE_RE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', content: text.slice(lastIndex, match.index) });
    }
    segments.push({
      type: 'code',
      lang: match[1] || 'plaintext',
      content: match[2].replace(/\n$/, ''),
    });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    segments.push({ type: 'text', content: text.slice(lastIndex) });
  }

  return segments;
}

/* ─────────────────────────────────────────────────────────────────────
   TEXT BLOCK PARSE — headings / lists / tables / paragraphs, line by
   line, for one non-code segment.
───────────────────────────────────────────────────────────────────── */
const HEADING_RE   = /^(#{1,6})\s+(.*)$/;
const UL_ITEM_RE   = /^\s*[-*+]\s+(.*)$/;
const OL_ITEM_RE   = /^\s*\d+\.\s+(.*)$/;
const TABLE_SEP_RE = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

function splitTableRow(line) {
  let trimmed = line.trim();
  if (trimmed.startsWith('|')) trimmed = trimmed.slice(1);
  if (trimmed.endsWith('|')) trimmed = trimmed.slice(0, -1);
  return trimmed.split('|').map((cell) => cell.trim());
}

function isTableStart(line, nextLine) {
  return line.trim().startsWith('|') && nextLine !== undefined && TABLE_SEP_RE.test(nextLine);
}

function parseTextBlocks(text) {
  const lines = text.split('\n');
  const blocks = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === '') { i++; continue; }

    const heading = line.match(HEADING_RE);
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1].length, content: heading[2].trim() });
      i++;
      continue;
    }

    if (isTableStart(line, lines[i + 1])) {
      const header = splitTableRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        rows.push(splitTableRow(lines[i]));
        i++;
      }
      blocks.push({ type: 'table', header, rows });
      continue;
    }

    if (UL_ITEM_RE.test(line)) {
      const items = [];
      while (i < lines.length && UL_ITEM_RE.test(lines[i])) {
        items.push(lines[i].match(UL_ITEM_RE)[1]);
        i++;
      }
      blocks.push({ type: 'ul', items });
      continue;
    }

    if (OL_ITEM_RE.test(line)) {
      const items = [];
      while (i < lines.length && OL_ITEM_RE.test(lines[i])) {
        items.push(lines[i].match(OL_ITEM_RE)[1]);
        i++;
      }
      blocks.push({ type: 'ol', items });
      continue;
    }

    const paraLines = [];
    while (
      i < lines.length
      && lines[i].trim() !== ''
      && !HEADING_RE.test(lines[i])
      && !UL_ITEM_RE.test(lines[i])
      && !OL_ITEM_RE.test(lines[i])
      && !isTableStart(lines[i], lines[i + 1])
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    blocks.push({ type: 'p', lines: paraLines });
  }

  return blocks;
}

/* ─────────────────────────────────────────────────────────────────────
   INLINE — bold / italic / strikethrough / inline code / bare URLs.
   Order in the alternation matters: code span first (nothing inside it
   is further processed), two-character markers before their
   single-character counterparts, so `**bold**` never reads as two
   stray italics.
───────────────────────────────────────────────────────────────────── */
const INLINE_RE = /`([^`\n]+)`|\*\*([^*\n]+)\*\*|__([^_\n]+)__|~~([^~\n]+)~~|\*([^*\n]+)\*|_([^_\n]+)_/g;
const URL_SPLIT_RE = /(https?:\/\/[^\s<]+)/g;

function renderTextWithLinks(text, key) {
  if (!text) return null;
  const parts = text.split(URL_SPLIT_RE);
  if (parts.length === 1) return <React.Fragment key={key}>{text}</React.Fragment>;
  return (
    <React.Fragment key={key}>
      {parts.map((part, i) => (
        /* text.split() with one capturing group alternates
           non-match/match/non-match/... — odd indices are always URLs. */
        i % 2 === 1
          ? <a key={i} href={part} target="_blank" rel="noopener noreferrer">{part}</a>
          : part
      ))}
    </React.Fragment>
  );
}

function renderInline(text) {
  const nodes = [];
  let last = 0;
  let m;
  let key = 0;
  INLINE_RE.lastIndex = 0;

  while ((m = INLINE_RE.exec(text)) !== null) {
    if (m.index > last) nodes.push(renderTextWithLinks(text.slice(last, m.index), key++));

    if (m[1] !== undefined) nodes.push(<code key={key++} className={styles.inline_code}>{m[1]}</code>);
    else if (m[2] !== undefined) nodes.push(<strong key={key++}>{m[2]}</strong>);
    else if (m[3] !== undefined) nodes.push(<strong key={key++}>{m[3]}</strong>);
    else if (m[4] !== undefined) nodes.push(<del key={key++}>{m[4]}</del>);
    else if (m[5] !== undefined) nodes.push(<em key={key++}>{m[5]}</em>);
    else if (m[6] !== undefined) nodes.push(<em key={key++}>{m[6]}</em>);

    last = INLINE_RE.lastIndex;
  }

  if (last < text.length) nodes.push(renderTextWithLinks(text.slice(last), key++));
  return nodes;
}

/* ─────────────────────────────────────────────────────────────────────
   BLOCK RENDER
───────────────────────────────────────────────────────────────────── */
const HEADING_CLASS = {
  1: styles.h1, 2: styles.h2, 3: styles.h3,
  4: styles.h4, 5: styles.h5, 6: styles.h6,
};

function renderBlock(block, key) {
  switch (block.type) {
    case 'heading': {
      const Tag = `h${Math.min(Math.max(block.level, 1), 6)}`;
      return <Tag key={key} className={HEADING_CLASS[block.level]}>{renderInline(block.content)}</Tag>;
    }

    case 'ul':
      return (
        <ul key={key} className={styles.list}>
          {block.items.map((item, i) => <li key={i}>{renderInline(item)}</li>)}
        </ul>
      );

    case 'ol':
      return (
        <ol key={key} className={styles.list}>
          {block.items.map((item, i) => <li key={i}>{renderInline(item)}</li>)}
        </ol>
      );

    case 'table':
      return (
        <div key={key} className={styles.table_wrap}>
          <table className={styles.table}>
            <thead>
              <tr>{block.header.map((cell, i) => <th key={i}>{renderInline(cell)}</th>)}</tr>
            </thead>
            <tbody>
              {block.rows.map((row, ri) => (
                <tr key={ri}>{row.map((cell, ci) => <td key={ci}>{renderInline(cell)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      );

    case 'p':
    default:
      return (
        <p key={key} className={styles.paragraph}>
          {block.lines.map((line, li) => (
            <React.Fragment key={li}>
              {li > 0 && <br />}
              {renderInline(line)}
            </React.Fragment>
          ))}
        </p>
      );
  }
}

/* ─────────────────────────────────────────────────────────────────────
   MARKDOWN LITE — the exported component.
───────────────────────────────────────────────────────────────────── */
export default function MarkdownLite({ text }) {
  if (!text) return null;

  let key = 0;
  const nodes = [];

  for (const segment of splitCodeBlocks(text)) {
    if (segment.type === 'code') {
      nodes.push(<CodeBlock key={key++} lang={segment.lang} content={segment.content} />);
      continue;
    }
    for (const block of parseTextBlocks(segment.content)) {
      nodes.push(renderBlock(block, key++));
    }
  }

  return <div className={styles.root}>{nodes}</div>;
}
