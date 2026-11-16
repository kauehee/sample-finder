function licenseLabel(url) {
  if (!url) return null;
  if (/publicdomain\/zero/.test(url)) return 'CC0 1.0';
  const m = url.match(/creativecommons\.org\/licenses\/([^/]+)\/([0-9.]+)/);
  if (m) return `CC ${m[1].replace(/-/g, ' ').toUpperCase()} ${m[2]}`;
  return null;
}

async function searchFreesound(term, { pageSize = 150, filters = {} } = {}) {
  const key = process.env.FSOUND_API_KEY;
  if (!key) {
    throw new Error('Fonte desativada: configure FSOUND_API_KEY (grátis em freesound.org/apiv2/apply)');
  }

  const params = new URLSearchParams({
    query: term,
    fields: 'id,name,username,duration,previews,license,url',
    page_size: String(pageSize),
    filter: 'duration:[0 TO 120]',
  });
  const res = await fetch(`https://freesound.org/apiv2/search/text/?${params.toString()}`, {
    headers: { Authorization: `Token ${key}` },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();

  return (data.results || [])
    .filter((s) => !s.duration || Number(s.duration) <= 120)
    .map((s) => {
      const preview = (s.previews && (s.previews['preview-hq-mp3'] || s.previews['preview-lq-mp3'])) || null;
      const filename = preview ? `${s.id}_preview.mp3` : null;
      return {
        id: `fs-${s.id}`,
        source: 'freesound',
        title: s.name,
        author: s.username,
        duration: s.duration || null,
        size: null,
        previewUrl: preview ? `/proxy?url=${encodeURIComponent(preview)}` : null,
        downloadUrl: preview ? `/proxy?url=${encodeURIComponent(preview)}` : null,
        filename,
        pageUrl: s.url || `https://freesound.org/s/${s.id}/`,
        license: licenseLabel(s.license),
        licenseUrl: s.license || null,
      };
    });
}

module.exports = { searchFreesound };
