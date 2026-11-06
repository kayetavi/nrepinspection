import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/server-auth';
import { extractGoogleDriveFileId } from '@/lib/driveBridge';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const BUCKET_NAME = 'inspection-reports';

function detectImageMime(buf: Buffer, fallbackTitle?: string, headerType?: string): string | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  ) {
    return 'image/png';
  }
  if (buf.length >= 4 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) {
    return 'image/gif';
  }
  if (
    buf.length >= 12 &&
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  ) {
    return 'image/webp';
  }
  const cleanHeader = (headerType || '').split(';')[0].trim().toLowerCase();
  if (cleanHeader.startsWith('image/')) {
    return cleanHeader;
  }
  const lower = (fallbackTitle || '').toLowerCase();
  if (lower.endsWith('.png') && buf.length > 64 && buf[0] !== 0x3c) return 'image/png';
  if ((lower.endsWith('.jpg') || lower.endsWith('.jpeg')) && buf.length > 64 && buf[0] !== 0x3c) {
    return 'image/jpeg';
  }
  return null;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const rawFileId = (searchParams.get('fileId') || '').trim();
  const rawUrl = (searchParams.get('url') || '').trim();
  const storagePath = (searchParams.get('storagePath') || '').trim();
  const title = (searchParams.get('title') || '').trim();

  // 1. Try Supabase Storage bucket first if storagePath is provided
  if (storagePath) {
    try {
      const sbAdmin = getSupabaseAdminClient();
      if (sbAdmin) {
        const { data, error } = await sbAdmin.storage.from(BUCKET_NAME).download(storagePath);
        if (!error && data) {
          const ab = await data.arrayBuffer();
          const buf = Buffer.from(ab);
          const mime = detectImageMime(buf, title, data.type) || data.type || 'image/jpeg';
          return new NextResponse(buf, {
            status: 200,
            headers: {
              'Content-Type': mime,
              'Cache-Control': 'public, max-age=3600',
            },
          });
        }
      }
    } catch {
      // Fall through to Google Drive / URL fetch
    }
  }

  // 2. Resolve Google Drive file ID from fileId or url
  const driveFileId = rawFileId || extractGoogleDriveFileId(rawUrl);
  const candidateUrls: string[] = [];

  if (driveFileId) {
    candidateUrls.push(
      `https://drive.google.com/uc?export=download&id=${encodeURIComponent(driveFileId)}`,
      `https://drive.google.com/thumbnail?id=${encodeURIComponent(driveFileId)}&sz=w2000`,
      `https://lh3.googleusercontent.com/d/${encodeURIComponent(driveFileId)}=w2000`
    );
  }
  if (rawUrl && /^https?:\/\//i.test(rawUrl)) {
    candidateUrls.push(rawUrl);
  }

  for (const targetUrl of candidateUrls) {
    try {
      const res = await fetch(targetUrl, {
        method: 'GET',
        redirect: 'follow',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        },
      });
      if (!res.ok) continue;

      const ab = await res.arrayBuffer();
      const buf = Buffer.from(ab);
      const detectedMime = detectImageMime(buf, title, res.headers.get('content-type') || '');
      if (detectedMime) {
        return new NextResponse(buf, {
          status: 200,
          headers: {
            'Content-Type': detectedMime,
            'Cache-Control': 'public, max-age=3600',
          },
        });
      }
    } catch {
      // Try next candidate URL
    }
  }

  return NextResponse.json(
    { ok: false, error: 'Unable to load direct image bytes from cloud provider.' },
    { status: 404 }
  );
}
