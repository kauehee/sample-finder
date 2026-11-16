const form = document.getElementById('searchForm');
const input = document.getElementById('searchInput');
const btn = document.getElementById('searchBtn');
const resultsEl = document.getElementById('results');
const emptyEl = document.getElementById('empty');
const warningsEl = document.getElementById('warnings');
const resultsHead = document.getElementById('resultsHead');
const resultCount = document.getElementById('resultCount');
const listHead = document.getElementById('listHead');
const activeFiltersEl = document.getElementById('activeFilters');
const licenseFilter = document.getElementById('licenseFilter');
const durationFilter = document.getElementById('durationFilter');
const genreFilter = document.getElementById('genreFilter');
const keyFilter = document.getElementById('keyFilter');
const sigFilter = document.getElementById('sigFilter');
const sourceFilter = document.getElementById('sourceFilter');
const sortSelect = document.getElementById('sortSelect');
const bpmMin = document.getElementById('bpmMin');
const bpmMax = document.getElementById('bpmMax');
const clearFiltersBtn = document.getElementById('clearFilters');
const filterHint = document.getElementById('filterHint');
const instrumentChips = document.querySelectorAll('#instrumentChips .chip');

let activeInstrument = 'all';
let lastData = null;
let lastTerm = '';
let searching = false;

instrumentChips.forEach((chip) => {
  chip.addEventListener('click', () => {
    const val = chip.dataset.instrument;
    activeInstrument = activeInstrument === val && val !== 'all' ? 'all' : val;
    instrumentChips.forEach((c) => c.classList.toggle('active', c.dataset.instrument === activeInstrument));
    render();
  });
});

licenseFilter.addEventListener('change', () => render());
durationFilter.addEventListener('change', () => render());
sortSelect.addEventListener('change', () => render());

genreFilter.addEventListener('change', () => { if (lastTerm) runSearch(); else render(); });
keyFilter.addEventListener('change', () => { if (lastTerm) runSearch(); else render(); });
sigFilter.addEventListener('change', () => { if (lastTerm) runSearch(); else render(); });
sourceFilter.addEventListener('change', () => { if (lastTerm) runSearch(); else render(); });
bpmMin.addEventListener('change', () => { if (lastTerm) runSearch(); else render(); });
bpmMax.addEventListener('change', () => { if (lastTerm) runSearch(); else render(); });

