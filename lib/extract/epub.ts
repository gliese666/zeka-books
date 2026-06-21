/**
 * EPUB extractor — supports text-based, image-based, and hybrid EPUBs.
 *
 * Primary API: extractEpubContent() — adaptive per-page extraction.
 *   Each page is independently classified:
 *   - HTML text ≥ MIN_TEXT_CHARS → text (fast, zero API cost)
 *   - HTML text < threshold + has <img> → image (caller sends to Vision OCR)
 *   - Neither → empty page (cover, separator) → silently skipped
 *
 * Legacy: extractEpubText() / extractEpubImages() kept for compatibility.
 */

import JSZip from 'jszip';
import * as cheerio from 'cheerio';
import type { Element } from 'domhandler';

/** Minimum characters to treat a page as text-based rather than a scan. */
const MIN_TEXT_CHARS = 150;

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

/**
 * Result of adaptive per-page extraction.
 * A single chapter may contain text pages, image pages, or both.
 * Callers should process text first; use images only when text is absent.
 */
export interface EpubContent {
  /** Concatenated plain text from pages that had sufficient HTML text. */
  text: string;
  /** Image data from pages that had no text but contained a scan <img>. */
  images: PageImage[];
  pageCount: number;
  textPages: number;
  imagePages: number;
  /** Pages with neither text nor image (covers, separators) — silently skipped. */
  emptyPages: number;
}

// ── OPF structure ─────────────────────────────────────────────────────────────

interface ManifestItem {
  id: string;
  href: string;
  mediaType: string;
  absPath: string;
  properties?: string;
}

interface EpubStructure {
  opfDir: string;
  manifest: ManifestItem[];
  spineItems: ManifestItem[];
}

function normalizePath(rawPath: string): string {
  const parts = rawPath.split('/');
  const resolved: string[] = [];
  for (const part of parts) {
    if (part === '..') resolved.pop();
    else if (part && part !== '.') resolved.push(part);
  }
  return resolved.join('/');
}

async function parseOpf(zip: JSZip): Promise<EpubStructure> {
  let opfPath = 'OEBPS/content.opf';
  const containerFile = zip.file('META-INF/container.xml');
  if (containerFile) {
    const xml = await containerFile.async('string');
    const m = xml.match(/full-path="([^"]+\.opf)"/);
    if (m) opfPath = m[1];
  } else {
    const found = Object.keys(zip.files).find(f => f.endsWith('.opf'));
    if (found) opfPath = found;
  }

  const opfDir = opfPath.includes('/') ? opfPath.substring(0, opfPath.lastIndexOf('/')) : '';
  const opfFile = zip.file(opfPath);
  if (!opfFile) throw new Error(`OPF не найден: ${opfPath}`);
  const opfXml = await opfFile.async('string');
  const $ = cheerio.load(opfXml, { xmlMode: true });

  const manifest: ManifestItem[] = [];
  $('item').each((_, el) => {
    const id = $(el).attr('id') ?? '';
    const href = $(el).attr('href') ?? '';
    const mediaType = $(el).attr('media-type') ?? '';
    const properties = $(el).attr('properties') ?? undefined;
    if (!id || !href) return;
    const absPath = normalizePath(opfDir ? `${opfDir}/${href}` : href);
    manifest.push({ id, href, mediaType, absPath, properties });
  });

  const manifestById = new Map(manifest.map(m => [m.id, m]));
  const spineItems: ManifestItem[] = [];
  $('itemref').each((_, el) => {
    const idref = $(el).attr('idref') ?? '';
    const item = manifestById.get(idref);
    if (item) spineItems.push(item);
  });

  return { opfDir, manifest, spineItems };
}

/** Build a filename → absPath lookup for image fallback resolution. */
function buildImageIndex(manifest: ManifestItem[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const item of manifest) {
    if (item.mediaType.startsWith('image/')) {
      const fname = item.absPath.split('/').pop()!.toLowerCase();
      index.set(fname, item.absPath);
    }
  }
  return index;
}

