async function testLiveServer() {
  console.log('Testing live HTTP server at http://localhost:4321 ...');

  // 1. Homepage GET /
  const homeRes = await fetch('http://localhost:4321/');
  console.log('GET / status:', homeRes.status);
  const homeHtml = await homeRes.text();
  console.log('Home HTML length:', homeHtml.length);
  console.log('Contains search-input:', homeHtml.includes('id="search-input"'));
  console.log('Contains product-card:', homeHtml.includes('product-card'));
  if (homeRes.status !== 200 || !homeHtml.includes('search-input')) {
    throw new Error('Homepage test failed');
  }

  // 2. Redirect GET /go/45
  const goRes = await fetch('http://localhost:4321/go/45', { redirect: 'manual' });
  console.log('GET /go/45 status:', goRes.status);
  console.log('GET /go/45 Location header:', goRes.headers.get('location'));
  if (goRes.status !== 302 || !goRes.headers.get('location')) {
    throw new Error('Redirect test failed');
  }

  // 3. Not found redirect GET /go/99999
  const goNotFound = await fetch('http://localhost:4321/go/99999', { redirect: 'manual' });
  console.log('GET /go/99999 status:', goNotFound.status);
  console.log('GET /go/99999 Location:', goNotFound.headers.get('location'));
  if (goNotFound.status !== 302 || !goNotFound.headers.get('location')?.includes('not_found=1')) {
    throw new Error('Not found redirect test failed');
  }

  // 4. Telegram Webhook GET /api/telegram
  const tgGet = await fetch('http://localhost:4321/api/telegram');
  console.log('GET /api/telegram status:', tgGet.status);
  const tgGetJson = (await tgGet.json()) as { status: string };
  console.log('GET /api/telegram response:', tgGetJson);

  // 5. Telegram Webhook POST /api/telegram (unauthorized: user 99999999)
  const tgPostUnauthorized = await fetch('http://localhost:4321/api/telegram', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      update_id: 1,
      message: {
        message_id: 1,
        from: { id: 99999999, is_bot: false, first_name: 'Attacker' },
        chat: { id: 99999999, type: 'private' },
        date: Date.now(),
        text: '999 - Fake Product - https://s.shopee.co.id/fake',
      },
    }),
  });
  console.log('POST /api/telegram (unauthorized) status:', tgPostUnauthorized.status);
  if (tgPostUnauthorized.status !== 403) {
    throw new Error('Telegram webhook unauthorized test failed');
  }

  // 6. Telegram Webhook POST /api/telegram (authorized: user 12345678)
  const tgPostAuthorized = await fetch('http://localhost:4321/api/telegram', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      update_id: 2,
      message: {
        message_id: 2,
        from: { id: 12345678, is_bot: false, first_name: 'Creator' },
        chat: { id: 12345678, type: 'private' },
        date: Date.now(),
        text: '62 - Gamis Brokat Cantik - https://s.shopee.co.id/gamis62',
      },
    }),
  });
  console.log('POST /api/telegram (authorized) status:', tgPostAuthorized.status);
  const tgAuthJson = (await tgPostAuthorized.json()) as { ok: boolean; handled: boolean };
  console.log('POST /api/telegram (authorized) response:', tgAuthJson);
  if (tgPostAuthorized.status !== 200 || !tgAuthJson.ok) {
    throw new Error('Telegram webhook authorized test failed');
  }

  // 7. Verify newly added product 62 redirect works
  const go62 = await fetch('http://localhost:4321/go/62', { redirect: 'manual' });
  console.log('GET /go/62 status:', go62.status);
  console.log('GET /go/62 Location:', go62.headers.get('location'));
  if (go62.status !== 302 || go62.headers.get('location') !== 'https://s.shopee.co.id/gamis62') {
    throw new Error('New product redirect test failed');
  }

  // 8. Sync endpoint /api/sync
  const syncRes = await fetch('http://localhost:4321/api/sync', { method: 'POST' });
  console.log('POST /api/sync status:', syncRes.status);
  const syncJson = (await syncRes.json()) as { success: boolean; error?: string };
  console.log('POST /api/sync json:', syncJson);
  if (syncJson.success !== false) {
    throw new Error('Expected sync to fail gracefully without credentials');
  }

  console.log('\nAll live server HTTP tests passed perfectly!');
}

testLiveServer().catch((err) => {
  console.error('Live server test failed:', err);
  process.exit(1);
});
