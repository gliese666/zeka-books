/**
 * PDF extractor.
 * Text-based: pdf-parse extracts raw text per page range.
 * Image-based detection: if extracted text is too sparse → flag for Vision OCR.
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require('pdf-parse') as (buf: Buffer, opts?: Record<string, unknown>) => Promise<{ numpages: number; text: string; info: Record<string, unknown> }>;

export interface PdfMeta {
  title: string;
  totalPages: number;
  isImageBased: boolean;
  /** For text PDFs: rough chapter detection from headings */
  suggestedChapters: Array<{ title: string; pageStart: number; pageEnd: number }>;
}

/** Parse PDF metadata and detect if image-based. */
export async function parsePdf(buffer: Buffer): Promise<PdfMeta> {
  let result: Awaited<ReturnType<typeof pdfParse>>;

  try {
    result = await pdfParse(buffer, { max: 0 }); // max:0 = all pages
  } catch {
    throw new Error('Failed to parse PDF — file may be corrupted or encrypted');
  }

  const totalPages = result.numpages;
  const fullText = result.text || '';

  // Heuristic: image-based if text density < 50 chars/page
  const isImageBased = fullText.length / totalPages < 50;

  // Try to detect chapters from headings (bold lines, numbered paragraphs)
  const suggestedChapters = isImageBased
    ? []
    : detectChaptersFromText(fullText, totalPages);

  const title = (result.info?.Title as string) || 'Untitled PDF';

  return { title, totalPages, isImageBased, suggestedChapters };
}

/** Extract text for a page range (1-indexed). */
export async function extractPdfText(
  buffer: Buffer,
  pageStart: number,
  pageEnd: number
): Promise<string> {
  const result = await pdfParse(buffer, {
    max: pageEnd,
    pagerender: (pageData: { pageIndex: number; pageContent?: Promise<string>; getTextContent: () => Promise<{ items: Array<{ str: string }> }> }) => {
      // Only render pages in our range
      if (pageData.pageIndex < pageStart - 1) return Promise.resolve('');
      return pageData.getTextContent().then((content) => {
        return content.items.map((item: { str: string }) => item.str).join(' ');
      });
    },
  });

  return result.text.trim();
}

/** Extract a page as an image buffer (for image-based PDFs).
 *  Returns null if canvas rendering isn't available (server-side).
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
