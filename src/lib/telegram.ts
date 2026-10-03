import { upsertProduct, getAllActiveProducts, setProductActive, detectPlatform } from './db';
import { appendProductToSheet, updateProductActiveInSheet, syncFromSheets } from './sheets';

export interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  username?: string;
}

export interface TelegramPhotoSize {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  file_size?: number;
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: {
    id: number;
    type: string;
    title?: string;
    username?: string;
  };
  date: number;
  text?: string;
  caption?: string;
  photo?: TelegramPhotoSize[];
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
}

export interface ParsedProductMessage {
  number: string;
  title: string;
  url: string;
}

export interface TelegramProcessResult {
  handled: boolean;
  authorized: boolean;
  response?: string;
}

export function parseProductMessage(rawText: string): ParsedProductMessage | null {
  const text = rawText.trim();
  if (!text) return null;

  // Pattern 1: Delimited by - or | or – (e.g., "45 - Kemeja Linen - https://s.shopee.co.id/abc")
  const delimiterPattern = /^(?:#)?([a-zA-Z0-9_\-]+)\s*(?:[-|–—]|\n)\s*(.+?)\s*(?:[-|–—]|\n)\s*(https?:\/\/[^\s]+)$/i;
  const match = text.match(delimiterPattern);
  if (match && match[1] && match[2] && match[3]) {
    return {
      number: match[1].trim(),
      title: match[2].trim(),
      url: match[3].trim(),
    };
  }

  // Pattern 2: Multiline format
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length >= 3) {
    const urlLineIdx = lines.findIndex((l) => /^https?:\/\//i.test(l));
    if (urlLineIdx >= 2) {
      const number = lines[0].replace(/^#/, '').trim();
      const title = lines.slice(1, urlLineIdx).join(' ').trim();
      const url = lines[urlLineIdx].trim();
      if (number && title && url) {
        return { number, title, url };
      }
    }
  }

  return null;
}

export async function sendTelegramMessage(
  chatId: number | string,
  text: string,
  parseMode: 'HTML' | 'Markdown' | undefined = 'HTML'
): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.warn('TELEGRAM_BOT_TOKEN not configured, skipping sendTelegramMessage');
    return false;
  }

  try {
    const body: Record<string, unknown> = {
      chat_id: chatId,
      text,
    };
    if (parseMode) {
      body.parse_mode = parseMode;
    }

    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Telegram API error (${response.status}):`, errorText);
      return false;
    }
    return true;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('Failed to send Telegram message:', msg);
    return false;
  }
}

export async function getTelegramFileUrl(fileId: string): Promise<string | null> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || !fileId) return null;

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`);
    if (!res.ok) return null;
    const data = (await res.json()) as { ok: boolean; result?: { file_path?: string } };
    if (data.ok && data.result?.file_path) {
      return `https://api.telegram.org/file/bot${token}/${data.result.file_path}`;
    }
    return null;
  } catch {
    return null;
  }
}

