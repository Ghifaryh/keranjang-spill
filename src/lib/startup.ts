import fs from 'node:fs';
import path from 'node:path';
import { sendTelegramMessage, getAllowedUserIds } from './telegram';

const CURRENT_VERSION = '1.1.0';

let hasNotified = false;

export async function checkAndNotifyStartup(): Promise<void> {
  if (hasNotified) return;
  hasNotified = true;

  try {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) return;

    const explicitChat = process.env.TELEGRAM_NOTIFICATION_CHAT_ID || process.env.TELEGRAM_CHAT_ID;
    const targetIds = explicitChat ? [explicitChat.trim()] : getAllowedUserIds();

    if (targetIds.length === 0) return;

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

    // Only notify if version changed or on fresh install
    if (previousVersion === CURRENT_VERSION) {
      return;
    }

    const isUpgrade = Boolean(previousVersion && previousVersion !== CURRENT_VERSION);
    const creatorName = process.env.CREATOR_NAME || 'Keranjang Spill';
    const appUrl = (process.env.APP_URL || '').replace(/\/$/, '');

    const statusHeader = isUpgrade
      ? `🚀 <b>Bot Diperbarui ke v${CURRENT_VERSION}!</b>`
      : `✨ <b>Bot Online &amp; Siap Digunakan!</b>`;

    const lines = [
      statusHeader,
      `Katalog: <b>${creatorName}</b>`,
      appUrl ? `🔗 Website: <a href="${appUrl}">${appUrl}</a>` : '',
      '',
      isUpgrade ? '🎉 <i>Fitur baru: ganti foto profil/logo langsung via chat dengan <code>/setavatar</code></i>\n' : '',
      '<b>📖 Daftar Perintah Bot:</b>',
      '• <code>Nama - Link</code> : Tambah produk nomor otomatis',
      '• <code>Nomor - Nama - Link</code> : Tambah dengan nomor khusus',
      '• <code>/edit Nomor - Nama - Link</code> : Ubah produk',
      '• <code>/delete &lt;nomor&gt;</code> : Hapus/nonaktifkan produk',
      '• <code>/setavatar</code> : Ganti foto profil/logo (kirim foto + caption)',
      '• <code>/list</code> : Lihat 10 produk terbaru & nomor berikutnya',
      '• <code>/sync</code> : Refresh data Google Sheets',
      '• <code>/help</code> : Panduan lengkap',
    ].filter(Boolean).join('\n');

    for (const chatId of targetIds) {
      try {
        await sendTelegramMessage(chatId, lines);
      } catch (err) {
        console.error('[startup-notify] Failed sending to chatId:', chatId, err);
      }
    }

    try {
      fs.writeFileSync(versionFile, CURRENT_VERSION, 'utf8');
    } catch {
      // ignore
    }
  } catch (err) {
    console.error('[startup-notify] Initialization error:', err);
  }
}
