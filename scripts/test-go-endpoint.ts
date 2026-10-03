import { GET } from '../src/pages/go/[id]';
import { upsertProduct } from '../src/lib/db';
import type { APIContext } from 'astro';

upsertProduct({
  number: '45',
  title: 'Kemeja Oversize Linen',
  affiliate_url: 'https://s.shopee.co.id/test-affiliate-45',
  platform: 'shopee',
  active: 1,
});

const mockRedirect = (path: string, status: number = 302) => {
  return new Response(null, {
    status,
    headers: { Location: path },
  });
};

// 1. Test existing product redirect
const reqExisting = new Request('https://keranjang.local/go/45', {
  headers: {
    'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)',
    'x-forwarded-for': '123.123.123.123',
  },
});

const resExisting = await GET({
  params: { id: '45' },
  request: reqExisting,
  redirect: mockRedirect,
} as unknown as APIContext);

console.log('Existing redirect status:', resExisting.status);
console.log('Location header:', resExisting.headers.get('location'));
const bodyText = await resExisting.text();
console.log('Contains fallback deep link button:', bodyText.includes('Buka di Aplikasi'));

if (resExisting.status !== 302) {
  throw new Error(`Expected status 302, got ${resExisting.status}`);
}
if (resExisting.headers.get('location') !== 'https://s.shopee.co.id/test-affiliate-45') {
  throw new Error('Incorrect Location header');
}
if (!bodyText.includes('Buka di Aplikasi')) {
  throw new Error('Fallback deep link button missing from response body');
}

// 2. Test non-existent product redirect
const reqNonExistent = new Request('https://keranjang.local/go/99999');
const resNonExistent = await GET({
  params: { id: '99999' },
  request: reqNonExistent,
  redirect: mockRedirect,
} as unknown as APIContext);

console.log('Non-existent redirect status:', resNonExistent.status);
console.log('Non-existent location:', resNonExistent.headers.get('location'));

if (resNonExistent.status !== 302 || resNonExistent.headers.get('location') !== '/?not_found=1') {
  throw new Error('Non-existent product should redirect to /?not_found=1');
}

console.log('All /go/[id] endpoint tests passed!');
