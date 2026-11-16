const { searchArchive } = require('./sources/internetArchive');
const { searchLooperman } = require('./sources/looperman');
const { searchFreesound } = require('./sources/freesound');
const { searchLoopmasters } = require('./sources/loopmasters');
const { searchSampleRadar } = require('./sources/sampleradar');
const { searchProducerLoops } = require('./sources/producerloops');
const { searchWAProduction } = require('./sources/waproduction');
const { searchUnison } = require('./sources/unison');

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

async function searchAll(term, { sources, filters = {} } = {}) {
  const wanted = sources && sources.length ? sources.filter((s) => SOURCES[s]) : Object.keys(SOURCES);
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
  unique.sort((a, b) => relevanceScore(b, term) - relevanceScore(a, term));

  return {
    query: term,
    results: unique,
    errors,
    tookMs: Date.now() - started,
    filters: { ...filters },
  };
}

module.exports = { searchAll };
