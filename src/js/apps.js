import {launchApp, launchAppViaRoot, listApps} from './luna.js';
import {
  isAppInstalled,
  isCatalogComplete,
  loadAppCatalog,
  normalizeAppRecord,
  prefersBundledIcons,
  resolvePinnedApp,
  setIconSrc
} from './app-catalog.js';
import {getAppIdCandidates, getBuiltinAppIcon} from './app-icons.js';

const BUNDLED_SETTINGS_ICON = 'assets/app-icons/tv-settings.png';

/**
 * Launch an app by trying every candidate id, sandboxed then root.
 * Prime Video is `amazon.html` on older TVs and native `amazon` on current
 * OLEDs — the first id often 404s or hangs, so we must fall through.
 */
export async function launchAppCandidates(ids) {
  const unique = [];
  (ids || []).forEach(function (id) {
    if (id && unique.indexOf(id) < 0) unique.push(id);
  });

  for (let i = 0; i < unique.length; i += 1) {
    try {
      await launchApp(unique[i]);
      return unique[i];
    } catch (err) {
      // Missing id or sandboxed launch denied (native Prime Video).
    }
    try {
      await launchAppViaRoot(unique[i]);
      return unique[i];
    } catch (err2) {
      // Try the next candidate.
    }
  }
  return '';
}

const APP_ID = 'org.webosbrew.lounge.launcher';
// The last dock built from the TV's full app list, painted at the next start.
const DOCK_SNAPSHOT_KEY = 'lounge.dock.v1';

