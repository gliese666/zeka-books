/**
 * POST /api/process
 * SSE endpoint — processes ONE chapter and streams events back to the client.
 * Client calls this once per chapter and chains them sequentially.
 *
 * Body (multipart/form-data):
 *   filePath     — absolute local path to book file (local mode, no size limit)
 *   OR file      — binary file upload (Vercel mode, limited to ~4.5MB)
 *   subject      — subject name for Supabase (e.g. "История Азербайджана 9")
 *   chapterTitle — chapter title
 *   chapterIndex — 1-based index
 *   pageStart    — start page (1-based)
 *   pageEnd      — end page (inclusive)
 *   fileType     — "epub" | "pdf"
 *   isImageBased — "true" | "false"
 *   bookName     — display name (optional)
 */

import { NextRequest } from 'next/server';
import { processChapter, type PipelineEvent } from '@/lib/pipeline';
import fs from 'fs';
import path from 'path';

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
        const filePath   = formData.get('filePath') as string | null;
        const file       = formData.get('file') as File | null;
        const subject    = formData.get('subject') as string;
        const chapterTitle = formData.get('chapterTitle') as string;
        const chapterIndex = parseInt(formData.get('chapterIndex') as string);
        const pageStart  = parseInt(formData.get('pageStart') as string);
        const pageEnd    = parseInt(formData.get('pageEnd') as string);
        const fileType   = formData.get('fileType') as 'epub' | 'pdf';
        const isImageBased = formData.get('isImageBased') === 'true';

        let fileBuffer: Buffer;
        let bookName: string;

        if (filePath) {
          // LOCAL PATH MODE — read from disk each chapter (no upload needed)
          const absPath = path.resolve(filePath);
          if (!fs.existsSync(absPath)) {
            send({ type: 'error', msg: `File not found: ${absPath}` });
            controller.close();
            return;
          }
          fileBuffer = fs.readFileSync(absPath);
          bookName = path.basename(absPath);
        } else if (file) {
          // UPLOAD MODE
          const bytes = await file.arrayBuffer();
          fileBuffer = Buffer.from(bytes);
          bookName = (formData.get('bookName') as string) || file.name;
        } else {
          send({ type: 'error', msg: 'Missing required fields: filePath or file' });
          controller.close();
          return;
        }

        if (!subject || !chapterTitle) {
          send({ type: 'error', msg: 'Missing required fields: subject, chapterTitle' });
          controller.close();
          return;
        }

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
