import {fetchJson} from './usb.js';
import {resolveAppUrl, withAssetVersion} from './compat.js';
import {APP_VERSION} from './version.js';

const BUILTIN_MANIFEST = 'assets/music/manifest.json';
// The tracks are not in the IPK (7 MB): with music on they stream from this
// repo via jsDelivr, pinned to this version's tag (the CDN marks the files
// immutable, so the TV caches them after the first play). The manifest still
// ships. Offline, music.js says music is unavailable instead of retrying.
const MUSIC_BASE = 'https://cdn.jsdelivr.net/gh/fabiodalez-dev/Cinema@v' + APP_VERSION + '/assets/music/';

/**
 * Hard-coded list matching assets/music/manifest.json.
 * Used when XHR/fetch of the manifest fails (common on webOS 4.x local files).
 */
export const BUILTIN_MUSIC_FALLBACK = [
  {id: 'midnight-lounge', title: 'Midnight Lounge', artist: 'Ambient', file: 'midnight-lounge.mp3'},
  {id: 'starlight-drift', title: 'Starlight Drift', artist: 'Ambient', file: 'starlight-drift.mp3'},
  {id: 'ocean-haze', title: 'Ocean Haze', artist: 'Ambient', file: 'ocean-haze.mp3'},
  {id: 'warm-glow', title: 'Warm Glow', artist: 'Ambient', file: 'warm-glow.mp3'},
  {id: 'backbay-lounge', title: 'Backbay Lounge', artist: 'Jazz', file: 'backbay-lounge.mp3'},
  {id: 'chill-wave', title: 'Chill Wave', artist: 'Relaxing', file: 'chill-wave.mp3'}
];

let manifestCache = null;

export function normalizeMusicConfig(music) {
  const out = Object.assign({}, music || {});

  if (typeof out.enabled !== 'boolean') {
    out.enabled = true;
  }
  if (!out.source) {
    out.source = out.path ? 'usb' : 'builtin';
  }
  if (!out.builtin) {
    out.builtin = 'midnight-lounge';
  }
  // Which packaged tracks to rotate (ids). Empty = all built-ins.
  if (!Array.isArray(out.builtinPlaylist)) {
    out.builtinPlaylist = [];
  }
  // Which USB tracks to play (urls). Empty = all discovered in folder.
  if (!Array.isArray(out.usbPlaylist)) {
    out.usbPlaylist = [];
  }
  // Track-title chip (music bar). Default off — compact volume only.
  if (typeof out.showBar !== 'boolean') {
    out.showBar = false;
  }
  if (typeof out.volume !== 'number') {
    out.volume = 0.35;
  }

  return out;
}

function normalizeManifestList(list) {
  if (!Array.isArray(list) || !list.length) return null;
  const cleaned = list.filter(function (entry) {
    return entry && entry.id && entry.file;
  });
  return cleaned.length ? cleaned : null;
}

export async function loadBuiltinMusicManifest() {
  if (manifestCache && manifestCache.length) return manifestCache;

  // Always seed with the hard-coded list so music works even if XHR of
  // manifest.json fails (common on webOS local file://).
  manifestCache = BUILTIN_MUSIC_FALLBACK.slice();

  try {
    // Prefer relative URL first — more reliable than absolute file:// for XHR.
    const candidates = [
      withAssetVersion(BUILTIN_MANIFEST, APP_VERSION),
      BUILTIN_MANIFEST,
      withAssetVersion(resolveAppUrl(BUILTIN_MANIFEST), APP_VERSION),
      resolveAppUrl(BUILTIN_MANIFEST)
    ];
    for (let i = 0; i < candidates.length; i += 1) {
      const url = candidates[i];
      if (!url) continue;
      try {
        const manifest = await fetchJson(url);
        const loaded = normalizeManifestList(manifest && manifest.tracks);
        if (loaded && loaded.length) {
          manifestCache = loaded;
          break;
        }
      } catch (err) {
        // try next candidate
      }
    }
  } catch (err) {
    manifestCache = BUILTIN_MUSIC_FALLBACK.slice();
  }

  if (!manifestCache || !manifestCache.length) {
    manifestCache = BUILTIN_MUSIC_FALLBACK.slice();
  }

  return manifestCache;
}

/** Streaming URL of a built-in track (see MUSIC_BASE). */
export function builtinTrackUrl(file) {
  if (!file) return '';
  return MUSIC_BASE + String(file).replace(/^\/+/, '');
}

/** URL candidates to try for a built-in track: the one CDN copy. */
export function builtinTrackCandidates(file) {
  const url = builtinTrackUrl(file);
  return url ? [url] : [];
}

export function getBuiltinTrackUrl(id, manifest) {
  const list = manifest || manifestCache || BUILTIN_MUSIC_FALLBACK;
  const entry = list.find(function (item) {
    return item.id === id;
  });

  if (!entry) return '';
  return builtinTrackUrl(entry.file);
}

function toTrack(entry) {
  return {
    url: builtinTrackUrl(entry.file),
    urls: builtinTrackCandidates(entry.file),
    title: entry.title || entry.id,
    artist: entry.artist || '',
    description: entry.description || '',
    id: entry.id,
    file: entry.file
  };
}

export async function resolveBuiltinTrack(id) {
  const manifest = await loadBuiltinMusicManifest();
  const entry = manifest.find(function (item) {
    return item.id === id;
  }) || manifest[0];

  if (!entry) return null;

  return toTrack(entry);
}

/**
 * @param {string} startId preferred first track
 * @param {string[]} [enabledIds] subset of manifest ids; empty/omitted = all
 */
export async function resolveBuiltinPlaylist(startId, enabledIds) {
  let manifest = await loadBuiltinMusicManifest();
  if (!manifest || !manifest.length) {
    manifest = BUILTIN_MUSIC_FALLBACK.slice();
  }

  let list = manifest;
  if (enabledIds && enabledIds.length) {
    const allowed = {};
    enabledIds.forEach(function (id) {
      if (id) allowed[id] = true;
    });
    list = manifest.filter(function (entry) {
      return allowed[entry.id];
    });
    // If user disabled everything or ids were removed from package, fall back.
    if (!list.length) list = manifest.slice();
  }

  if (!list.length) {
    list = BUILTIN_MUSIC_FALLBACK.slice();
  }

  let startIndex = list.findIndex(function (item) {
    return item.id === startId;
  });
  if (startIndex < 0) startIndex = 0;

  const ordered = list.slice(startIndex).concat(list.slice(0, startIndex));
  return ordered.map(toTrack);
}
