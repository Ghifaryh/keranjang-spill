import { upsertProduct, getDb } from '../src/lib/db';
import { trackClick, isBot } from '../src/lib/anti-spam';

console.log('--- Testing Anti-Spam Bot Filter ---');
if (!isBot('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)')) {
  throw new Error('Googlebot should be detected as bot');
}
if (!isBot('Mozilla/5.0 (compatible; Bytespider; https://zhanzhang.toutiao.com/)')) {
  throw new Error('Bytespider should be detected as bot');
}
if (!isBot('curl/7.68.0')) {
  throw new Error('curl should be detected as bot');
}
if (isBot('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1')) {
  throw new Error('Real iPhone user should NOT be detected as bot');
}
console.log('Bot detection checks passed!');

console.log('--- Testing Click Deduplication Logic ---');
// Clean up clicks table for test isolation
const db = getDb();
db.prepare('DELETE FROM clicks WHERE product_number = ?').run('45');
db.prepare('DELETE FROM click_dedup').run();

upsertProduct({
  number: '45',
  title: 'Kemeja Oversize Linen',
  affiliate_url: 'https://s.shopee.co.id/test-affiliate-45',
  platform: 'shopee',
  active: 1,
});

const userAgent = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) Mobile/15E148';
const clientIp = '192.168.1.100';

const req1 = new Request('https://keranjang.local/go/45', {
  headers: {
    'user-agent': userAgent,
    'x-forwarded-for': clientIp,
  },
});

// Click 1: should be recorded
const res1 = trackClick(req1, '45');
console.log('Click 1 result:', res1);
if (!res1.logged || res1.reason !== 'recorded') {
  throw new Error('Click 1 should have been recorded');
}
const row1 = db.prepare('SELECT COUNT(*) as count FROM clicks WHERE product_number = ?').get('45');
const countAfterClick1 = row1 && typeof row1 === 'object' && 'count' in row1 && typeof row1.count === 'number' ? row1.count : 0;
console.log('Clicks in DB after click 1:', countAfterClick1);
if (countAfterClick1 !== 1) {
  throw new Error(`Expected 1 click in DB, got ${countAfterClick1}`);
}

// Click 2: identical user within 30s -> should be deduplicated
const req2 = new Request('https://keranjang.local/go/45', {
  headers: {
    'user-agent': userAgent,
    'x-forwarded-for': clientIp,
  },
});
const res2 = trackClick(req2, '45');
console.log('Click 2 result:', res2);
const row2 = db.prepare('SELECT COUNT(*) as count FROM clicks WHERE product_number = ?').get('45');
const countAfterClick2 = row2 && typeof row2 === 'object' && 'count' in row2 && typeof row2.count === 'number' ? row2.count : 0;
console.log('Clicks in DB after click 2:', countAfterClick2);
if (countAfterClick2 !== 1) {
  throw new Error(`Expected click count to remain 1, got ${countAfterClick2}`);
}

// Click 3: Bot request
const botReq = new Request('https://keranjang.local/go/45', {
  headers: {
    'user-agent': 'Mozilla/5.0 (compatible; Bytespider; spider-feedback@bytedance.com)',
    'x-forwarded-for': '114.119.130.55',
  },
});
const botRes = trackClick(botReq, '45');
const row3 = db.prepare('SELECT COUNT(*) as count FROM clicks WHERE product_number = ?').get('45');
const countAfterBot = row3 && typeof row3 === 'object' && 'count' in row3 && typeof row3.count === 'number' ? row3.count : 0;
console.log('Clicks in DB after bot request:', countAfterBot);
if (countAfterBot !== 1) {
  throw new Error(`Bot should not increment clicks count, got ${countAfterBot}`);
}

console.log('All Redirect & Anti-Spam checks passed successfully!');