clearFiltersBtn.addEventListener('click', () => {
  genreFilter.value = '';
  keyFilter.value = '';
  sigFilter.value = '';
  sourceFilter.value = 'all';
  licenseFilter.value = 'all';
  durationFilter.value = 'loops';
  sortSelect.value = 'relevance';
  bpmMin.value = '';
  bpmMax.value = '';
  activeInstrument = 'all';
  instrumentChips.forEach((c) => c.classList.toggle('active', c.dataset.instrument === 'all'));
  if (lastTerm) runSearch(); else render();
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
  if (filter === 'loops') return duration == null || Number(duration) <= 60;
  if (duration == null) return false;
  const d = Number(duration);
  if (filter === 'short') return d <= 15;
  if (filter === 'medium') return d > 15 && d <= 30;
  if (filter === 'long') return d > 30 && d <= 60;
  if (filter === 'xlong') return d > 60 && d <= 120;
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

const INSTRUMENT_KEYWORDS = {
  drums: ['drum', 'beat', 'break', 'groove', 'rhythm'],
  vocals: ['vocal', 'vox', 'acapella', 'a capella', 'voice', 'chant', 'sing'],
  synth: ['synth', 'pad', 'arp', 'pluck', 'lead', 'stab'],
  keys: ['keys', 'keyboard', 'rhodes', 'wurlitzer', 'organ', 'clav'],
  guitar: ['guitar', 'riff', 'strum'],
  percussion: ['perc', 'shaker', 'conga', 'bongo', 'tambourine', 'cowbell', 'cajon', 'djembe', 'timbal'],
  piano: ['piano', 'upright', 'felt'],
  strings: ['string', 'violin', 'viola', 'cello', 'pizzicato', 'harp'],
  kicks: ['kick'],
  hats: ['hat', 'hihat', 'hi-hat'],
  snares: ['snare', 'clap', 'snap'],
  808: ['808'],
};

function instrumentMatches(item, id) {
  if (!id || id === 'all') return true;
  const kws = INSTRUMENT_KEYWORDS[id] || [];
  const hay = `${item.title || ''} ${item.genre || ''} ${item.author || ''}`.toLowerCase();
  return kws.some((k) => new RegExp(`(^|[^a-z])${k}`).test(hay));
}

const SOURCE_LABELS = { archive: 'Internet Archive', looperman: 'Looperman', freesound: 'FreeSound', loopmasters: 'Loopmasters', sampleradar: 'SampleRadar', producerloops: 'Producer Loops', waproduction: 'W. A. Production', unison: 'Unison Audio' };

function rowHtml(item) {
  const dur = formatDuration(item.duration);
  const size = formatSize(item.size);
  const sourceLabel = SOURCE_LABELS[item.source] || item.source;

  const tags = [
    `<span class="tag src src-${escapeHtml(item.source)}">${escapeHtml(sourceLabel)}</span>`,
    !item.previewUrl && item.downloadUrl ? '<span class="tag">Pacote ZIP</span>' : '',
    item.genre ? `<span class="tag">${escapeHtml(item.genre)}</span>` : '',
    item.author ? `<span class="tag">${escapeHtml(item.author)}</span>` : '',
    item.sig ? `<span class="tag">${escapeHtml(item.sig)}</span>` : '',
    size ? `<span class="tag">${escapeHtml(size)}</span>` : '',
    dur ? `<span class="tag meta-only">${dur}</span>` : '',
    item.bpm ? `<span class="tag meta-only">${escapeHtml(item.bpm)} BPM</span>` : '',
    item.key ? `<span class="tag meta-only">${escapeHtml(item.key)}</span>` : '',
  ].join('');

  const license = item.license
    ? `<span class="tag license">${item.licenseUrl ? `<a href="${escapeHtml(item.licenseUrl)}" target="_blank" rel="noopener">` : ''}${escapeHtml(item.license)}${item.licenseUrl ? '</a>' : ''}</span>`
    : '';

  const player = item.previewUrl
    ? `<button class="play" type="button" aria-label="Tocar preview" title="Tocar preview">▶</button>
       <audio preload="none" src="${escapeHtml(item.previewUrl)}"></audio>`
    : `<button class="play disabled" type="button" disabled title="Sem preview">—</button>`;

  const download = item.downloadUrl
    ? item.downloadUrl.startsWith('/')
      ? `<a class="btn download" href="${escapeHtml(item.downloadUrl)}" download="${escapeHtml(item.filename || 'audio')}">Baixar</a>`
      : `<a class="btn download" href="${escapeHtml(item.downloadUrl)}" target="_blank" rel="noopener">Baixar</a>`
    : `<span class="btn ghost" title="Download no site oficial">No site</span>`;

  return `
    <div class="row">
      <div class="row-main">
        <div class="play-wrap">${player}</div>
        <div class="row-info">
          <div class="row-title" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</div>
          <div class="row-tags">${tags}${license}</div>
        </div>
      </div>
      <div class="row-col">${dur || '–'}</div>
      <div class="row-col">${item.key ? escapeHtml(item.key) : '–'}</div>
      <div class="row-col">${item.bpm ? escapeHtml(item.bpm) : '–'}</div>
      <div class="row-actions">
        ${download}
        <a class="btn ghost" href="${escapeHtml(item.pageUrl || '#')}" target="_blank" rel="noopener">Site</a>
      </div>
    </div>`;
}

function activeChips() {
  const f = currentFilters();
  const chips = [];
  const add = (clear, label) => chips.push({ clear, label });

  if (activeInstrument !== 'all') add('instrument', activeInstrument.toUpperCase() === '808' ? '808' : activeInstrument[0].toUpperCase() + activeInstrument.slice(1));
  if (f.genre) add('genre', `Gênero: ${genreName(f.genre)}`);
  if (f.key) add('key', `Tom: ${keyFilter.options[keyFilter.selectedIndex]?.textContent || f.key}`);
  if (f.sig) add('sig', `Compasso: ${f.sig}`);
  if (f.bpmMin != null || f.bpmMax != null) add('bpm', `BPM: ${f.bpmMin ?? '–'}–${f.bpmMax ?? '–'}`);
  if (sourceFilter.value !== 'all') add('source', `Fonte: ${sourceFilter.options[sourceFilter.selectedIndex].textContent}`);
  if (licenseFilter.value !== 'all') add('license', `Licença: ${licenseFilter.options[licenseFilter.selectedIndex].textContent}`);
  if (durationFilter.value !== 'loops') add('duration', `Duração: ${durationFilter.options[durationFilter.selectedIndex].textContent}`);
  return chips;
}

function renderActiveChips() {
  const chips = activeChips();
  activeFiltersEl.innerHTML = chips
    .map((c) => `<button class="afchip" type="button" data-clear="${c.clear}">${escapeHtml(c.label)} <span class="x">×</span></button>`)
    .join('');
}

activeFiltersEl.addEventListener('click', (e) => {
  const chip = e.target.closest('.afchip');
  if (!chip) return;
  const what = chip.dataset.clear;
  let serverFilter = false;
  if (what === 'instrument') {
    activeInstrument = 'all';
    instrumentChips.forEach((c) => c.classList.toggle('active', c.dataset.instrument === 'all'));
  } else if (what === 'genre') {
    genreFilter.value = '';
    serverFilter = true;
  } else if (what === 'key') {
    keyFilter.value = '';
    serverFilter = true;
  } else if (what === 'sig') {
    sigFilter.value = '';
    serverFilter = true;
  } else if (what === 'bpm') {
    bpmMin.value = '';
    bpmMax.value = '';
    serverFilter = true;
  } else if (what === 'source') {
    sourceFilter.value = 'all';
    serverFilter = true;
  } else if (what === 'license') {
    licenseFilter.value = 'all';
  } else if (what === 'duration') {
    durationFilter.value = 'loops';
  }
  if (serverFilter && lastTerm) runSearch(); else render();
});

function sortResults(list) {
  const mode = sortSelect.value;
  const arr = list.slice();
  if (mode === 'dur-asc') arr.sort((a, b) => (a.duration ?? 1e9) - (b.duration ?? 1e9));
  else if (mode === 'dur-desc') arr.sort((a, b) => (b.duration ?? -1) - (a.duration ?? -1));
  else if (mode === 'bpm-asc') arr.sort((a, b) => (a.bpm ?? 1e9) - (b.bpm ?? 1e9));
  return arr;
}

function updateHint() {
  const f = currentFilters();
  filterHint.textContent =
    f.genre || f.key || f.sig || f.bpmMin != null || f.bpmMax != null
      ? 'Filtros musicais ativos: itens sem o metadado correspondente ficam de fora (Looperman aplica na busca oficial).'
      : '';
}

function render() {
  renderActiveChips();
  updateHint();
  if (!lastData) return;

  const data = lastData;

  if (data.errors && data.errors.length) {
    warningsEl.innerHTML = data.errors
      .map((e) => `<div class="warning">⚠ ${escapeHtml(e.label)}: ${escapeHtml(e.message)}</div>`)
      .join('');
  } else {
    warningsEl.innerHTML = '';
  }

  const musicFilter = currentFilters();
  const baseFiltered = data.results.filter(
    (r) =>
      licenseMatches(r.license, licenseFilter.value) &&
      instrumentMatches(r, activeInstrument) &&
      musicMatches(r, musicFilter)
  );
  const filtered = baseFiltered.filter((r) => durationMatches(r.duration, durationFilter.value));
  const hiddenByDuration = baseFiltered.length - filtered.length;
  const hiddenReason =
    durationFilter.value === 'loops' ? 'acima de 1min' : 'fora da faixa de duração escolhida';

  if (!filtered.length) {
    const filtersAtivos =
      licenseFilter.value !== 'all' ||
      durationFilter.value !== 'loops' ||
      activeInstrument !== 'all' ||
      sourceFilter.value !== 'all' ||
      Object.keys(musicFilter).length > 0;
    const notes = [];
    if (hiddenByDuration > 0) {
      notes.push(
        `${hiddenByDuration} resultado(s) ${hiddenReason} ficaram ocultos — ajuste a Duração para ver.`
      );
    }
    if (data.droppedLong > 0) {
      notes.push(`${data.droppedLong} áudio(s) com mais de 2min foram removidos automaticamente.`);
    }
    const hint = notes.length
      ? notes.map(escapeHtml).join(' ')
      : `${filtersAtivos ? 'Tente relaxar os filtros ou ' : ''}use termos mais simples ou em inglês — ex.: "drums", "synth", "ambient".`;
    emptyEl.innerHTML = `
      <p>Nenhum resultado para "${escapeHtml(data.query)}".</p>
      <p class="muted">${hint}</p>`;
    emptyEl.classList.remove('hidden');
    resultsEl.innerHTML = '';
    resultsHead.classList.add('hidden');
    listHead.classList.add('hidden');
    const emptyCounts = ['0 resultado(s)'];
    if (hiddenByDuration > 0) emptyCounts.push(`${hiddenByDuration} ${hiddenReason} oculto(s)`);
    if (data.droppedLong > 0) emptyCounts.push(`${data.droppedLong} >2min removido(s)`);
    if (data.tookMs) emptyCounts.push(`${(data.tookMs / 1000).toFixed(1)}s`);
    resultCount.textContent = emptyCounts.join(' · ');
    return;
  }

  emptyEl.classList.add('hidden');
  const sorted = sortResults(filtered);
  resultsEl.innerHTML = sorted.map(rowHtml).join('');
  resultsHead.classList.remove('hidden');
  listHead.classList.remove('hidden');
  const counts = [`${sorted.length} resultado(s)`];
  if (hiddenByDuration > 0) counts.push(`${hiddenByDuration} ${hiddenReason} oculto(s)`);
  if (data.droppedLong > 0) counts.push(`${data.droppedLong} >2min removido(s)`);
  if (data.tookMs) counts.push(`${(data.tookMs / 1000).toFixed(1)}s`);
  resultCount.textContent = counts.join(' · ');
}

resultsEl.addEventListener('click', (e) => {
  const btnPlay = e.target.closest('.play');
  if (!btnPlay || btnPlay.disabled) return;
  const audio = btnPlay.parentElement.querySelector('audio');
  if (!audio) return;
  if (audio.paused) {
    resultsEl.querySelectorAll('audio').forEach((a) => {
      if (a !== audio && !a.paused) a.pause();
    });
    audio.play().catch(() => {});
  } else {
    audio.pause();
  }
});

resultsEl.addEventListener(
  'play',
  (e) => {
    if (e.target.tagName !== 'AUDIO') return;
    const wrap = e.target.parentElement;
    const b = wrap && wrap.querySelector('.play');
    if (b) b.textContent = '❚❚';
  },
  true
);

resultsEl.addEventListener(
  'pause',
  (e) => {
    if (e.target.tagName !== 'AUDIO') return;
    const wrap = e.target.parentElement;
    const b = wrap && wrap.querySelector('.play');
    if (b) b.textContent = '▶';
  },
  true
);

async function runSearch() {
  const term = input.value.trim();
  if (!term) return;
  lastTerm = term;
  searching = true;

  btn.disabled = true;
  warningsEl.innerHTML = '';
  resultsEl.innerHTML = '';
  emptyEl.classList.add('hidden');
  resultCount.textContent = 'Buscando nas fontes...';
  resultsHead.classList.remove('hidden');
  listHead.classList.add('hidden');

  const params = new URLSearchParams({ q: term });
  if (sourceFilter.value !== 'all') params.set('sources', sourceFilter.value);
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
    resultCount.textContent = '';
    warningsEl.innerHTML = `<div class="warning">⚠ Falha na busca: ${escapeHtml(err.message)}</div>`;
  } finally {
    btn.disabled = false;
    searching = false;
  }
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
  } catch {
    // selects ficam apenas com "Todos"
  }
}

loadFilters();
input.focus();
