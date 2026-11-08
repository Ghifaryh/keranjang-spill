import fs from 'node:fs';
import path from 'node:path';
import {
  getSheetsClient,
  ensureSheetHeaders,
  beautifySheet,
  pushLocalProductsToSheet,
  syncFromSheets,
} from '../src/lib/sheets';

function autoEncodeLocalJsonToEnv(): void {
  const envPath = path.join(process.cwd(), '.env');
  const localJsonPath = path.join(process.cwd(), 'service-account.json');

  if (fs.existsSync(localJsonPath)) {
    const rawJson = fs.readFileSync(localJsonPath, 'utf-8').trim();
    const b64 = Buffer.from(rawJson, 'utf-8').toString('base64');

    if (!process.env.GOOGLE_SERVICE_ACCOUNT_KEY?.trim()) {
      process.env.GOOGLE_SERVICE_ACCOUNT_KEY = b64;
    }

    if (fs.existsSync(envPath)) {
      const envContent = fs.readFileSync(envPath, 'utf-8');
      if (/^GOOGLE_SERVICE_ACCOUNT_KEY=.*$/m.test(envContent)) {
        const updated = envContent.replace(
          /^GOOGLE_SERVICE_ACCOUNT_KEY=.*$/m,
          `GOOGLE_SERVICE_ACCOUNT_KEY=${b64}`
        );
        fs.writeFileSync(envPath, updated, 'utf-8');
      } else {
        fs.appendFileSync(envPath, `\nGOOGLE_SERVICE_ACCOUNT_KEY=${b64}\n`, 'utf-8');
      }
      fs.unlinkSync(localJsonPath);
      console.log('✨ Auto-encoded service-account.json -> GOOGLE_SERVICE_ACCOUNT_KEY in .env (and removed plaintext service-account.json)!');
    }
  }
}

async function runSetup(): Promise<void> {
  console.log('====================================================');
  console.log('   📊 KERANJANGSPILL GOOGLE SHEETS SETUP & TEST');
  console.log('====================================================\n');

  autoEncodeLocalJsonToEnv();

  const sheetId = process.env.GOOGLE_SHEET_ID?.trim();
  const hasKey = Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_KEY?.trim());

  if (!sheetId || !hasKey) {
    console.log('⚠️  Missing configuration in .env:\n');
    if (!sheetId) {
      console.log('  ❌ GOOGLE_SHEET_ID is empty.');
      console.log('     -> Create a blank Google Sheet and copy the ID from its URL:');
      console.log('        https://docs.google.com/spreadsheets/d/<GOOGLE_SHEET_ID>/edit\n');
    }
    if (!hasKey) {
      console.log('  ❌ GOOGLE_SERVICE_ACCOUNT_KEY is empty.');
      console.log('     -> Option A: Drop your downloaded key file as `service-account.json` in this folder');
      console.log('     -> Option B: Paste the JSON (or Base64 JSON) into GOOGLE_SERVICE_ACCOUNT_KEY in .env\n');
    }
    process.exit(1);
  }

  const client = getSheetsClient();
  if (!client) {
    console.error('❌ Could not parse GOOGLE_SERVICE_ACCOUNT_KEY. Make sure it is valid Service Account JSON or Base64.');
    process.exit(1);
  }

  console.log(`🔑 Service Account Email: ${client.clientEmail || 'Unknown'}`);
  console.log(`📄 Target Google Sheet ID: ${client.sheetId}`);
  console.log('   (Make sure you clicked "Share" on your Google Sheet and gave Editor access to the email above!)\n');

  console.log('1️⃣ Checking connection & initializing header row...');
  const headerRes = await ensureSheetHeaders();
  if (!headerRes.ok) {
    console.error(`\n❌ Failed to access Google Sheet: ${headerRes.error}`);
    console.error('\n💡 Checklist:');
    console.error('   1. Did you enable "Google Sheets API" in Google Cloud Console?');
    console.error(`   2. Did you Share the Google Sheet with "${client.clientEmail}" as Editor?`);
    process.exit(1);
  }
  console.log(`✅ Connected to sheet tab "${headerRes.tabName}" and verified headers!\n`);

  console.log('2️⃣ Applying Boutique Theme & Column Formatting...');
  const styleRes = await beautifySheet();
  if (styleRes.ok) {
    console.log('✨ Styled headers, column widths, alternating rows, and status badges!\n');
  } else {
    console.warn(`⚠️  Could not apply some styles: ${styleRes.error}\n`);
  }

  console.log('3️⃣ Pushing existing local SQLite products to Google Sheet...');
  const pushRes = await pushLocalProductsToSheet();
  console.log(`✅ Synced ${pushRes.pushed} local products to Google Sheet!\n`);

  console.log('4️⃣ Pulling from Google Sheet back to local SQLite...');
  const pullRes = await syncFromSheets();
  console.log(`✅ Pulled ${pullRes.count} active products from Google Sheet!\n`);

  console.log('🎉 Google Sheets integration is 100% working!');
}

runSetup();

