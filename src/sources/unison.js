const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const BASE = 'https://unison.audio';
const LIST_URL = `${BASE}/free-packs/`;

let cache = { at: 0, data: null };
const CACHE_TTL = 10 * 60 * 1000;

function titleFromSlug(slug) {
  return decodeURIComponent(slug)
    .split('-')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

async function fetchFreePacks() {
  if (cache.data && Date.now() - cache.at < CACHE_TTL) return cache.data;
  const res = await fetch(LIST_URL, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();

  const items = [];
  const seen = new Set();

  const products = [];
  const prodRe = /href="(https:\/\/unison\.audio\/product\/([^"/?#]+))\/?"/g;
  let pm;
  while ((pm = prodRe.exec(html))) {
    products.push({ url: pm[1], slug: pm[2], used: false });
  }

  const demos = [...new Set((html.match(/data-file="([^"]+\.mp3)"/g) || []).map((s) => s.replace(/^data-file="|"$/g, '')))];

  const tokens = (str) =>
    decodeURIComponent(str)
      .toLowerCase()
      .replace(/\.mp3$|demo/gi, ' ')
      .split(/[+\s%._,-]+/)
      .filter((w) => w && w.length > 2 && w !== 'free');

  for (const mp3 of demos) {
    if (seen.has(mp3)) continue;
    const demoTokens = tokens(mp3.split('/').pop() || '');
    let best = null;
    let bestScore = 0;
    for (const p of products) {
      if (p.used) continue;
      const slugTokens = tokens(p.slug.replace(/-/g, ' '));
      const score = slugTokens.filter((w) => demoTokens.includes(w)).length;
      if (score > bestScore) {
        best = p;
        bestScore = score;
      }
    }
    const matched = bestScore >= 2 ? best : null;
    if (matched) matched.used = true;
    seen.add(mp3);
    const proxied = `/proxy?url=${encodeURIComponent(mp3)}`;
    const title = matched ? titleFromSlug(matched.slug) : titleFromSlug((mp3.split('/').pop() || '').replace(/\.mp3$/i, ''));
    items.push({
      id: `un-${matched ? matched.slug : items.length}`,
      source: 'unison',
      title,
      author: 'Unison Audio',
      duration: null,
      size: null,
      previewUrl: proxied,
      downloadUrl: proxied,
      filename: decodeURIComponent(mp3.split('/').pop() || 'demo.mp3'),
      pageUrl: matched ? matched.url : LIST_URL,
      license: 'Grátis — demo oficial; pack completo grátis no site (cadastro)',
      licenseUrl: matched ? matched.url : LIST_URL,
      genre: null,
      bpm: null,
      key: null,
      sig: null,
    });
  }

  if (!items.length) throw new Error('Lista de packs gratuitos não encontrada (site pode ter mudado)');
  cache = { at: Date.now(), data: items };
  return items;
}

function titleMatches(title, words) {
  const t = title.toLowerCase();
  const norm = (w) => (w.endsWith('s') && w.length > 3 ? w.slice(0, -1) : w);
  return words.every((w) => t.includes(norm(w)) || t.includes(w));
}

async function searchUnison(term, { maxResults = 8 } = {}) {
  const packs = await fetchFreePacks();
  const words = String(term).toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  if (!words.length) return [];
  const matched = packs.filter((p) => titleMatches(p.title, words));
  const picked = matched.length ? matched : packs.filter((p) => words.some((w) => p.title.toLowerCase().includes(w)));
  return picked.slice(0, maxResults);
}

module.exports = { searchUnison };
