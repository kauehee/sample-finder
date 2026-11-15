const form = document.getElementById('searchForm');
const input = document.getElementById('searchInput');
const btn = document.getElementById('searchBtn');
const resultsEl = document.getElementById('results');
const emptyEl = document.getElementById('empty');
const statusEl = document.getElementById('status');
const warningsEl = document.getElementById('warnings');
const licenseFilter = document.getElementById('licenseFilter');
const durationFilter = document.getElementById('durationFilter');
const genreFilter = document.getElementById('genreFilter');
const keyFilter = document.getElementById('keyFilter');
const sigFilter = document.getElementById('sigFilter');
const bpmMin = document.getElementById('bpmMin');
const bpmMax = document.getElementById('bpmMax');
const clearFiltersBtn = document.getElementById('clearFilters');
const filterHint = document.getElementById('filterHint');
const chips = document.querySelectorAll('#sourceChips .chip');

let activeSource = 'all';
let lastData = null;
let lastTerm = '';

chips.forEach((chip) => {
  chip.addEventListener('click', () => {
    chips.forEach((c) => c.classList.remove('active'));
    chip.classList.add('active');
    activeSource = chip.dataset.source;
    if (lastTerm) runSearch();
  });
});

licenseFilter.addEventListener('change', () => render());
durationFilter.addEventListener('change', () => render());

genreFilter.addEventListener('change', () => { if (lastTerm) runSearch(); });
keyFilter.addEventListener('change', () => { if (lastTerm) runSearch(); });
sigFilter.addEventListener('change', () => { if (lastTerm) runSearch(); });
bpmMin.addEventListener('change', () => { if (lastTerm) runSearch(); });
bpmMax.addEventListener('change', () => { if (lastTerm) runSearch(); });

clearFiltersBtn.addEventListener('click', () => {
  genreFilter.value = '';
  keyFilter.value = '';
  sigFilter.value = '';
  bpmMin.value = '';
  bpmMax.value = '';
  updateFilterHint();
  if (lastTerm) runSearch();
});

