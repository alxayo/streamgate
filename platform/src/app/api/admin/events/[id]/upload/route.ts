// =========================================================================
// Admin Upload Status — GET /api/admin/events/:id/upload
// =========================================================================
// Same data as the creator endpoint, but accessible to any admin with the
// "events:manage" permission. No channel-ownership check is needed because
// admins may inspect any event.
//
// Auth: Admin session cookie + events:manage permission.
//
// Response shape:
//   { data: { upload: UploadWithJobs | null } }
//   - null when no upload exists for this event yet
//   - Includes jobs[] array with per-codec status and progress
// =========================================================================

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkPermission } from '@/lib/require-permission';

// Next.js 14+ dynamic route params are delivered as a Promise
interface RouteParams {
  params: Promise<{ id: string }>;
}

// ── GET handler ─────────────────────────────────────────────────────────
export async function GET(_request: NextRequest, { params }: RouteParams) {
  // 1. Authenticate — requires admin session with events:manage permission.
  //    checkPermission returns a NextResponse (401/403) when denied, or null
  //    when the caller is authorised.
  const denied = await checkPermission('events:view');
  if (denied) return denied;

  // 2. Extract the event ID from the URL path
  const { id } = await params;

  // 3. Look up the event — admins can access any event, so no channel filter.
  const event = await prisma.event.findUnique({
    where: { id },
    select: { id: true },
  });

  if (!event) {
    return NextResponse.json({ error: 'Event not found' }, { status: 404 });
  }

  // 4. Fetch the upload (if any) together with its per-codec transcode jobs.
  //    An event may have zero or one upload (the relation is @unique on eventId).
  const upload = await prisma.upload.findUnique({
    where: { eventId: event.id },
    include: {
      transcodeJobs: {
        orderBy: { codec: 'asc' },
        select: {
          id: true,
          codec: true,
          status: true,
          progress: true,
          errorMessage: true,
          startedAt: true,
          completedAt: true,
        },
      },
    },
  });

  // 5. Serialise — BigInt values (fileSize) are not natively JSON-serialisable,
  //    so we convert fileSize to a string before returning.
  const serialised = upload
    ? { ...upload, fileSize: upload.fileSize.toString() }
    : null;

  return NextResponse.json({ data: { upload: serialised } });
}
