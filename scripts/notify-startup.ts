import fs from 'node:fs';
import path from 'node:path';
import { sendTelegramMessage, getAllowedUserIds } from '../src/lib/telegram';

const CURRENT_VERSION = '1.1.0';

const COMMANDS_SUMMARY = [
  '<b>📖 Daftar Perintah Bot:</b>',
  '• <code>Nama - Link</code> : Tambah produk nomor otomatis',
  '• <code>Nomor - Nama - Link</code> : Tambah dengan nomor khusus',
  '• <code>/edit Nomor - Nama - Link</code> : Ubah produk',
  '• <code>/delete &lt;nomor&gt;</code> : Hapus/nonaktifkan produk',
  '• <code>/setavatar</code> : Ganti foto profil/logo (kirim foto + caption)',
  '• <code>/list</code> : Lihat 10 produk terbaru & nomor berikutnya',
  '• <code>/sync</code> : Refresh data Google Sheets',
  '• <code>/help</code> : Panduan lengkap',
].join('\n');

async function main() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.log('[notify-startup] TELEGRAM_BOT_TOKEN not configured, skipping startup message.');
    process.exit(0);
  }

  // Recipients: TELEGRAM_NOTIFICATION_CHAT_ID, or TELEGRAM_CHAT_ID, or all allowed admin user IDs
  const explicitChat = process.env.TELEGRAM_NOTIFICATION_CHAT_ID || process.env.TELEGRAM_CHAT_ID;
  const targetIds = explicitChat
    ? [explicitChat.trim()]
    : getAllowedUserIds();

  if (targetIds.length === 0) {
    console.log('[notify-startup] No recipient chat ID configured, skipping startup message.');
    process.exit(0);
  }

  // Version tracking in data volume to detect new commands / version upgrades
  const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'keranjang.db');
  const dataDir = path.dirname(dbPath);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const versionFile = path.join(dataDir, '.bot_version');
  let previousVersion = '';
  if (fs.existsSync(versionFile)) {
    try {
      previousVersion = fs.readFileSync(versionFile, 'utf8').trim();
    } catch {
      // ignore
    }
  }

  const isUpgrade = Boolean(previousVersion && previousVersion !== CURRENT_VERSION);
  const isFirstRun = !previousVersion;

  // Build message
  const creatorName = process.env.CREATOR_NAME || 'Keranjang Spill';
  const rawAppUrl = (process.env.APP_URL || '').replace(/\/$/, '');
  const appUrl = (!rawAppUrl || rawAppUrl.includes('localhost') || rawAppUrl.includes('127.0.0.1'))
    ? 'https://spill.gehu.me'
    : rawAppUrl;

  let statusHeader = isUpgrade
    ? `🚀 <b>Bot Diperbarui ke v${CURRENT_VERSION}!</b>`
    : `✨ <b>Bot Online &amp; Siap Digunakan!</b>`;

  const lines = [
    statusHeader,
    `Katalog: <b>${creatorName}</b>`,
    appUrl ? `🔗 Website: <a href="${appUrl}">${appUrl}</a>` : '',
    '',
  ];

  // Include commands list if version changed or on fresh install
  if (isFirstRun || isUpgrade) {
    if (isUpgrade) {
      lines.push('🎉 <i>Fitur baru ditambahkan (ganti foto profil via <code>/setavatar</code>).</i>', '');
    }
    lines.push(COMMANDS_SUMMARY);
  } else {
    lines.push('<i>Sistem siap menerima produk spill baru kapan saja.</i>');
  }

  const messageText = lines.filter((l) => l !== undefined).join('\n').trim();

  for (const chatId of targetIds) {
    try {
      await sendTelegramMessage(chatId, messageText);
      console.log(`[notify-startup] Sent startup notification to ${chatId}`);
    } catch (err) {
      console.error(`[notify-startup] Failed to send notification to ${chatId}:`, err);
    }
  }

  // Save current version
  try {
    fs.writeFileSync(versionFile, CURRENT_VERSION, 'utf8');
  } catch (err) {
    console.error('[notify-startup] Failed to write version file:', err);
  }
}

main().catch((err) => {
  console.error('[notify-startup] Error:', err);
});
