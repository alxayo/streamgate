import { NextResponse } from 'next/server';
import { getSession } from '@/lib/admin-session';

export async function POST() {
  const session = await getSession();
  session.destroy();

  return NextResponse.json({ data: { success: true } });
}
