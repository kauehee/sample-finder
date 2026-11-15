const cheerio = require('cheerio');

const BASE = 'https://www.looperman.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function createSession() {
  const jar = {};
  function absorb(res) {
    const cookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const c of cookies) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      if (i > 0) jar[pair.slice(0, i)] = pair.slice(i + 1);
    }
  }
  function cookieHeader() {
    return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
  }
  async function get(url) {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9', Cookie: cookieHeader() },
      signal: AbortSignal.timeout(12000),
      redirect: 'follow',
    });
    absorb(res);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    if (/cloudflare|attention required|just a moment/i.test(html.slice(0, 2000))) {
      throw new Error('Bloqueado por proteção anti-bot do site');
    }
    return html;
  }
  async function post(url, data, referer) {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'User-Agent': UA,
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
        Referer: referer,
        Origin: BASE,
        Cookie: cookieHeader(),
      },
      body: new URLSearchParams(data).toString(),
      signal: AbortSignal.timeout(12000),
      redirect: 'follow',
    });
    absorb(res);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
  }
  return { get, post };
}

async function openAdvSearchModal(session) {
  const homeHtml = await session.get(`${BASE}/loops`);
  const csrfA = (homeHtml.match(/var csrfToken = '([^']+)'/) || [])[1];
  if (!csrfA) throw new Error('Falha ao obter token de sessão');

  const modalRaw = await session.post(
    `${BASE}/ajax/ajax_adv_search_modal`,
    { item_type: 'loops', query_filter_params: Buffer.from('[]').toString('base64'), csrftoken: csrfA },
    `${BASE}/loops`
  );
  let modalHtml = modalRaw;
  if (modalRaw.trim().startsWith('{')) {
    const json = JSON.parse(modalRaw);
    modalHtml = json.html || json.content || '';
  }
  const csrfB = (modalHtml.match(/name="csrftoken" value="([^"]+)"/) || [])[1];
  if (!csrfB) throw new Error('Falha ao abrir busca do site');
  return { csrfB, modalHtml };
}

function parseModalFilters(modalHtml) {
  const $ = cheerio.load(modalHtml);
  const genres = [];
  $('select[name="gid"] option').each((_, el) => {
    const v = $(el).attr('value');
    const label = $(el).text().trim();
    if (v) genres.push({ id: v, name: label });
  });
  const keys = [];
  $('select[name="mkey"] option').each((_, el) => {
    const v = $(el).attr('value');
    const label = $(el).text().trim();
    if (v) keys.push({ id: v, name: label });
  });
  const sigs = [];
  $('select[name="tsig"] option').each((_, el) => {
    const v = $(el).attr('value');
    const label = $(el).text().trim();
    if (v) sigs.push({ id: v, name: label });
  });
  return { genres, keys, sigs };
}

async function getLoopermanFilters() {
  const session = createSession();
  const { modalHtml } = await openAdvSearchModal(session);
  return parseModalFilters(modalHtml);
}

function pool(items, limit, worker) {
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
  return Promise.all(Array.from({ length: Math.min(limit, items.length) }, run)).then(() => out);
}

function extractBpm(text) {
  const m = text.match(/(\d{2,3}(?:\.\d+)?)\s*bpm/i);
  return m ? parseFloat(m[1]) : null;
}

function extractKey(text) {
  const m = text.match(/\bKey\s*:\s*([A-Ga-g][#b]?(?:\s*(?:m|min|minor|maj|major))?)/);
  return m ? m[1].trim() : null;
}

function extractSig(text) {
  const tags = text.match(/Tags\s*:\s*([^]*?)(?:Key\s*:|Description\s*:)/i);
  const m = (tags ? tags[1] : text).match(/\b(\d+)\s*[x/]\s*(\d+)\b/);
  return m ? `${m[1]}x${m[2]}` : null;
}

async function searchLooperman(term, { maxResults = 8, filters = {} } = {}) {
  const keys = String(term).replace(/[^a-zA-Z0-9\s-]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!keys || keys.length < 2) {
    throw new Error('Termo sem caracteres pesquisáveis');
  }

  const session = createSession();
  const { csrfB, modalHtml } = await openAdvSearchModal(session);

  const form = { csrftoken: csrfB, keys };
  if (filters.genre) form.gid = filters.genre;
  if (filters.key) form.mkey = filters.key;
  if (filters.sig) form.tsig = filters.sig;
  if (filters.bpmMin) form.ftempo = filters.bpmMin;
  if (filters.bpmMax) form.ttempo = filters.bpmMax;

  const resultsHtml = await session.post(`${BASE}/loops/search`, form, `${BASE}/loops`);

  const $ = cheerio.load(resultsHtml);
  const links = [];
  $('a[href*="/loops/detail/"]').each((_, el) => {
    const href = $(el).attr('href') || '';
    const m = href.match(/\/loops\/detail\/(\d+)/);
    if (m && !links.some((l) => l.id === m[1])) {
      links.push({ id: m[1], href: href.startsWith('http') ? href : BASE + href });
    }
  });

  const picked = links.slice(0, maxResults);
  const items = await pool(picked, 3, async (link) => {
    const page = await session.get(link.href);
    const p = cheerio.load(page);

    const padded = link.id.padStart(7, '0');
    const mp3s = [];
    p('a[href], audio[src], source[src]').each((_, el) => {
      const val = p(el).attr('href') || p(el).attr('src');
      if (val && /\.mp3$/i.test(val)) mp3s.push(val.startsWith('http') ? val : BASE + val);
    });
    const own =
      p('meta[property="og:audio"]').attr('content') ||
      mp3s.find((u) => u.includes(padded)) ||
      mp3s[0];
    if (!own) return null;

    const title =
      p('meta[property="og:title"]').attr('content') ||
      p('h1').first().text().trim() ||
      link.id;
    const description =
      p('meta[property="og:description"]').attr('content') ||
      p('meta[name="description"]').attr('content') ||
      '';
    const genre = p('a[href*="/loops/genres/"]').first().text().trim().replace(/\s*Loops\s*$/i, '') || null;
    const bodyText = p('body').text();
    const metaText = `${description} ${bodyText}`;

    return {
      id: `lm-${link.id}`,
      source: 'looperman',
      title: title.replace(/\s*#\d+.*$/i, '').replace(/\s*\|\s*Looperman\s*$/i, '').trim(),
      author: null,
      duration: null,
      size: null,
      previewUrl: `/proxy?url=${encodeURIComponent(own)}`,
      downloadUrl: `/proxy?url=${encodeURIComponent(own)}`,
      filename: own.split('/').pop().split('?')[0],
      pageUrl: link.href,
      license: 'Uso livre (site de compartilhamento gratuito)',
      licenseUrl: null,
      bpm: extractBpm(metaText),
      key: extractKey(bodyText),
      sig: extractSig(bodyText),
      genre,
    };
  });

  return items.filter(Boolean);
}

module.exports = { searchLooperman, getLoopermanFilters };
