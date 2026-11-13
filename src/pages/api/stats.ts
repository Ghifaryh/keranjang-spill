import type { APIRoute } from 'astro';
import { getClicksSummary } from '../../lib/db';
import { isConfiguredSecret, timingSafeEqualStr } from '../../lib/security';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const url = new URL(request.url);
  const authHeader = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();
  const headerSecret = request.headers.get('x-stats-secret')?.trim();
  const querySecret = url.searchParams.get('secret')?.trim();
  const expectedSecret = process.env.STATS_SECRET || process.env.SYNC_SECRET;
  const isProd = process.env.NODE_ENV === 'production';

  // Require secret in production; allow local/dev if unconfigured
  if (isConfiguredSecret(expectedSecret)) {
    const cleanExpected = expectedSecret.trim();
    const isAuthorized =
      timingSafeEqualStr(authHeader, cleanExpected) ||
      timingSafeEqualStr(headerSecret, cleanExpected) ||
      timingSafeEqualStr(querySecret, cleanExpected);

    if (!isAuthorized) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  } else if (isProd) {
    return new Response(JSON.stringify({ error: 'Stats secret not configured' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const summary = getClicksSummary();

  return new Response(JSON.stringify({ ok: true, data: summary }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
