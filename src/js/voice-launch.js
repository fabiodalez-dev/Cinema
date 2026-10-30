import {getAppIdCandidates, getBuiltinAppTitle} from './app-icons.js';

// English and Italian: the TV speaks Italian ("apri Netflix", "vai su YouTube").
const LAUNCH_VERB_RE = /^(?:open|launch|start|run|play|go\s+to|load|show|put\s+on|fire\s+up|bring\s+up|lunch|punch|lanch|lauch|launce|apri|aprimi|avvia|lancia|metti|vai\s+su|vai\s+a|mostra|fammi\s+vedere|accendi)\s+(?:l['’]app\s+|l['’]\s*|il\s+|la\s+|lo\s+|le\s+|gli\s+|un[ao]?\s+)?/i;

const PRIME_RE = /^(?:the\s+)?(?:amazon\s+prime(?:\s+video)?|prime\s+video|amazon\s+video|prime|amazon)$/i;

const SPOKEN_ALIASES = {
  netflix: 'netflix',
  youtube: 'youtube.leanback.v4',
  'you tube': 'youtube.leanback.v4',
  disney: 'com.disney.disneyplus',
  'disney plus': 'com.disney.disneyplus',
  'disney+': 'com.disney.disneyplus',
  'apple tv': 'com.apple.appletv',
  'bbc iplayer': 'bbc.iplayer.lge',
  iplayer: 'bbc.iplayer.lge',
  browser: 'com.webos.app.browser',
  'web browser': 'com.webos.app.browser',
  settings: 'com.webos.app.settings',
  'tv settings': 'com.webos.app.settings',
  navigatore: 'com.webos.app.browser',
  internet: 'com.webos.app.browser',
  impostazioni: 'com.webos.app.settings',
  'impostazioni tv': 'com.webos.app.settings',
  'impostazioni della tv': 'com.webos.app.settings',
  'disney più': 'com.disney.disneyplus',
  'apple tivù': 'com.apple.appletv',
  'tivù': 'com.webos.app.livetv',
  'la tv': 'com.webos.app.livetv',
  'live tv': 'com.webos.app.livetv'
};

function normalizeSpoken(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[?!.,]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function stripLaunchVerb(text) {
  const t = normalizeSpoken(text);
  return t.replace(LAUNCH_VERB_RE, '').replace(/^(?:the|a|an)\s+/, '').trim();
}

export function isPrimeVideoPhrase(text) {
  const target = stripLaunchVerb(text);
  return PRIME_RE.test(target);
}

/**
 * Map a spoken phrase ("launch prime video") to launch candidate ids.
 * Returns null when this is not an app-launch utterance.
 */
export function resolveVoiceLaunch(text, config) {
  const raw = normalizeSpoken(text);
  if (!raw) return null;
  if (/^\b(what|who|why|how|when|where|tell|about|explain)\b/.test(raw) &&
      !LAUNCH_VERB_RE.test(raw)) {
    return null;
  }

  const hasVerb = LAUNCH_VERB_RE.test(raw);
  const target = stripLaunchVerb(raw);
  if (!target) return null;
  if (!hasVerb && target.split(' ').length > 4) return null;

  if (PRIME_RE.test(target)) {
    return {
      id: 'amazon.html',
      title: 'Prime Video',
      ids: getAppIdCandidates('amazon.html')
    };
  }

  const aliasId = SPOKEN_ALIASES[target];
  if (aliasId) {
    return {
      id: aliasId,
      title: getBuiltinAppTitle(aliasId) || target,
      ids: getAppIdCandidates(aliasId)
    };
  }

  const launcher = (config && config.launcher) || {};
  const customApps = launcher.customApps || [];
  for (let i = 0; i < customApps.length; i += 1) {
    const entry = customApps[i];
    if (!entry) continue;
    const title = normalizeSpoken(entry.title || '');
    if (title && (title === target || title.indexOf(target) === 0 || target.indexOf(title) === 0)) {
      const launchId = entry.launchId || entry.id;
      return {
        id: launchId,
        title: entry.title || launchId,
        ids: getAppIdCandidates(launchId)
      };
    }
  }

  const pinned = launcher.pinnedApps || [];
  for (let j = 0; j < pinned.length; j += 1) {
    const pinId = pinned[j];
    const title = normalizeSpoken(getBuiltinAppTitle(pinId) || '');
    if (title && title === target) {
      return {
        id: pinId,
        title: getBuiltinAppTitle(pinId) || pinId,
        ids: getAppIdCandidates(pinId)
      };
    }
  }

  return null;
}
