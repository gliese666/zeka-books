/**
 * GET /api/local-books
 * Lists all books in Books Labs folder on local disk.
 * Only works when running locally (npm run dev).
 * ragReadyCount = chunk count from Supabase (not disk md files),
 * so books processed via web UI show the correct status.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
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
  ragReadyCount: number; // chunk count from Supabase (0 = not processed yet)
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

      if (!fs.existsSync(rawDir)) continue;

      const rawFiles = fs.readdirSync(rawDir).filter(f =>
        f.toLowerCase().endsWith('.epub') || f.toLowerCase().endsWith('.pdf')
      );

      if (!rawFiles.length) continue;

      const fileName = rawFiles[0];
      const filePath = path.join(rawDir, fileName);
      const stat = fs.statSync(filePath);
      const fileType = fileName.toLowerCase().endsWith('.epub') ? 'epub' : 'pdf';

      // Derive subject: folder name minus language suffix (рус/aze/ru/az)
      const subject = folder.replace(/\s+(рус|aze|ru|az)$/i, '').trim();

      books.push({
        folder,
        subject,
        filePath,
        fileName,
        fileType,
        sizeMb: Math.round(stat.size / 1024 / 1024 * 10) / 10,
        ragReadyCount: 0, // will be filled from Supabase below
      });
    }
  } catch (e) {
    return NextResponse.json({ error: String(e), books: [] });
  }

  // Enrich with Supabase chunk counts
  // NOTE: subject stored in Supabase may be either the stripped name ("Coğrafiya 11")
  // or the full folder name ("Coğrafiya 11 aze") depending on how processing was done.
  // We check BOTH and take whichever has data.
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Collect all possible lookup keys: stripped subject + full folder name
    const allKeys = [...new Set(books.flatMap(b => [b.subject, b.folder]))];

    if (allKeys.length > 0) {
      const { data } = await supabase
        .from('dim_textbooks_vector')
        .select('subject')
        .in('subject', allKeys);

      if (data) {
        const countMap: Record<string, number> = {};
        for (const row of data) {
          countMap[row.subject] = (countMap[row.subject] ?? 0) + 1;
        }
        for (const book of books) {
          // Use only the normalized subject (canonical key), never add folder name on top
          // Fallback to folder name only when canonical subject has 0 (migration period)
          const bySubject = countMap[book.subject] ?? 0;
          const byFolder  = countMap[book.folder]  ?? 0;
          book.ragReadyCount = bySubject > 0 ? bySubject : byFolder;
        }
      }
    }
  } catch {
    // Supabase unavailable — fall back to 0 counts (non-fatal)
  }

  return NextResponse.json({ books });
}
