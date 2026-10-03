import {
  getDb,
  upsertProduct,
  getProductByNumber,
  setProductActive,
  detectPlatform,
} from '../src/lib/db';
import { parseProductMessage } from '../src/lib/telegram';
import { syncFromSheets } from '../src/lib/sheets';
import { GET as getRedirect } from '../src/pages/go/[id]';
import { POST as postTelegram } from '../src/pages/api/telegram';
import { ALL as allSync } from '../src/pages/api/sync';
import type { APIContext } from 'astro';

async function runAllVerifications(): Promise<void> {
  console.log('====================================================');
  console.log('   KERANJANGSPILL END-TO-END VERIFICATION SUITE');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string): void {
    if (condition) {
      console.log(`✅ [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${testName}`);
      failed++;
    }
  }

  // -----------------------------------------------------------------
  // 1. Database & Schema Invariants
  // -----------------------------------------------------------------
  console.log('--- 1. Testing Database & Schema Invariants ---');
  const db = getDb();
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
  const tableNames = Array.isArray(tables)
    ? tables.map((t) => (t && typeof t === 'object' && 'name' in t && typeof t.name === 'string' ? t.name : ''))
    : [];

  assert(tableNames.includes('products'), 'Table `products` exists in SQLite');
  assert(tableNames.includes('clicks'), 'Table `clicks` exists in SQLite');
  assert(tableNames.includes('click_dedup'), 'Table `click_dedup` exists in SQLite');

  // Test platform detection
  assert(detectPlatform('https://s.shopee.co.id/abc1234') === 'shopee', 'Detects Shopee platform from s.shopee.co.id');
  assert(detectPlatform('https://vt.tiktok.com/ZSj1234') === 'tiktok', 'Detects TikTok platform from vt.tiktok.com');
  assert(detectPlatform('https://tokopedia.link/xyz') === 'tokopedia', 'Detects Tokopedia platform from tokopedia.link');

  // -----------------------------------------------------------------
  // 2. Product Management (CRUD & Inactive state)
  // -----------------------------------------------------------------
  console.log('\n--- 2. Testing Product CRUD & Inactive State ---');
  const prod = upsertProduct({
    number: '45',
    title: 'Kemeja Oversize Linen',
    affiliate_url: 'https://s.shopee.co.id/demo45',
    platform: 'shopee',
    active: 1,
  });
  assert(prod.number === '45' && prod.platform === 'shopee', 'Upsert product #45 succeeded');

  const fetched = getProductByNumber('45');
  assert(fetched !== null && fetched.title === 'Kemeja Oversize Linen', 'Fetch active product #45 succeeded');

  setProductActive('45', 0);
  const inactiveCheck = getProductByNumber('45');
  assert(inactiveCheck === null, 'Deactivated product #45 excluded from getProductByNumber');

  setProductActive('45', 1);
  const reactivatedCheck = getProductByNumber('45');
  assert(reactivatedCheck !== null, 'Reactivated product #45 retrieved successfully');

  // -----------------------------------------------------------------
  // 3. Telegram Message Parser & Webhook Endpoint
  // -----------------------------------------------------------------
  console.log('\n--- 3. Testing Telegram Message Parser & Webhook ---');
  const parsedHyphen = parseProductMessage('101 - Dress Floral Vintage - https://s.shopee.co.id/dress101');
  assert(
    parsedHyphen !== null &&
      parsedHyphen.number === '101' &&
      parsedHyphen.title === 'Dress Floral Vintage' &&
      parsedHyphen.url === 'https://s.shopee.co.id/dress101',
    'Parses standard hyphen format `101 - Dress Floral Vintage - Link`'
  );

  const parsedPipe = parseProductMessage('#77 | Celana Kulot Highwaist | https://vt.tiktok.com/kulot77');
  assert(
    parsedPipe !== null && parsedPipe.number === '77' && parsedPipe.title === 'Celana Kulot Highwaist',
    'Parses pipe format `#77 | Celana Kulot Highwaist | Link`'
  );

  process.env.TELEGRAM_ALLOWED_USER_ID = '12345678';

  // 3a. Unauthorized POST to webhook
  const mockContextUnauthorized: unknown = {
    request: new Request('https://keranjang.local/api/telegram', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        update_id: 1,
        message: {
          message_id: 1,
          from: { id: 9999999, is_bot: false, first_name: 'Unknown' },
          chat: { id: 9999999, type: 'private' },
          date: Date.now(),
          text: '50 - Tas Lucu - https://s.shopee.co.id/tas50',
        },
      }),
    }),
  };
  const unauthorizedResponse = await postTelegram(mockContextUnauthorized as APIContext);
  assert(unauthorizedResponse.status === 403, 'Webhook rejects unauthorized Telegram user ID with 403 Forbidden');

  // 3b. Authorized POST to webhook
  const mockContextAuthorized: unknown = {
    request: new Request('https://keranjang.local/api/telegram', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        update_id: 2,
        message: {
          message_id: 2,
          from: { id: 12345678, is_bot: false, first_name: 'Creator' },
          chat: { id: 12345678, type: 'private' },
          date: Date.now(),
          text: '55 - Sandal Lucu Korea - https://s.shopee.co.id/sandal55',
        },
      }),
    }),
  };
  const authorizedResponse = await postTelegram(mockContextAuthorized as APIContext);
  assert(authorizedResponse.status === 200, 'Webhook processes authorized Telegram user with 200 OK');

  const savedFromTg = getProductByNumber('55');
  assert(
    savedFromTg !== null && savedFromTg.title === 'Sandal Lucu Korea' && savedFromTg.platform === 'shopee',
    'Product #55 from Telegram properly stored in SQLite'
  );

  // -----------------------------------------------------------------
  // 4. Redirect Endpoint, Anti-Spam & Deduplication
  // -----------------------------------------------------------------
  console.log('\n--- 4. Testing Redirect Endpoint & Anti-Spam Logic ---');
  db.prepare('DELETE FROM clicks WHERE product_number = ?').run('45');
  db.prepare('DELETE FROM click_dedup').run();

  const mockRedirect = (path: string, status: number = 302) => {
    return new Response(null, { status, headers: { Location: path } });
  };

  const humanReq = new Request('https://keranjang.local/go/45', {
    headers: {
      'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
      'x-forwarded-for': '180.252.10.20',
    },
  });

  const redirectRes1 = await getRedirect({
    params: { id: '45' },
    request: humanReq,
    redirect: mockRedirect,
  } as unknown as APIContext);

  assert(redirectRes1.status === 302, 'Redirect returns HTTP 302');
  assert(
    redirectRes1.headers.get('location') === 'https://s.shopee.co.id/demo45',
    'Redirect Location matches affiliate URL'
  );
  assert(
    redirectRes1.headers.get('cache-control')?.includes('no-store') === true,
    'Redirect has Cache-Control: no-store header'
  );

  const row1 = db.prepare('SELECT COUNT(*) as count FROM clicks WHERE product_number = ?').get('45');
  let clicksCount1 = 0;
  if (row1 && typeof row1 === 'object' && 'count' in row1 && typeof row1.count === 'number') {
    clicksCount1 = row1.count;
  }
  assert(clicksCount1 === 1, 'First human click logged in database (clicks = 1)');

  // Repeat click from same user -> should be deduplicated
  const redirectRes2 = await getRedirect({
    params: { id: '45' },
    request: humanReq,
    redirect: mockRedirect,
  } as unknown as APIContext);

  assert(redirectRes2.status === 302, 'Repeat request still redirects with 302');
  const row2 = db.prepare('SELECT COUNT(*) as count FROM clicks WHERE product_number = ?').get('45');
  let clicksCount2 = 0;
  if (row2 && typeof row2 === 'object' && 'count' in row2 && typeof row2.count === 'number') {
    clicksCount2 = row2.count;
  }
  assert(clicksCount2 === 1, 'Repeat click within 30m deduplicated (clicks remains 1)');

  // Bot click test
  const botReq = new Request('https://keranjang.local/go/45', {
    headers: {
      'user-agent': 'Mozilla/5.0 (compatible; Bytespider; spider-feedback@bytedance.com)',
      'x-forwarded-for': '114.119.130.55',
    },
  });
  const botRedirectRes = await getRedirect({
    params: { id: '45' },
    request: botReq,
    redirect: mockRedirect,
  } as unknown as APIContext);

  assert(botRedirectRes.status === 302, 'Bot is redirected without crashing');
  const rowBot = db.prepare('SELECT COUNT(*) as count FROM clicks WHERE product_number = ?').get('45');
  let clicksCountBot = 0;
  if (rowBot && typeof rowBot === 'object' && 'count' in rowBot && typeof rowBot.count === 'number') {
    clicksCountBot = rowBot.count;
  }
  assert(clicksCountBot === 1, 'Bot request did NOT increment clicks count');

  // Non-existent product redirect test
  const notFoundRedirect = await getRedirect({
    params: { id: '99999' },
    request: humanReq,
    redirect: mockRedirect,
  } as unknown as APIContext);
  assert(
    notFoundRedirect.status === 302 && notFoundRedirect.headers.get('location') === '/?not_found=1',
    'Non-existent product redirects to /?not_found=1'
  );

  // -----------------------------------------------------------------
  // 5. Google Sheets Graceful Fallback
  // -----------------------------------------------------------------
  console.log('\n--- 5. Testing Google Sheets Graceful Fallback ---');
  delete process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  delete process.env.GOOGLE_SHEET_ID;

  const syncResult = await syncFromSheets();
  assert(
    syncResult.success === false && syncResult.count === 0 && typeof syncResult.error === 'string',
    'Google Sheets handles missing credentials gracefully without throwing'
  );

  const mockSyncContext: unknown = {
    request: new Request('https://keranjang.local/api/sync', { method: 'POST' }),
  };
  const syncApiResponse = await allSync(mockSyncContext as APIContext);
  assert(
    syncApiResponse.status === 500,
    'API /api/sync returns structured JSON error when credentials missing'
  );

  console.log('\n====================================================');
  console.log(`VERIFICATION SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('====================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runAllVerifications().catch((err) => {
  console.error('Verification failed with unexpected error:', err);
  process.exit(1);
});
