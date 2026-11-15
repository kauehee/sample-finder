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

function pickAudioFile(files) {
  const byFormat = (fmt) => files.find((f) => f.format === fmt);
  return (
    byFormat('VBR MP3') ||
    byFormat('128Kbps MP3') ||
    byFormat('64Kbps MP3') ||
    files.find((f) => /\.mp3$/i.test(f.name || '')) ||
    files.find((f) => /\.ogg$/i.test(f.name || '')) ||
    files.find((f) => /\.wav$/i.test(f.name || '')) ||
    null
  );
}

function extractBpm(text) {
  const m = String(text || '').match(/(\d{2,3}(?:\.\d+)?)\s*bpm/i);
  return m ? parseFloat(m[1]) : null;
}

async function searchArchive(term, { rows = 12, filters = {} } = {}) {
  const params = new URLSearchParams({
    q: `(${term}) AND mediatype:audio AND collection:opensource_audio`,
    rows: String(rows),
    page: '1',
    output: 'json',
    'sort[]': 'downloads desc',
  });
  for (const f of FIELDS) params.append('fl[]', f);

  const data = await fetchJson(`${ADV_SEARCH}?${params.toString()}`);
  const docs = (data.response && data.response.docs) || [];

  const enriched = await pool(docs, 5, async (doc) => {
    const meta = await fetchJson(`https://archive.org/metadata/${encodeURIComponent(doc.identifier)}`, 8000);
    const file = pickAudioFile(meta.files || []);
    if (!file) return null;
    const base = `https://archive.org/download/${encodeURIComponent(doc.identifier)}/${encodeURIComponent(file.name)}`;
    return {
      id: `ia-${doc.identifier}`,
      source: 'archive',
      title: doc.title || file.name,
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
  });

  return enriched.filter(Boolean);
}

module.exports = { searchArchive };
