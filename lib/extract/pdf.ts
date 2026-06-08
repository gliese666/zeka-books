/**
 * PDF extractor — pdf-parse v2.x API (class-based).
 *
 * v1.x used: pdfParse(buffer) function
 * v2.x uses: new PDFParse({ data: ArrayBuffer }) + getInfo() / getText()
 *
 * Key gotcha: PDF.js transfers the ArrayBuffer to a Worker, so each PDFParse
 * instance needs its OWN independent copy of the buffer.
 */

import { PDFParse, type LoadParameters } from 'pdf-parse';

export interface PdfMeta {
  title: string;
  totalPages: number;
  isImageBased: boolean;
  /** For text PDFs: rough chapter detection from headings */
  suggestedChapters: Array<{ title: string; pageStart: number; pageEnd: number }>;
}

// ── Buffer helpers ────────────────────────────────────────────────────────────

/** Copy a Node.js Buffer into a fresh ArrayBuffer (safe to transfer to Worker). */
function bufToArrayBuffer(buf: Buffer): ArrayBuffer {
  const ab = new ArrayBuffer(buf.byteLength);
  new Uint8Array(ab).set(buf);
  return ab;
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Parse PDF metadata and detect if image-based. */
export async function parsePdf(buffer: Buffer): Promise<PdfMeta> {
  let totalPages: number;
  let fullText: string;
  let infoTitle: string | undefined;

  try {
    // --- page count + title ---
    const parser1 = new PDFParse({ data: bufToArrayBuffer(buffer) } as LoadParameters);
    const info = await parser1.getInfo();
    await parser1.destroy();
    totalPages = info.total;
    infoTitle = (info.info as Record<string, unknown>)?.Title as string | undefined;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to parse PDF metadata: ${msg}`);
  }

  try {
    // --- text extraction ---
    const parser2 = new PDFParse({ data: bufToArrayBuffer(buffer) } as LoadParameters);
    const textResult = await parser2.getText();
    await parser2.destroy();
    fullText = textResult.text || '';
  } catch (err) {
    // Text extraction failed — treat as image-based
    fullText = '';
  }

  // Heuristic 1: low text density
  const lowDensity = totalPages > 0 && fullText.length / totalPages < 50;

  // Heuristic 2: garbled encoding (e.g., WinAnsi misread)
  // A genuine Russian/Azerbaijani PDF should have mostly Cyrillic + basic ASCII.
  // If "normal" chars are < 50% of printable chars → garbled → treat as image.
  const printable = fullText.replace(/\s/g, '');
  const normalChars = (printable.match(/[\x20-\x7EЀ-ԯ]/g) ?? []).length;
  const garbled = printable.length > 200 && normalChars / printable.length < 0.5;

  const isImageBased = lowDensity || garbled;

  const suggestedChapters = isImageBased
    ? generatePageGroups(totalPages, 15) // 15 pages per group for image-based PDFs
    : detectChaptersFromText(fullText, totalPages);

  const title = infoTitle || 'Untitled PDF';

  return { title, totalPages, isImageBased, suggestedChapters };
}

/** Extract text for a page range (1-indexed, inclusive). */
export async function extractPdfText(
  buffer: Buffer,
  pageStart: number,
  pageEnd: number
): Promise<string> {
  // first + last = inclusive range in pdf-parse v2
  const parser = new PDFParse({
    data: bufToArrayBuffer(buffer),
  } as LoadParameters);

  try {
    const result = await parser.getText({ first: pageStart, last: pageEnd });
    return result.text.trim();
  } finally {
    await parser.destroy();
  }
}

/** Extract a page as an image buffer (for image-based PDFs).
 *  Returns null — server-side rendering not available without canvas.
 *  Caller should fall back to sending full page range via File API.
 */
export async function extractPdfPageImage(
  _buffer: Buffer,
  _pageNum: number
): Promise<Buffer | null> {
  // PDF rendering to image requires canvas (browser) or puppeteer (heavy).
  // On Vercel, we use Gemini File API to upload the whole PDF instead.
  return null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** For image-based PDFs without a TOC: group pages into equal-sized chunks. */
function generatePageGroups(
  totalPages: number,
  pagesPerGroup: number
): Array<{ title: string; pageStart: number; pageEnd: number }> {
  const groups: Array<{ title: string; pageStart: number; pageEnd: number }> = [];
  for (let start = 1; start <= totalPages; start += pagesPerGroup) {
    const end = Math.min(start + pagesPerGroup - 1, totalPages);
    groups.push({
      title: `Страницы ${start}–${end}`,
      pageStart: start,
      pageEnd: end,
    });
  }
  return groups;
}

function detectChaptersFromText(
  text: string,
  totalPages: number
): Array<{ title: string; pageStart: number; pageEnd: number }> {
  // Simple heuristic: lines that look like "Глава N." or "Chapter N"
  const chapterRe = /^(Глава|Chapter|§|Раздел|Тема)\s+\d+[.:]?\s+.{3,60}$/im;
  const lines = text.split('\n').filter(l => l.trim().length > 0);

  const found: Array<{ title: string; lineIdx: number }> = [];
  lines.forEach((line, idx) => {
    if (chapterRe.test(line.trim())) {
      found.push({ title: line.trim(), lineIdx: idx });
    }
  });

  if (found.length < 2) return [];

  // Distribute pages proportionally
  const chapters: Array<{ title: string; pageStart: number; pageEnd: number }> = [];
  const ratio = totalPages / lines.length;

  for (let i = 0; i < found.length; i++) {
    const pageStart = Math.max(1, Math.round(found[i].lineIdx * ratio));
    const pageEnd = i + 1 < found.length
      ? Math.round(found[i + 1].lineIdx * ratio) - 1
      : totalPages;
    chapters.push({ title: found[i].title, pageStart, pageEnd });
  }

  return chapters;
}
