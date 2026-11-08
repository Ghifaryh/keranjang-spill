import type { APIRoute } from 'astro';
import { syncFromSheets } from '../../lib/sheets';
import { isConfiguredSecret, timingSafeEqualStr } from '../../lib/security';

export const prerender = false;

export const ALL: APIRoute = async ({ request }) => {
  const url = new URL(request.url);
  const authHeader = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();
  const headerSecret = request.headers.get('x-sync-secret')?.trim();
  const secretQuery = url.searchParams.get('secret')?.trim();
  const expectedSecret = process.env.SYNC_SECRET;
  const isProd = process.env.NODE_ENV === 'production';

  if (isConfiguredSecret(expectedSecret)) {
    const cleanExpected = expectedSecret.trim();
    const isAuthorized =
      timingSafeEqualStr(authHeader, cleanExpected) ||
      timingSafeEqualStr(headerSecret, cleanExpected) ||
      (!isProd && timingSafeEqualStr(secretQuery, cleanExpected));

    if (!isAuthorized) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  } else if (isProd) {
    console.error('SECURITY BLOCK: SYNC_SECRET must be configured in production.');
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
      error: result.success ? undefined : isProd ? 'Sync failed' : result.error,
      timestamp: new Date().toISOString(),
    }),
    {
      status: result.success ? 200 : 500,
      headers: { 'Content-Type': 'application/json' },
    }
  );
};
