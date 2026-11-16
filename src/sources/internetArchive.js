const ADV_SEARCH = 'https://archive.org/advancedsearch.php';
const FIELDS = ['identifier', 'title', 'creator', 'year', 'licenseurl', 'downloads'];

function licenseLabel(url) {
  if (!url) return null;
  if (/publicdomain\/zero/.test(url)) return 'CC0 1.0';
  if (/publicdomain\/mark/.test(url)) return 'Public Domain Mark';
  const m = url.match(/creativecommons\.org\/licenses\/([^/]+)\/([0-9.]+)/);
  if (m) return `CC ${m[1].replace(/-/g, ' ').toUpperCase()} ${m[2]}`;
  return null;
}

async function fetchJson(url, timeoutMs = 10000) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { 'User-Agent': 'SampleFinder/1.0 (+educational use)' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchJsonRetry(url, timeoutMs = 10000) {
  try {
    return await fetchJson(url, timeoutMs);
  } catch {
    await new Promise((r) => setTimeout(r, 1500));
    return fetchJson(url, timeoutMs);
  }
}

async function pool(items, limit, worker) {
  const out = new Array(items.length);
  let i = 0;
  async function run() {
    while (i < items.length) {
      const idx = i++;
      try {
        out[idx] = await worker(items[idx], idx);
      } catch {
        out[idx] = null;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return out;
}

function shortAudioFile(files) {
  const audio = files.filter((f) => /\.(mp3|ogg|wav)$/i.test(f.name || ''));
  const mp3 = audio.filter((f) => /\.mp3$/i.test(f.name || ''));
  const len = (f) => parseFloat(f.length);
  // Prefere o arquivo mais substancial que ainda cabe no padrão de loop da interface (até 1 min).
  const shortLoop = mp3.filter((f) => len(f) >= 2 && len(f) <= 60).sort((a, b) => len(b) - len(a));
  if (shortLoop.length) return shortLoop[0];
  const medium = mp3.filter((f) => len(f) > 60 && len(f) <= 120).sort((a, b) => len(b) - len(a));
  if (medium.length) return medium[0];
  const short = mp3.filter((f) => len(f) > 0 && len(f) <= 120);
  if (short.length) return short[0];
  return (
    mp3.find((f) => f.format === 'VBR MP3') ||
    mp3[0] ||
    audio.find((f) => f.format === 'VBR MP3') ||
    audio[0] ||
    null
  );
}

function audioFileCount(files) {
  return files.filter((f) => /\.(mp3|ogg|wav)$/i.test(f.name || '')).length;
}

function extractBpm(text) {
  const m = String(text || '').match(/(\d{2,3}(?:\.\d+)?)\s*bpm/i);
  return m ? parseFloat(m[1]) : null;
}

async function searchArchive(term, { rows = 50, filters = {} } = {}) {
  const params = new URLSearchParams({
    q: `(${term}) AND mediatype:audio AND collection:opensource_audio`,
    rows: String(rows),
    page: '1',
    output: 'json',
    'sort[]': 'downloads desc',
  });
  for (const f of FIELDS) params.append('fl[]', f);

  const data = await fetchJsonRetry(`${ADV_SEARCH}?${params.toString()}`);
  const docs = (data.response && data.response.docs) || [];

  let failed = 0;
  const enriched = await pool(docs, 10, async (doc) => {
    try {
      const meta = await fetchJsonRetry(`https://archive.org/metadata/${encodeURIComponent(doc.identifier)}`, 8000);
      const files = meta.files || [];
      const file = shortAudioFile(files);
      if (!file) return null;
      const base = `https://archive.org/download/${encodeURIComponent(doc.identifier)}/${encodeURIComponent(file.name)}`;
      const fileBase = decodeURIComponent(String(file.name).split('/').pop().replace(/\.[^.]+$/, ''));
      const docTitle = doc.title || fileBase || file.name;
      const multi = audioFileCount(files) > 1 && /[a-z]{2,}/i.test(fileBase) && String(docTitle).toLowerCase() !== fileBase.toLowerCase();
      return {
        id: `ia-${doc.identifier}`,
        source: 'archive',
        title: multi ? `${docTitle} — ${fileBase}` : docTitle,
        author: doc.creator ? (Array.isArray(doc.creator) ? doc.creator.join(', ') : doc.creator) : (meta.metadata && meta.metadata.creator) || null,
        duration: file.length && parseFloat(file.length) > 0 ? parseFloat(file.length) : null,
        size: file.size || null,
        previewUrl: `/proxy?url=${encodeURIComponent(base)}`,
        downloadUrl: `/proxy?url=${encodeURIComponent(base)}`,
        filename: file.name,
        pageUrl: `https://archive.org/details/${doc.identifier}`,
        license: licenseLabel(doc.licenseurl),
        licenseUrl: doc.licenseurl || null,
        year: doc.year || null,
        downloads: doc.downloads || 0,
        bpm: extractBpm(doc.title),
      };
    } catch {
      failed += 1;
      return null;
    }
  });

  const items = enriched.filter(Boolean);
  if (docs.length > 0 && items.length === 0) {
    throw new Error(`Nenhum arquivo de áudio obtido (${failed} de ${docs.length} itens falharam — possível bloqueio do data center)`);
  }
  return items;
}

module.exports = { searchArchive };