export async function processTelegramUpdate(update: TelegramUpdate): Promise<TelegramProcessResult> {
  const msg = update.message || update.edited_message;
  if (!msg) {
    return { handled: false, authorized: true };
  }

  const userId = msg.from?.id;
  const chatId = msg.chat.id;
  const allowedUserId = process.env.TELEGRAM_ALLOWED_USER_ID?.trim();

  // Authorization check: If allowedUserId is not configured or user does not match, reject
  if (!allowedUserId) {
    console.warn(`TELEGRAM_ALLOWED_USER_ID is not configured. Rejecting update from user ${userId}.`);
    await sendTelegramMessage(chatId, '⚠️ Bot admin belum dikonfigurasi. Silakan setel TELEGRAM_ALLOWED_USER_ID.');
    return { handled: true, authorized: false };
  }

  if (!userId || String(userId) !== allowedUserId) {
    console.warn(`Unauthorized Telegram access attempt from user ID ${userId} (chat: ${chatId})`);
    await sendTelegramMessage(chatId, '⛔ Akses ditolak. Anda tidak memiliki izin untuk mengelola keranjang spill ini.');
    return { handled: true, authorized: false };
  }
  const rawText = (msg.text || msg.caption || '').trim();

  // Command: /start or /help
  if (rawText === '/start' || rawText === '/help') {
    const helpText = `
<b>🌸 KeranjangSpill Bot Admin</b>

Halo! Bot ini digunakan untuk menambah dan mengelola produk spill di link-in-bio Anda.

<b>Cara Tambah Produk:</b>
Ketik pesan dengan format:
<code>Nomor - Nama Produk - Link</code>

<b>Contoh:</b>
<code>45 - Kemeja Oversize Linen - https://s.shopee.co.id/abc123</code>

<i>Tips: Anda juga bisa mengirim Foto produk dengan caption format di atas!</i>

<b>Daftar Perintah:</b>
• <code>/list</code> : Melihat 10 produk spill terbaru
• <code>/delete &lt;nomor&gt;</code> : Menonaktifkan produk (contoh: <code>/delete 45</code>)
• <code>/sync</code> : Refresh cache dari Google Sheets
• <code>/help</code> : Tampilkan panduan ini
    `.trim();

    await sendTelegramMessage(chatId, helpText);
    return { handled: true, authorized: true, response: 'help_sent' };
  }

  // Command: /list
  if (rawText.startsWith('/list')) {
    const products = getAllActiveProducts().slice(0, 10);
    if (products.length === 0) {
      await sendTelegramMessage(chatId, '📦 Belum ada produk aktif di keranjang spill.');
      return { handled: true, authorized: true, response: 'list_empty' };
    }

    const itemsText = products
      .map((p) => `• <b>#${p.number}</b>: ${p.title} (${p.platform || 'link'})\n  🔗 ${p.affiliate_url}`)
      .join('\n\n');

    const reply = `<b>📋 10 Produk Spill Terbaru:</b>\n\n${itemsText}`;
    await sendTelegramMessage(chatId, reply);
    return { handled: true, authorized: true, response: 'list_sent' };
  }

  // Command: /delete <number> or /hapus <number>
  if (rawText.startsWith('/delete') || rawText.startsWith('/hapus')) {
    const parts = rawText.split(/\s+/);
    const targetNumber = parts[1]?.replace(/^#/, '').trim();
    if (!targetNumber) {
      await sendTelegramMessage(chatId, '⚠️ Mohon cantumkan nomor produk.\nContoh: <code>/delete 45</code>');
      return { handled: true, authorized: true, response: 'delete_missing_number' };
    }

    const dbSuccess = setProductActive(targetNumber, 0);
    // Background sync to Google Sheets
    updateProductActiveInSheet(targetNumber, false).catch((err) => {
      console.error('Error updating Google Sheets on delete:', err);
    });

    if (dbSuccess) {
      await sendTelegramMessage(chatId, `🗑️ Produk <b>#${targetNumber}</b> berhasil dinonaktifkan.`);
    } else {
      await sendTelegramMessage(chatId, `⚠️ Produk <b>#${targetNumber}</b> tidak ditemukan di database.`);
    }
    return { handled: true, authorized: true, response: 'delete_completed' };
  }

  // Command: /sync
  if (rawText === '/sync') {
    await sendTelegramMessage(chatId, '🔄 Sedang menyinkronkan data dengan Google Sheets...');
    const syncRes = await syncFromSheets();
    if (syncRes.success) {
      await sendTelegramMessage(chatId, `✅ Sinkronisasi berhasil! <b>${syncRes.count}</b> produk diperbarui.`);
    } else {
      await sendTelegramMessage(chatId, `⚠️ Gagal sinkronisasi: ${syncRes.error || 'Unknown error'}`);
    }
    return { handled: true, authorized: true, response: 'sync_completed' };
  }

  // Parse product creation: <Number> - <Title> - <Link>
  const parsed = parseProductMessage(rawText);
  if (parsed) {
    let imageUrl = '';
    // If photos are attached, take the highest resolution photo
    if (msg.photo && msg.photo.length > 0) {
      const bestPhoto = msg.photo[msg.photo.length - 1];
      const photoUrl = await getTelegramFileUrl(bestPhoto.file_id);
      if (photoUrl) {
        imageUrl = photoUrl;
      }
    }

    const platform = detectPlatform(parsed.url);
    const appUrl = (process.env.APP_URL || '').replace(/\/$/, '');
    const shortUrl = appUrl ? `${appUrl}/go/${parsed.number}` : `/go/${parsed.number}`;

    // 1. Immediately update local SQLite database
    upsertProduct({
      number: parsed.number,
      title: parsed.title,
      affiliate_url: parsed.url,
      image_url: imageUrl,
      platform,
      active: 1,
    });

    // 2. Append to Google Sheets asynchronously (non-blocking for fast creator feedback)
    appendProductToSheet({
      number: parsed.number,
      title: parsed.title,
      affiliateUrl: parsed.url,
      imageUrl,
    }).catch((err) => {
      console.error('Failed to append to Google Sheets:', err);
    });

    // 3. Send confirmation to creator
    const confirmationText = `
✅ <b>Produk #${parsed.number} berhasil ditambahkan!</b>

<b>Judul:</b> ${parsed.title}
<b>Platform:</b> ${platform.toUpperCase()}
<b>Link Spill:</b> <code>${shortUrl}</code>
<b>Target:</b> ${parsed.url}
    `.trim();

    await sendTelegramMessage(chatId, confirmationText);
    return { handled: true, authorized: true, response: 'product_added' };
  }

  // If text is not recognized
  await sendTelegramMessage(
    chatId,
    `⚠️ Format pesan tidak dikenali.\n\nGunakan format:\n<code>Nomor - Nama Produk - Link</code>\n\nAtau ketik <code>/help</code> untuk panduan.`
  );
  return { handled: true, authorized: true, response: 'unknown_format' };
}
