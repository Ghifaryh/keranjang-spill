import { google, type sheets_v4 } from 'googleapis';
import { upsertProductsBatch, detectPlatform } from './db';

interface SheetClientContext {
  sheets: sheets_v4.Sheets;
  sheetId: string;
}

export interface SyncResult {
  success: boolean;
  count: number;
  error?: string;
}

function getSheetsClient(): SheetClientContext | null {
  const rawKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  const sheetId = process.env.GOOGLE_SHEET_ID;

  if (!rawKey || !sheetId) {
    return null;
  }

  try {
    const trimmed = rawKey.trim();
    const jsonStr = trimmed.startsWith('{')
      ? trimmed
      : Buffer.from(trimmed, 'base64').toString('utf-8');
    const credentials = JSON.parse(jsonStr) as Record<string, unknown>;

    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const sheets = google.sheets({ version: 'v4', auth });
    return { sheets, sheetId };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('Failed to initialize Google Sheets client:', msg);
    return null;
  }
}

export async function syncFromSheets(): Promise<SyncResult> {
  const clientContext = getSheetsClient();
  if (!clientContext) {
    return {
      success: false,
      count: 0,
      error: 'Google Sheets credentials (GOOGLE_SERVICE_ACCOUNT_KEY or GOOGLE_SHEET_ID) not configured',
    };
  }

  const { sheets, sheetId } = clientContext;

  try {
    let rows: unknown[][] | undefined;
    try {
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: sheetId,
        range: 'Products!A2:G',
      });
      rows = response.data.values as unknown[][] | undefined;
    } catch {
      const fallbackResponse = await sheets.spreadsheets.values.get({
        spreadsheetId: sheetId,
        range: 'A2:G',
      });
      rows = fallbackResponse.data.values as unknown[][] | undefined;
    }

    if (!rows || rows.length === 0) {
      return { success: true, count: 0 };
    }

    const productsToUpsert: Array<{
      number: string;
      title: string;
      affiliate_url: string;
      original_url?: string;
      image_url?: string;
      platform?: string;
      active?: number;
    }> = [];

    for (const row of rows) {
      const number = String(row[0] ?? '').trim();
      const title = String(row[1] ?? '').trim();
      const affiliateUrl = String(row[2] ?? '').trim();
      const originalUrl = String(row[3] ?? '').trim();
      const imageUrl = String(row[4] ?? '').trim();
      const activeRaw = String(row[6] ?? '').trim().toLowerCase();

      if (!number || !title || !affiliateUrl) {
        continue;
      }

      const active =
        activeRaw === '' ||
        activeRaw === '1' ||
        activeRaw === 'true' ||
        activeRaw === 'active' ||
        activeRaw === 'yes'
          ? 1
          : 0;

      productsToUpsert.push({
        number,
        title,
        affiliate_url: affiliateUrl,
        original_url: originalUrl,
        image_url: imageUrl,
        platform: detectPlatform(affiliateUrl),
        active,
      });
    }

    if (productsToUpsert.length > 0) {
      const inserted = upsertProductsBatch(productsToUpsert);
      return { success: true, count: inserted };
    }

    return { success: true, count: 0 };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('Error syncing from Google Sheets:', errorMsg);
    return {
      success: false,
      count: 0,
      error: errorMsg,
    };
  }
}

export async function appendProductToSheet(product: {
  number: string;
  title: string;
  affiliateUrl: string;
  originalUrl?: string;
  imageUrl?: string;
}): Promise<boolean> {
  const clientContext = getSheetsClient();
  if (!clientContext) {
    return false;
  }

  const { sheets, sheetId } = clientContext;
  const timestamp = new Date().toISOString();
  const rowValues = [
    product.number,
    product.title,
    product.affiliateUrl,
    product.originalUrl || '',
    product.imageUrl || '',
    timestamp,
    '1',
  ];

  try {
    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: 'Products!A:G',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [rowValues],
      },
    });
    return true;
  } catch {
    try {
      await sheets.spreadsheets.values.append({
        spreadsheetId: sheetId,
        range: 'A:G',
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [rowValues],
        },
      });
      return true;
    } catch (fallbackErr) {
      const msg = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
      console.error('Failed to append product to Google Sheets:', msg);
      return false;
    }
  }
}

export async function updateProductActiveInSheet(
  number: string,
  active: boolean
): Promise<boolean> {
  const clientContext = getSheetsClient();
  if (!clientContext) {
    return false;
  }

  const { sheets, sheetId } = clientContext;

  try {
    let sheetName = 'Products';
    let response;
    try {
      response = await sheets.spreadsheets.values.get({
        spreadsheetId: sheetId,
        range: `${sheetName}!A:A`,
      });
    } catch {
      sheetName = 'Sheet1';
      response = await sheets.spreadsheets.values.get({
        spreadsheetId: sheetId,
        range: `${sheetName}!A:A`,
      });
    }

    const rows = response.data.values as unknown[][] | undefined;
    if (!rows) return false;

    for (let i = 0; i < rows.length; i++) {
      if (String(rows[i]?.[0] ?? '').trim() === number) {
        const rowIndex = i + 1;
        await sheets.spreadsheets.values.update({
          spreadsheetId: sheetId,
          range: `${sheetName}!G${rowIndex}`,
          valueInputOption: 'USER_ENTERED',
          requestBody: {
            values: [[active ? '1' : '0']],
          },
        });
        return true;
      }
    }
    return false;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('Failed to update product active status in Google Sheets:', msg);
    return false;
  }
}
