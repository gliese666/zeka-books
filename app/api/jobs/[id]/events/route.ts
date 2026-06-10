/**
 * GET /api/jobs/[id]/events?after=<id>
 * Инкрементальный живой лог: события с id > after (курсор поллинга дашборда).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getEventsSince } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const after = parseInt(req.nextUrl.searchParams.get('after') ?? '0', 10) || 0;
  const events = await getEventsSince(id, after);
  return NextResponse.json({ events });
}
