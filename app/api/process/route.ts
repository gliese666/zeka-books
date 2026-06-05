/**
 * POST /api/process
 * SSE endpoint — processes ONE chapter and streams events back to the client.
 * Client calls this once per chapter and chains them sequentially.
 *
 * Body (multipart/form-data):
 *   file         — the book file (PDF/EPUB)
 *   subject      — subject name for Supabase (e.g. "История Азербайджана 9")
 *   chapterTitle — chapter title
 *   chapterIndex — 1-based index
 *   pageStart    — start page (1-based)
 *   pageEnd      — end page (inclusive)
 *   fileType     — "epub" | "pdf"
 *   isImageBased — "true" | "false"
 */

import { NextRequest } from 'next/server';
import { processChapter, type PipelineEvent } from '@/lib/pipeline';

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      function send(event: PipelineEvent) {
        const data = `data: ${JSON.stringify(event)}\n\n`;
        controller.enqueue(encoder.encode(data));
      }

      try {
        const formData = await req.formData();
        const file = formData.get('file') as File;
        const subject = formData.get('subject') as string;
        const chapterTitle = formData.get('chapterTitle') as string;
        const chapterIndex = parseInt(formData.get('chapterIndex') as string);
        const pageStart = parseInt(formData.get('pageStart') as string);
        const pageEnd = parseInt(formData.get('pageEnd') as string);
        const fileType = formData.get('fileType') as 'epub' | 'pdf';
        const isImageBased = formData.get('isImageBased') === 'true';
        const bookName = formData.get('bookName') as string || file.name;

        if (!file || !subject || !chapterTitle) {
          send({ type: 'error', msg: 'Missing required fields: file, subject, chapterTitle' });
          controller.close();
          return;
        }

        const bytes = await file.arrayBuffer();
        const fileBuffer = Buffer.from(bytes);

        await processChapter(
          { bookName, subject, chapterTitle, chapterIndex, pageStart, pageEnd, fileBuffer, fileType, isImageBased },
          send
        );

      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        send({ type: 'error', msg });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
