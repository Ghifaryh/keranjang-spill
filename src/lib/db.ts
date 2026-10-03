import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';

export interface Product {
  id?: number;
  number: string;
  title: string;
  affiliate_url: string;
  original_url?: string;
  image_url?: string;
  platform?: string;
  active?: number;
  updated_at?: string;
}

export interface ClickRecord {
  id?: number;
  product_number: string;
  ip_hash: string;
  user_agent: string;
  referer?: string;
  clicked_at?: string;
}

let dbInstance: Database.Database | null = null;

export function getDb(): Database.Database {
  if (dbInstance) {
    return dbInstance;
  }

  const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'keranjang.db');
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  dbInstance = new Database(dbPath);
  dbInstance.pragma('journal_mode = WAL');
  dbInstance.pragma('synchronous = NORMAL');

  initSchema(dbInstance);

  return dbInstance;
}

function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      number TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      affiliate_url TEXT NOT NULL,
      original_url TEXT,
      image_url TEXT,
      platform TEXT,
      active INTEGER DEFAULT 1,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_products_number ON products(number);
    CREATE INDEX IF NOT EXISTS idx_products_active ON products(active);

    CREATE TABLE IF NOT EXISTS clicks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_number TEXT NOT NULL,
      ip_hash TEXT NOT NULL,
      user_agent TEXT NOT NULL,
      referer TEXT,
      clicked_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_clicks_product_number ON clicks(product_number);

    CREATE TABLE IF NOT EXISTS click_dedup (
      dedup_key TEXT PRIMARY KEY,
      expires_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_click_dedup_expires ON click_dedup(expires_at);
  `);
}

export function getAllActiveProducts(): Product[] {
  const db = getDb();
  // Order numerically descending if numeric, otherwise alphabetical/updated_at
  const stmt = db.prepare(`
    SELECT * FROM products 
    WHERE active = 1 
    ORDER BY CAST(number AS INTEGER) DESC, updated_at DESC
  `);
  return stmt.all() as Product[];
}

export function getProductByNumber(number: string): Product | null {
  const db = getDb();
  const stmt = db.prepare(`SELECT * FROM products WHERE number = ? AND active = 1`);
  const row = stmt.get(number);
  return (row as Product) || null;
}

export function getProductByNumberAnyStatus(number: string): Product | null {
  const db = getDb();
  const stmt = db.prepare(`SELECT * FROM products WHERE number = ?`);
  const row = stmt.get(number);
  return (row as Product) || null;
}

export function upsertProduct(product: {
  number: string;
  title: string;
  affiliate_url: string;
  original_url?: string;
  image_url?: string;
  platform?: string;
  active?: number;
}): Product {
  const db = getDb();
  const activeVal = product.active !== undefined ? product.active : 1;
  const platformVal = product.platform || detectPlatform(product.affiliate_url);
  const originalUrlVal = product.original_url || '';
  const imageUrlVal = product.image_url || '';

  const stmt = db.prepare(`
    INSERT INTO products (number, title, affiliate_url, original_url, image_url, platform, active, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(number) DO UPDATE SET
      title = excluded.title,
      affiliate_url = excluded.affiliate_url,
      original_url = CASE WHEN excluded.original_url != '' THEN excluded.original_url ELSE products.original_url END,
      image_url = CASE WHEN excluded.image_url != '' THEN excluded.image_url ELSE products.image_url END,
      platform = excluded.platform,
      active = excluded.active,
      updated_at = CURRENT_TIMESTAMP
    RETURNING *
  `);

  return stmt.get(
    product.number,
    product.title,
    product.affiliate_url,
    originalUrlVal,
    imageUrlVal,
    platformVal,
    activeVal
  ) as Product;
}

export function upsertProductsBatch(products: Array<{
  number: string;
  title: string;
  affiliate_url: string;
  original_url?: string;
  image_url?: string;
  platform?: string;
  active?: number;
}>): number {
  const db = getDb();
  const insertStmt = db.prepare(`
    INSERT INTO products (number, title, affiliate_url, original_url, image_url, platform, active, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(number) DO UPDATE SET
      title = excluded.title,
      affiliate_url = excluded.affiliate_url,
      original_url = CASE WHEN excluded.original_url != '' THEN excluded.original_url ELSE products.original_url END,
      image_url = CASE WHEN excluded.image_url != '' THEN excluded.image_url ELSE products.image_url END,
      platform = excluded.platform,
      active = excluded.active,
      updated_at = CURRENT_TIMESTAMP
  `);

  const runBatch = db.transaction((items) => {
    let count = 0;
    for (const item of items) {
      const activeVal = item.active !== undefined ? item.active : 1;
      const platformVal = item.platform || detectPlatform(item.affiliate_url);
      const originalUrlVal = item.original_url || '';
      const imageUrlVal = item.image_url || '';
      insertStmt.run(
        item.number,
        item.title,
        item.affiliate_url,
        originalUrlVal,
        imageUrlVal,
        platformVal,
        activeVal
      );
      count++;
    }
    return count;
  });

  return runBatch(products);
}

export function setProductActive(number: string, active: number): boolean {
  const db = getDb();
  const stmt = db.prepare(`UPDATE products SET active = ?, updated_at = CURRENT_TIMESTAMP WHERE number = ?`);
  const result = stmt.run(active, number);
  return result.changes > 0;
}

export function deleteProduct(number: string): boolean {
  const db = getDb();
  const stmt = db.prepare(`DELETE FROM products WHERE number = ?`);
  const result = stmt.run(number);
  return result.changes > 0;
}

export function recordClick(click: {
  product_number: string;
  ip_hash: string;
  user_agent: string;
  referer?: string;
}): void {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO clicks (product_number, ip_hash, user_agent, referer, clicked_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
  `);
  stmt.run(
    click.product_number,
    click.ip_hash,
    click.user_agent,
    click.referer || ''
  );
}

export function isClickDeduped(dedupKey: string): boolean {
  const db = getDb();
  const now = Date.now();
  const stmt = db.prepare(`
    SELECT expires_at FROM click_dedup WHERE dedup_key = ?
  `);
  const row = stmt.get(dedupKey) as { expires_at: number } | undefined;
  if (!row) {
    return false;
  }
  if (row.expires_at <= now) {
    // Expired
    db.prepare(`DELETE FROM click_dedup WHERE dedup_key = ?`).run(dedupKey);
    return false;
  }
  return true;
}

export function setClickDedup(dedupKey: string, ttlSeconds: number = 1800): void {
  const db = getDb();
  const expiresAt = Date.now() + ttlSeconds * 1000;
  const stmt = db.prepare(`
    INSERT INTO click_dedup (dedup_key, expires_at)
    VALUES (?, ?)
    ON CONFLICT(dedup_key) DO UPDATE SET expires_at = excluded.expires_at
  `);
  stmt.run(dedupKey, expiresAt);
}

export function pruneExpiredDedup(): number {
  const db = getDb();
  const now = Date.now();
  const stmt = db.prepare(`DELETE FROM click_dedup WHERE expires_at <= ?`);
  const res = stmt.run(now);
  return res.changes;
}

export function getClickStats(): Array<{ product_number: string; clicks: number }> {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT product_number, COUNT(*) as clicks
    FROM clicks
    GROUP BY product_number
    ORDER BY clicks DESC
  `);
  return stmt.all() as Array<{ product_number: string; clicks: number }>;
}

export function detectPlatform(url: string): string {
  if (!url) return 'other';
  const lower = url.toLowerCase();
  if (lower.includes('shopee') || lower.includes('shope.ee')) {
    return 'shopee';
  }
  if (lower.includes('tiktok') || lower.includes('tiktokv') || lower.includes('vt.tiktok')) {
    return 'tiktok';
  }
  if (lower.includes('tokopedia') || lower.includes('tokopedia.link')) {
    return 'tokopedia';
  }
  if (lower.includes('lazada')) {
    return 'lazada';
  }
  return 'other';
}
