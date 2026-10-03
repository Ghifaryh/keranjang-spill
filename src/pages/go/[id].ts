import type { APIRoute } from 'astro';
import { getProductByNumber } from '../../lib/db';
import { trackClick } from '../../lib/anti-spam';

export const prerender = false;

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export const GET: APIRoute = async ({ params, request, redirect }) => {
  const productNumber = params.id?.trim();

  if (!productNumber) {
    return redirect('/?not_found=1', 302);
  }

  const product = getProductByNumber(productNumber);

  if (!product) {
    return redirect('/?not_found=1', 302);
  }

  // Track click with anti-spam & deduplication
  trackClick(request, product.number);

  const targetUrl = product.affiliate_url;
  const escapedUrl = escapeHtml(targetUrl);
  const escapedTitle = escapeHtml(product.title);
  const platformName = product.platform === 'shopee'
    ? 'Shopee'
    : product.platform === 'tiktok'
      ? 'TikTok Shop'
      : product.platform === 'tokopedia'
        ? 'Tokopedia'
        : 'Toko';

  // HTML body with meta-refresh, JS navigation, and deep-link fallback button
  const fallbackHtml = `<!doctype html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="refresh" content="0;url=${escapedUrl}">
  <title>Membuka ${escapedTitle}...</title>
  <style>
    body {
      font-family: system-ui, -apple-system, sans-serif;
      background: #fff1f2;
      color: #1f2937;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
      padding: 1rem;
      box-sizing: border-box;
      text-align: center;
    }
    .card {
      background: white;
      border: 1px solid #fecdd3;
      border-radius: 1.25rem;
      padding: 1.5rem;
      max-width: 22rem;
      width: 100%;
      box-shadow: 0 10px 25px -5px rgba(244, 63, 94, 0.1);
    }
    .badge {
      width: 3rem;
      height: 3rem;
      border-radius: 0.75rem;
      background: linear-gradient(135deg, #ec4899, #f43f5e);
      color: white;
      font-weight: 800;
      font-size: 1.125rem;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 1rem;
    }
    h1 {
      font-size: 0.875rem;
      font-weight: 600;
      margin: 0 0 0.5rem;
      line-height: 1.4;
    }
    p {
      font-size: 0.75rem;
      color: #6b7280;
      margin: 0 0 1.25rem;
    }
    .btn {
      display: block;
      width: 100%;
      padding: 0.75rem 1rem;
      background: linear-gradient(90deg, #ec4899, #f43f5e);
      color: white;
      font-size: 0.875rem;
      font-weight: 700;
      text-decoration: none;
      border-radius: 0.75rem;
      box-sizing: border-box;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">#${escapeHtml(product.number)}</div>
    <h1>${escapedTitle}</h1>
    <p>Sedang mengalihkan ke aplikasi ${platformName}...</p>
    <a href="${escapedUrl}" class="btn" rel="noreferrer">Buka di Aplikasi</a>
  </div>
  <script>
    try {
      window.location.replace(${JSON.stringify(targetUrl)});
    } catch (e) {
      window.location.href = ${JSON.stringify(targetUrl)};
    }
  </script>
</body>
</html>`;

  return new Response(fallbackHtml, {
    status: 302,
    headers: {
      Location: targetUrl,
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
      Pragma: 'no-cache',
      Expires: '0',
    },
  });
};