async function resolveImage(
  zip: JSZip,
  imgSrc: string,
  xhtmlAbsPath: string,
  imageIndex: Map<string, string>
): Promise<{ data: Buffer; mimeType: string } | null> {
  const xhtmlDir = xhtmlAbsPath.includes('/')
    ? xhtmlAbsPath.substring(0, xhtmlAbsPath.lastIndexOf('/'))
    : '';
  const resolvedPath = normalizePath(xhtmlDir ? `${xhtmlDir}/${imgSrc}` : imgSrc);

  let imgFile = zip.file(resolvedPath);
  if (!imgFile) {
    const fname = imgSrc.split('/').pop()!.toLowerCase();
    const fallbackPath = imageIndex.get(fname);
    if (fallbackPath) imgFile = zip.file(fallbackPath);
  }
  if (!imgFile) return null;

  const data = Buffer.from(await imgFile.async('arraybuffer'));
  const isPng = imgFile.name.toLowerCase().endsWith('.png');
  return { data, mimeType: isPng ? 'image/png' : 'image/jpeg' };
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Parse EPUB TOC and metadata. isImageBased is now informational only. */
export async function parseEpub(buffer: Buffer): Promise<EpubMeta> {
  const zip = await JSZip.loadAsync(buffer);
  const structure = await parseOpf(zip);

  const isImageBased = await detectImageBased(zip, structure);
  const totalPages = structure.spineItems.length;
  const chapters = await buildChapters(zip, structure, totalPages);

  const opfPath = Object.keys(zip.files).find(f => f.endsWith('.opf')) ?? '';
  let title = 'Untitled';
  if (opfPath) {
    const opfXml = await zip.file(opfPath)!.async('string');
    const m = opfXml.match(/<dc:title[^>]*>([^<]+)<\/dc:title>/);
    if (m) title = m[1].trim();
  }

  return { title, isImageBased, chapters, totalPages };
}

/**
 * Adaptive per-page extraction — handles any EPUB type without pre-classification.
 *
 * For each spine page in [pageStart, pageEnd]:
 *   1. Extract HTML text (strip scripts/style/nav).
 *   2. If text ≥ MIN_TEXT_CHARS → append to text output.
 *   3. Else if page contains <img> → resolve image and add to images output.
 *   4. Else → empty page (cover, separator) → skip silently.
 */
export async function extractEpubContent(
  buffer: Buffer,
  pageStart: number,
  pageEnd: number
): Promise<EpubContent> {
  const zip = await JSZip.loadAsync(buffer);
  const structure = await parseOpf(zip);
  const imageIndex = buildImageIndex(structure.manifest);

  let text = '';
  const images: PageImage[] = [];
  let textPages = 0;
  let imagePages = 0;
  let emptyPages = 0;

  for (let pg = pageStart; pg <= pageEnd; pg++) {
    const spineItem = structure.spineItems[pg - 1];
    if (!spineItem) continue;
    const file = zip.file(spineItem.absPath);
    if (!file) continue;

    const html = await file.async('string');
    const $ = cheerio.load(html);
    $('script, style, nav').remove();
    const pageText = $('body').text().replace(/\s+/g, ' ').trim();

    if (pageText.length >= MIN_TEXT_CHARS) {
      text += pageText + '\n\n';
      textPages++;
      continue;
    }

    const imgSrc = $('img').first().attr('src')
      ?? $('image').first().attr('xlink:href')
      ?? $('image').first().attr('href')
      ?? '';

    if (imgSrc) {
      const img = await resolveImage(zip, imgSrc, spineItem.absPath, imageIndex);
      if (img) {
        images.push({ pageNum: pg, ...img });
        imagePages++;
        continue;
      }
    }

    emptyPages++;
  }

  return { text: text.trim(), images, pageCount: pageEnd - pageStart + 1, textPages, imagePages, emptyPages };
}

/**
 * Extract text from a chapter (text-based EPUB).
 * @deprecated Prefer extractEpubContent() for correct hybrid book handling.
 */
export async function extractEpubText(
  buffer: Buffer,
  pageStart: number,
  pageEnd: number
): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const structure = await parseOpf(zip);

  let text = '';
  for (let pg = pageStart; pg <= pageEnd; pg++) {
    const spineItem = structure.spineItems[pg - 1];
    if (!spineItem) continue;
    const file = zip.file(spineItem.absPath);
    if (!file) continue;
    const html = await file.async('string');
    const $ = cheerio.load(html);
    $('script, style, nav').remove();
    text += $.text().replace(/\s+/g, ' ').trim() + '\n\n';
  }

  return text.trim();
}

/**
 * Extract page images for a chapter (image-based EPUB).
 * @deprecated Prefer extractEpubContent() for correct hybrid book handling.
 */