form.addEventListener('submit', (e) => {
  e.preventDefault();
  runSearch();
});

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDuration(sec) {
  if (!sec || !isFinite(sec)) return null;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatSize(bytes) {
  if (!bytes) return null;
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

function licenseMatches(license, filter) {
  if (filter === 'all') return true;
  if (filter === 'cc0') return /cc0|public domain|domínio/i.test(license || '');
  if (filter === 'cc-by') return /^cc by(?!-nc)/i.test(license || '');
  return true;
}

function durationMatches(duration, filter) {
  if (filter === 'all') return true;
  if (duration == null) return filter !== 'long';
  if (filter === 'short') return duration <= 15;
  if (filter === 'medium') return duration > 15 && duration <= 60;
  if (filter === 'long') return duration > 60;
  return true;
}

function currentFilters() {
  const f = {};
  if (genreFilter.value) f.genre = genreFilter.value;
  if (keyFilter.value) f.key = keyFilter.value;
  if (sigFilter.value) f.sig = sigFilter.value;
  if (bpmMin.value !== '' && isFinite(bpmMin.value)) f.bpmMin = Number(bpmMin.value);
  if (bpmMax.value !== '' && isFinite(bpmMax.value)) f.bpmMax = Number(bpmMax.value);
  return f;
}

function genreName(value) {
  const opt = genreFilter.querySelector(`option[value="${value}"]`);
  return opt ? opt.textContent : null;
}

function keyId(k) {
  return String(k)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace('#', 's')
    .replace(/(maj|major)$/, '')
    .replace(/(min|minor)$/, 'm');
}

function musicMatches(item, f) {
  if (f.genre) {
    const name = genreName(f.genre) || '';
    const hay = `${item.genre || ''} ${item.title || ''}`.toLowerCase();
    if (!hay.includes(name.toLowerCase())) return false;
  }
  if (f.bpmMin != null || f.bpmMax != null) {
    if (item.bpm == null) return false;
    if (f.bpmMin != null && item.bpm < f.bpmMin) return false;
    if (f.bpmMax != null && item.bpm > f.bpmMax) return false;
  }
  if (f.key) {
    if (!item.key) return false;
    if (keyId(item.key) !== keyId(f.key)) return false;
  }
  if (f.sig) {
    if (!item.sig) return false;
    if (item.sig !== f.sig) return false;
  }
  return true;
}

function cardHtml(item) {
  const dur = formatDuration(item.duration);
  const size = formatSize(item.size);
  const meta = [
    item.author ? `<span class="badge">${escapeHtml(item.author)}</span>` : '',
    dur ? `<span class="badge">${dur}</span>` : '',
    size ? `<span class="badge">${size}</span>` : '',
    item.bpm ? `<span class="badge">${escapeHtml(item.bpm)} BPM</span>` : '',
    item.key ? `<span class="badge">Tom ${escapeHtml(item.key)}</span>` : '',
    item.sig ? `<span class="badge">${escapeHtml(item.sig)}</span>` : '',
    item.genre ? `<span class="badge">${escapeHtml(item.genre)}</span>` : '',
  ].join('');

  const license = item.license
    ? `<span class="badge license">${item.licenseUrl ? `<a href="${escapeHtml(item.licenseUrl)}" target="_blank" rel="noopener">` : ''}${escapeHtml(item.license)}${item.licenseUrl ? '</a>' : ''}</span>`
    : '';

  const player = item.previewUrl
    ? `<audio controls preload="none" src="${escapeHtml(item.previewUrl)}"></audio>`
    : '<div class="card-meta">Sem preview disponível</div>';

  const actions = item.downloadUrl
    ? item.downloadUrl.startsWith('/')
      ? `<a class="btn download" href="${escapeHtml(item.downloadUrl)}" download="${escapeHtml(item.filename || 'audio')}">Baixar</a>`
      : `<a class="btn download" href="${escapeHtml(item.downloadUrl)}" target="_blank" rel="noopener">Baixar</a>`
    : `<span class="btn" title="Downloads exigem login no site">Download no site</span>`;

  return `
    <div class="card">
      <div class="card-title">${escapeHtml(item.title)}</div>
      <div class="card-meta">
        <span class="badge source-${item.source}">${escapeHtml(item.sourceLabel || item.source)}</span>
        ${meta}
        ${license}
      </div>
      ${player}
      <div class="card-actions">
        ${actions}
        <a class="btn" href="${escapeHtml(item.pageUrl)}" target="_blank" rel="noopener">Ver no site</a>
      </div>
    </div>`;
}

const SOURCE_LABELS = { archive: 'Internet Archive', looperman: 'Looperman', freesound: 'FreeSound' };

resultsEl.addEventListener(
  'play',
  (e) => {
    const playing = e.target;
    resultsEl.querySelectorAll('audio').forEach((a) => {
      if (a !== playing && !a.paused) a.pause();
    });
  },
  true
);

function render() {
  if (!lastData) return;
  const data = lastData;

  if (data.errors && data.errors.length) {
    warningsEl.innerHTML = data.errors
      .map((e) => `<div class="warning">⚠ ${escapeHtml(e.label)}: ${escapeHtml(e.message)}</div>`)
      .join('');
  } else {
    warningsEl.innerHTML = '';
  }

  const licFilter = licenseFilter.value;
  const durFilter = durationFilter.value;
  const musicFilter = currentFilters();
  const filtered = data.results.filter(
    (r) =>
      licenseMatches(r.license, licFilter) &&
      durationMatches(r.duration, durFilter) &&
      musicMatches(r, musicFilter)
  );

  if (!filtered.length) {
    const filtersAtivos = licFilter !== 'all' || durFilter !== 'all' || Object.keys(musicFilter).length > 0;
    emptyEl.innerHTML = `
      <p>Nenhum resultado para "${escapeHtml(data.query)}".</p>
      <p class="muted">${filtersAtivos ? 'Tente relaxar os filtros ou ' : ''}use termos mais simples ou em inglês — ex.: "drums", "synth", "ambient".</p>`;
    emptyEl.classList.remove('hidden');
    resultsEl.innerHTML = '';
    statusEl.textContent = '';
    return;
  }

  emptyEl.classList.add('hidden');
  resultsEl.innerHTML = filtered
    .map((r) => cardHtml({ ...r, sourceLabel: SOURCE_LABELS[r.source] }))
    .join('');
  statusEl.textContent = `${filtered.length} resultado(s) em ${(data.tookMs / 1000).toFixed(1)}s`;
}

async function runSearch() {
  const term = input.value.trim();
  if (!term) return;
  lastTerm = term;
  updateFilterHint();

  btn.disabled = true;
  statusEl.textContent = 'Buscando nas fontes...';
  warningsEl.innerHTML = '';
  resultsEl.innerHTML = '';
  emptyEl.classList.add('hidden');

  const params = new URLSearchParams({ q: term });
  if (activeSource !== 'all') params.set('sources', activeSource);
  const f = currentFilters();
  if (f.genre) params.set('genre', f.genre);
  if (f.key) params.set('key', f.key);
  if (f.sig) params.set('sig', f.sig);
  if (f.bpmMin != null) params.set('bpmMin', f.bpmMin);
  if (f.bpmMax != null) params.set('bpmMax', f.bpmMax);

  try {
    const res = await fetch(`/api/search?${params.toString()}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Erro ${res.status}`);
    lastData = data;
    render();
  } catch (err) {
    statusEl.textContent = '';
    warningsEl.innerHTML = `<div class="warning">⚠ Falha na busca: ${escapeHtml(err.message)}</div>`;
  } finally {
    btn.disabled = false;
  }
}

function updateFilterHint() {
  const f = currentFilters();
  const parts = [];
  if (f.genre) parts.push(`gênero ${genreName(f.genre)}`);
  if (f.key) parts.push(`tom ${f.key}`);
  if (f.sig) parts.push(`compasso ${f.sig}`);
  if (f.bpmMin != null || f.bpmMax != null) {
    parts.push(`BPM ${f.bpmMin ?? '–'} a ${f.bpmMax ?? '–'}`);
  }
  filterHint.textContent = parts.length
    ? `Filtros ativos: ${parts.join(' · ')} — Looperman aplica na busca oficial; itens sem esse metadado ficam de fora.`
    : 'Gênero, tom, BPM e compasso refinam onde as fontes têm metadados (Looperman aplica na busca oficial do site).';
}

async function loadFilters() {
  try {
    const res = await fetch('/api/filters');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'erro');
    const fill = (select, items) => {
      items.forEach((it) => {
        const opt = document.createElement('option');
        opt.value = it.id;
        opt.textContent = it.name;
        select.appendChild(opt);
      });
    };
    fill(genreFilter, data.genres || []);
    fill(keyFilter, data.keys || []);
    fill(sigFilter, data.sigs || []);
    updateFilterHint();
  } catch {
    filterHint.textContent = 'Filtros de gênero/tom/compasso indisponíveis no momento (Looperman não respondeu).';
  }
}

loadFilters();
input.focus();
