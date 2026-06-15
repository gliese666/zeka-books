/**
 * export-md.ts — writes processed chapter chunks as a markdown file
 * into Books Labs/{subject} {suffix}/01_RAG_Ready/{idx:02d}_{title}.md
 *
 * This mirrors the format produced by the legacy ETL scripts so that
 * all books (old and new pipeline) look consistent in Obsidian.
 */

import fs from 'fs';
import path from 'path';
import { folderName, subjectLang } from '@/lib/normalize';
import type { KarpathyChunk } from '@/lib/ai/deepseek';

const BOOKS_DIR =
  process.env.BOOKS_LAB_DIR ??
  '/Users/akram/Library/Mobile Documents/iCloud~md~obsidian/Documents/My Obsidian/Books Labs';

// ── Bloom emoji map ───────────────────────────────────────────────────────────

const BLOOM_EMOJI: Record<string, string> = {
  знание:       '🔵',
  понимание:    '🟢',
  применение:   '🟡',
  анализ:       '🟠',
  синтез:       '🔴',
  оценка:       '🟣',
  knowledge:    '🔵',
  comprehension:'🟢',
  application:  '🟡',
  analysis:     '🟠',
  synthesis:    '🔴',
  evaluation:   '🟣',
};

function bloomEmoji(level: string): string {
  const key = level?.toLowerCase().trim();
  return BLOOM_EMOJI[key] ?? '⚪';
}

// ── Difficulty → stars ────────────────────────────────────────────────────────

function stars(n: number): string {
  const v = Math.max(1, Math.min(5, Math.round(n)));
  return '★'.repeat(v) + '☆'.repeat(5 - v);
}

// ── Sanitize string for use as filename component ─────────────────────────────

function sanitizeFilename(s: string): string {
  return s
    .replace(/[\/\\:*?"<>|]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 80);
}

// ── Format one chunk as Obsidian callout block ────────────────────────────────

function formatChunk(chunk: KarpathyChunk): string {
  const lines: string[] = [];

  const tags = (chunk.concepts ?? []).map((t) => `\`${t}\``).join(' ');
  const bloom = chunk.bloom_level ?? '';
  const type = chunk.concept_type ?? '';

  lines.push(`> [!INFO] ${chunk.title}`);
  lines.push(`> **Сложность:** ${stars(chunk.difficulty)} · **Bloom:** ${bloomEmoji(bloom)} ${bloom} · **Тип:** ${type}`);
  if (tags) lines.push(`> **Теги:** ${tags}`);
  lines.push(`>`);
  lines.push('');

  // Content: already markdown from AI
  lines.push(chunk.content);

  // Optional extra fields
  if (chunk.key_figures?.length) {
    lines.push('');
    lines.push(`**Персонажи/учёные:** ${chunk.key_figures.join(', ')}`);
  }
  if (chunk.key_dates?.length) {
    lines.push('');
    lines.push(`**Даты:** ${chunk.key_dates.join(', ')}`);
  }
  if (chunk.misconceptions?.length) {
    lines.push('');
    lines.push(`**Типичные ошибки:** ${chunk.misconceptions.join(' · ')}`);
  }
  if (chunk.prerequisites?.length) {
    lines.push('');
    lines.push(`**Пресупозиции:** ${chunk.prerequisites.join(', ')}`);
  }

  lines.push('');
  lines.push('---');
  lines.push('');

  return lines.join('\n');
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface ExportParams {
  subject: string;          // canonical (no suffix): "Математика 9"
  chapterIndex: number;     // 1-based
  chapterTitle: string;
  chunks: KarpathyChunk[];
  model: string;            // e.g. "deepseek-v4-pro" or "gemini-3.5-flash"
}

/**
 * Writes chunks to Books Labs/{subject} {suffix}/01_RAG_Ready/{idx}_{title}.md
 * Idempotent — overwrites if the file already exists.
 * Returns the absolute path written.
 */
export async function writeChapterMd(params: ExportParams): Promise<string> {
  const { subject, chapterIndex, chapterTitle, chunks, model } = params;

  const folder = path.join(BOOKS_DIR, folderName(subject), '01_RAG_Ready');
  fs.mkdirSync(folder, { recursive: true });

  const idx = String(chapterIndex).padStart(2, '0');
  const filename = `${idx}_${sanitizeFilename(chapterTitle)}.md`;
  const filePath = path.join(folder, filename);

  const header = [
    `# Глава ${chapterIndex}. ${chapterTitle}`,
    '',
    `> ${chunks.length} концептуальных чанков · ${model} · Метод Карпаты`,
    '',
    '---',
    '',
  ].join('\n');

  const body = chunks.map(formatChunk).join('');

  fs.writeFileSync(filePath, header + body, 'utf8');
  return filePath;
}
