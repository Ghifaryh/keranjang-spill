# 🌸 KeranjangSpill

A high-performance, mobile-first affiliate link-in-bio web application for Indonesian social media creators (TikTok & Instagram).

Followers locate recommended products via a designated **Product Number** mentioned in videos, search with zero latency (<5ms), and click through tracking redirects directly into native e-commerce apps (Shopee / TikTok Shop / Tokopedia).

The creator manages links remotely via a private **Telegram Bot** backed by **Google Sheets** (as CMS) and a local **SQLite** cache with sub-10ms response times.

---

## ✨ Features

- **⚡ Zero-Latency Instant Search**: Real-time client-side DOM filtering in vanilla JS (<5ms). Supports numeric (`123`) and text (`ABC`) search modes.
- **📱 Mobile-First Aesthetic**: Optimized for mobile viewports with soft rose-pink gradients, sticky frosted-glass search bar, verified badge, and product thumbnails.
- **🤖 Private Telegram Bot CMS**: Add products on the go from your phone by sending:
  `45 - Kemeja Oversize Linen - https://s.shopee.co.id/abc1234`
  Supports photo attachments with caption, `/list`, `/delete <number>`, and `/sync`.
- **📊 Anti-Spam Click Tracking**:
  - Automatically filters crawler and bot user-agents (`Bytespider`, `Googlebot`, etc.).
  - SHA-256 IP + User-Agent deduplication with a 30-minute window prevents inflated click metrics.
- **🚀 In-App Browser Compatibility**: Special fallback deep-link buttons and meta navigation to seamlessly navigate past TikTok and Instagram in-app webviews.
- **🛡️ Google Sheets Graceful Fallback**: If Google Sheets is unreachable or rate-limited, Astro continues serving traffic uninterrupted from local SQLite.
- **🐳 Docker & Portainer Ready**: Containerized with multi-stage Docker build and persistent SQLite data volume.

---

## 🛠️ Tech Stack

- **Framework**: [Astro 5+](https://astro.build) in SSR mode with `@astrojs/node`
- **Styling**: [Tailwind CSS v4](https://tailwindcss.com)
- **Local Database**: [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) (WAL mode enabled)
- **CMS / Cloud Backup**: [Google Sheets API v4](https://developers.google.com/sheets/api) via `googleapis`
- **Admin Channel**: Telegram Bot Webhook API

---

## 🚀 Quick Start (Local Development)

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```

### 3. Run Development Server
```bash
npm run dev
```
Open [http://localhost:4321](http://localhost:4321) in your browser (switch to Mobile view in DevTools).

---

## 🤖 Telegram Bot Configuration

1. Create a bot using [@BotFather](https://t.me/BotFather) on Telegram and copy the `TELEGRAM_BOT_TOKEN`.
2. Find your personal Telegram user ID using [@userinfobot](https://t.me/userinfobot) and set `TELEGRAM_ALLOWED_USER_ID`. *(All other users will receive a 403 Forbidden).*
3. Set your webhook URL:
```bash
curl -X POST "https://api.telegram.org/bot<YOUR_TOKEN>/setWebhook?url=https://spill.yourdomain.com/api/telegram"
```
*(Optional: include `&secret_token=<YOUR_SECRET>` and match `TELEGRAM_WEBHOOK_SECRET`).*

### Bot Commands & Usage
- **Add product**: Send message `45 - Kemeja Linen - https://s.shopee.co.id/xyz` *(or upload a photo with that caption)*.
- **List products**: `/list`
- **Delete product**: `/delete 45` or `/hapus 45`
- **Sync cache from Sheets**: `/sync`
- **Help**: `/help`

---

## 📊 Google Sheets Setup (Optional CMS)

1. Create a Google Spreadsheet with sheet name `Products`.
2. Define column headers in row 1:
   `Number | Title | Affiliate Link | Original Link | Image URL | Timestamp | Active Status`
3. Create a Google Cloud Service Account, grant **Editor** access to the spreadsheet, and pass the JSON key via `GOOGLE_SERVICE_ACCOUNT_KEY` (base64 or raw JSON) and `GOOGLE_SHEET_ID`.

---

## 🐳 Deployment with Docker / Portainer

### 1. Build and Run via Docker Compose
```bash
docker compose up -d --build
```

### 2. Portainer Configuration
- **Stack Name**: `keranjangspill`
- **Repository**: Point to your Git repo
- **Volume**: Map `./data` to `/app/data` (stores `keranjang.db`)
- **Port**: `4321:4321`

---

## 🛣️ API Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/` | `GET` | Mobile visitor link-in-bio page |
| `/go/:id` | `GET` | Tracking redirect to affiliate link with anti-spam |
| `/api/telegram` | `POST` | Webhook endpoint for Telegram Bot updates |
| `/api/sync` | `GET`/`POST` | Trigger sync from Google Sheets to SQLite |
