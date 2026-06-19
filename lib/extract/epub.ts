/**
 * EPUB extractor — supports both image-based and text-based EPUBs.
 * Image-based: extracts page images via OPF manifest + spine (not filename guessing).
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

// ── OPF structure ─────────────────────────────────────────────────────────────

interface ManifestItem {
  id: string;
  href: string;
  mediaType: string;
  absPath: string; // resolved path inside zip
}

interface EpubStructure {
  opfDir: string;
  manifest: ManifestItem[];
  spineItems: ManifestItem[]; // in reading order
}

/** Resolve path segments including ../ */
function normalizePath(rawPath: string): string {
  const parts = rawPath.split('/');
  const resolved: string[] = [];
  for (const part of parts) {
    if (part === '..') resolved.pop();
    else if (part && part !== '.') resolved.push(part);
  }
  return resolved.join('/');
}

/** Find container.xml → OPF path → parse manifest + spine. */
async function parseOpf(zip: JSZip): Promise<EpubStructure> {
  // 1. Find OPF path via container.xml
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

  // 2. Parse manifest
  const manifest: ManifestItem[] = [];
  $('item').each((_, el) => {
    const id = $(el).attr('id') ?? '';
    const href = $(el).attr('href') ?? '';
    const mediaType = $(el).attr('media-type') ?? '';
    if (!id || !href) return;
    const absPath = normalizePath(opfDir ? `${opfDir}/${href}` : href);
    manifest.push({ id, href, mediaType, absPath });
  });

  // 3. Parse spine
  const manifestById = new Map(manifest.map(m => [m.id, m]));
  const spineItems: ManifestItem[] = [];
  $('itemref').each((_, el) => {
    const idref = $(el).attr('idref') ?? '';
    const item = manifestById.get(idref);
    if (item) spineItems.push(item);
  });

  return { opfDir, manifest, spineItems };
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Parse EPUB TOC and detect if it's image-based. */
export async function parseEpub(buffer: Buffer): Promise<EpubMeta> {
  const zip = await JSZip.loadAsync(buffer);
  const structure = await parseOpf(zip);

  const isImageBased = await detectImageBased(zip, structure);
  const totalPages = structure.spineItems.length;
  const chapters = await buildChapters(zip, structure, totalPages);

  // Book title
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
 * Extract page images for a chapter (image-based EPUB).
 * Uses spine order: spine[pg-1] = page pg.
 * Reads <img src="..."> from XHTML and resolves via manifest — no filename guessing.
 */
export async function extractEpubImages(
  buffer: Buffer,
  pageStart: number,
  pageEnd: number
): Promise<PageImage[]> {
  const zip = await JSZip.loadAsync(buffer);
  const structure = await parseOpf(zip);

  // Filename → absPath index for fallback
  const fileNameIndex = new Map<string, string>();
  for (const item of structure.manifest) {
    if (item.mediaType.startsWith('image/')) {
      const fname = item.absPath.split('/').pop()!.toLowerCase();
      fileNameIndex.set(fname, item.absPath);
    }
  }

  const images: PageImage[] = [];

  for (let pg = pageStart; pg <= pageEnd; pg++) {
    const spineItem = structure.spineItems[pg - 1];
    if (!spineItem) continue;

    const xhtmlFile = zip.file(spineItem.absPath);
    if (!xhtmlFile) continue;

    const html = await xhtmlFile.async('string');
    const $ = cheerio.load(html, { xmlMode: false });

    // Find first image reference in the page
    const imgSrc = $('img').first().attr('src')
      ?? $('image').first().attr('xlink:href')
      ?? $('image').first().attr('href')
      ?? '';

    if (!imgSrc) continue;

    // Resolve relative to the XHTML file's directory
    const xhtmlDir = spineItem.absPath.includes('/')
      ? spineItem.absPath.substring(0, spineItem.absPath.lastIndexOf('/'))
      : '';
    const resolvedPath = normalizePath(xhtmlDir ? `${xhtmlDir}/${imgSrc}` : imgSrc);

    // Try resolved path, then filename-only fallback
    let imgFile = zip.file(resolvedPath);
    if (!imgFile) {
      const fname = imgSrc.split('/').pop()!.toLowerCase();
      const fallbackPath = fileNameIndex.get(fname);
      if (fallbackPath) imgFile = zip.file(fallbackPath);
    }

    if (!imgFile) continue;

    const data = Buffer.from(await imgFile.async('arraybuffer'));
    const isPng = imgFile.name.toLowerCase().endsWith('.png');
    images.push({ pageNum: pg, mimeType: isPng ? 'image/png' : 'image/jpeg', data });
  }

  return images;
}

/** Extract text from a chapter (text-based EPUB). Uses spine order. */
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

// ── Helpers ───────────────────────────────────────────────────────────────────

async function detectImageBased(zip: JSZip, structure: EpubStructure): Promise<boolean> {
  for (const item of structure.spineItems.slice(0, 5)) {
    const file = zip.file(item.absPath);
    if (!file) continue;
    const html = await file.async('string');
    const $ = cheerio.load(html);
    const bodyText = $('body').text().trim();
    if ($('img, image').length > 0 && bodyText.length < 30) return true;
  }
  return false;
}

async function buildChapters(
  zip: JSZip,
  structure: EpubStructure,
  totalPages: number
): Promise<ChapterEntry[]> {
  // Spine index: filename or absPath → 1-based page number
  const hrefToPage = new Map<string, number>();
  structure.spineItems.forEach((item, i) => {
    hrefToPage.set(item.absPath, i + 1);
    hrefToPage.set(item.href, i + 1);
    hrefToPage.set(item.absPath.split('/').pop()!, i + 1);
  });

  // Find TOC file
  const tocItem = structure.manifest.find(m =>
    m.mediaType === 'application/x-dtbncx+xml' ||
    m.mediaType === 'application/xhtml+xml' && (m.href.includes('toc') || m.id === 'toc') ||
    m.id === 'ncx'
  );
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

  // EPUB3 nav
  $('nav a').each((_, el) => {
    const href = ($(el).attr('href') ?? '').split('#')[0];
    const text = $(el).text().trim();
    const fname = href.split('/').pop()!;
    const page = hrefToPage.get(fname) ?? hrefToPage.get(href);
    if (page && text.length > 1) links.push({ text, page });
  });

  // EPUB2 NCX fallback
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
