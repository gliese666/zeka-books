/**
 * GET /api/local-books
 * Lists all books in Books Labs folder on local disk.
 * Only works when running locally (npm run dev).
 */

import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

const BOOKS_LABS = '/Users/akram/Library/Mobile Documents/iCloud~md~obsidian/Documents/My Obsidian/Books Labs';

export interface LocalBook {
  folder: string;       // "История Азербайджана 9 рус"
  subject: string;      // "История Азербайджана 9"
  filePath: string;     // absolute path to the raw file
  fileName: string;     // "История_Азербайджана_9_ru.epub"
  fileType: 'epub' | 'pdf';
  sizeMb: number;
  ragReadyCount: number; // processed chapters already in 01_RAG_Ready
}

export async function GET() {
  // Only available locally
  if (!fs.existsSync(BOOKS_LABS)) {
    return NextResponse.json({ error: 'Books Labs not found (only available locally)', books: [] });
  }

  const books: LocalBook[] = [];

  try {
    const folders = fs.readdirSync(BOOKS_LABS).filter(f => {
      const full = path.join(BOOKS_LABS, f);
      return fs.statSync(full).isDirectory() && !f.startsWith('.');
    });

    for (const folder of folders) {
      const rawDir = path.join(BOOKS_LABS, folder, '00_Raw');
      const ragDir = path.join(BOOKS_LABS, folder, '01_RAG_Ready');

      if (!fs.existsSync(rawDir)) continue;

      const rawFiles = fs.readdirSync(rawDir).filter(f =>
        f.toLowerCase().endsWith('.epub') || f.toLowerCase().endsWith('.pdf')
      );

      if (!rawFiles.length) continue;

      const fileName = rawFiles[0];
      const filePath = path.join(rawDir, fileName);
      const stat = fs.statSync(filePath);
      const fileType = fileName.toLowerCase().endsWith('.epub') ? 'epub' : 'pdf';

      // Count processed chapters
      const ragReadyCount = fs.existsSync(ragDir)
        ? fs.readdirSync(ragDir).filter(f => f.endsWith('.md')).length
        : 0;

      // Derive subject: folder name minus language suffix (рус/aze)
      const subject = folder.replace(/\s+(рус|aze|ru|az)$/i, '').trim();

      books.push({
        folder,
        subject,
        filePath,
        fileName,
        fileType,
        sizeMb: Math.round(stat.size / 1024 / 1024 * 10) / 10,
        ragReadyCount,
      });
    }
  } catch (e) {
    return NextResponse.json({ error: String(e), books: [] });
  }

  return NextResponse.json({ books });
}