export async function extractEpubImages(
  buffer: Buffer,
  pageStart: number,
  pageEnd: number
): Promise<PageImage[]> {
  const zip = await JSZip.loadAsync(buffer);
  const structure = await parseOpf(zip);
  const imageIndex = buildImageIndex(structure.manifest);
  const images: PageImage[] = [];

  for (let pg = pageStart; pg <= pageEnd; pg++) {
    const spineItem = structure.spineItems[pg - 1];
    if (!spineItem) continue;
    const xhtmlFile = zip.file(spineItem.absPath);
    if (!xhtmlFile) continue;

    const html = await xhtmlFile.async('string');
    const $ = cheerio.load(html, { xmlMode: false });
    const imgSrc = $('img').first().attr('src')
      ?? $('image').first().attr('xlink:href')
      ?? $('image').first().attr('href')
      ?? '';
    if (!imgSrc) continue;

    const img = await resolveImage(zip, imgSrc, spineItem.absPath, imageIndex);
    if (img) images.push({ pageNum: pg, ...img });
  }

  return images;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Classify book as image-based by sampling content pages (not covers).
 * Skips first 3 spine items, samples up to 10 content pages.
 * Returns true only if >60% of sampled pages have no text (genuine scans).
 * This is now informational — extraction does not depend on this flag.
 */
async function detectImageBased(zip: JSZip, structure: EpubStructure): Promise<boolean> {
  const total = structure.spineItems.length;
  if (total === 0) return false;

  const startIdx = Math.min(3, total - 1);
  const sample = structure.spineItems.slice(startIdx, startIdx + 10);

  let textPages = 0;
  let imageOnlyPages = 0;

  for (const item of sample) {
    const file = zip.file(item.absPath);
    if (!file) continue;
    const html = await file.async('string');
    const $ = cheerio.load(html);
    $('script, style, nav').remove();
    const bodyText = $('body').text().replace(/\s+/g, ' ').trim();

    if (bodyText.length >= MIN_TEXT_CHARS) {
      textPages++;
    } else if ($('img, image').length > 0) {
      imageOnlyPages++;
    }
  }

  const checked = textPages + imageOnlyPages;
  if (checked === 0) return false;
  return imageOnlyPages / checked > 0.6;
}

async function buildChapters(
  zip: JSZip,
  structure: EpubStructure,
  totalPages: number
): Promise<ChapterEntry[]> {
  const hrefToPage = new Map<string, number>();
  structure.spineItems.forEach((item, i) => {
    hrefToPage.set(item.absPath, i + 1);
    hrefToPage.set(item.href, i + 1);
    hrefToPage.set(item.absPath.split('/').pop()!, i + 1);
  });

  // EPUB3 nav first, NCX as fallback
  const tocItem =
    structure.manifest.find(m => m.properties?.split(' ').includes('nav')) ??
    structure.manifest.find(m => m.mediaType === 'application/x-dtbncx+xml') ??
    structure.manifest.find(m => m.id === 'ncx') ??
    structure.manifest.find(m => m.mediaType === 'application/xhtml+xml' && (m.href.toLowerCase().includes('toc') || m.id === 'toc' || m.id === 'nav'));
  const tocFile = tocItem ? zip.file(tocItem.absPath) : null;

  if (!tocFile) {
    return structure.spineItems.map((_, i) => ({
      title: `Глава ${i + 1}`,
      pageStart: i + 1,
      pageEnd: i + 1,
    }));
  }

  const tocContent = await tocFile.async('string');
  const $ = cheerio.load(tocContent, { xmlMode: false });
  const links: Array<{ text: string; page: number }> = [];

  const allNavs = $('nav');
  const tocNav = allNavs.filter((_, el) => {
    const t = $(el).attr('epub:type') ?? '';
    return t === 'toc' || t.split(' ').includes('toc');
  });
  const targetNav = tocNav.length > 0
    ? tocNav
    : allNavs.filter((_, el) => {
        const t = $(el).attr('epub:type') ?? '';
        return !t.includes('page-list') && !t.includes('landmarks');
      }).first();

  function walkOl(olEl: Element, depth: number) {
    if (depth > 2) return;
    $(olEl).children('li').each((_, li) => {
      const a = $(li).children('a').first();
      if (a.length) {
        const href = (a.attr('href') ?? '').split('#')[0];
        const text = a.text().trim();
        const fname = href.split('/').pop()!;
        const page = hrefToPage.get(fname) ?? hrefToPage.get(href);
        if (page && text.length > 1) links.push({ text, page });
      }
      $(li).children('ol').each((_, nestedOl) => walkOl(nestedOl, depth + 1));
    });
  }

  const rootOl = targetNav.children('ol').first().get(0);
  if (rootOl) {
    walkOl(rootOl, 1);
  } else {
    targetNav.find('a').each((_, el) => {
      const href = ($(el).attr('href') ?? '').split('#')[0];
      const text = $(el).text().trim();
      const fname = href.split('/').pop()!;
      const page = hrefToPage.get(fname) ?? hrefToPage.get(href);
      if (page && text.length > 1) links.push({ text, page });
    });
  }

  if (!links.length) {
    $('navPoint').each((_, el) => {
      const href = ($(el).find('content').attr('src') ?? '').split('#')[0];
      const text = $(el).find('navLabel text').first().text().trim();
      const fname = href.split('/').pop()!;
      const page = hrefToPage.get(fname) ?? hrefToPage.get(href);
      if (page && text.length > 1) links.push({ text, page });
    });
  }

  const unique = dedupeChapters(links);
  return unique.map((l, i) => ({
    title: l.text,
    pageStart: l.page,
    pageEnd: i + 1 < unique.length ? unique[i + 1].page - 1 : totalPages,
  })).filter(c => c.pageEnd >= c.pageStart);
}

function dedupeChapters(links: Array<{ text: string; page: number }>) {
  const seen = new Set<number>();
  return links.filter(l => {
    if (seen.has(l.page)) return false;
    seen.add(l.page);
    return true;
  });
}
