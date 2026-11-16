const { searchArchive } = require('./sources/internetArchive');
const { searchLooperman } = require('./sources/looperman');
const { searchFreesound } = require('./sources/freesound');
const { searchLoopmasters } = require('./sources/loopmasters');
const { searchSampleRadar } = require('./sources/sampleradar');
const { searchProducerLoops } = require('./sources/producerloops');
const { searchWAProduction } = require('./sources/waproduction');
const { searchUnison } = require('./sources/unison');
const { probeAudioDuration } = require('./audioDuration');

// Nada acima de 2 minutos entra nos resultados. A interface usa 1 min por padrão.
const MAX_AUDIO_SECONDS = 120;
const DEFAULT_LOOP_SECONDS = 60;
const PROBE_CONCURRENCY = 10;

const SEARCH_CACHE_TTL = 5 * 60 * 1000;
const SEARCH_CACHE_ERROR_TTL = 60 * 1000;
const SEARCH_CACHE_MAX = 40;
const searchCache = new Map();

function cacheKey(term, sources, filters) {
  const src = sources && sources.length ? [...sources].sort().join(',') : 'all';
  const f = Object.keys(filters)
    .sort()
    .map((k) => `${k}=${filters[k]}`)
    .join('&');
  return `${term.toLowerCase()}|${src}|${f}`;
}

function cacheGet(key) {
  const hit = searchCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > hit.ttl) {
    searchCache.delete(key);
    return null;
  }
  return hit.data;
}

function cacheSet(key, data, ttl) {
  if (searchCache.size >= SEARCH_CACHE_MAX) {
    const oldest = searchCache.keys().next().value;
    if (oldest != null) searchCache.delete(oldest);
  }
  searchCache.set(key, { at: Date.now(), ttl, data });
}

const SOURCES = {
  archive: { label: 'Internet Archive', run: searchArchive },
  looperman: { label: 'Looperman', run: searchLooperman },
  freesound: { label: 'FreeSound', run: searchFreesound },
  loopmasters: { label: 'Loopmasters', run: searchLoopmasters },
  sampleradar: { label: 'SampleRadar', run: searchSampleRadar },
  producerloops: { label: 'Producer Loops', run: searchProducerLoops },
  waproduction: { label: 'W. A. Production', run: searchWAProduction },
  unison: { label: 'Unison Audio', run: searchUnison },
};

function relevanceScore(item, term) {
  const t = term.toLowerCase();
  const title = (item.title || '').toLowerCase();
  let score = 0;
  if (title.includes(t)) score += 4;
  for (const word of t.split(/\s+/).filter((w) => w.length > 2)) {
    if (title.includes(word)) score += 1;
  }
  return score;
}

function dedupe(items) {
  const seen = new Set();
  return items.filter((it) => {
    const key = it.downloadUrl || it.previewUrl || it.pageUrl;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function pool(items, limit, worker) {
  let index = 0;
  async function run() {
    while (index < items.length) {
      const current = items[index++];
      try {
        await worker(current);
      } catch {
        // item fica sem duração e será descartado (exceto Looperman/packs)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
}

const PREVIEW_AUDIO_RE = /\.(mp3|wav|ogg|flac|m4a|aac)(\?|$)/i;

function originFromPreview(previewUrl) {
  if (!previewUrl || !previewUrl.startsWith('/proxy?url=')) return null;
  try {
    const url = decodeURIComponent(previewUrl.slice('/proxy?url='.length));
    return /^https?:\/\//i.test(url) ? url : null;
  } catch {
    return null;
  }
}

// Preenche a duração real dos itens que vêm sem metadado (Looperman, demos, Archive).
async function resolveDurations(items) {
  await pool(items, PROBE_CONCURRENCY, async (item) => {
    if (item.duration != null && isFinite(Number(item.duration))) return;
    if (!item.previewUrl) return;
    const origin = originFromPreview(item.previewUrl);
    if (!origin || !PREVIEW_AUDIO_RE.test(origin)) return;
    const duration = await probeAudioDuration(origin);
    if (duration != null) item.duration = duration;
  });
}

function isLoopResult(item) {
  const isPack = !item.previewUrl && !!item.downloadUrl;
  if (isPack) return true; // pacote zip de loops, não é áudio longo
  if (item.duration == null || !isFinite(Number(item.duration))) {
    return item.source === 'looperman'; // biblioteca 100% de loops
  }
  const duration = Number(item.duration);
  return duration > 0 && duration <= MAX_AUDIO_SECONDS;
}

async function searchAll(term, { sources, filters = {} } = {}) {
  const wanted = sources && sources.length ? sources.filter((s) => SOURCES[s]) : Object.keys(SOURCES);
  const key = cacheKey(term, sources, filters);
  const cached = cacheGet(key);
  if (cached) return { ...cached, tookMs: 0, cached: true };

  const started = Date.now();
  const settled = await Promise.allSettled(
    wanted.map((key) => SOURCES[key].run(term, { filters }))
  );

  const results = [];
  const errors = [];
  settled.forEach((entry, i) => {
    const source = wanted[i];
    if (entry.status === 'fulfilled') {
      results.push(...entry.value);
    } else {
      errors.push({ source, label: SOURCES[source].label, message: (entry.reason && entry.reason.message) || String(entry.reason) });
    }
  });

  const unique = dedupe(results);
  await resolveDurations(unique);

  const droppedLong = unique.filter(
    (it) => it.duration != null && isFinite(Number(it.duration)) && Number(it.duration) > MAX_AUDIO_SECONDS
  ).length;

  const loops = unique.filter(isLoopResult);
  loops.sort((a, b) => relevanceScore(b, term) - relevanceScore(a, term));

  const out = {
    query: term,
    results: loops,
    errors,
    tookMs: Date.now() - started,
    droppedLong,
    limits: { maxSeconds: MAX_AUDIO_SECONDS, defaultLoopSeconds: DEFAULT_LOOP_SECONDS },
    filters: { ...filters },
  };
  cacheSet(key, out, errors.length ? SEARCH_CACHE_ERROR_TTL : SEARCH_CACHE_TTL);
  return out;
}

module.exports = { searchAll };
