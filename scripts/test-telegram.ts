import { parseProductMessage, processTelegramUpdate } from '../src/lib/telegram';
import { getProductByNumber, getAllActiveProducts } from '../src/lib/db';

console.log('--- Testing Telegram Message Parser ---');

const parsed1 = parseProductMessage('45 - Kemeja Oversize Linen - https://s.shopee.co.id/abc1234');
console.log('Format 1 (hyphen):', parsed1);
if (!parsed1 || parsed1.number !== '45' || !parsed1.url.includes('shopee')) {
  throw new Error('Failed to parse hyphen format');
}

const parsed2 = parseProductMessage('#99 | Sandal Slop Korea | https://vt.tiktok.com/ZSjX123');
console.log('Format 2 (pipe):', parsed2);
if (!parsed2 || parsed2.number !== '99' || !parsed2.url.includes('tiktok')) {
  throw new Error('Failed to parse pipe format');
}

const parsed3 = parseProductMessage('77\nRok Plisket Premium\nhttps://tokopedia.link/xyz');
console.log('Format 3 (multiline):', parsed3);
if (!parsed3 || parsed3.number !== '77') {
  throw new Error('Failed to parse multiline format');
}

console.log('--- Testing Authorization & Update Processing ---');
process.env.TELEGRAM_ALLOWED_USER_ID = '123456789';

// 1. Test unauthorized user
const unauthorizedResult = await processTelegramUpdate({
  update_id: 1,
  message: {
    message_id: 101,
    from: { id: 999999999, is_bot: false, first_name: 'Attacker' },
    chat: { id: 999999999, type: 'private' },
    date: Date.now(),
    text: '50 - Tas Selempang - https://s.shopee.co.id/tas123',
  },
});
console.log('Unauthorized result:', unauthorizedResult);
if (unauthorizedResult.authorized !== false) {
  throw new Error('Unauthorized user should have been rejected!');
}

// 2. Test authorized user adding product
const authorizedResult = await processTelegramUpdate({
  update_id: 2,
  message: {
    message_id: 102,
    from: { id: 123456789, is_bot: false, first_name: 'Creator' },
    chat: { id: 123456789, type: 'private' },
    date: Date.now(),
    text: '88 - Cardigan Rajut Crop - https://s.shopee.co.id/cardi88',
  },
});
console.log('Authorized add result:', authorizedResult);
if (!authorizedResult.authorized || authorizedResult.response !== 'product_added') {
  throw new Error('Authorized product add failed');
}

const savedProduct = getProductByNumber('88');
console.log('Saved product in DB:', savedProduct);
if (!savedProduct || savedProduct.title !== 'Cardigan Rajut Crop' || savedProduct.platform !== 'shopee') {
  throw new Error('Product not properly saved in DB');
}

// 3. Test /delete command
const deleteResult = await processTelegramUpdate({
  update_id: 3,
  message: {
    message_id: 103,
    from: { id: 123456789, is_bot: false, first_name: 'Creator' },
    chat: { id: 123456789, type: 'private' },
    date: Date.now(),
    text: '/delete 88',
  },
});
console.log('Delete command result:', deleteResult);
const deletedProduct = getProductByNumber('88');
if (deletedProduct !== null) {
  throw new Error('Product 88 should have been deactivated');
}

console.log('All Telegram smoke tests passed successfully!');
