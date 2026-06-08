/**
 * POST /api/upload
 * Two modes:
 *   1. File upload (FormData with 'file') — limited to ~4.5MB on Vercel
 *   2. Local path (FormData with 'filePath') — reads from disk, no size limit (local dev only)
 * Returns TOC structure for the client.
 */

import { NextRequest, NextResponse } from 'next/server';
import { parseEpub } from '@/lib/extract/epub';
import { parsePdf } from '@/lib/extract/pdf';
import fs from 'fs';
import path from 'path';

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const filePath = formData.get('filePath') as string | null;
    const file = formData.get('file') as File | null;
    const subject = formData.get('subject') as string | null;

    let buffer: Buffer;
    let fileName: string;

    if (filePath) {
      // LOCAL PATH MODE — read from disk (local dev only)
      const absPath = path.resolve(filePath);
      if (!fs.existsSync(absPath)) {
        return NextResponse.json({ error: `File not found: ${absPath}` }, { status: 404 });
      }
      buffer = fs.readFileSync(absPath);
      fileName = path.basename(absPath);
    } else if (file) {
      // UPLOAD MODE — browser file upload
      const bytes = await file.arrayBuffer();
      buffer = Buffer.from(bytes);
      fileName = file.name;
    } else {
      return NextResponse.json({ error: 'Provide either file or filePath' }, { status: 400 });
    }
    const isEpub = fileName.toLowerCase().endsWith('.epub');
    const isPdf  = fileName.toLowerCase().endsWith('.pdf');

    if (!isEpub && !isPdf) {
      return NextResponse.json({ error: 'Only PDF and EPUB files are supported' }, { status: 400 });
    }

    let meta;
    if (isEpub) {
      meta = await parseEpub(buffer);
    } else {
      const pdfMeta = await parsePdf(buffer);
      meta = {
        title: pdfMeta.title,
        isImageBased: pdfMeta.isImageBased,
        totalPages: pdfMeta.totalPages,
        chapters: pdfMeta.suggestedChapters,
      };
    }

    return NextResponse.json({
      fileName,
      fileType: isEpub ? 'epub' : 'pdf',
      title: meta.title,
      isImageBased: meta.isImageBased,
      totalPages: meta.totalPages,
      chapters: meta.chapters,
      subject: subject || meta.title,
      // Pass filePath back so client can use local mode for processing
      ...(filePath ? { filePath } : {}),
    });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
