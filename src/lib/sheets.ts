import fs from 'node:fs';
import path from 'node:path';
import { google, type sheets_v4 } from 'googleapis';
import { upsertProductsBatch, detectPlatform, getAllActiveProducts } from './db';
import { sanitizeHttpUrl, sanitizeImageUrl } from './security';

interface SheetClientContext {
  sheets: sheets_v4.Sheets;
  sheetId: string;
  clientEmail?: string;
}

export interface SyncResult {
  success: boolean;
  count: number;
  error?: string;
}

const HEADER_ROW = [
  'No. Spill',
  'Nama Produk',
  'Link Affiliate (Shopee / TikTok)',
  'Link Asli (Opsional)',
  'URL Foto Produk',
  'Terakhir Diperbarui',
  'Status Aktif (1/0)',
];

export function getSheetsClient(): SheetClientContext | null {
  let rawKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY?.trim();
  const sheetId = process.env.GOOGLE_SHEET_ID?.trim();

  // Convenience fallback: if GOOGLE_SERVICE_ACCOUNT_KEY is a path to a JSON file or service-account.json exists locally
  if (!rawKey) {
    const localJsonPath = path.join(process.cwd(), 'service-account.json');
    if (fs.existsSync(localJsonPath)) {
      rawKey = fs.readFileSync(localJsonPath, 'utf-8').trim();
    }
  } else if (rawKey.endsWith('.json') && fs.existsSync(path.resolve(process.cwd(), rawKey))) {
    rawKey = fs.readFileSync(path.resolve(process.cwd(), rawKey), 'utf-8').trim();
  }

  if (!rawKey || !sheetId) {
    return null;
  }

  try {
    const jsonStr = rawKey.startsWith('{')
      ? rawKey
      : Buffer.from(rawKey, 'base64').toString('utf-8');
    const credentials = JSON.parse(jsonStr) as Record<string, unknown>;

    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const sheets = google.sheets({ version: 'v4', auth });
    const clientEmail = typeof credentials.client_email === 'string' ? credentials.client_email : undefined;
    return { sheets, sheetId, clientEmail };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('Failed to initialize Google Sheets client:', msg);
    return null;
  }
}

async function resolveSheetTabName(sheets: sheets_v4.Sheets, sheetId: string): Promise<string> {
  try {
    const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
    const titles =
      meta.data.sheets
        ?.map((s) => s.properties?.title)
        .filter((t): t is string => Boolean(t)) || [];
    if (titles.includes('Products')) {
      return 'Products';
    }
    return titles[0] || 'Sheet1';
  } catch {
    return 'Sheet1';
  }
}

export async function ensureSheetHeaders(): Promise<{ ok: boolean; tabName?: string; error?: string }> {
  const clientContext = getSheetsClient();
  if (!clientContext) {
    return {
      ok: false,
      error: 'Google Sheets credentials (GOOGLE_SERVICE_ACCOUNT_KEY or GOOGLE_SHEET_ID) not configured',
    };
  }

  const { sheets, sheetId } = clientContext;
  try {
    const tabName = await resolveSheetTabName(sheets, sheetId);
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: `${tabName}!A1:G1`,
    });

    const firstRow = res.data.values?.[0];
    if (!firstRow || firstRow.length === 0 || firstRow[0] === 'Number') {
      await sheets.spreadsheets.values.update({
        spreadsheetId: sheetId,
        range: `${tabName}!A1:G1`,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [HEADER_ROW],
        },
      });
    }
    return { ok: true, tabName };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { ok: false, error: msg };
  }
}

