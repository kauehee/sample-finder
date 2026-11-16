const path = require('path');
const fs = require('fs');
const express = require('express');
const { searchAll } = require('./src/search');
const { getLoopermanFilters } = require('./src/sources/looperman');

try {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && process.env[m[1]] == null) process.env[m[1]] = m[2];
    }
  }
} catch {}

const app = express();
const PORT = process.env.PORT || 3000;

const FILTER_FALLBACK = {
  genres: [
    { id: '54', name: 'Trap' }, { id: '7', name: 'Hip Hop' }, { id: '22', name: 'House' },
    { id: '9', name: 'Techno' }, { id: '11', name: 'Drum And Bass' }, { id: '49', name: 'Dubstep' },
    { id: '12', name: 'RnB' }, { id: '50', name: 'Pop' }, { id: '6', name: 'Jazz' },
    { id: '19', name: 'Funk' }, { id: '2', name: 'Ambient' }, { id: '62', name: 'Lo-Fi' },
    { id: '64', name: 'EDM' }, { id: '28', name: 'Trance' }, { id: '32', name: 'Reggaeton' },
    { id: '1', name: 'Rock' }, { id: '36', name: 'Cinematic' }, { id: '37', name: 'Breakbeat' },
    { id: '5', name: 'Dub' }, { id: '34', name: 'Orchestral' },
  ],
  keys: [
    { id: 'a', name: 'A' }, { id: 'am', name: 'Am' }, { id: 'b', name: 'B' }, { id: 'bm', name: 'Bm' },
    { id: 'c', name: 'C' }, { id: 'cm', name: 'Cm' }, { id: 'd', name: 'D' }, { id: 'dm', name: 'Dm' },
    { id: 'e', name: 'E' }, { id: 'em', name: 'Em' }, { id: 'f', name: 'F' }, { id: 'fm', name: 'Fm' },
    { id: 'g', name: 'G' }, { id: 'gm', name: 'Gm' }, { id: 'fs', name: 'F#' }, { id: 'fsm', name: 'F#m' },
    { id: 'cs', name: 'C#' }, { id: 'csm', name: 'C#m' }, { id: 'gs', name: 'G#' }, { id: 'gsm', name: 'G#m' },
    { id: 'as', name: 'A#' }, { id: 'asm', name: 'A#m' }, { id: 'ds', name: 'D#' }, { id: 'dsm', name: 'D#m' },
  ],
  sigs: [{ id: '4x4', name: '4x4' }, { id: '2x4', name: '2x4' }, { id: '3x4', name: '3x4' }, { id: '6x8', name: '6x8' }],
};

let filtersCache = { at: 0, data: null };
const FILTERS_TTL = 30 * 60 * 1000;

async function getFilters() {
  if (filtersCache.data && Date.now() - filtersCache.at < FILTERS_TTL) return filtersCache.data;
  try {
    const data = await getLoopermanFilters();
    if (data.genres.length || data.keys.length || data.sigs.length) {
      filtersCache = { at: Date.now(), data };
      return data;
    }
  } catch {
    // fallback abaixo
  }
  return { ...FILTER_FALLBACK, stale: true };
}

const AUDIO_HOSTS = new Map([
  ['www.looperman.com', 'https://www.looperman.com/'],
  ['looperman.com', 'https://www.looperman.com/'],
  ['cdn.freesound.org', 'https://freesound.org/'],
  ['demos.loopmasters.com', 'https://www.loopmasters.com/'],
  ['cdn.mos.musicradar.com', 'https://www.musicradar.com/'],
]);

function isAllowedHost(hostname) {
  return AUDIO_HOSTS.has(hostname) || hostname === 'archive.org' || hostname.endsWith('.archive.org');
}

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/filters', async (req, res) => {
  try {
    res.json(await getFilters());
  } catch (err) {
    res.status(500).json({ error: (err && err.message) || String(err) });
  }
});

app.get('/catalogo', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'catalogo.html'));
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true, uptime: Math.round(process.uptime()) });
});

app.get('/api/search', async (req, res) => {
  const term = String(req.query.q || '').trim();
  if (!term) {
    return res.status(400).json({ error: 'Informe um termo de busca (?q=...)' });
  }
  const sources = req.query.sources ? String(req.query.sources).split(',').filter(Boolean) : null;
  const filters = {};
  if (req.query.genre) filters.genre = String(req.query.genre);
  if (req.query.key) filters.key = String(req.query.key);
  if (req.query.sig) filters.sig = String(req.query.sig);
  if (req.query.bpmMin && isFinite(req.query.bpmMin)) filters.bpmMin = Number(req.query.bpmMin);
  if (req.query.bpmMax && isFinite(req.query.bpmMax)) filters.bpmMax = Number(req.query.bpmMax);
  try {
    const out = await searchAll(term, { sources, filters });
    res.json(out);
  } catch (err) {
    res.status(500).json({ error: (err && err.message) || String(err) });
  }
});

app.get('/proxy', async (req, res) => {
  let parsed;
  try {
    parsed = new URL(String(req.query.url || ''));
  } catch {
    return res.status(400).end('URL inválida');
  }
  if (!isAllowedHost(parsed.hostname) || !/\.(mp3|wav|ogg|flac|m4a|aac|zip)(\?|$)/i.test(parsed.pathname)) {
    return res.status(400).end('Host ou tipo de arquivo não permitido');
  }

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  };
  const referer = AUDIO_HOSTS.get(parsed.hostname);
  if (referer) headers.Referer = referer;
  if (req.headers.range) headers.Range = req.headers.range;

  try {
    const upstream = await fetch(parsed.toString(), {
      headers,
      redirect: 'follow',
      signal: AbortSignal.timeout(600000),
    });
    res.status(upstream.status);
    const pass = ['content-type', 'content-length', 'content-range', 'accept-ranges'];
    for (const h of pass) {
      const v = upstream.headers.get(h);
      if (v) res.set(h, v);
    }
    const filename = decodeURIComponent(parsed.pathname.split('/').pop() || 'audio');
    res.set('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(filename)}`);
    if (upstream.body) {
      const reader = upstream.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
    }
    res.end();
  } catch {
    if (!res.headersSent) res.status(502).end('Falha ao buscar mídia');
    else res.end();
  }
});

app.listen(PORT, () => {
  console.log(`Sample Finder rodando em http://localhost:${PORT}`);
});

const KEEPALIVE_INTERVAL = 10 * 60 * 1000;

function startKeepAlive() {
  const base = process.env.RENDER_EXTERNAL_URL;
  if (!process.env.RENDER || !base) return;
  const ping = async () => {
    try {
      await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(15000) });
    } catch {
      // falha momentânea: o próximo ciclo tenta de novo
    }
  };
  const tick = () => {
    ping();
    setTimeout(tick, KEEPALIVE_INTERVAL + Math.floor(Math.random() * 60000));
  };
  setTimeout(tick, 30000);
}

startKeepAlive();
