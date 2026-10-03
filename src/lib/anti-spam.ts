import crypto from 'node:crypto';
import { isClickDeduped, setClickDedup, recordClick } from './db';

const BOT_PATTERNS = [
  /googlebot/i,
  /bingbot/i,
  /slurp/i,
  /duckduckbot/i,
  /baiduspider/i,
  /yandexbot/i,
  /bytespider/i,
  /petalbot/i,
  /sogou/i,
  /exabot/i,
  /twitterbot/i,
  /facebookexternalhit/i,
  /facebot/i,
  /linkedinbot/i,
  /pinterest/i,
  /whatsapp/i,
  /telegrambot/i,
  /discordbot/i,
  /slackbot/i,
  /curl\//i,
  /wget\//i,
  /python-requests/i,
  /go-http-client/i,
  /node-fetch/i,
  /axios/i,
  /postmanruntime/i,
  /headlesschrome/i,
  /lighthouse/i,
];

export interface TrackClickResult {
  logged: boolean;
  reason: 'recorded' | 'deduped' | 'bot';
  ipHash: string;
}

export function isBot(userAgent: string): boolean {
  if (!userAgent || userAgent.trim().length === 0) {
    return true;
  }
  return BOT_PATTERNS.some((pattern) => pattern.test(userAgent));
}

export function getClientIp(request: Request): string {
  const cfIp = request.headers.get('cf-connecting-ip');
  if (cfIp) return cfIp.trim();

  const xff = request.headers.get('x-forwarded-for');
  if (xff) {
    const firstIp = xff.split(',')[0]?.trim();
    if (firstIp) return firstIp;
  }

  const xRealIp = request.headers.get('x-real-ip');
  if (xRealIp) return xRealIp.trim();

  return '127.0.0.1';
}

export function trackClick(request: Request, productNumber: string): TrackClickResult {
  const userAgent = request.headers.get('user-agent') || '';
  const ip = getClientIp(request);
  const ipHash = crypto.createHash('sha256').update(ip).digest('hex').slice(0, 16);

  // 1. Bot filtering
  if (isBot(userAgent)) {
    return { logged: false, reason: 'bot', ipHash };
  }

  // 2. Anti-spam 30-minute click deduplication
  const rawKey = `${ip}::${userAgent}::${productNumber}`;
  const dedupKey = crypto.createHash('sha256').update(rawKey).digest('hex');

  if (isClickDeduped(dedupKey)) {
    return { logged: false, reason: 'deduped', ipHash };
  }

  // 3. Record click in SQLite
  const referer = request.headers.get('referer') || '';
  recordClick({
    product_number: productNumber,
    ip_hash: ipHash,
    user_agent: userAgent.slice(0, 500),
    referer: referer.slice(0, 500),
  });

  // 4. Set 30-minute TTL in dedup table (1800 seconds)
  setClickDedup(dedupKey, 1800);

  return { logged: true, reason: 'recorded', ipHash };
}
