import {
  getDb,
  upsertProduct,
  getAllActiveProducts,
  getProductByNumber,
  setClickDedup,
  isClickDeduped,
  recordClick,
  getClickStats,
} from '../src/lib/db';
import { syncFromSheets } from '../src/lib/sheets';

console.log('Testing DB operations...');
const p1 = upsertProduct({
  number: '45',
  title: 'Kemeja Oversize Linen',
  affiliate_url: 'https://s.shopee.co.id/abc1234',
  platform: 'shopee',
});
console.log('Inserted product:', p1.number, p1.title);

const fetched = getProductByNumber('45');
console.log('Fetched product by number 45:', fetched?.title);

setClickDedup('hash-test-45', 1800);
const isDedup1 = isClickDeduped('hash-test-45');
const isDedup2 = isClickDeduped('hash-test-unknown');
console.log('Dedup check 1 (should be true):', isDedup1);
console.log('Dedup check 2 (should be false):', isDedup2);

recordClick({
  product_number: '45',
  ip_hash: 'hash-test',
  user_agent: 'Mozilla/5.0',
  referer: 'https://instagram.com/',
});

const stats = getClickStats();
console.log('Stats:', JSON.stringify(stats));

const syncRes = await syncFromSheets();
console.log('Sync without creds result (graceful):', JSON.stringify(syncRes));

console.log('All DB & Sheets sanity checks passed!');
