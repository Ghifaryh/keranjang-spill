const PLATFORM_LABELS: Record<string, string> = {
  shopee: 'Shopee',
  tiktok: 'TikTok Shop',
};

export function platformLabel(platform?: string): string {
  return (platform && PLATFORM_LABELS[platform]) || 'Toko';
}
