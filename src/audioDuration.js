const { refererFor } = require('./audioHosts');

// Sonda de duração: lê só o começo do arquivo (Range) e estima/extrai a
// duração real do MP3 (Xing/Info ou bitrate CBR) ou do WAV (RIFF).
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const HEAD_BYTES = 64 * 1024;
const FOLLOW_BYTES = 32 * 1024;
const CACHE_TTL = 6 * 60 * 60 * 1000;
const FAIL_TTL = 10 * 60 * 1000;
const CACHE_MAX = 1500;

const cache = new Map();

const BITRATES = {
  '1-3': [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  '1-2': [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
  '1-1': [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
  '2-3': [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
  '2-2': [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
  '2-1': [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
};

const SAMPLE_RATES = {
  3: [44100, 48000, 32000],
  2: [22050, 24000, 16000],
  0: [11025, 12000, 8000],
};

function syncsafe(buf, off) {
  return (
    ((buf[off] & 0x7f) << 21) |
    ((buf[off + 1] & 0x7f) << 14) |
    ((buf[off + 2] & 0x7f) << 7) |
    (buf[off + 3] & 0x7f)
  );
}

// opts.offset = posição do byte 0 do buffer dentro do arquivo
// opts.id3Size = tamanho total do ID3v2 já conhecido (quando o frame veio num 2º Range)
function parseMp3(buf, totalSize, opts = {}) {
  const base = opts.offset || 0;
  let id3 = opts.id3Size || 0;
  if (!id3 && buf.length > 10 && buf.toString('latin1', 0, 3) === 'ID3') {
    id3 = 10 + syncsafe(buf, 6);
    if (buf[5] & 0x10) id3 += 10;
  }

  let frame = -1;
  const startScan = Math.max(0, id3 - base);
  for (let i = startScan; i < buf.length - 4; i++) {
    if (buf[i] === 0xff && (buf[i + 1] & 0xe0) === 0xe0) {
      frame = i;
      break;
    }
  }
  if (frame < 0) {
    return { error: 'sem frame sync', id3, needsMore: id3 > base + buf.length - 4 };
  }

  const b1 = buf[frame + 1];
  const b2 = buf[frame + 2];
  const b3 = buf[frame + 3];
  const verBits = (b1 >> 3) & 3;
  const layerBits = (b1 >> 1) & 3;
  const brIdx = (b2 >> 4) & 15;
  const srIdx = (b2 >> 2) & 3;
  if (verBits === 1 || layerBits === 0 || brIdx === 0 || brIdx === 15 || srIdx === 3) {
    return { error: 'header inválido', id3 };
  }

  const version = verBits === 3 ? 1 : verBits === 2 ? 2 : 2.5;
  const layer = 4 - layerBits;
  const bitrate = BITRATES[`${version === 1 ? 1 : 2}-${layer}`][brIdx] * 1000;
  const sampleRate = SAMPLE_RATES[verBits][srIdx];
  const samplesPerFrame = layer === 1 ? 384 : layer === 2 ? 1152 : version === 1 ? 1152 : 576;
  const channelMode = (b3 >> 6) & 3;
  const sideInfo = version === 1 ? (channelMode === 3 ? 17 : 32) : channelMode === 3 ? 9 : 17;

  const xingOff = frame + 4 + sideInfo;
  if (buf.length >= xingOff + 12) {
    const tag = buf.toString('latin1', xingOff, xingOff + 4);
    if (tag === 'Xing' || tag === 'Info') {
      const flags = buf.readUInt32BE(xingOff + 4);
      if (flags & 1) {
        const frames = buf.readUInt32BE(xingOff + 8);
        if (frames > 0) {
          return {
            duration: (frames * samplesPerFrame) / sampleRate,
            bitrate,
            sampleRate,
            exact: true,
          };
        }
      }
    }
  }

  if (!totalSize) return { error: 'sem tamanho total', bitrate, sampleRate };
  const audioBytes = Math.max(0, totalSize - id3);
  return {
    duration: (audioBytes * 8) / bitrate,
    bitrate,
    sampleRate,
    exact: false,
  };
}

function parseWav(buf, totalSize) {
  if (buf.length < 44) return null;
  if (buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'WAVE') return null;

  let offset = 12;
  let byteRate = null;
  let dataSize = null;
  while (offset + 8 <= buf.length) {
    const id = buf.toString('latin1', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    if (id === 'fmt ' && offset + 20 <= buf.length) {
      byteRate = buf.readUInt32LE(offset + 16);
    } else if (id === 'data') {
      dataSize = size;
      if (byteRate) break;
    }
    if (size <= 0 || size > buf.length) break;
    offset += 8 + size + (size % 2);
  }

  if (!byteRate) return null;
  if (dataSize && dataSize !== 0xffffffff) return dataSize / byteRate;
  if (totalSize) return Math.max(0, totalSize - 44) / byteRate;
  return null;
}

async function fetchRange(url, start, length) {
  const headers = {
    'User-Agent': UA,
    Range: `bytes=${start}-${start + length - 1}`,
  };
  const referer = refererFor(url);
  if (referer) headers.Referer = referer;

  const res = await fetch(url, {
    headers,
    redirect: 'follow',
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const contentRange = res.headers.get('content-range') || '';
  const rangeMatch = contentRange.match(/\/(\d+)$/);
  let total = rangeMatch ? Number(rangeMatch[1]) : 0;
  if (!total && res.status === 200) {
    const len = Number(res.headers.get('content-length') || 0);
    if (len > 0) total = len;
  }

  const chunks = [];
  let got = 0;
  if (res.body) {
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(Buffer.from(value));
      got += value.length;
      if (got >= length) {
        try {
          await reader.cancel();
        } catch {}
        break;
      }
    }
  }

  return { buf: Buffer.concat(chunks), total: total || null };
}

async function probeAudioDuration(url) {
  const now = Date.now();
  const cached = cache.get(url);
  if (cached) {
    const ttl = cached.duration != null ? CACHE_TTL : FAIL_TTL;
    if (now - cached.at < ttl) return cached.duration;
  }

  let duration = null;
  try {
    const first = await fetchRange(url, 0, HEAD_BYTES);
    const isWav = first.buf.length >= 12 && first.buf.toString('latin1', 0, 4) === 'RIFF';
    if (isWav) {
      duration = parseWav(first.buf, first.total);
    } else {
      let parsed = parseMp3(first.buf, first.total);
      if (!parsed.duration && parsed.needsMore && parsed.id3 < (first.total || Infinity)) {
        const follow = await fetchRange(url, parsed.id3, FOLLOW_BYTES);
        parsed = parseMp3(follow.buf, first.total, { offset: parsed.id3, id3Size: parsed.id3 });
      }
      duration = parsed.duration || null;
    }
  } catch {
    duration = null;
  }

  if (duration != null && (!isFinite(duration) || duration <= 0)) duration = null;
  if (duration != null) duration = Math.round(duration * 10) / 10;

  cache.set(url, { at: now, duration });
  if (cache.size > CACHE_MAX) {
    for (const [key, entry] of cache) {
      if (now - entry.at > CACHE_TTL) cache.delete(key);
    }
    if (cache.size > CACHE_MAX) cache.clear();
  }
  return duration;
}

module.exports = { probeAudioDuration };