export async function beautifySheet(): Promise<{ ok: boolean; error?: string }> {
  const clientContext = getSheetsClient();
  if (!clientContext) {
    return { ok: false, error: 'Google Sheets client not configured' };
  }

  const { sheets, sheetId } = clientContext;

  try {
    const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
    const firstSheet = meta.data.sheets?.[0];
    const sheetGid = firstSheet?.properties?.sheetId ?? 0;
    const existingBandings = firstSheet?.bandedRanges || [];
    const existingConditionalRules = firstSheet?.conditionalFormats || [];

    // Dusty Rose: #B4475F -> r: 0.706, g: 0.278, b: 0.373
    // Soft Paper: #FAF6F2 -> r: 0.980, g: 0.965, b: 0.949
    // Rose Soft:  #F7E8EC -> r: 0.969, g: 0.910, b: 0.925
    // Ink:        #24191C -> r: 0.141, g: 0.098, b: 0.110

    const requests: sheets_v4.Schema$Request[] = [];

    // Remove existing banded ranges so we can apply fresh banding cleanly
    for (const band of existingBandings) {
      if (band.bandedRangeId !== undefined && band.bandedRangeId !== null) {
        requests.push({
          deleteBanding: { bandedRangeId: band.bandedRangeId },
        });
      }
    }

    // Remove existing conditional format rules from top to bottom so we don't duplicate
    for (let i = existingConditionalRules.length - 1; i >= 0; i--) {
      requests.push({
        deleteConditionalFormatRule: { sheetId: sheetGid, index: i },
      });
    }

    // 1. Freeze top header row & set Dusty Rose tab color
    requests.push({
      updateSheetProperties: {
        properties: {
          sheetId: sheetGid,
          gridProperties: {
            frozenRowCount: 1,
          },
          tabColorStyle: {
            rgbColor: { red: 0.706, green: 0.278, blue: 0.373 },
          },
        },
        fields: 'gridProperties.frozenRowCount,tabColorStyle',
      },
    });

    // 2. Header Row (Row 1) height = 42px
    requests.push({
      updateDimensionProperties: {
        range: {
          sheetId: sheetGid,
          dimension: 'ROWS',
          startIndex: 0,
          endIndex: 1,
        },
        properties: { pixelSize: 42 },
        fields: 'pixelSize',
      },
    });

    // 3. Data Rows (Row 2..200) height = 34px for breathing room
    requests.push({
      updateDimensionProperties: {
        range: {
          sheetId: sheetGid,
          dimension: 'ROWS',
          startIndex: 1,
          endIndex: 200,
        },
        properties: { pixelSize: 34 },
        fields: 'pixelSize',
      },
    });

    // 4. Custom Column Widths (A..G)
    const columnWidths = [95, 310, 290, 180, 220, 185, 140];
    columnWidths.forEach((width, colIdx) => {
      requests.push({
        updateDimensionProperties: {
          range: {
            sheetId: sheetGid,
            dimension: 'COLUMNS',
            startIndex: colIdx,
            endIndex: colIdx + 1,
          },
          properties: { pixelSize: width },
          fields: 'pixelSize',
        },
      });
    });

    // 5. Style Header Row (A1:G1): Dusty Rose background, white bold text, middle-center
    requests.push({
      repeatCell: {
        range: {
          sheetId: sheetGid,
          startRowIndex: 0,
          endRowIndex: 1,
          startColumnIndex: 0,
          endColumnIndex: 7,
        },
        cell: {
          userEnteredFormat: {
            backgroundColor: { red: 0.706, green: 0.278, blue: 0.373 },
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
            textFormat: {
              foregroundColor: { red: 1, green: 1, blue: 1 },
              fontSize: 10,
              bold: true,
            },
          },
        },
        fields: 'userEnteredFormat(backgroundColor,horizontalAlignment,verticalAlignment,textFormat)',
      },
    });

    // 6. Style Data Cells (A2:G200): vertical middle, clean borders
    requests.push({
      repeatCell: {
        range: {
          sheetId: sheetGid,
          startRowIndex: 1,
          endRowIndex: 200,
          startColumnIndex: 0,
          endColumnIndex: 7,
        },
        cell: {
          userEnteredFormat: {
            verticalAlignment: 'MIDDLE',
            textFormat: {
              foregroundColor: { red: 0.141, green: 0.098, blue: 0.11 },
              fontSize: 10,
            },
          },
        },
        fields: 'userEnteredFormat(verticalAlignment,textFormat)',
      },
    });

    // 7. Style Column A (No. Spill): Bold Dusty Rose, Center-aligned
    requests.push({
      repeatCell: {
        range: {
          sheetId: sheetGid,
          startRowIndex: 1,
          endRowIndex: 200,
          startColumnIndex: 0,
          endColumnIndex: 1,
        },
        cell: {
          userEnteredFormat: {
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
            textFormat: {
              foregroundColor: { red: 0.706, green: 0.278, blue: 0.373 },
              fontSize: 11,
              bold: true,
            },
          },
        },
        fields: 'userEnteredFormat(horizontalAlignment,verticalAlignment,textFormat)',
      },
    });

    // 8. Center-align Column F (Updated At) & Column G (Status Aktif)
    requests.push({
      repeatCell: {
        range: {
          sheetId: sheetGid,
          startRowIndex: 1,
          endRowIndex: 200,
          startColumnIndex: 5,
          endColumnIndex: 7,
        },
        cell: {
          userEnteredFormat: {
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
          },
        },
        fields: 'userEnteredFormat(horizontalAlignment,verticalAlignment)',
      },
    });

    // 9. Alternating Row Banding (White & Warm Paper #FAF6F2)
    requests.push({
      addBanding: {
        bandedRange: {
          range: {
            sheetId: sheetGid,
            startRowIndex: 0,
            endRowIndex: 200,
            startColumnIndex: 0,
            endColumnIndex: 7,
          },
          rowProperties: {
            headerColor: { red: 0.706, green: 0.278, blue: 0.373 },
            firstBandColor: { red: 1, green: 1, blue: 1 },
            secondBandColor: { red: 0.98, green: 0.965, blue: 0.949 },
          },
        },
      },
    });

    // 10. Conditional Formatting for Column G (Status Aktif): Green when 1, Soft Rose/Red when 0
    requests.push({
      addConditionalFormatRule: {
        index: 0,
        rule: {
          ranges: [
            {
              sheetId: sheetGid,
              startRowIndex: 1,
              endRowIndex: 200,
              startColumnIndex: 6,
              endColumnIndex: 7,
            },
          ],
          booleanRule: {
            condition: {
              type: 'TEXT_EQ',
              values: [{ userEnteredValue: '1' }],
            },
            format: {
              backgroundColor: { red: 0.886, green: 0.957, blue: 0.902 },
              textFormat: {
                foregroundColor: { red: 0.09, green: 0.42, blue: 0.2 },
                bold: true,
              },
            },
          },
        },
      },
    });

    requests.push({
      addConditionalFormatRule: {
        index: 1,
        rule: {
          ranges: [
            {
              sheetId: sheetGid,
              startRowIndex: 1,
              endRowIndex: 200,
              startColumnIndex: 6,
              endColumnIndex: 7,
            },
          ],
          booleanRule: {
            condition: {
              type: 'TEXT_EQ',
              values: [{ userEnteredValue: '0' }],
            },
            format: {
              backgroundColor: { red: 0.98, green: 0.89, blue: 0.9 },
              textFormat: {
                foregroundColor: { red: 0.65, green: 0.18, blue: 0.25 },
                bold: true,
              },
            },
          },
        },
      },
    });

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: { requests },
    });

    return { ok: true };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('Failed to beautify Google Sheet:', msg);
    return { ok: false, error: msg };
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
    const tabName = await resolveSheetTabName(sheets, sheetId);
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: `${tabName}!A2:G`,
    });
    const rows = response.data.values as unknown[][] | undefined;

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
      const number = String(row[0] ?? '').replace(/^#/, '').trim();
      const title = String(row[1] ?? '').trim();
      const affiliateUrl = sanitizeHttpUrl(String(row[2] ?? ''));
      const originalUrl = sanitizeHttpUrl(String(row[3] ?? ''));
      const imageUrl = sanitizeImageUrl(String(row[4] ?? ''));
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
  const safeAffiliateUrl = sanitizeHttpUrl(product.affiliateUrl);
  if (!safeAffiliateUrl) {
    return false;
  }
  const rowValues = [
    product.number,
    product.title,
    safeAffiliateUrl,
    sanitizeHttpUrl(product.originalUrl),
    sanitizeImageUrl(product.imageUrl),
    timestamp,
    '1',
  ];

  try {
    const tabName = await resolveSheetTabName(sheets, sheetId);
    await ensureSheetHeaders();

    // Check if product number already exists in column A; if so, update that row in place
    const colARes = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: `${tabName}!A:A`,
    });
    const rows = colARes.data.values as unknown[][] | undefined;
    if (rows) {
      for (let i = 1; i < rows.length; i++) {
        if (String(rows[i]?.[0] ?? '').replace(/^#/, '').trim() === product.number) {
          const rowIndex = i + 1;
          await sheets.spreadsheets.values.update({
            spreadsheetId: sheetId,
            range: `${tabName}!A${rowIndex}:G${rowIndex}`,
            valueInputOption: 'USER_ENTERED',
            requestBody: {
              values: [rowValues],
            },
          });
          return true;
        }
      }
    }

    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: `${tabName}!A:G`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [rowValues],
      },
    });
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('Failed to append/update product in Google Sheets:', msg);
    return false;
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
    const tabName = await resolveSheetTabName(sheets, sheetId);
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: `${tabName}!A:A`,
    });

    const rows = response.data.values as unknown[][] | undefined;
    if (!rows) return false;

    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i]?.[0] ?? '').replace(/^#/, '').trim() === number) {
        const rowIndex = i + 1;
        await sheets.spreadsheets.values.update({
          spreadsheetId: sheetId,
          range: `${tabName}!G${rowIndex}`,
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

export async function pushLocalProductsToSheet(): Promise<{ pushed: number; error?: string }> {
  const clientContext = getSheetsClient();
  if (!clientContext) {
    return { pushed: 0, error: 'Google Sheets client not configured' };
  }

  const headerCheck = await ensureSheetHeaders();
  if (!headerCheck.ok) {
    return { pushed: 0, error: headerCheck.error };
  }

  const products = getAllActiveProducts();
  let pushed = 0;
  for (const prod of products) {
    const ok = await appendProductToSheet({
      number: prod.number,
      title: prod.title,
      affiliateUrl: prod.affiliate_url,
      originalUrl: prod.original_url,
      imageUrl: prod.image_url,
    });
    if (ok) pushed++;
  }
  return { pushed };
}
