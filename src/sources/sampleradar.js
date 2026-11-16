const cheerio = require('cheerio');

const HUB_URL = 'https://www.musicradar.com/news/tech/free-music-samples-royalty-free-loops-hits-and-multis-to-download-sampleradar';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

let cache = { at: 0, data: null };
const CACHE_TTL = 60 * 60 * 1000;
const PACK_TTL = 6 * 60 * 60 * 1000;
const packCache = new Map();

async function fetchPacksIndex() {
  if (cache.data && Date.now() - cache.at < CACHE_TTL) return cache.data;
  const res = await fetch(HUB_URL, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const $ = cheerio.load(await res.text());

  const packs = [];
  const seen = new Set();
  $('a[href]').each((_, el) => {
    const href = ($(el).attr('href') || '').trim();
    if (seen.has(href)) return;
    seen.add(href);
    const t = ($(el).text() || '').replace(/\s+/g, ' ').trim();
    const isPack =
      /musicradar\.com/.test(href) &&
      href !== HUB_URL &&
      (/\bfree\b/i.test(t) && /\bsamples?\b/i.test(t) || /sampleradar/i.test(t)) &&
      t.length > 12 &&
      t.length < 150;
    if (!isPack) return;
    const title = /sampleradar:\s*/i.test(t) ? t : t;
    packs.push({
      pageUrl: href.startsWith('http') ? href : `https://www.musicradar.com${href}`,
      title: title.replace(/\s*\|.*$/, '').trim(),
    });
  });

  if (!packs.length) throw new Error('Índice do SampleRadar não encontrado (site pode ter mudado)');
  cache = { at: Date.now(), data: packs };
  return packs;
}

async function pool(items, limit, worker) {
  const out = new Array(items.length);
  let i = 0;
  async function run() {
    while (i < items.length) {
      const idx = i++;
      try {
        out[idx] = await worker(items[idx]);
      } catch {
        out[idx] = null;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return out;
}

function titleMatches(title, words) {
  const t = title.toLowerCase();
  const norm = (w) => (w.endsWith('s') && w.length > 3 ? w.slice(0, -1) : w);
  return words.every((w) => t.includes(norm(w)) || t.includes(w));
}

async function searchSampleRadar(term, { maxResults = 15, filters = {} } = {}) {
  const packs = await fetchPacksIndex();
  const words = String(term).toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  if (!words.length) return [];

  const matched = packs.filter((p) => titleMatches(p.title, words));
  const picked = (matched.length ? matched : packs.filter((p) => words.some((w) => p.title.toLowerCase().includes(w)))).slice(0, maxResults);

  const enriched = await pool(picked, 4, async (pack) => {
    const hit = packCache.get(pack.pageUrl);
    if (hit && Date.now() - hit.at < PACK_TTL) return hit.data;

    const res = await fetch(pack.pageUrl, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    const $ = cheerio.load(html);
    const zip = html.match(/https:\/\/cdn\.mos\.musicradar\.com\/audio\/samples\/[^"'\s)]+\.zip/);
    if (!zip) return null;
    const sizeM = html.match(new RegExp(`${zip[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^<]*\\((\\d+)\\s*MB\\)`));
    const size = sizeM ? `${sizeM[1]} MB` : null;
    const pageTitle = ($('meta[property="og:title"]').attr('content') || pack.title).replace(/\s*\|\s*MusicRadar.*$/i, '').trim();

    const item = {
      id: `sr-${pack.pageUrl.split('/').filter(Boolean).pop()}`,
      source: 'sampleradar',
      title: pageTitle,
      author: 'MusicRadar / SampleRadar',
      duration: null,
      size,
      previewUrl: null,
      downloadUrl: `/proxy?url=${encodeURIComponent(zip[0])}`,
      filename: decodeURIComponent(zip[0].split('/').pop() || 'samples.zip'),
      pageUrl: pack.pageUrl,
      license: 'Uso livre — SampleRadar (ver página)',
      licenseUrl: pack.pageUrl,
      genre: null,
      bpm: null,
      key: null,
      sig: null,
    };
    packCache.set(pack.pageUrl, { at: Date.now(), data: item });
    return item;
  });

  return enriched.filter(Boolean);
}

module.exports = { searchSampleRadar };