export function createAppGrid(container, getConfig, options) {
  let catalog = {};

  // Each tile's app: a late app list updates tiles in place (see
  // retryNames), which leaves the remote's focus where it is.
  const tileApps = new WeakMap();

  function fallbackBadge(title) {
    const fallback = document.createElement('span');
    fallback.className = 'app-fallback';
    fallback.textContent = String(title || '').slice(0, 2).toUpperCase();
    return fallback;
  }

  function tileIcon(app) {
    if (!app.icon) return fallbackBadge(app.title);
    const img = document.createElement('img');
    img.className = 'app-icon';
    img.alt = '';
    img.addEventListener('error', function () {
      const fallbackIcon = getBuiltinAppIcon(app.id);
      if (fallbackIcon && img.dataset.iconUrl !== fallbackIcon) {
        setIconSrc(img, fallbackIcon);
        return;
      }
      if (img.parentNode) img.parentNode.replaceChild(fallbackBadge(app.title), img);
    });
    setIconSrc(img, app.icon, {keep: true});
    return img;
  }

  function makeTile(app, index) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'app-tile focusable';
    button.dataset.focusIndex = String(index);
    button.dataset.appId = app.id;
    button.setAttribute('aria-label', app.title);

    const label = document.createElement('span');
    label.className = 'app-label';
    label.textContent = app.title;

    button.appendChild(tileIcon(app));
    button.appendChild(label);

    tileApps.set(button, app);
    button.addEventListener('click', function () {
      openApp(tileApps.get(button) || app);
    });

    return button;
  }

  function updateTile(button, app) {
    tileApps.set(button, app);
    button.setAttribute('aria-label', app.title);
    const label = button.querySelector('.app-label');
    if (label) label.textContent = app.title;
    const icon = tileIcon(app);
    const old = button.querySelector('.app-icon, .app-fallback');
    if (old) button.replaceChild(icon, old);
    else button.insertBefore(icon, label);
  }

  function makeSettingsTile(index, iconUrl) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'app-tile settings-tile focusable';
    button.dataset.focusIndex = String(index);
    button.dataset.action = 'tv-settings';
    button.setAttribute('aria-label', 'Impostazioni TV');

    const img = document.createElement('img');
    img.className = 'app-icon';
    img.alt = '';
    img.addEventListener('error', function () {
      if (img.dataset.iconUrl !== BUNDLED_SETTINGS_ICON) {
        setIconSrc(img, BUNDLED_SETTINGS_ICON);
        return;
      }
      img.remove();
      const fallback = document.createElement('span');
      fallback.className = 'app-fallback';
      fallback.textContent = '\u2699';
      button.insertBefore(fallback, label);
    });
    setIconSrc(img, document.body.classList.contains('cinematic') ? 'assets/cinema-settings.svg' : (iconUrl || BUNDLED_SETTINGS_ICON));
    button.appendChild(img);

    const label = document.createElement('span');
    label.className = 'app-label';
    label.textContent = 'Impostazioni TV';
    button.appendChild(label);

    button.addEventListener('click', function () {
      if (options.onOpenTvSettings) options.onOpenTvSettings();
    });

    return button;
  }

  // All apps: opens the grid of every app on the TV (all-apps.js).
  const ALL_APPS_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="currentColor">' +
    [3, 9.5, 16].map(function (y) {
      return [3, 9.5, 16].map(function (x) {
        return '<rect x="' + x + '" y="' + y + '" width="5" height="5" rx="1.4"/>';
      }).join('');
    }).join('') + '</g></svg>';

  const INPUT_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18v10H3z M9 20h6 M12 16v4 M7 10h4"/></svg>';

  /**
   * The inputs shown in the wide dock: HDMI always (dimmed with no signal),
   * other inputs (AV, Component) only while something is connected. Live TV
   * has its own tab.
   */
  function dockInputs() {
    const list = typeof options.getInputs === 'function' ? options.getInputs() || [] : [];
    const labels = (getConfig().launcher || {}).inputLabels || {};
    return list.filter(function (d) {
      return d && d.id && !/^(TV|LIVE_TV|TUNER)$/.test(d.id) && (/^HDMI_/.test(d.id) || d.connected);
    }).map(function (d) {
      return Object.assign({}, d, {label: labels[d.id] || d.label || d.id.replace(/_/g, ' ')});
    });
  }

  function makeInputTile(device, index) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'app-tile input-tile focusable' + (device.connected === false ? ' input-off' : '');
    button.dataset.focusIndex = String(index);
    button.dataset.inputId = device.id;
    button.setAttribute('aria-label', device.label + (device.connected === false ? ', nessun segnale' : ''));
    const icon = document.createElement('span');
    icon.className = 'app-fallback input-icon';
    icon.innerHTML = INPUT_ICON;
    button.appendChild(icon);
    const label = document.createElement('span');
    label.className = 'app-label';
    label.textContent = device.label;
    button.appendChild(label);
    if (device.connected === false) {
      const sub = document.createElement('span');
      sub.className = 'input-sub';
      sub.textContent = 'Nessun segnale';
      button.appendChild(sub);
    }
    button.addEventListener('click', function () {
      if (options.onOpenInput) options.onOpenInput(device);
    });
    return button;
  }

  function makeAllAppsTile(index) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'app-tile all-apps-launcher focusable';
    button.dataset.focusIndex = String(index);
    button.dataset.action = 'all-apps';
    button.setAttribute('aria-label', 'Tutte le app');

    const icon = document.createElement('span');
    icon.className = 'app-fallback all-apps-icon';
    icon.innerHTML = ALL_APPS_ICON;
    button.appendChild(icon);

    const label = document.createElement('span');
    label.className = 'app-label';
    label.textContent = 'Tutte le app';
    button.appendChild(label);

    button.addEventListener('click', function () {
      if (options.onOpenAllApps) options.onOpenAllApps();
    });
    return button;
  }

  async function openApp(app) {
    if (options.onBeforeLaunch) options.onBeforeLaunch();

    const ids = [];
    function addId(id) {
      if (id && ids.indexOf(id) < 0) ids.push(id);
    }
    if (app && Array.isArray(app.ids)) {
      app.ids.forEach(addId);
    }
    addId(app && app.launchId);
    getAppIdCandidates((app && app.id) || '').forEach(addId);
    getAppIdCandidates((app && app.launchId) || '').forEach(addId);

    const launched = await launchAppCandidates(ids);
    if (launched) return launched;

    const label = app && app.title ? app.title : (app && app.id) || 'app';
    if (options.onToast) options.onToast('Could not launch ' + label);
    return '';
  }

  // What the current dock was built from; see refresh({reuse}).
  let builtSignature = '';
  let builtInputs = '';
  let lastSignature = '';

  // Built without the TV's full app list (root not answering yet, Luna late
  // after power-on): ask again a few times and fill names and icons in place.
  const NAME_RETRY_MS = [20000, 60000, 180000];
  let nameRetry = null;
  let nameRetries = 0;

  function scheduleNameRetry(listed) {
    if (nameRetry) clearTimeout(nameRetry);
    nameRetry = null;
    if (listed) {
      nameRetries = 0;
      return;
    }
    if (nameRetries >= NAME_RETRY_MS.length) return;
    nameRetry = setTimeout(retryNames, NAME_RETRY_MS[nameRetries]);
    nameRetries += 1;
  }

  async function retryNames() {
    nameRetry = null;
    const fresh = await loadAppCatalog();
    const listed = isCatalogComplete(fresh);
    const listedAny = Object.keys(fresh).length > 0;
    const tiles = container.querySelectorAll('.app-tile[data-app-id]');
    for (let i = 0; i < tiles.length; i += 1) {
      const current = tileApps.get(tiles[i]);
      if (!current || current.custom) continue;
      const info = await resolvePinnedApp(tiles[i].dataset.appId, fresh);
      if (info.title !== current.title || info.icon !== current.icon) updateTile(tiles[i], info);
    }
    if (listedAny) {
      catalog = fresh;
      builtSignature = lastSignature;
    }
    scheduleNameRetry(listed);
  }

  /**
   * @param {{reuse?: boolean}} [opts] reuse: keep the current dock when its
   *   inputs are unchanged. Returning from an app used to redo every Luna
   *   lookup (app list + one getAppInfo per pinned app) and redraw the dock.
   */
  // The dock settings and the signature its tiles were built from.
  function dockSettings() {
    const config = getConfig();
    const pinned = (config.launcher && config.launcher.pinnedApps) || [];
    const customApps = (config.launcher && config.launcher.customApps) || [];
    const iconSize = (config.launcher && config.launcher.iconSize) || 'medium';
    const allAppsTile = !(config.launcher && config.launcher.allAppsTile === false);
    const numberKeys = !(config.launcher && config.launcher.numberKeyLaunch === false);
    const wide = !(config.launcher && config.launcher.dockStyle === 'compact');
    const inputs = wide && !(config.launcher && config.launcher.dockInputs === false);
    return {
      wide: wide,
      inputs: inputs,
      pinned: pinned,
      customApps: customApps,
      iconSize: iconSize,
      allAppsTile: allAppsTile,
      numberKeys: numberKeys,
      signature: JSON.stringify([pinned, customApps, iconSize, prefersBundledIcons(), allAppsTile, numberKeys, wide, inputs])
    };
  }

  function applyTileScale(iconSize) {
    const scaleBySize = {small: 0.78, medium: 1, large: 1.28};
    container.style.setProperty('--tile-scale', String(scaleBySize[iconSize] || 1));
  }

  function readSnapshot() {
    try {
      const value = JSON.parse(localStorage.getItem(DOCK_SNAPSHOT_KEY) || 'null');
      return value && typeof value === 'object' && Array.isArray(value.apps) ? value : null;
    } catch (err) {
      return null;
    }
  }

  function writeSnapshot(signature, pinnedApps, settingsIcon, inputs) {
    try {
      localStorage.setItem(DOCK_SNAPSHOT_KEY, JSON.stringify({
        sig: signature,
        apps: pinnedApps,
        settingsIcon: settingsIcon,
        inputs: (inputs || []).map(function (d) {
          return {id: d.id, label: d.label, connected: d.connected, appId: d.appId};
        })
      }));
    } catch (err) { /* storage full: the dock is built from Luna next time */ }
  }

  /**
   * Paint the last complete dock at once, before any Luna call. A cold start
   * (webOS closes Cinema when RAM is short) otherwise shows an empty dock
   * until the app list arrives. refresh() then rebuilds it from the TV.
   * True when tiles were painted.
   */
  function paintCached() {
    if (container.children.length) return false;
    const dock = dockSettings();
    const snapshot = readSnapshot();
    if (!snapshot || snapshot.sig !== dock.signature) return false;
    applyTileScale(dock.iconSize);
    const tiles = snapshot.apps.filter(function (entry) {
      return entry && entry.app && entry.app.id;
    }).map(function (entry) {
      return makeTile(entry.app, entry.index);
    });
    if (dock.inputs) {
      (snapshot.inputs || []).forEach(function (device, i) {
        tiles.push(makeInputTile(device, dock.pinned.length + 10 + i));
      });
    }
    if (dock.allAppsTile) tiles.push(makeAllAppsTile(dock.pinned.length));
    tiles.push(makeSettingsTile(dock.pinned.length + 1, snapshot.settingsIcon || ''));
    swapIn(tiles, dock.numberKeys);
    // Not built from the TV's app list: the next refresh must not reuse it.
    builtSignature = '';
    return true;
  }

  // Number the home row 1-9 in the order it reads (pinned apps, then All
  // apps, then TV Settings) so the remote's number keys open a tile by
  // position, then put the tiles in the dock.
  function swapIn(tiles, numberKeys) {
    // The badge is the visible half of the shortcut.
    if (numberKeys) {
      tiles.slice(0, 9).forEach(function (tile, i) {
        const key = String(i + 1);
        tile.dataset.appKey = key;
        const badge = document.createElement('span');
        badge.className = 'app-key';
        badge.setAttribute('aria-hidden', 'true');
        badge.textContent = key;
        tile.appendChild(badge);
      });
    }

    // The remote may already be on a tile (a cached dock painted first):
    // keep it on the same app after the swap.
    const focused = container.querySelector('.app-tile.focused');
    const focusedKey = focused ? (focused.dataset.appId || focused.dataset.focusIndex) : '';

    // Swap in the freshly built tiles atomically. Clearing the container up
    // front instead would leave the dock empty (and unselectable) for the whole
    // async catalog fetch above -- and if that fetch stalls after a failed app
    // launch, the dock would stay empty and focus would never be restored.
    const fragment = document.createDocumentFragment();
    for (const tile of tiles) {
      fragment.appendChild(tile);
    }
    container.innerHTML = '';
    container.appendChild(fragment);

    if (focusedKey && typeof options.refocus === 'function') {
      const again = tiles.filter(function (tile) {
        return (tile.dataset.appId || tile.dataset.focusIndex) === focusedKey;
      })[0];
      if (again) options.refocus(again);
    }
  }

  async function refresh(opts) {
    const dock = dockSettings();
    const pinned = dock.pinned;
    const customApps = dock.customApps;
    const customById = {};
    customApps.forEach(function (entry) {
      if (entry && entry.id) customById[entry.id] = entry;
    });
    applyTileScale(dock.iconSize);
    const allAppsTile = dock.allAppsTile;
    const numberKeys = dock.numberKeys;
    const signature = dock.signature;
    const inputsSignature = dock.inputs ? JSON.stringify(dockInputs().map(function (d) { return [d.id, d.label, d.connected]; })) : '';
    if (opts && opts.reuse && signature === builtSignature && inputsSignature === builtInputs && container.children.length) {
      return;
    }
    builtInputs = inputsSignature;
    const tiles = [];
    const pinnedApps = [];

    catalog = await loadAppCatalog();

    for (let i = 0; i < pinned.length; i += 1) {
      const custom = customById[pinned[i]];
      if (custom) {
        const launchId = custom.launchId || custom.id;
        // No bundled icon picked: use the app's own, as the TV reports it.
        const icon = custom.icon || (await resolvePinnedApp(launchId, catalog)).icon || '';
        const customApp = {
          id: launchId,
          launchId: launchId,
          title: custom.title || launchId,
          icon: icon,
          custom: true
        };
        pinnedApps.push({app: customApp, index: i});
        tiles.push(makeTile(customApp, i));
        continue;
      }
      // Pinned but not on this TV (a default pin, or an app since removed):
      // no tile that can't open. Settings still lists it, marked.
      if (!isAppInstalled(catalog, pinned[i])) continue;
      const info = await resolvePinnedApp(pinned[i], catalog);
      pinnedApps.push({app: info, index: i});
      tiles.push(makeTile(info, i));
    }

    let settingsIcon = '';
    if (!prefersBundledIcons()) {
      const settingsApp = catalog['com.webos.app.settings'] || catalog['com.palm.app.settings'];
      settingsIcon = (settingsApp && settingsApp.icon) || '';
    }
    if (dock.inputs) {
      dockInputs().forEach(function (device, i) {
        tiles.push(makeInputTile(device, pinned.length + 10 + i));
      });
    }
    if (allAppsTile) tiles.push(makeAllAppsTile(pinned.length));
    tiles.push(makeSettingsTile(pinned.length + 1, settingsIcon));

    swapIn(tiles, numberKeys);
    // Only reuse a dock built from a real app list: at power-on the Luna
    // services can be late, and that first dock uses fallback titles/icons.
    builtSignature = Object.keys(catalog).length ? signature : '';
    lastSignature = signature;
    const complete = isCatalogComplete(catalog);
    if (complete) writeSnapshot(signature, pinnedApps, settingsIcon, dock.inputs ? dockInputs() : []);
    scheduleNameRetry(complete);
  }

  return {
    refresh: refresh,
    paintCached: paintCached,
    isLoungeApp: function (id) {
      return id === APP_ID;
    },
    launchApp: openApp,
    /**
     * Open the home row tile numbered `n` (1-9), exactly as pressing Select on
     * it would. False when there is no such tile.
     */
    launchByNumber: function (n) {
      const config = getConfig();
      if (config.launcher && config.launcher.numberKeyLaunch === false) return false;
      const num = Number(n);
      if (!(num >= 1 && num <= 9)) return false;
      const tile = container.querySelector('.app-tile[data-app-key="' + num + '"]');
      if (!tile) return false;
      tile.click();
      return true;
    }
  };
}

export async function listInstalledApps(options) {
  const includeHidden = !!(options && options.includeHidden);
  try {
    const res = await listApps();
    return (res.apps || [])
      .filter(function (app) {
        const id = (app && (app.id || app.appId)) || '';
        if (includeHidden) return true;
        const record = (app && app.appInfo) || app || {};
        return record.visible !== false;
      })
      .map(function (app) {
        // hidden: a system or background app LG keeps off its own home screen.
        const record = (app && app.appInfo) || app || {};
        return Object.assign(normalizeAppRecord(app, app && app.id), {hidden: record.visible === false});
      });
  } catch (err) {
    return [];
  }
}