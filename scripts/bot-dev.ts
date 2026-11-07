import fs from 'node:fs';
import path from 'node:path';
import { processTelegramUpdate, type TelegramUpdate } from '../src/lib/telegram';

const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
let allowedId = process.env.TELEGRAM_ALLOWED_USER_ID?.trim();

if (!token) {
  console.error('\n❌ TELEGRAM_BOT_TOKEN is empty in your .env file!');
  console.error('👉 1. Message @BotFather on Telegram -> /newbot');
  console.error('👉 2. Paste the token into .env as TELEGRAM_BOT_TOKEN=...\n');
  process.exit(1);
}

function saveAllowedUserIdToEnv(userId: number): void {
  const envPath = path.join(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, 'utf-8');
  const updated = content.replace(/^TELEGRAM_ALLOWED_USER_ID=.*$/m, `TELEGRAM_ALLOWED_USER_ID=${userId}`);
  fs.writeFileSync(envPath, updated, 'utf-8');
}

async function startPolling(): Promise<void> {
  console.log('====================================================');
  console.log('   🤖 KERANJANGSPILL LOCAL TELEGRAM BOT POLLER');
  console.log('====================================================');

  // Verify bot identity
  const meRes = await fetch(`https://api.telegram.org/bot${token}/getMe`);
  const meData = (await meRes.json()) as { ok: boolean; result?: { username?: string; first_name?: string } };
  if (!meData.ok) {
    console.error('❌ Invalid TELEGRAM_BOT_TOKEN! Telegram API rejected the token.');
    process.exit(1);
  }

  console.log(`✅ Connected as: ${meData.result?.first_name} (@${meData.result?.username})`);
  console.log(
    `👤 Allowed Admin User ID: ${allowedId || '(Waiting for your first message to auto-register your ID...)'}`
  );

  // Remove any active webhook so getUpdates works locally
  await fetch(`https://api.telegram.org/bot${token}/deleteWebhook`);
  console.log('📡 Listening for messages from Telegram... (Send /start to your bot now!)\n');

  let offset = 0;

  while (true) {
    try {
      const res = await fetch(
        `https://api.telegram.org/bot${token}/getUpdates?offset=${offset}&timeout=20`,
        { signal: AbortSignal.timeout(30000) }
      );
      const data = (await res.json()) as { ok: boolean; result?: TelegramUpdate[] };

      if (data.ok && Array.isArray(data.result)) {
        for (const update of data.result) {
          offset = update.update_id + 1;
          const msg = update.message || update.edited_message;
          const fromId = msg?.from?.id;
          const fromName = msg?.from?.first_name || 'Unknown';
          const text = msg?.text || msg?.caption || '';

          console.log(`📩 [${fromName} | ID: ${fromId}]: ${text}`);

          if (!allowedId && fromId) {
            allowedId = String(fromId);
            process.env.TELEGRAM_ALLOWED_USER_ID = allowedId;
            saveAllowedUserIdToEnv(fromId);
            console.log(`✨ Auto-registered your Telegram User ID (${fromId}) into .env!`);
          }

          const result = await processTelegramUpdate(update);
          console.log(
            `   ↳ Handled: ${result.handled} | Authorized: ${result.authorized} | Action: ${result.response || 'none'}\n`
          );
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes('aborted')) {
        console.error('Polling error (retrying in 3s):', msg);
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  }
}

startPolling();
