const cheerio = require('cheerio');

const BASE = 'https://www.loopmasters.com';
const FREE_SAMPLES_URL = `${BASE}/genres/136-Free-Samples`;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

let cache = { at: 0, data: null };
const CACHE_TTL = 10 * 60 * 1000;

async function fetchFreePacks() {
  if (cache.data && Date.now() - cache.at < CACHE_TTL) return cache.data;
  const res = await fetch(FREE_SAMPLES_URL, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const $ = cheerio.load(await res.text());

  const tracks = {};
  $('[data-track-url][data-track-id]').each((_, el) => {
    tracks[$(el).attr('data-track-id')] = $(el).attr('data-track-url');
  });

  const items = [];
  const seen = new Set();
  $('a[href*="/products/"]').each((_, el) => {
    const href = $(el).attr('href') || '';
    if (seen.has(href)) return;
    seen.add(href);
    const m = href.match(/\/products\/(\d+)/);
    if (!m) return;
    const text = ($(el).text() || '').replace(/\s+/g, ' ').trim();
    if (!/\$0\.00/.test(text)) return;

    const title = (text.split('Genre:')[0] || '').trim() || `Free Sample Pack ${m[1]}`;
    const genre = (text.match(/Genre:\s*(.*?)\s*Label:/) || [])[1] || 'Free Samples';
    const label = (text.match(/Label:\s*(.*?)\s*Contains:/) || [])[1] || null;
    const demo = tracks[m[1]] || null;

    items.push({
      id: `lms-${m[1]}`,
      source: 'loopmasters',
      title,
      author: label,
      duration: null,
      size: null,
      previewUrl: demo ? `/proxy?url=${encodeURIComponent(demo)}` : null,
      downloadUrl: demo ? `/proxy?url=${encodeURIComponent(demo)}` : null,
      filename: demo ? decodeURIComponent(demo.split('/').pop() || 'demo.mp3') : null,
      pageUrl: `${BASE}${href}`,
      license: 'Grátis — demo oficial; pack completo via site (carrinho)',
      licenseUrl: null,
      genre: genre.trim(),
      bpm: null,
      key: null,
      sig: null,
    });
  });

  if (!items.length) throw new Error('Lista de packs gratuitos não encontrada (site pode ter mudado)');
  cache = { at: Date.now(), data: items };
  return items;
}

function titleMatches(title, words) {
  const t = title.toLowerCase();
  const norm = (w) => (w.endsWith('s') && w.length > 3 ? w.slice(0, -1) : w);
  return words.every((w) => t.includes(norm(w)) || t.includes(w));
}

async function searchLoopmasters(term, { maxResults = 8, filters = {} } = {}) {
  const packs = await fetchFreePacks();
  const words = String(term).toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  if (!words.length) return [];

  const matched = packs.filter((p) => titleMatches(p.title, words));
  const picked = (matched.length ? matched : packs.filter((p) => words.some((w) => p.title.toLowerCase().includes(w))));
  return picked.slice(0, maxResults);
}

module.exports = { searchLoopmasters };
