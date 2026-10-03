# Product Requirements Document (PRD): Affiliate Link-in-Bio Site

## 1. Product Overview
**Working Title:** KeranjangInten (TBD)
**Objective:** To build a lightning-fast, mobile-first link-in-bio website that allows followers from TikTok and Instagram to easily find and click affiliate product links using a designated "Product Number" mentioned in short-form videos.
**Primary User:** Shopee and TikTok users (mobile).
**Admin User:** The affiliate marketer (Creator), updating links via mobile without breaking their workflow.

## 2. Target Audience & Problem Statement
*   **Audience:** Indonesian social media users with short attention spans. They are primarily on mobile devices and will bounce if a page takes more than 3 seconds to load.
*   **Problem:** Standard link-in-bio tools require scrolling through endless lists. The Creator needs a frictionless way to say "Product is at number 45," allowing the user to instantly search and click "45" to open the native e-commerce app.
*   **Admin Problem:** The Creator finds it tedious to manually update a website backend or spreadsheet while switching back and forth from the TikTok/Shopee apps on their phone.

## 3. Technical Architecture
*   **Frontend Framework:** Astro (using Hybrid/SSR mode for dynamic link fetching or SSG with instant rebuilds).
*   **Interactivity:** Vanilla JS or lightweight Vue components (via Astro Islands) strictly for the search filter.
*   **Database:** Google Sheets (acts as the CMS).
*   **Admin Interface:** Telegram Bot (Listens for messages, extracts data, writes to Google Sheets).
*   **Tracking/Redirect Service:** A lightweight Go or Node.js/ElysiaJS backend to handle `/go/:id` endpoints, log clicks, and redirect.
*   **Infrastructure:** Self-hosted VPS using Docker and Portainer.

## 4. User Journeys (Flows)

### 4.1 Admin Flow (Adding a Product)
1. Creator copies an affiliate link from the Shopee/TikTok app.
2. Creator opens the private Telegram Bot.
3. Creator sends a message formatted as: `<Number> - <Product Name> - <Link>` (or the bot interactively asks for these).
4. Bot extracts metadata (if possible), formats it, and appends a new row to the Google Sheet.
5. Bot replies: "✅ Success! Product #45 added."
6. Frontend automatically reflects the new product (via SSR fetch or webhook trigger).

### 4.2 Visitor Flow (Finding & Clicking)
1. Visitor watches a video: *"Link di bio nomor 45 ya!"*
2. Visitor clicks the link in the Creator's bio.
3. Site loads instantly on mobile.
4. Visitor types "45" into the sticky search bar at the top.
5. The list instantly filters to show Product #45.
6. Visitor clicks the product card.
7. The redirect service intercepts the click (logs it) and immediately redirects to the affiliate URL.
8. The OS intercepts the URL and opens the native Shopee/TikTok app.

## 5. Core Features & Requirements

### 5.1 Frontend (User Facing)
*   **Mobile-First UI:** Viewport locked to mobile dimensions, large tap targets (minimum 44x44px).
*   **Sticky Search Bar:** Always visible at the top of the screen. Numeric keypad triggered by default on mobile (`type="number"` or `inputmode="numeric"`).
*   **Instant Filtering:** As the user types "4", only numbers starting with or containing "4" show up. Zero latency.
*   **Product Card Layout:**
    *   Prominent Number Badge (e.g., a bold circle in the top left corner).
    *   Product Thumbnail (Optional but recommended for visual confirmation).
    *   Truncated Product Title.
    *   Clear CTA Button ("Cek Shopee" / "Cek TikTok").
*   **Pagination/Infinite Scroll:** Lazy load images to save bandwidth, load items in batches of 50 to maintain performance.

### 5.2 Backend & Data Management
*   **Google Sheets Integration:** Standardized columns: `Number | Title | Affiliate Link | Original Link | Timestamp | Active Status`.
*   **Telegram Bot Webhook:** Needs to handle basic commands (`/add`, `/edit`, `/delete`) or parse natural text input.

### 5.3 Click Tracking & Anti-Spam
*   **Redirect Endpoint:** All frontend links point to `yoursite.com/go/123`.
*   **Spam Prevention Logic:** 
    *   Hash the visitor's IP + User-Agent.
    *   Store in memory/Redis with a 30-minute TTL.
    *   If the same hash clicks the same product ID within 30 minutes, redirect them, but do *not* increment the click counter.
    *   Reject requests from known bot User-Agents.

## 6. UI/UX Wireframe Guidelines
*   **Header:** Clean, Creator's profile picture, short bio, and the Search Bar immediately below.
*   **Background:** Clean, solid color or subtle gradient (no heavy background images to preserve load time).
*   **List Style:** Single-column stacked cards to maximize readable text size on mobile.

## 7. Future Scope (Phase 2)
*   **Categories:** Tabs for "Fashion", "Skincare", "Home", etc.
*   **Out of Stock Tagging:** Ability via Telegram to mark an item as "Habis" so users know before clicking.
*   **Analytics Dashboard:** A simple web view for the Creator to see the top 10 most clicked numbers this week.
