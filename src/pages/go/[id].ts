import type { APIRoute } from 'astro';
import { getProductByNumber } from '../../lib/db';
import { trackClick } from '../../lib/anti-spam';
import { platformLabel } from '../../lib/platform';
import { sanitizeHttpUrl, sanitizeImageUrl } from '../../lib/security';

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

  const targetUrl = sanitizeHttpUrl(product.affiliate_url);
  if (!targetUrl) {
    return redirect('/?not_found=1', 302);
  }

  // Track click with anti-spam & deduplication
  trackClick(request, product.number);

  const safeImageUrl = sanitizeImageUrl(product.image_url);
  const escapedUrl = escapeHtml(targetUrl);
  const escapedTitle = escapeHtml(product.title);
  const escapedImage = safeImageUrl ? escapeHtml(safeImageUrl) : '';
  const platformName = platformLabel(product.platform);

  // HTML body with meta-refresh, JS navigation, and deep-link fallback button
  const fallbackHtml = `<!doctype html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="refresh" content="0;url=${escapedUrl}">
  <meta name="theme-color" content="#FAF6F2">
  <title>Membuka ${escapedTitle}...</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
      background-color: #FAF6F2;
      background-image: radial-gradient(ellipse 80% 50% at 50% -10%, rgba(180, 71, 95, 0.10), transparent 70%);
      color: #24191C;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
      padding: 1.25rem;
      text-align: center;
      -webkit-font-smoothing: antialiased;
    }
    .card {
      background: #FFFFFF;
      border: 1px solid #E8DCDA;
      border-radius: 18px;
      padding: 1.75rem 1.5rem 1.5rem;
      max-width: 22rem;
      width: 100%;
      box-shadow: 0 12px 32px -8px rgba(36, 25, 28, 0.08), 0 2px 6px -1px rgba(36, 25, 28, 0.04);
    }
    .ticket {
      display: inline-flex;
      align-items: baseline;
      gap: 0.25rem;
      padding: 0.35rem 0.85rem;
      border-radius: 9999px;
      background: #F7E8EC;
      border: 1px solid rgba(180, 71, 95, 0.18);
      color: #93354A;
      margin-bottom: 1rem;
    }
    .ticket-label {
      font-size: 0.6875rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .ticket-num {
      font-family: Georgia, 'Times New Roman', serif;
      font-weight: 600;
      font-size: 1.25rem;
      line-height: 1;
      font-variant-numeric: tabular-nums;
    }
    .thumb {
      width: 4.5rem;
      height: 4.5rem;
      border-radius: 12px;
      object-fit: cover;
      margin: 0 auto 0.875rem;
      display: block;
      border: 1px solid #E8DCDA;
      background: #F4ECE6;
    }
    h1 {
      font-size: 1rem;
      font-weight: 600;
      line-height: 1.4;
      margin: 0 0 0.375rem;
      color: #24191C;
    }
    p {
      font-size: 0.8125rem;
      color: #78666B;
      margin: 0 0 1.25rem;
    }
    .progress {
      height: 3px;
      width: 100%;
      background: #F4ECE6;
      border-radius: 999px;
      overflow: hidden;
      margin-bottom: 1.25rem;
    }
    .progress-bar {
      height: 100%;
      width: 45%;
      background: #B4475F;
      border-radius: 999px;
      animation: slide 1.1s ease-in-out infinite alternate;
    }
    @keyframes slide {
      from { transform: translateX(-20%); }
      to { transform: translateX(140%); }
    }
    .btn {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 2.875rem;
      padding: 0 1.25rem;
      background: #B4475F;
      color: #FFFFFF;
      font-size: 0.9375rem;
      font-weight: 600;
      text-decoration: none;
      border-radius: 12px;
      transition: background-color 0.15s ease;
    }
    .btn:hover {
      background: #93354A;
    }
    .btn:focus-visible {
      outline: 2px solid #B4475F;
      outline-offset: 2px;
    }
    .back {
      display: inline-block;
      margin-top: 0.875rem;
      font-size: 0.75rem;
      color: #78666B;
      text-decoration: none;
    }
    .back:hover {
      color: #24191C;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="ticket">
      <span class="ticket-label">No.</span>
      <span class="ticket-num">${escapeHtml(product.number)}</span>
    </div>
    ${escapedImage ? `<img src="${escapedImage}" alt="" class="thumb" onerror="this.remove()" />` : ''}
    <h1>${escapedTitle}</h1>
    <p>Mengalihkan ke aplikasi ${platformName}...</p>
    <div class="progress" aria-hidden="true"><div class="progress-bar"></div></div>
    <a href="${escapedUrl}" class="btn" rel="noreferrer">Buka di ${platformName}</a>
    <a href="/" class="back">← Kembali ke katalog</a>
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
