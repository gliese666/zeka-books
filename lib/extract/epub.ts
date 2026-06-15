/**
 * EPUB extractor — supports both image-based and text-based EPUBs.
 * Image-based: extracts page JPGs/PNGs as base64 buffers.
 * Text-based: extracts HTML → plain text via cheerio.
 */

import JSZip from 'jszip';
import * as cheerio from 'cheerio';

export interface ChapterEntry {
  title: string;
  pageStart: number;
  pageEnd: number;
}

export interface EpubMeta {
  title: string;
  isImageBased: boolean;
  chapters: ChapterEntry[];
  totalPages: number;
}

export interface PageImage {
  pageNum: number;
  mimeType: string;
  data: Buffer;
}

/** Parse EPUB TOC and detect if it's image-based. */
export async function parseEpub(buffer: Buffer): Promise<EpubMeta> {
  const zip = await JSZip.loadAsync(buffer);

  // Read TOC
  const tocFile = zip.file('OEBPS/toc.xhtml') || zip.file('toc.xhtml') || zip.file('toc.ncx');
  if (!tocFile) throw new Error('TOC not found in EPUB');

  const tocContent = await tocFile.async('string');
  const $ = cheerio.load(tocContent, { xmlMode: false });

  const links: Array<{ href: string; text: string }> = [];
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') || '';
    const text = $(el).text().trim();
    if (text && href) links.push({ href, text });
  });

  // Detect page numbers from hrefs like "page10.xhtml"
  const pageNumRe = /page(\d+)/i;
  const chapterLinks = links
    .map(l => ({ text: l.text, page: parseInt(l.href.match(pageNumRe)?.[1] || '0') }))
    .filter(l => l.page > 0 && l.text.length > 2 && !/^\d+$/.test(l.text));

  // Detect total pages
  const allPageFiles = Object.keys(zip.files).filter(f => pageNumRe.test(f));
  const pageNums = allPageFiles.map(f => parseInt(f.match(pageNumRe)![1])).filter(Boolean);
  const totalPages = pageNums.length > 0 ? Math.max(...pageNums) : 0;

  // Check if image-based: sample page has only <img> tag
  const isImageBased = await detectImageBased(zip);

  // Build chapter ranges
  const chapters: ChapterEntry[] = [];
  const unique = dedupeChapters(chapterLinks);

  for (let i = 0; i < unique.length; i++) {
    const start = unique[i].page;
    const end = i + 1 < unique.length ? unique[i + 1].page - 1 : totalPages;
    if (end >= start && unique[i].text.length > 2) {
      chapters.push({ title: unique[i].text, pageStart: start, pageEnd: end });
    }
  }

  // Get title
  const opfFile = zip.file('OEBPS/content.opf') || zip.file('content.opf');
  let title = 'Untitled';
  if (opfFile) {
    const opfContent = await opfFile.async('string');
    const titleMatch = opfContent.match(/<dc:title[^>]*>([^<]+)<\/dc:title>/);
    if (titleMatch) title = titleMatch[1].trim();
  }

  return { title, isImageBased, chapters, totalPages };
}

/** Extract page images for a chapter (image-based EPUB). */
export async function extractEpubImages(
  buffer: Buffer,
  pageStart: number,
  pageEnd: number
): Promise<PageImage[]> {
  const zip = await JSZip.loadAsync(buffer);

  // Build an index of all image files in the zip for fallback lookup
  const allImagePaths = Object.keys(zip.files).filter(f => /\.(jpe?g|png)$/i.test(f));

  const images: PageImage[] = [];

  for (let pg = pageStart; pg <= pageEnd; pg++) {
    // 1. Try canonical path first
    let found = false;
    for (const ext of ['jpg', 'jpeg', 'png']) {
      const canonical = `OEBPS/assets/img/${pg}.${ext}`;
      const file = zip.file(canonical);
      if (file) {
        const data = Buffer.from(await file.async('arraybuffer'));
        images.push({ pageNum: pg, mimeType: ext === 'png' ? 'image/png' : 'image/jpeg', data });
        found = true;
        break;
      }
    }
    if (found) continue;

    // 2. Fallback: search all images whose filename starts with or equals the page number
    const pgStr = String(pg);
    const match = allImagePaths.find(p => {
      const base = p.split('/').pop()!;
      const nameNoExt = base.replace(/\.[^.]+$/, '');
      return nameNoExt === pgStr || nameNoExt === pgStr.padStart(3, '0') || nameNoExt === pgStr.padStart(4, '0');
    });
    if (match) {
      const file = zip.file(match)!;
      const data = Buffer.from(await file.async('arraybuffer'));
      const isPng = match.toLowerCase().endsWith('.png');
      images.push({ pageNum: pg, mimeType: isPng ? 'image/png' : 'image/jpeg', data });
    }
  }

  return images;
}

/** Extract text from a chapter (text-based EPUB). */
export async function extractEpubText(
  buffer: Buffer,
  pageStart: number,
  pageEnd: number
): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  let text = '';

  // Find HTML files in spine order
  const htmlFiles = Object.keys(zip.files)
    .filter(f => f.endsWith('.xhtml') || f.endsWith('.html'))
    .filter(f => !f.includes('toc') && !f.includes('cover'))
    .sort();

  // Try to match page range if files are named page{n}
  const pageRe = /page(\d+)/i;
  const pageFiles = htmlFiles
    .map(f => ({ f, pg: parseInt(f.match(pageRe)?.[1] || '0') }))
    .filter(x => x.pg >= pageStart && x.pg <= pageEnd);

  const filesToRead = pageFiles.length > 0
    ? pageFiles.map(x => x.f)
    : htmlFiles.slice(pageStart - 1, pageEnd);

  for (const filePath of filesToRead) {
    const file = zip.file(filePath);
    if (!file) continue;
    const html = await file.async('string');
    const $ = cheerio.load(html);
    $('script, style, nav').remove();
    text += $.text().replace(/\s+/g, ' ').trim() + '\n\n';
  }

  return text.trim();
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function detectImageBased(zip: JSZip): Promise<boolean> {
  // Check if any content page has only an img tag
  const pageFiles = Object.keys(zip.files).filter(f => /page\d+\.xhtml/.test(f)).slice(0, 3);
  for (const f of pageFiles) {
    const file = zip.file(f);
    if (!file) continue;
    const html = await file.async('string');
    const $ = cheerio.load(html);
    const bodyText = $('body').text().trim();
    const imgs = $('img').length;
    if (imgs > 0 && bodyText.length < 20) return true;
  }
  return false;
}

function dedupeChapters(
  links: Array<{ text: string; page: number }>
): Array<{ text: string; page: number }> {
  const seen = new Set<number>();
  return links.filter(l => {
    if (seen.has(l.page)) return false;
    seen.add(l.page);
    return true;
  });
}
