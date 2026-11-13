import fs from 'node:fs';
import path from 'node:path';
import {
  upsertProduct,
  getAllActiveProducts,
  getProductByNumber,
  getNextProductNumber,
  setProductActive,
  detectPlatform,
} from './db';
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
  reply_to_message?: TelegramMessage;
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
  autoNumber?: boolean;
  isExplicitEdit?: boolean;
}

export interface TelegramProcessResult {
  handled: boolean;
  authorized: boolean;
  response?: string;
}

export function getAllowedUserIds(): string[] {
  const raw = [process.env.TELEGRAM_ALLOWED_USER_ID, process.env.TELEGRAM_ALLOWED_USER_IDS]
    .filter(Boolean)
    .join(',');
  return raw
    .split(/[,;\s]+/)
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
}

export function parseProductMessage(rawText: string): ParsedProductMessage | null {
  const trimmed = rawText.trim();
  if (!trimmed) return null;

  const isExplicitEdit = /^\/(?:edit|update|ubah)\s+/i.test(trimmed);
  const text = trimmed.replace(/^\/(?:edit|update|ubah|add|tambah)\s+/i, '').trim();
  if (!text) return null;

  // Pattern 1: 3-part with explicit number (`45 - Kemeja Linen - https://s.shopee.co.id/abc`)
  const threePartPattern =
    /^(?:#)?([a-zA-Z0-9_\-]+)\s*(?:[-|–—]|\n)\s*(.+?)\s*(?:[-|–—]|\n)\s*(https?:\/\/[^\s]+)$/i;
  const match3 = text.match(threePartPattern);
  if (match3 && match3[1] && match3[2] && match3[3]) {
    return {
      number: match3[1].trim(),
      title: match3[2].trim(),
      url: match3[3].trim(),
      autoNumber: false,
      isExplicitEdit,
    };
  }

  // Pattern 2: 2-part WITHOUT number (`Tas Selempang Kulit Vintage - https://s.shopee.co.id/demo99`)
  const twoPartPattern = /^(.+?)\s*(?:[-|–—]|\n)\s*(https?:\/\/[^\s]+)$/i;
  const match2 = text.match(twoPartPattern);
  if (match2 && match2[1] && match2[2]) {
    const candidateTitle = match2[1].trim();
    if (candidateTitle && !/^https?:\/\//i.test(candidateTitle)) {
      return {
        number: '',
        title: candidateTitle,
        url: match2[2].trim(),
        autoNumber: true,
        isExplicitEdit,
      };
    }
  }

  // Pattern 3: Multiline format (3+ lines or 2 lines)
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length >= 2) {
    const urlLineIdx = lines.findIndex((l) => /^https?:\/\//i.test(l));
    if (urlLineIdx >= 2) {
      const number = lines[0].replace(/^#/, '').trim();
      const title = lines.slice(1, urlLineIdx).join(' ').trim();
      const url = lines[urlLineIdx].trim();
      if (number && title && url) {
        return { number, title, url, autoNumber: false, isExplicitEdit };
      }
    } else if (urlLineIdx === 1) {
      const title = lines[0].trim();
      const url = lines[1].trim();
      if (title && url) {
        return { number: '', title, url, autoNumber: true, isExplicitEdit };
      }
    }
  }

  return null;
}

export function diagnoseParseError(rawText: string): string {
  const text = rawText.trim();
  const hasUrl = /https?:\/\/[^\s]+/i.test(text);
  const isOnlyUrl = /^https?:\/\/[^\s]+$/i.test(text);

  if (isOnlyUrl) {
    return [
      '⚠️ <b>Gagal: Nama produk belum diisi!</b>',
      'Anda baru mengirim link saja tanpa nama produk.',
      '',
      '💡 <b>Contoh yang benar:</b>',
      `<code>Tas Selempang Kulit - ${text}</code>`,
    ].join('\n');
  }

  if (!hasUrl) {
    return [
      '⚠️ <b>Gagal: Link produk tidak ditemukan!</b>',
      'Pastikan pesan menyertakan link toko yang lengkap (diawali <code>https://</code>).',
      '',
      '💡 <b>Contoh yang benar:</b>',
      '<code>Tas Selempang Kulit - https://s.shopee.co.id/abc123</code>',
    ].join('\n');
  }

  return [
    '⚠️ <b>Gagal: Format pemisah belum sesuai!</b>',
    'Gunakan tanda strip (<code> - </code>) atau baris baru untuk memisahkan Nama Produk dan Link.',
    '',
    '💡 <b>Contoh (Nomor Otomatis):</b>',
    '<code>Nama Produk - https://s.shopee.co.id/abc123</code>',
    '',
    '💡 <b>Contoh (Pilih Nomor Sendiri):</b>',
    '<code>45 - Nama Produk - https://s.shopee.co.id/abc123</code>',
  ].join('\n');
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
  const trimmedId = fileId?.trim() || '';
  if (!/^[A-Za-z0-9_-]{5,256}$/.test(trimmedId)) {
    return null;
  }
  // Return internal proxy path so TELEGRAM_BOT_TOKEN is never exposed in HTML or Google Sheets
  return `/api/tg-photo/${encodeURIComponent(trimmedId)}`;
}

export async function fetchTelegramPhotoResponse(fileId: string): Promise<Response | null> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const trimmedId = fileId?.trim() || '';
  if (!token || !/^[A-Za-z0-9_-]{5,256}$/.test(trimmedId)) {
    return null;
  }

  try {
    const metaRes = await fetch(
      `https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(trimmedId)}`
    );
    if (!metaRes.ok) return null;
    const data = (await metaRes.json()) as { ok: boolean; result?: { file_path?: string } };
    const filePath = data.result?.file_path;
    if (!data.ok || !filePath || filePath.includes('..')) {
      return null;
    }

    const fileRes = await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`);
    if (!fileRes.ok || !fileRes.body) return null;

    const contentType = fileRes.headers.get('content-type') || 'image/jpeg';
    const safeContentType = contentType.startsWith('image/') ? contentType : 'image/jpeg';

    return new Response(fileRes.body, {
      status: 200,
      headers: {
        'Content-Type': safeContentType,
        'Cache-Control': 'public, max-age=86400, immutable',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return null;
  }
}

export async function downloadTelegramPhotoBuffer(fileId: string): Promise<{ buffer: Buffer; contentType: string } | null> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const trimmedId = fileId?.trim() || '';
  if (!token || !/^[A-Za-z0-9_-]{5,256}$/.test(trimmedId)) {
    return null;
  }

  try {
    const metaRes = await fetch(
      `https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(trimmedId)}`
    );
    if (!metaRes.ok) return null;
    const data = (await metaRes.json()) as { ok: boolean; result?: { file_path?: string } };
    const filePath = data.result?.file_path;
    if (!data.ok || !filePath || filePath.includes('..')) {
      return null;
    }

    const fileRes = await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`);
    if (!fileRes.ok) return null;

    const arrayBuf = await fileRes.arrayBuffer();
    const contentType = fileRes.headers.get('content-type') || 'image/jpeg';
    return {
      buffer: Buffer.from(arrayBuf),
      contentType: contentType.startsWith('image/') ? contentType : 'image/jpeg',
    };
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
  const allowedIds = getAllowedUserIds();

  // Authorization check: Supports 1 or multiple comma-separated Telegram User IDs (e.g. husband + wife)
  if (allowedIds.length === 0) {
    console.warn(`TELEGRAM_ALLOWED_USER_ID is not configured. Rejecting update from user ${userId}.`);
    await sendTelegramMessage(
      chatId,
      '⛔ <b>Akses ditolak.</b> Bot ini bersifat privat dan belum mengizinkan akses publik.'
    );
    return { handled: true, authorized: false };
  }

  if (!userId || !allowedIds.includes(String(userId))) {
    console.warn(`Unauthorized Telegram access attempt from user ID ${userId} (chat: ${chatId})`);
    await sendTelegramMessage(
      chatId,
      '⛔ <b>Akses ditolak.</b> Akun Telegram Anda tidak terdaftar sebagai admin.'
    );
    return { handled: true, authorized: false };
  }

  const rawText = (msg.text || msg.caption || '').trim();

  // Command: /start or /help
  if (rawText === '/start' || rawText === '/help') {
    const nextNum = getNextProductNumber();
    const helpText = `
<b>🌸 KeranjangSpill Bot Admin</b>

Halo! Berikut cara menambah produk ke katalog Anda:

<b>1️⃣ Cara Cepat (Nomor Otomatis — #${nextNum}):</b>
Cukup kirim nama barang dan link tanpa nomor:
<code>Nama Produk - Link</code>
Contoh:
<code>Tas Selempang Kulit - https://s.shopee.co.id/abc123</code>

<b>2️⃣ Pilih Nomor Sendiri:</b>
<code>Nomor - Nama Produk - Link</code>
Contoh:
<code>45 - Kemeja Oversize Linen - https://s.shopee.co.id/abc123</code>

<b>3️⃣ Ubah Produk yang Sudah Ada:</b>
<code>/edit Nomor - Nama Baru - Link</code>

<i>Tips: Bisa juga kirim Foto produk dengan caption di atas!</i>

<b>Daftar Perintah:</b>
• <code>/list</code> : Lihat 10 produk terbaru &amp; nomor berikutnya
• <code>/edit &lt;no&gt; - &lt;nama&gt; - &lt;link&gt;</code> : Update produk
• <code>/delete &lt;nomor&gt;</code> : Hapus produk (mis. <code>/delete 45</code>)
• <code>/setavatar</code> : Ganti foto profil/logo (kirim foto + caption <code>/setavatar</code>)
• <code>/sync</code> : Refresh cache dari Google Sheets
• <code>/help</code> : Tampilkan panduan ini
    `.trim();

    await sendTelegramMessage(chatId, helpText);
    return { handled: true, authorized: true, response: 'help_sent' };
  }

  // Command: /list
  if (rawText.startsWith('/list')) {
    const products = getAllActiveProducts().slice(0, 10);
    const nextNum = getNextProductNumber();
    if (products.length === 0) {
      await sendTelegramMessage(chatId, '📦 Belum ada produk aktif di keranjang spill.');
      return { handled: true, authorized: true, response: 'list_empty' };
    }

    const itemsText = products
      .map((p) => `• <b>#${p.number}</b>: ${p.title} (${p.platform || 'link'})\n  🔗 ${p.affiliate_url}`)
      .join('\n\n');

    const reply = `<b>📋 10 Produk Spill Terbaru:</b>\n\n${itemsText}\n\n💡 <i>Nomor otomatis berikutnya: <b>#${nextNum}</b></i>`;
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

  // Command: /setavatar or /avatar (handles photo with caption or replied photo)
  if (rawText.startsWith('/setavatar') || rawText.startsWith('/avatar')) {
    let photoFileId = '';
    if (msg.photo && msg.photo.length > 0) {
      photoFileId = msg.photo[msg.photo.length - 1].file_id;
    } else if (msg.reply_to_message?.photo && msg.reply_to_message.photo.length > 0) {
      photoFileId = msg.reply_to_message.photo[msg.reply_to_message.photo.length - 1].file_id;
    }

    if (!photoFileId) {
      await sendTelegramMessage(
        chatId,
        '⚠️ <b>Foto tidak ditemukan!</b>\n\nKirim foto dengan caption <code>/setavatar</code> atau balas (reply) foto yang sudah ada dengan <code>/setavatar</code>.'
      );
      return { handled: true, authorized: true, response: 'avatar_missing_photo' };
    }

    const downloaded = await downloadTelegramPhotoBuffer(photoFileId);
    if (!downloaded) {
      await sendTelegramMessage(chatId, '❌ Gagal mengunduh foto dari Telegram. Silakan coba lagi.');
      return { handled: true, authorized: true, response: 'avatar_download_failed' };
    }

    try {
      const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'keranjang.db');
      const dataDir = path.dirname(dbPath);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }

      // Remove existing avatar extensions
      for (const ext of ['jpg', 'jpeg', 'png', 'webp']) {
        const oldFile = path.join(dataDir, `avatar.${ext}`);
        if (fs.existsSync(oldFile)) {
          fs.unlinkSync(oldFile);
        }
      }

      const targetPath = path.join(dataDir, 'avatar.jpg');
      fs.writeFileSync(targetPath, downloaded.buffer);

      await sendTelegramMessage(
        chatId,
        '✨ <b>Foto profil/logo berhasil diubah!</b>\nFoto terbaru langsung aktif di halaman web Anda.'
      );
      return { handled: true, authorized: true, response: 'avatar_updated' };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error('Error saving avatar:', errorMsg);
      await sendTelegramMessage(chatId, `❌ Gagal menyimpan foto avatar: ${errorMsg}`);
      return { handled: true, authorized: true, response: 'avatar_save_failed' };
    }
  }

  // Parse product creation or edit
  const parsed = parseProductMessage(rawText);
  if (parsed) {
    const isAutoAssigned = Boolean(parsed.autoNumber || !parsed.number);
    const finalNumber = isAutoAssigned ? getNextProductNumber() : parsed.number;
    const existingProduct = !isAutoAssigned ? getProductByNumber(finalNumber) : null;

    // Prevent accidental collision unless user explicitly sent /edit
    if (existingProduct && !parsed.isExplicitEdit) {
      const nextAvailable = getNextProductNumber();
      const collisionMsg = [
        `⚠️ <b>Gagal: Nomor #${finalNumber} sudah terdaftar!</b>`,
        `📦 Produk saat ini: <b>${existingProduct.title}</b>`,
        `🔗 ${existingProduct.affiliate_url}`,
        '',
        '💡 <b>Solusi:</b>',
        `1️⃣ Kirim tanpa nomor agar otomatis mendapat <b>#${nextAvailable}</b>:`,
        `<code>${parsed.title} - ${parsed.url}</code>`,
        '',
        `2️⃣ Atau jika ingin menimpa produk #${finalNumber}, gunakan perintah <code>/edit</code>:`,
        `<code>/edit ${finalNumber} - ${parsed.title} - ${parsed.url}</code>`,
      ].join('\n');

      await sendTelegramMessage(chatId, collisionMsg);
      return { handled: true, authorized: true, response: 'collision_blocked' };
    }

    let imageUrl = '';
    if (msg.photo && msg.photo.length > 0) {
      const bestPhoto = msg.photo[msg.photo.length - 1];
      const photoUrl = await getTelegramFileUrl(bestPhoto.file_id);
      if (photoUrl) {
        imageUrl = photoUrl;
      }
    }

    const platform = detectPlatform(parsed.url);
    const rawAppUrl = (process.env.APP_URL || '').replace(/\/$/, '');
    const appUrl = (!rawAppUrl || rawAppUrl.includes('localhost') || rawAppUrl.includes('127.0.0.1'))
      ? 'https://spill.gehu.me'
      : rawAppUrl;
    const shortUrl = `${appUrl}/go/${finalNumber}`;

    // 1. Immediately update local SQLite database
    upsertProduct({
      number: finalNumber,
      title: parsed.title,
      affiliate_url: parsed.url,
      image_url: imageUrl,
      platform,
      active: 1,
    });

    // 2. Append to Google Sheets asynchronously (non-blocking for fast creator feedback)
    appendProductToSheet({
      number: finalNumber,
      title: parsed.title,
      affiliateUrl: parsed.url,
      imageUrl,
    }).catch((err) => {
      console.error('Failed to append to Google Sheets:', err);
    });

    // 3. Send confirmation to creator
    const headerLine = existingProduct
      ? `🔄 <b>Nomor #${finalNumber} berhasil diperbarui!</b>\n<i>(Sebelumnya: ${existingProduct.title})</i>`
      : isAutoAssigned
        ? `✅ <b>Produk ditambahkan otomatis di Nomor #${finalNumber}!</b>`
        : `✅ <b>Produk #${finalNumber} berhasil ditambahkan!</b>`;

    const confirmationText = `
${headerLine}

<b>Nomor Spill:</b> <code>#${finalNumber}</code>
<b>Judul:</b> ${parsed.title}
<b>Platform:</b> ${platform.toUpperCase()}
<b>Link Spill:</b> <code>${shortUrl}</code>
<b>Target:</b> ${parsed.url}
    `.trim();

    await sendTelegramMessage(chatId, confirmationText);
    return { handled: true, authorized: true, response: existingProduct ? 'product_updated' : 'product_added' };
  }

  // Comprehensive error reason when message cannot be parsed
  const detailedError = diagnoseParseError(rawText);
  await sendTelegramMessage(chatId, detailedError);
  return { handled: true, authorized: true, response: 'unknown_format' };
}
