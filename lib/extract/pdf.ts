/**
 * PDF extractor — single engine (pdfjs-dist) for text + metadata, pdf-to-img for rendering.
 *
 * ⚠️ Намеренно НЕ используем pdf-parse: его встроенный pdfjs ставит несовместимые
 * глобальные полифилы canvas (Path2D/DOMMatrix), из-за чего рендер pdf-to-img падает
 * ("Value is none of these types String, Path"). Один pdfjs-dist = ноль конфликтов.
 *
 * Тяжёлые модули (pdfjs-dist, pdf-to-img, sharp) импортируются ЛЕНИВО внутри функций,
 * чтобы Next.js route-модули не грузили их при сборке.
 */

import type { PageImage } from '@/lib/extract/epub';

export interface PdfMeta {
  title: string;
  totalPages: number;
  isImageBased: boolean;
  /** For text PDFs: rough chapter detection from headings */
  suggestedChapters: Array<{ title: string; pageStart: number; pageEnd: number }>;
}

// ── pdfjs loader (Node legacy build) ────────────────────────────────────────────
async function loadPdfjs() {
  return await import('pdfjs-dist/legacy/build/pdf.mjs');
}

async function openDoc(buffer: Buffer) {
  const pdfjs = await loadPdfjs();
  // Fresh Uint8Array copy: pdfjs may transfer/detach the underlying buffer.
  return await pdfjs.getDocument({ data: Uint8Array.from(buffer), useSystemFonts: true, isEvalSupported: false }).promise;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function pageText(doc: any, n: number): Promise<string> {
  const page = await doc.getPage(n);
  const tc = await page.getTextContent();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return tc.items.map((i: any) => ('str' in i ? i.str : '')).join(' ');
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Parse PDF metadata and detect if image-based. */
export async function parsePdf(buffer: Buffer): Promise<PdfMeta> {
  const doc = await openDoc(buffer);
  const totalPages: number = doc.numPages;

  let infoTitle: string | undefined;
  try {
    const meta = await doc.getMetadata();
    infoTitle = (meta.info as Record<string, unknown>)?.Title as string | undefined;
  } catch { /* metadata optional */ }

  // Sample text from up to 12 pages to decide image-vs-text (avoid scanning huge PDFs).
  const sampleCount = Math.min(totalPages, 12);
  let sampleText = '';
  for (let n = 1; n <= sampleCount; n++) {
    try { sampleText += (await pageText(doc, n)) + '\n'; } catch { /* skip */ }
  }

  // Heuristic 1: low text density per page.
  const lowDensity = sampleCount > 0 && sampleText.length / sampleCount < 50;
  // Heuristic 2: garbled encoding (non-Cyrillic/ASCII dominates) → scanned/mis-encoded.
  const printable = sampleText.replace(/\s/g, '');
  const normalChars = (printable.match(/[\x20-\x7EЀ-ԯ]/g) ?? []).length;
  const garbled = printable.length > 200 && normalChars / printable.length < 0.5;

  const isImageBased = lowDensity || garbled;

  let suggestedChapters: Array<{ title: string; pageStart: number; pageEnd: number }>;
  if (isImageBased) {
    suggestedChapters = generatePageGroups(totalPages, 15);
  } else {
    // Text-based: extract full text for heading-based chapter detection.
    let fullText = '';
    for (let n = 1; n <= totalPages; n++) {
      try { fullText += (await pageText(doc, n)) + '\n'; } catch { /* skip */ }
    }
    suggestedChapters = detectChaptersFromText(fullText, totalPages);
    if (!suggestedChapters.length) suggestedChapters = generatePageGroups(totalPages, 15);
  }

  return { title: infoTitle || 'Untitled PDF', totalPages, isImageBased, suggestedChapters };
}

/** Extract text for a page range (1-indexed, inclusive). */
export async function extractPdfText(buffer: Buffer, pageStart: number, pageEnd: number): Promise<string> {
  const doc = await openDoc(buffer);
  const last = Math.min(pageEnd, doc.numPages);
  let text = '';
  for (let n = pageStart; n <= last; n++) {
    try { text += (await pageText(doc, n)) + '\n\n'; } catch { /* skip */ }
  }
  return text.trim();
}

/**
 * Render a page range of an image-based PDF to JPEG buffers.
 * Uses pdf-to-img (pdfjs + @napi-rs/canvas) — no system deps — then sharp to
 * downscale/re-encode so each page stays small enough for Gemini inline_data.
 * Returns PageImage[] (same shape as extractEpubImages) so the Vision path is shared.
 */
export async function extractPdfImages(
  buffer: Buffer,
  pageStart: number,
  pageEnd: number,
  opts: { scale?: number; maxWidth?: number; quality?: number } = {}
): Promise<PageImage[]> {
  const { scale = 2, maxWidth = 1240, quality = 80 } = opts;

  const { pdf } = await import('pdf-to-img');
  const sharp = (await import('sharp')).default;

  // Gemini inline_data limit: stay well under 4MB per page
  const MAX_PAGE_BYTES = 4 * 1024 * 1024;

  const doc = await pdf(buffer, { scale });
  const last = Math.min(pageEnd, doc.length);
  const images: PageImage[] = [];

  for (let n = pageStart; n <= last; n++) {
    const png = await doc.getPage(n); // pdf-to-img returns PNG buffers

    // Start at requested quality, reduce until page fits within limit
    let q = quality;
    let jpg = await sharp(png)
      .resize({ width: maxWidth, withoutEnlargement: true })
      .jpeg({ quality: q })
      .toBuffer();

    while (jpg.length > MAX_PAGE_BYTES && q > 40) {
      q -= 10;
      jpg = await sharp(png)
        .resize({ width: maxWidth, withoutEnlargement: true })
        .jpeg({ quality: q })
        .toBuffer();
    }

    images.push({ pageNum: n, mimeType: 'image/jpeg', data: jpg });
  }

  return images;
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
    groups.push({ title: `Страницы ${start}–${end}`, pageStart: start, pageEnd: end });
  }
  return groups;
}

function detectChaptersFromText(
  text: string,
  totalPages: number
): Array<{ title: string; pageStart: number; pageEnd: number }> {
  const chapterRe = /^(Глава|Chapter|§|Раздел|Тема)\s+\d+[.:]?\s+.{3,60}$/im;
  const lines = text.split('\n').filter((l) => l.trim().length > 0);

  const found: Array<{ title: string; lineIdx: number }> = [];
  lines.forEach((line, idx) => {
    if (chapterRe.test(line.trim())) found.push({ title: line.trim(), lineIdx: idx });
  });

  if (found.length < 2) return [];

  const chapters: Array<{ title: string; pageStart: number; pageEnd: number }> = [];
  const ratio = totalPages / lines.length;
  for (let i = 0; i < found.length; i++) {
    const pageStart = Math.max(1, Math.round(found[i].lineIdx * ratio));
    const pageEnd = i + 1 < found.length ? Math.round(found[i + 1].lineIdx * ratio) - 1 : totalPages;
    chapters.push({ title: found[i].title, pageStart, pageEnd });
  }
  return chapters;
}
