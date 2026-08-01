import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const CONTENT_BASE = 'https://speakeo-content.pages.dev/v1';
const TTS_API = 'https://makoa-ai.pages.dev/api/tts';
const VOICE = 'en_US-amy-medium';
const SPEEDS = [0.75, 1.0, 1.25];
const OUTPUT_ROOT = path.join(__dirname, '../audio/v1');
const LANG = 'english';  // ← Correction : 'english' au lieu de 'en'

// Catégories
const CATEGORIES = [
  { name: 'practice-by-sound', packKey: 'sounds' },
  { name: 'mixed', packKey: 'packs' },
  { name: 'pro', packKey: 'challenges' },
];

// Headers pour éviter le blocage Cloudflare
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'identity',
  'Cache-Control': 'no-cache',
  'Pragma': 'no-cache',
  'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
  'Sec-Ch-Ua-Mobile': '?0',
  'Sec-Ch-Ua-Platform': '"Windows"',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'cross-site',
};

async function fetchWithRetry(url, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      console.log(`  🌐 Fetching: ${url}`);
      const response = await fetch(url, { headers: HEADERS });
      
      let body = '';
      try {
        const cloned = response.clone();
        body = await cloned.text();
        if (body.length > 500) body = body.substring(0, 500) + '...';
      } catch (_) {}
      
      if (!response.ok) {
        console.log(`  📄 Response (${response.status}): ${body || '(empty)'}`);
        throw new Error(`HTTP ${response.status}`);
      }
      
      return await response.json();
    } catch (e) {
      if (i === retries - 1) {
        console.error(`  ❌ Failed after ${retries} attempts:`, e.message);
        throw e;
      }
      console.log(`  ⏳ Retry ${i + 1}/${retries}...`);
      await new Promise(r => setTimeout(r, 2000 * (i + 1)));
    }
  }
}

async function generateAudio(text, speed) {
  const url = `${TTS_API}?text=${encodeURIComponent(text)}&voice=${VOICE}&speed=${speed}`;
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'audio/mpeg,audio/*;q=0.9',
      'Accept-Encoding': 'identity',
    },
  });
  if (!response.ok) throw new Error(`TTS API error ${response.status}`);
  const buffer = await response.arrayBuffer();
  return Buffer.from(buffer);
}

async function main() {
  console.log('🚀 Starting audio generation...');
  console.log(`📁 Output directory: ${OUTPUT_ROOT}`);
  console.log(`🎤 Voice: ${VOICE}`);
  console.log(`⚡ Speeds: ${SPEEDS.join(', ')}x\n`);

  let totalFiles = 0;
  let totalSize = 0;

  for (const category of CATEGORIES) {
    console.log(`\n📁 Processing ${category.name}...`);
    const collectionUrl = `${CONTENT_BASE}/${LANG}/tongue-twisters/${category.name}/collection.json`;
    const collection = await fetchWithRetry(collectionUrl);
    const packList = collection[category.packKey] || [];

    for (const packMeta of packList) {
      const packId = packMeta.id;
      console.log(`  📦 Pack: ${packId}`);

      const packUrl = `${CONTENT_BASE}/${LANG}/tongue-twisters/${category.name}/${packId}.json`;
      const packData = await fetchWithRetry(packUrl);
      const items = packData.items || [];

      for (const item of items) {
        const itemId = item.id;
        const text = item.text;
        if (!text) {
          console.warn(`    ⚠️  Skipping ${itemId}: no text`);
          continue;
        }

        for (const speed of SPEEDS) {
          const speedStr = speed === 1.0 ? '1.0' : speed.toString().replace('.', '_');
          const filename = `${itemId}_${speedStr}x.mp3`;
          const dirPath = path.join(OUTPUT_ROOT, LANG, 'tongue-twisters', category.name, packId);
          const filePath = path.join(dirPath, filename);

          if (fs.existsSync(filePath)) {
            console.log(`    ✅ ${filename} already exists. Skipping.`);
            continue;
          }

          console.log(`    🎤 Generating ${filename} (speed ${speed})...`);
          try {
            const audioBuffer = await generateAudio(text, speed);
            fs.mkdirSync(dirPath, { recursive: true });
            fs.writeFileSync(filePath, audioBuffer);
            const size = audioBuffer.length;
            totalSize += size;
            totalFiles++;
            console.log(`    ✅ Saved ${filename} (${(size / 1024).toFixed(1)} KB)`);
          } catch (err) {
            console.error(`    ❌ Failed to generate ${filename}:`, err.message);
          }

          await new Promise(r => setTimeout(r, 300));
        }
      }
    }
  }

  // Créer un index
  console.log('\n📝 Generating index...');
  const indexData = {
    version: '1.0.0',
    generated: new Date().toISOString(),
    voice: VOICE,
    speeds: SPEEDS,
    base_path: `/v1/${LANG}/tongue-twisters/`,
    files: {
      total: totalFiles,
      totalSizeMB: (totalSize / 1024 / 1024).toFixed(2),
    },
  };
  fs.writeFileSync(path.join(OUTPUT_ROOT, 'index.json'), JSON.stringify(indexData, null, 2));

  console.log('\n✅ Audio generation complete!');
  console.log(`📁 Files saved in: ${OUTPUT_ROOT}`);
  console.log(`📊 Total files: ${totalFiles}`);
  console.log(`📊 Total size: ${(totalSize / 1024 / 1024).toFixed(2)} MB`);
}

main().catch(console.error);
