import type { APIRoute } from 'astro';
import { processTelegramUpdate, type TelegramUpdate } from '../../lib/telegram';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  // Secret token verification (if configured in setWebhook)
  const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (webhookSecret) {
    const receivedSecret = request.headers.get('x-telegram-bot-api-secret-token');
    if (receivedSecret !== webhookSecret) {
      return new Response(JSON.stringify({ error: 'Invalid webhook secret' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  try {
    const body = (await request.json()) as TelegramUpdate;
    if (!body || typeof body !== 'object') {
      return new Response(JSON.stringify({ error: 'Invalid payload' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const result = await processTelegramUpdate(body);

    if (!result.authorized) {
      return new Response(JSON.stringify({ error: 'Unauthorized Telegram user' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ ok: true, handled: result.handled, response: result.response }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('Error handling Telegram webhook:', msg);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

export const GET: APIRoute = async () => {
  return new Response(JSON.stringify({ status: 'Telegram webhook endpoint active' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
