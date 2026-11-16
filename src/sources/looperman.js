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

function parseSize(text) {
  const m = String(text).match(/([\d.]+)\s*(GB|MB|KB)/i);
  if (!m) return null;
  const mult = { GB: 1024 ** 3, MB: 1024 ** 2, KB: 1024 }[m[2].toUpperCase()];
  return Math.round(parseFloat(m[1]) * mult);
}

// A própria listagem de busca já traz título, autor, mp3, duração, BPM, tom e compasso.
// Assim não é preciso abrir a página de detalhe de cada loop (muito mais rápido e sem perder metadados).
function parseListing(html) {
  const $ = cheerio.load(html);
  const items = [];

  $('.player-wrapper').each((_, el) => {
    const wrap = $(el);
    const mp3 = wrap.attr('data-mp3');
    if (!mp3 || !/\.mp3(\?|$)/i.test(mp3)) return;

    const titleEl = wrap.find('a.player-title').first();
    const href = titleEl.attr('href') || '';
    const m = href.match(/\/loops\/detail\/(\d+)/);
    const title = titleEl.text().replace(/\s+/g, ' ').trim();
    if (!m || !title) return;

    const author = wrap.find('.getuser a').first().text().trim() || null;
    const duration = parseFloat(wrap.attr('data-duration'));

    let bpm = null;
    let genre = null;
    let sig = null;
    let size = null;
    let key = null;
    // O bloco de tags (BPM, gênero, compasso, tamanho, tom) vem logo depois do player, como irmão.
    // Para até o próximo loop, evitando pegar as tags de outro item caso a estrutura mude.
    let tags = $();
    for (let sib = wrap.next(); sib.length; sib = sib.next()) {
      if (sib.hasClass('player-wrapper')) break;
      if (sib.hasClass('tag-wrapper')) {
        tags = sib;
        break;
      }
    }
    tags.find('a').each((_, a) => {
      const link = $(a);
      const text = link.text().replace(/\s+/g, ' ').trim();
      const hrefTag = link.attr('href') || '';
      const tip = link.attr('data-bs-title') || '';
      if (bpm == null) {
        const bm = text.match(/(\d{2,3}(?:\.\d+)?)\s*bpm/i);
        if (bm) bpm = parseFloat(bm[1]);
      }
      if (!genre && /\/loops\/genres\//.test(hrefTag)) {
        genre = text.replace(/\s*Loops\s*$/i, '').trim() || null;
      }
      if (!sig && /tsig=/.test(hrefTag)) {
        const sm = text.match(/(\d+)\s*[x/]\s*(\d+)/);
        if (sm) sig = `${sm[1]}x${sm[2]}`;
      }
      if (size == null && /file size/i.test(tip)) size = parseSize(text);
      if (!key && /key\s*:/i.test(text)) {
        const km = text.match(/Key\s*:\s*(.+)$/i);
        if (km && !/unknown|no key/i.test(km[1])) key = km[1].trim();
      }
    });

    const pageUrl = href.startsWith('http') ? href : BASE + href;
    items.push({
      id: `lm-${m[1]}`,
      source: 'looperman',
      title: title.replace(/\s*#\d+.*$/i, '').replace(/\s*\|\s*Looperman\s*$/i, '').trim(),
      author,
      duration: isFinite(duration) && duration > 0 ? duration : null,
      size,
      previewUrl: `/proxy?url=${encodeURIComponent(mp3)}`,
      downloadUrl: `/proxy?url=${encodeURIComponent(mp3)}`,
      filename: decodeURIComponent(mp3.split('/').pop().split('?')[0]),
      pageUrl,
      license: 'Uso livre (site de compartilhamento gratuito)',
      licenseUrl: null,
      bpm,
      key,
      sig,
      genre,
    });
  });

  const pages = new Set();
  $('a[data-ci-pagination-page]').each((_, el) => {
    const n = parseInt($(el).attr('data-ci-pagination-page'), 10);
    if (n > 1) pages.add(n);
  });

  return { items, pages };
}

async function searchLooperman(term, { maxResults = 60, maxPages = 3, filters = {} } = {}) {
  const keys = String(term).replace(/[^a-zA-Z0-9\s-]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!keys || keys.length < 2) {
    throw new Error('Termo sem caracteres pesquisáveis');
  }

  const baseQs = new URLSearchParams({ keys });
  if (filters.genre) baseQs.set('gid', filters.genre);
  if (filters.key) baseQs.set('mkey', filters.key);
  if (filters.sig) baseQs.set('tsig', filters.sig);
  if (filters.bpmMin) baseQs.set('ftempo', String(filters.bpmMin));
  if (filters.bpmMax) baseQs.set('ttempo', String(filters.bpmMax));

  const urlFor = (n) => {
    const qs = new URLSearchParams(baseQs);
    qs.set('page', String(n));
    return `${BASE}/loops?${qs.toString()}`;
  };

  const session = createSession();
  const first = parseListing(await session.get(urlFor(1)));

  const extraPages = [...first.pages].filter((n) => n <= maxPages).sort((a, b) => a - b);
  const rest = extraPages.length
    ? await pool(extraPages, 3, async (n) => parseListing(await session.get(urlFor(n))))
    : [];

  const seen = new Set();
  const items = [];
  for (const part of [first, ...rest.filter(Boolean)]) {
    for (const item of part.items) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      items.push(item);
    }
  }

  if (!items.length) throw new Error('Nenhum loop encontrado (site pode ter mudado)');
  return items.slice(0, maxResults);
}

module.exports = { searchLooperman, getLoopermanFilters };
