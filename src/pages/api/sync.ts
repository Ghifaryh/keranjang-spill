import type { APIRoute } from 'astro';
import { syncFromSheets } from '../../lib/sheets';

export const prerender = false;

export const ALL: APIRoute = async ({ request }) => {
  const url = new URL(request.url);
  const authHeader = request.headers.get('authorization')?.replace('Bearer ', '');
  const secretQuery = url.searchParams.get('secret');
  const expectedSecret = process.env.SYNC_SECRET;

  if (expectedSecret && authHeader !== expectedSecret && secretQuery !== expectedSecret) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const result = await syncFromSheets();

  return new Response(
    JSON.stringify({
      success: result.success,
      synced: result.count,
      error: result.error,
      timestamp: new Date().toISOString(),
    }),
    {
      status: result.success ? 200 : 500,
      headers: { 'Content-Type': 'application/json' },
    }
  );
};
