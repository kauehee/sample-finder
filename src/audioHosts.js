// Hosts de áudio liberados no /proxy e o Referer que cada CDN exige.
const AUDIO_HOSTS = new Map([
  ['www.looperman.com', { referer: 'https://www.looperman.com/' }],
  ['looperman.com', { referer: 'https://www.looperman.com/' }],
  ['cdn.freesound.org', { referer: 'https://freesound.org/' }],
  ['demos.loopmasters.com', { referer: 'https://www.loopmasters.com/' }],
  ['cdn.mos.musicradar.com', { referer: 'https://www.musicradar.com/' }],
  ['cdn.producerloops.com', { referer: 'https://www.producerloops.com/' }],
  ['nyc3.digitaloceanspaces.com', { referer: 'https://www.waproduction.com/', prefix: '/waeshop-space/' }],
  ['unisonsoundbanks.s3.us-west-1.amazonaws.com', { referer: 'https://unison.audio/' }],
]);

function isAllowedHost(hostname, pathname = '') {
  if (hostname === 'archive.org' || hostname.endsWith('.archive.org')) return true;
  const cfg = AUDIO_HOSTS.get(hostname);
  if (!cfg) return false;
  return !cfg.prefix || pathname.startsWith(cfg.prefix);
}

function refererFor(urlStr) {
  let url;
  try {
    url = new URL(String(urlStr));
  } catch {
    return null;
  }
  if (url.hostname === 'archive.org' || url.hostname.endsWith('.archive.org')) {
    return 'https://archive.org/';
  }
  const cfg = AUDIO_HOSTS.get(url.hostname);
  return cfg && cfg.referer ? cfg.referer : null;
}

module.exports = { AUDIO_HOSTS, isAllowedHost, refererFor };
