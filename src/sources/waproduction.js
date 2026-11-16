const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const BASE = 'https://www.waproduction.com';
const LIST_URL = `${BASE}/sounds/items/free`;

let cache = { at: 0, data: null };
const CACHE_TTL = 10 * 60 * 1000;

function decodeEntities(s) {
  return String(s)
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

async function fetchFreeItems() {
  if (cache.data && Date.now() - cache.at < CACHE_TTL) return cache.data;
  const res = await fetch(LIST_URL, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();

  const items = [];
  const seen = new Set();
  const re = /alt="([^"]{3,140})"[^>]*>[\s\S]{0,200}?data-id="(\d+)"[^>]*data-track="([^"]+\.mp3)"/g;
  let m;
  while ((m = re.exec(html))) {
    const [, rawTitle, id, mp3] = m;
    if (seen.has(mp3)) continue;
    seen.add(mp3);
    const title = decodeEntities(rawTitle).trim();
    const proxied = `/proxy?url=${encodeURIComponent(mp3)}`;
    items.push({
      id: `wa-${id}`,
      source: 'waproduction',
      title,
      author: 'W. A. Production',
      duration: null,
      size: null,
      previewUrl: proxied,
      downloadUrl: proxied,
      filename: decodeURIComponent(mp3.split('/').pop() || 'preview.mp3'),
      pageUrl: LIST_URL,
      license: 'Grátis — preview oficial; pack completo via cadastro no site',
      licenseUrl: LIST_URL,
      genre: null,
      bpm: null,
      key: null,
      sig: null,
    });
  }

  if (!items.length) throw new Error('Lista de itens gratuitos não encontrada (site pode ter mudado)');
  cache = { at: Date.now(), data: items };
  return items;
}

function titleMatches(title, words) {
  const t = title.toLowerCase();
  const norm = (w) => (w.endsWith('s') && w.length > 3 ? w.slice(0, -1) : w);
  return words.every((w) => t.includes(norm(w)) || t.includes(w));
}

async function searchWAProduction(term, { maxResults = 8 } = {}) {
  const items = await fetchFreeItems();
  const words = String(term).toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  if (!words.length) return [];
  const matched = items.filter((p) => titleMatches(p.title, words));
  const picked = matched.length ? matched : items.filter((p) => words.some((w) => p.title.toLowerCase().includes(w)));
  return picked.slice(0, maxResults);
}

module.exports = { searchWAProduction };
