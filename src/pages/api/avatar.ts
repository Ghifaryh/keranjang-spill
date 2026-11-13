import type { APIRoute } from 'astro';
import fs from 'node:fs';
import path from 'node:path';

export const prerender = false;

const MIME_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

export const GET: APIRoute = async () => {
  const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'keranjang.db');
  const dataDir = path.dirname(dbPath);

  for (const ext of ['jpg', 'jpeg', 'png', 'webp']) {
    const filePath = path.join(dataDir, `avatar.${ext}`);
    if (fs.existsSync(filePath)) {
      try {
        const fileBuffer = fs.readFileSync(filePath);
        return new Response(fileBuffer, {
          status: 200,
          headers: {
            'Content-Type': MIME_TYPES[ext] || 'image/jpeg',
            'Cache-Control': 'public, max-age=60, stale-while-revalidate=300',
            'X-Content-Type-Options': 'nosniff',
          },
        });
      } catch (err) {
        console.error('Error reading avatar file:', err);
      }
    }
  }

  // Fallback redirect to default env avatar
  const defaultUrl = process.env.CREATOR_AVATAR || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200&auto=format&fit=crop&q=80';
  return new Response(null, {
    status: 302,
    headers: {
      Location: defaultUrl,
      'Cache-Control': 'no-cache',
    },
  });
};
