import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CONTENT_API = 'https://speakeo-content.pages.dev/v1';
const TTS_API = 'https://makoa-ai.pages.dev/api/tts';
const VOICE = 'am_puck';
const SPEEDS = [0.75, 1.0, 1.25];
const AUDIO_ROOT = path.join(__dirname, 'audio/v1/english/tongue-twisters');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function ask(question) {
  return new Promise((resolve) => {
    rl.question(question, resolve);
  });
}

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.json();
}

async function getPackList(category) {
  const url = `${CONTENT_API}/english/tongue-twisters/${category}/collection.json`;
  const data = await fetchJSON(url);
  const key = category === 'practice-by-sound' ? 'sounds' : category === 'mixed' ? 'packs' : 'challenges';
  return data[key] || [];
}

async function getPackItems(category, packId) {
  const url = `${CONTENT_API}/english/tongue-twisters/${category}/${packId}.json`;
  const data = await fetchJSON(url);
  return data.items || [];
}

async function getAllValidItems() {
  const categories = ['practice-by-sound', 'mixed', 'pro'];
  const valid = {};
  for (const cat of categories) {
    const packs = await getPackList(cat);
    for (const pack of packs) {
      const items = await getPackItems(cat, pack.id);
      for (const item of items) {
        valid[item.id] = { category: cat, packId: pack.id };
      }
    }
  }
  return valid;
}

async function listPacks() {
  const categories = ['practice-by-sound', 'mixed', 'pro'];
  console.log('\n📦 Packs disponibles :');
  for (const cat of categories) {
    const packs = await getPackList(cat);
    console.log(`\n${cat} (${packs.length} packs):`);
    for (const p of packs) {
      const items = await getPackItems(cat, p.id);
      console.log(`  - ${p.id} (${items.length} items)`);
    }
  }
}

async function generatePack(category, packId) {
  const items = await getPackItems(category, packId);
  if (!items.length) {
    console.log(`⚠️  Aucun item trouvé pour le pack ${packId}`);
    return;
  }
  console.log(`🎤 Génération audio pour ${category}/${packId} (${items.length} items)...`);
  const dir = path.join(AUDIO_ROOT, category, packId);
  fs.mkdirSync(dir, { recursive: true });

  for (const item of items) {
    const text = item.text;
    if (!text) continue;
    for (const speed of SPEEDS) {
      const speedStr = speed === 1.0 ? '1.0' : speed.toString().replace('.', '_');
      const filename = `${item.id}_${speedStr}x.mp3`;
      const filePath = path.join(dir, filename);
      if (fs.existsSync(filePath)) {
        console.log(`  ✅ ${filename} existe déjà`);
        continue;
      }
      console.log(`  🎤 ${filename}...`);
      try {
        const url = `${TTS_API}?text=${encodeURIComponent(text)}&voice=${VOICE}&speed=${speed}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`TTS error ${res.status}`);
        const buffer = await res.arrayBuffer();
        fs.writeFileSync(filePath, Buffer.from(buffer));
        console.log(`  ✅ ${filename} enregistré`);
      } catch (err) {
        console.error(`  ❌ Échec pour ${filename}:`, err.message);
      }
      await new Promise(r => setTimeout(r, 300));
    }
  }
  console.log(`✅ Génération terminée pour ${packId}`);
}

function removePackAudio(category, packId) {
  const dir = path.join(AUDIO_ROOT, category, packId);
  if (!fs.existsSync(dir)) {
    console.log(`⚠️  Le dossier ${dir} n'existe pas.`);
    return;
  }
  const files = fs.readdirSync(dir);
  if (files.length === 0) {
    fs.rmdirSync(dir);
    console.log(`🗑️  Dossier vide supprimé : ${dir}`);
  } else {
    fs.rmSync(dir, { recursive: true, force: true });
    console.log(`🗑️  Dossier supprimé : ${dir}`);
  }
}

async function removeOrphans() {
  console.log('🔍 Récupération des items valides depuis le serveur...');
  const valid = await getAllValidItems();
  const validIds = new Set(Object.keys(valid));
  console.log(`✅ ${validIds.size} items valides trouvés.`);

  let deleted = 0;
  const categories = ['practice-by-sound', 'mixed', 'pro'];
  for (const cat of categories) {
    const dir = path.join(AUDIO_ROOT, cat);
    if (!fs.existsSync(dir)) continue;
    const packs = fs.readdirSync(dir);
    for (const packId of packs) {
      const packDir = path.join(dir, packId);
      if (!fs.statSync(packDir).isDirectory()) continue;
      const files = fs.readdirSync(packDir);
      for (const file of files) {
        if (!file.endsWith('.mp3')) continue;
        const itemId = file.split('_')[0];
        if (!validIds.has(itemId)) {
          const filePath = path.join(packDir, file);
          fs.unlinkSync(filePath);
          console.log(`🗑️  Supprimé : ${filePath}`);
          deleted++;
        }
      }
      // Si le dossier est vide, on le supprime
      if (fs.readdirSync(packDir).length === 0) {
        fs.rmdirSync(packDir);
        console.log(`🗑️  Dossier vide supprimé : ${packDir}`);
      }
    }
  }
  console.log(`✅ ${deleted} fichiers orphelins supprimés.`);
}

async function main() {
  console.log('\n🎧 Speakeo Audio Manager');
  console.log('========================');

  while (true) {
    console.log('\nMenu :');
    console.log('  1. Lister tous les packs');
    console.log('  2. Générer l\'audio d\'un pack');
    console.log('  3. Supprimer l\'audio d\'un pack');
    console.log('  4. Nettoyer les fichiers orphelins');
    console.log('  5. Quitter');

    const choice = await ask('Choisissez une option (1-5) : ');

    switch (choice.trim()) {
      case '1':
        await listPacks();
        break;
      case '2': {
        const category = await ask('Catégorie (practice-by-sound, mixed, pro) : ');
        const packId = await ask('ID du pack : ');
        await generatePack(category.trim(), packId.trim());
        break;
      }
      case '3': {
        const category = await ask('Catégorie (practice-by-sound, mixed, pro) : ');
        const packId = await ask('ID du pack : ');
        removePackAudio(category.trim(), packId.trim());
        break;
      }
      case '4':
        await removeOrphans();
        break;
      case '5':
        console.log('👋 Au revoir !');
        rl.close();
        return;
      default:
        console.log('❌ Option invalide.');
    }
  }
}

main().catch(err => {
  console.error('Erreur :', err);
  rl.close();
});
