/**
 * POST /api/upload
 * Accepts a PDF or EPUB file, returns TOC structure for the client.
 * No AI calls here — just structural parsing.
 */

import { NextRequest, NextResponse } from 'next/server';
import { parseEpub } from '@/lib/extract/epub';
import { parsePdf } from '@/lib/extract/pdf';

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const subject = formData.get('subject') as string | null;

    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const fileName = file.name;
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
    });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
