import {SETTINGS_CATEGORIES, settingsIcon, decorateSettings} from './settings-design.js';
import {configFromBackup, loadConfig, saveConfig, TIMEZONE_OPTIONS, coerceScreensaverMinutes} from './config.js';
import {listInstalledApps} from './apps.js';
import {lgHomeAppsToAdd} from './lg-home.js';
import {isAppInstalled, loadAppCatalog, rememberApps, resolvePinnedApp, setIconSrc, lazyLoadIcon} from './app-catalog.js';
import {KNOWN_BUILTIN_APPS, getBuiltinAppIcon, getBuiltinAppTitle, BUILTIN_ICON_CHOICES} from './app-icons.js';
import {
  loadBuiltinManifest,
  normalizeBackgroundConfig,
  parseUrlList,
  REMOTE_BACKGROUNDS,
  findRemoteBackgroundById,
  findRemoteBackgroundByUrl,
  remoteThumbUrl,
  builtinImageUrl,
  jpegForTv
} from './backgrounds.js';
import {AERIAL_BACKGROUNDS} from './aerials.js';
import {loadBuiltinMusicManifest, normalizeMusicConfig} from './builtin-music.js';
import {applyActiveProfile, getProfileOverrides, PROFILE_OPTIONS} from './profiles.js';
import {fetchInputDevices, inputFromId, isTvInputId} from './inputs.js';
import {findLoungeRoots, joinPath, discoverMusicTracks} from './usb.js';
import {
  disableVoice, enableVoice, execRoot, isVoiceRunning, listLaunchPoints, readSettingsBackups,
  runTvCheck, whoAmI, writeAutoBackup, writeSettingsBackup
} from './luna.js';
import {activity} from './activity.js';
import {
  LAST_BACKUP_KEY, backupLabel, backupWhen, compatibilityNote, lastBackupNote, listBackups,
  restoreReport, settingsBackupText
} from './settings-backup.js';
import {APP_VERSION} from './version.js';
import {
  getVoiceConfig,
  getVoiceStatus,
  setVoiceConfig,
  startSuperGrokLogin,
  cancelSuperGrokLogin,
  signOutSuperGrok,
  importSuperGrokAuth
} from './voice-config.js';
import {qrSvgMarkup} from './qr-svg.js';
import {foldPlaceText, normalizeWeatherConfig, searchPlaces} from './weather.js';

const DEFAULT_INPUTS = ['HDMI_1', 'HDMI_2', 'HDMI_3', 'TV'];
const KEYBOARD_SCROLL_RESERVE = 420;

/**
 * Gate virtual keyboard on TV text fields.
 *
 * webOS opens the on-screen keyboard as soon as a text input is focused, which
 * is painful when D-pad scrolling through Settings. Keep fields read-only until
 * the user presses OK/Select (or clicks), then unlock for editing. On blur,
 * re-lock so the next focus via arrows won't pop the keyboard again.
 */
export function isSettingsTextField(el) {
  if (!el || !el.tagName) return false;
  const tag = el.tagName;
  if (tag === 'TEXTAREA') return true;
  if (tag !== 'INPUT') return false;
  const t = String(el.type || 'text').toLowerCase();
  return t === 'text' || t === 'number' || t === 'search' || t === 'url' || t === 'password';
}

export function isEditingSettingsText(el) {
  return isSettingsTextField(el) && el.readOnly === false && el.dataset.tvEdit === '1';
}

export function beginSettingsTextEdit(el) {
  if (!isSettingsTextField(el)) return false;
  el.readOnly = false;
  el.dataset.tvEdit = '1';
  try { el.focus(); } catch (err) { /* ignore */ }
  // Some webOS builds only raise the keyboard after a click once editable.
  try { el.click(); } catch (err) { /* ignore */ }
  return true;
}

export function endSettingsTextEdit(el) {
  if (!isSettingsTextField(el)) return;
  el.readOnly = true;
  delete el.dataset.tvEdit;
}

function gateTextField(input) {
  if (!input || input.dataset.tvKeyboardGated === '1') return;
  input.dataset.tvKeyboardGated = '1';
  input.readOnly = true;

  input.addEventListener('blur', function () {
    endSettingsTextEdit(input);
  });

  // Magic Remote pointer: click should enter edit mode (same as OK).
  input.addEventListener('click', function (event) {
    if (input.readOnly) {
      event.preventDefault();
      beginSettingsTextEdit(input);
    }
  });
}

function attachInputScrollHelpers(scrollContainer) {
  if (!scrollContainer) return;

  scrollContainer.querySelectorAll('input[type="text"], input[type="number"], textarea').forEach(function (input) {
    gateTextField(input);

    input.addEventListener('focus', function () {
      // Only scroll for keyboard when actually editing (Select pressed).
      if (input.readOnly) return;
      window.setTimeout(function () {
        const containerRect = scrollContainer.getBoundingClientRect();
        const inputRect = input.getBoundingClientRect();
        const visibleBottom = containerRect.bottom - KEYBOARD_SCROLL_RESERVE;

        if (inputRect.bottom > visibleBottom) {
          scrollContainer.scrollTop += inputRect.bottom - visibleBottom + 32;
        } else if (inputRect.top < containerRect.top + 16) {
          scrollContainer.scrollTop -= containerRect.top + 16 - inputRect.top;
        }
      }, 320);
    });
  });
}

function createOptionStepper(className, focusIndex, optionList, currentValue, onChange) {
  const el = document.createElement('div');
  el.className = 'option-stepper focusable' + (className ? ' ' + className : '');
  el.dataset.focusIndex = String(focusIndex);
  el.tabIndex = 0;el.setAttribute('role','button');

  const prev = document.createElement('span');
  prev.className = 'stepper-arrow';
  prev.textContent = '\u2039';

  const labelEl = document.createElement('span');
  labelEl.className = 'stepper-label';

  const next = document.createElement('span');
  next.className = 'stepper-arrow';
  next.textContent = '\u203A';

  el.appendChild(prev);
  el.appendChild(labelEl);
  el.appendChild(next);

  let options = optionList.slice();
  let index = 0;

  function indexOfValue(value) {
    for (let i = 0; i < options.length; i += 1) {
      if (options[i].value === value) return i;
    }
    return -1;
  }

  function render() {
    const opt = options[index] || {value: '', label: ''};
    labelEl.textContent = opt.label;
    if(el.dataset.controlLabel)el.setAttribute('aria-label',el.dataset.controlLabel+': '+opt.label);
    el.value = opt.value;
    el.dataset.value = opt.value;
    prev.classList.toggle('is-disabled', index <= 0);
    next.classList.toggle('is-disabled', index >= options.length - 1);
  }

  el.__step = function (dir) {
    if (!options.length) return;
    let n = index + dir;
    if (n < 0) n = 0;
    if (n > options.length - 1) n = options.length - 1;
    if (n !== index) {
      index = n;
      render();
      if (onChange) onChange(el.value);
    }
  };

  el.setOptions = function (newOptions, newValue) {
    options = (newOptions || []).slice();
    const found = indexOfValue(newValue);
    index = found >= 0 ? found : 0;
    render();
  };

  el.setValue = function (value) {
    const found = indexOfValue(value);
    if (found >= 0 && found !== index) {
      index = found;
      render();
    }
  };

  prev.addEventListener('click', function (event) {
    event.stopPropagation();
    el.__step(-1);
  });

  next.addEventListener('click', function (event) {
    event.stopPropagation();
    el.__step(1);
  });

  el.addEventListener('click', function (event) {
    if (event.target === prev || event.target === next) return;
    el.__step(1);
  });

  const start = indexOfValue(currentValue);
  index = start >= 0 ? start : 0;
  render();
  return el;
}

/**
 * Settings -> TV check: one line about Cinema itself. It heads the text
 * on screen and is saved in the report file too.
 */
function tvCheckHead(config) {
  const launcher = (config && config.launcher) || {};
  const bg = normalizeBackgroundConfig(applyActiveProfile(config).background);
  const chrome = (String(navigator.userAgent).match(/Chrome\/(\d+)/) || [])[1] || '?';
  return 'Cinema ' + APP_VERSION +
    ' | perf ' + (launcher.perfMode ? 'on' : 'off') +
    ' | wallpaper ' + bg.source + (bg.kenBurns ? ' + slow zoom' : '') +
    ' | profile ' + ((config && config.profile) || 'default') +
    ' | Home button ' + (launcher.launchOnHome ? 'on' : 'off') +
    ' | boot ' + (launcher.bootOnStart ? 'on' : 'off') +
    ' | ' + (window.devicePixelRatio || 1) + 'x, Chrome ' + chrome;
}

/**
 * Settings -> TV check: watch Cinema itself while the check opens TV
 * Settings over it. Counts only the moments something else has the remote
 * (TV Settings), and shows whether Cinema got in the way: relaunching or
 * bringing itself back, taking focus, or still animating underneath.
 */
function startLauncherProbe() {
  const start = Object.assign({}, activity);
  const t0 = Date.now();
  let away = 0;
  let awayPaused = 0;
  let awayAnims = 0;
  let awayFrames = 0;
  let running = true;
  function frame() {
    if (!running) return;
    if (!document.hasFocus()) awayFrames += 1;
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  const timer = setInterval(function () {
    if (document.hasFocus()) return;
    away += 1;
    if (document.body.classList.contains('app-inactive')) awayPaused += 1;
    const anims = document.getAnimations
      ? document.getAnimations().filter(function (a) { return a.playState === 'running'; }).length
      : 0;
    if (anims > awayAnims) awayAnims = anims;
  }, 500);
  return {
    stop: function () {
      running = false;
      clearInterval(timer);
      const newSeen = Math.min(activity.foregroundSeq - start.foregroundSeq, activity.foreground.length);
      const seen = newSeen > 0 ? activity.foreground.slice(-newSeen).join(', ') : 'nothing new';
      const counts = 'relaunched ' + (activity.relaunches - start.relaunches) +
        ', back from home ' + (activity.returns - start.returns) +
        ', closed apps ' + (activity.closes - start.closes) +
        ', took focus ' + (activity.reclaims - start.reclaims);
      const under = away > 0
        ? 'under TV Settings ' + Math.round(away / 2) + ' s: paused ' +
          Math.round(100 * awayPaused / away) + '%, animations up to ' + awayAnims +
          ', ' + Math.round(awayFrames / (away / 2)) + ' frames/s'
        : 'never lost focus to TV Settings';
      return 'Cinema during the check: ' + counts + ' | ' + under +
        ' | foreground seen: ' + seen + ' (' + Math.round((Date.now() - t0) / 1000) + ' s)';
    }
  };
}

/**
 * Settings -> TV check text: the Cinema line, then the summary part of
 * the root script's report (its details stay in /tmp).
 */
function tvCheckSummary(report, head) {
  const text = String(report || '');
  const cut = text.indexOf('=== details ===');
  return head + '\n' + (cut >= 0 ? text.slice(0, cut) : text).trim();
}

function createProviderPicker(focusIndex, onChange) {
  const wrap = document.createElement('div');
  wrap.className = 'ai-provider-pick';
  wrap.setAttribute('role', 'radiogroup');
  wrap.setAttribute('aria-label', 'AI assistant');

  function makeCard(value, name, sub, indexOffset) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ai-provider-card focusable';
    btn.dataset.focusIndex = String(focusIndex + indexOffset);
    btn.dataset.value = value;
    btn.setAttribute('role', 'radio');
    const title = document.createElement('span');
    title.className = 'ai-provider-card-name';
    title.textContent = name;
    const detail = document.createElement('span');
    detail.className = 'ai-provider-card-sub';
    detail.textContent = sub;
    btn.appendChild(title);
    btn.appendChild(detail);
    return btn;
  }

  const grokBtn = makeCard('xai', 'Grok', 'xAI · voice, chat, and spoken answers', 0);
  const gemBtn = makeCard('gemini', 'Gemini', 'Google · speech and chat answers', 1);
  const orBtn = makeCard('openrouter', 'OpenRouter', 'Many models · chat answers', 2);
  wrap.appendChild(grokBtn);
  wrap.appendChild(gemBtn);
  wrap.appendChild(orBtn);
  wrap.value = 'xai';

  function paint() {
    const v = wrap.value;
    grokBtn.classList.toggle('is-selected', v === 'xai');
    gemBtn.classList.toggle('is-selected', v === 'gemini');
    orBtn.classList.toggle('is-selected', v === 'openrouter');
    grokBtn.setAttribute('aria-checked', v === 'xai' ? 'true' : 'false');
    gemBtn.setAttribute('aria-checked', v === 'gemini' ? 'true' : 'false');
    orBtn.setAttribute('aria-checked', v === 'openrouter' ? 'true' : 'false');
  }

  function select(value, silent) {
    const next = (value === 'gemini' || value === 'openrouter') ? value : 'xai';
    const changed = wrap.value !== next;
    wrap.value = next;
    paint();
    if (!silent && changed && onChange) onChange(next);
  }

  grokBtn.addEventListener('click', function () { select('xai'); });
  gemBtn.addEventListener('click', function () { select('gemini'); });
  orBtn.addEventListener('click', function () { select('openrouter'); });
  wrap.setValue = function (value) { select(value, true); };
  paint();
  return wrap;
}

export function createSettingsPanel(panel, getConfig, options) {
  let visible = false;
  let opening = false;
  let renderGen = 0;
  // Backup & restore result to show again after a restore redraws the panel.
  let backupNote = '';
  let builtinManifest = [];
  let pinnedOrder = [];
  let pinnedContainer = null;
  let appsByIdMap = {};
  // The installed-apps catalog behind the lists (see isAppInstalled).
  let installedCatalog = null;
  // Settings -> Apps -> Show hidden and system apps (for this visit only).
  let showHiddenApps = false;
  let customApps = [];
  // After open, ignore pointer/click for a short window so the Magic Remote
  // "click" that opened Settings (gear is top-right, Close is also top-right)
  // does not immediately hit Close and dismiss the panel.
  let openGuardUntil = 0;
  let guardHandler = null;
  let aiOauthPollTimer = null;
  // Updates the "Show installed apps (N)" button after the list re-renders.
  let syncAddAppsToggle = null;

  function findCustomApp(id) {
    for (let i = 0; i < customApps.length; i += 1) {
      if (customApps[i].id === id) return customApps[i];
    }
    return null;
  }

  function clearOpenGuard() {
    openGuardUntil = 0;
    if (guardHandler) {
      document.removeEventListener('click', guardHandler, true);
      document.removeEventListener('pointerup', guardHandler, true);
      document.removeEventListener('pointerdown', guardHandler, true);
      guardHandler = null;
    }
  }

  function armOpenGuard(ms) {
    clearOpenGuard();
    openGuardUntil = Date.now() + (ms || 600);
    guardHandler = function (event) {
      if (Date.now() >= openGuardUntil) {
        clearOpenGuard();
        return;
      }
      // Swallow the trailing OK/click from the same press that opened us.
      event.preventDefault();
      event.stopPropagation();
      if (typeof event.stopImmediatePropagation === 'function') {
        event.stopImmediatePropagation();
      }
    };
    document.addEventListener('click', guardHandler, true);
    document.addEventListener('pointerup', guardHandler, true);
    document.addEventListener('pointerdown', guardHandler, true);
  }

  function requestHide() {
    if (Date.now() < openGuardUntil) return; // ignore Close during open guard
    hide();
  }

  function hide() {
    visible = false;
    opening = false;
    renderGen += 1; // invalidate any in-flight render
    clearOpenGuard();
    if (aiOauthPollTimer) {
      clearInterval(aiOauthPollTimer);
      aiOauthPollTimer = null;
    }
    panel.hidden = true;
    panel.classList.remove('settings-enter');
    document.body.classList.remove('settings-open');
    if (options.onClose) options.onClose();
  }

  /** Immediate shell so the panel is visible even while async lists load. */
  function paintLoadingShell() {
    panel.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'settings-header';

    const headerTitleWrap = document.createElement('div');
    headerTitleWrap.className = 'settings-header-title';
    const headerTitle = document.createElement('h2');
    headerTitle.textContent = 'Impostazioni';
    headerTitleWrap.appendChild(headerTitle);

    const headerActions = document.createElement('div');
    headerActions.className = 'settings-header-actions';
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'settings-close focusable';
    closeBtn.dataset.focusIndex = '900';
    closeBtn.textContent = "Chiudi";
    closeBtn.addEventListener('click', requestHide);
    headerActions.appendChild(closeBtn);

    header.appendChild(headerTitleWrap);
    header.appendChild(headerActions);

    const body = document.createElement('div');
    body.className = 'settings-body';
    const loading = document.createElement('p');
    loading.className = 'settings-hint settings-loading';
    loading.textContent = "Caricamento delle impostazioni…";
    body.appendChild(loading);

    panel.appendChild(header);
    panel.appendChild(body);
  }

  function showErrorState(message) {
    // Never leave a blank black panel.
    if (!panel.querySelector('.settings-header')) {
      paintLoadingShell();
    }
    const body = panel.querySelector('.settings-body');
    if (body) {
      body.innerHTML = '';
      const msg = document.createElement('p');
      msg.className = 'settings-hint';
      msg.textContent = message || 'Could not load settings. Press Close and try again.';
      body.appendChild(msg);
    }
  }

  function show() {
    // Already open — just re-focus (do not rebuild).
    if (visible && !opening && panel && !panel.hidden &&
        (panel.querySelector('.settings-section') || panel.querySelector('.settings-tabs'))) {
      if (options.onRendered) options.onRendered();
      return;
    }
    // Open already in progress.
    if (opening && visible && !panel.hidden) return;

    opening = true;
    visible = true;
    const gen = (renderGen += 1);

    // Paint shell BEFORE hiding underlay so we never flash empty black.
    panel.hidden = false;
    panel.removeAttribute('hidden');
    panel.classList.add('settings-enter');
    setTimeout(function(){panel.classList.remove('settings-enter');},260);
    paintLoadingShell();
    document.body.classList.add('settings-open');
    armOpenGuard(700);

    if (options.onOpen) options.onOpen();
    // Delay focus until after the opening click sequence finishes, otherwise
    // focus lands on Close under the cursor and the same OK closes us.
    setTimeout(function () {
      if (!visible || gen !== renderGen) return;
      if (options.onRendered) options.onRendered();
    }, 350);

    Promise.resolve(render(gen)).then(function () {
      if (!visible || gen !== renderGen) return;
      opening = false;
      // If render bailed early without sections, keep a usable shell.
      if (!panel.querySelector('.settings-section') && !panel.querySelector('.settings-tabs')) {
        showErrorState('Settings did not finish loading. Close and open again.');
      }
      if (options.onRendered) options.onRendered();
    }).catch(function (err) {
      console.error(err);
      if (!visible || gen !== renderGen) return;
      opening = false;
      showErrorState('Could not load settings. Close and try again.');
      if (options.onRendered) options.onRendered();
    });
  }

  function labeledControl(label, control) {
    const wrap = document.createElement('div');
    wrap.className = 'settings-row';
    control.dataset.controlLabel=label;
    control.setAttribute('aria-label',label+(control.classList.contains('option-stepper')?': '+control.querySelector('.stepper-label').textContent:''));
    const span = document.createElement('span');
    span.textContent = label;
    wrap.appendChild(span);
    wrap.appendChild(control);
    return wrap;
  }

  function labeledBlock(label, control) {
    const wrap = document.createElement('div');
    wrap.className = 'settings-block';
    const heading = document.createElement('span');
    heading.className = 'settings-block-label';
    heading.textContent = label;
    wrap.appendChild(heading);
    wrap.appendChild(control);
    return wrap;
  }

  function focusPhotoGallery(galleryEl) {
    if (!galleryEl || galleryEl.hidden) return;
    window.setTimeout(function () {
      try {
        galleryEl.scrollIntoView({block: 'nearest', behavior: 'smooth'});
      } catch (err) {
        try { galleryEl.scrollIntoView(true); } catch (err2) { /* ignore */ }
      }
      const firstTile = galleryEl.querySelector('.photo-picker-tile.focusable');
      if (firstTile && typeof firstTile.focus === 'function') {
        // preventScroll: a plain focus() would re-centre mid smooth scroll.
        try { firstTile.focus({preventScroll: true}); } catch (err3) { /* ignore */ }
        firstTile.classList.add('focused');
        const siblings = galleryEl.ownerDocument.querySelectorAll(
          '#settings-panel .focusable.focused'
        );
        for (let i = 0; i < siblings.length; i += 1) {
          if (siblings[i] !== firstTile) siblings[i].classList.remove('focused');
        }
      }
    }, 80);
  }

  /**
   * Put focus (and the row highlight) on a Settings control, e.g. back on
   * the field the user was editing. Picking used to jump to Save, so the next
   * Down restarted from the top of the panel.
   */
  function focusSettingsControl(el) {
    window.setTimeout(function () {
      focusSettingsControlNow(el);
    }, 60);
  }

  function focusSettingsControlNow(el) {
    if (!el || !panel.contains(el)) return false;
    // Same path as D-pad navigation: focus, row highlight, minimal scroll.
    if (options.focusControl) return !!options.focusControl(el);

    if (!el.getClientRects || !el.getClientRects().length) return false;
    try {
      el.scrollIntoView({block: 'nearest'});
    } catch (err) { /* ignore */ }
    try {
      if (typeof el.tabIndex === 'number' && el.tabIndex < 0) el.tabIndex = 0;
    } catch (err3) { /* ignore */ }
    try { el.focus({preventScroll: true}); } catch (err4) { /* ignore */ }

    const focused = panel.querySelectorAll('.focusable.focused');
    for (let i = 0; i < focused.length; i += 1) {
      if (focused[i] !== el) focused[i].classList.remove('focused');
    }
    el.classList.add('focused');

    // Match focus manager row highlight for consistency.
    const highlights = panel.querySelectorAll('.settings-row-highlight');
    for (let j = 0; j < highlights.length; j += 1) {
      highlights[j].classList.remove('settings-row-highlight');
    }
    const row = el.closest && el.closest('.settings-row');
    (row || el).classList.add('settings-row-highlight');
    return true;
  }

  /**
   * The app lists are rebuilt from scratch when they change, which destroys
   * the ↑/↓/✕/+ button that had focus. With nothing focused, the next Up
   * jumped to the bottom of Settings and Down to the top. Focus the button in
   * the same spot instead: row `rowIndex` (or the last row), trying the
   * buttons in `buttonOrder`, or the nearest control when the list is empty.
   */
  function refocusListButton(listEl, rowIndex, buttonOrder) {
    if (!listEl || !panel.contains(listEl)) return;
    const rows = listEl.querySelectorAll('.settings-pinned-row, .settings-app-row');
    if (rows.length) {
      const buttons = rows[Math.min(rowIndex, rows.length - 1)]
        .querySelectorAll('.settings-mini-btn');
      for (let i = 0; i < buttonOrder.length; i += 1) {
        const btn = buttons[buttonOrder[i]];
        if (btn && !btn.disabled && focusSettingsControlNow(btn)) return;
      }
    }
    const all = Array.prototype.slice.call(panel.querySelectorAll('.focusable'))
      .filter(function (el) { return !listEl.contains(el); });
    const after = all.filter(function (el) {
      return listEl.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING;
    });
    const before = all.filter(function (el) { return after.indexOf(el) < 0; }).reverse();
    const nearest = after.concat(before);
    for (let j = 0; j < nearest.length; j += 1) {
      if (focusSettingsControlNow(nearest[j])) return;
    }
  }

  function syncBackgroundFields(source, refs, opts) {
    const isImage = source !== 'preset' && source !== 'animated-gradient';
    const showBuiltin = source === 'builtin';
    const showUsb = source === 'usb';
    const showUrl = source === 'url';
    const showAerial = source === 'aerial';
    const isSlideshow = refs.displaySelect.value === 'slideshow';
    const revealGallery = !!(opts && opts.revealGallery);

    refs.displayRow.hidden = !isImage;
    // Aerial Slideshow cycles the whole catalog, so the single-clip picker is
    // hidden there (as the built-in gallery is for its own slideshow).
    refs.aerialRow.hidden = !showAerial || isSlideshow;
    refs.bgShuffleRow.hidden = !(showAerial && isSlideshow);
    // Built-in / online / aerial galleries are mutually exclusive by source.
    refs.builtinRow.hidden = !showBuiltin || isSlideshow;
    refs.usbHint.hidden = !showUsb;
    refs.usbFileRow.hidden = !showUsb || isSlideshow;
    refs.remoteRow.hidden = !showUrl || isSlideshow;
    refs.urlHint.hidden = !showUrl;
    refs.urlRow.hidden = !showUrl || isSlideshow;
    refs.urlsRow.hidden = !showUrl || !isSlideshow;
    // Neither applies to aerials: clips advance on the clip's own end, and a
    // Ken Burns pan on top of a moving video is meaningless.
    refs.intervalRow.hidden = !isImage || !isSlideshow || showAerial;
    refs.kenBurnsRow.hidden = !isImage || showAerial;
    refs.kenBurnsHint.hidden = !isImage || showAerial;

    // When the user switches Source to a photo catalog, scroll that gallery into view.
    if (revealGallery && !isSlideshow) {
      if (showAerial && refs.aerialRow && !refs.aerialRow.hidden) {
        focusPhotoGallery(refs.aerialRow);
      } else if (showBuiltin && refs.builtinRow && !refs.builtinRow.hidden) {
        focusPhotoGallery(refs.builtinRow);
      } else if (showUrl && refs.remoteRow && !refs.remoteRow.hidden) {
        focusPhotoGallery(refs.remoteRow);
      }
    }
  }

  function movePinned(index, delta) {
    const next = index + delta;
    if (next < 0 || next >= pinnedOrder.length) return;
    const tmp = pinnedOrder[index];
    pinnedOrder[index] = pinnedOrder[next];
    pinnedOrder[next] = tmp;
    if (!pinnedContainer) return;
    const keepFocus = pinnedContainer.contains(document.activeElement);
    renderPinnedList(pinnedContainer);
    // Stay on the moved app's arrow so repeated presses keep moving it.
    if (keepFocus) refocusListButton(pinnedContainer, next, delta < 0 ? [0] : [1]);
  }

  function renderPinnedList(container) {
    container.innerHTML = '';

    pinnedOrder.forEach(function (appId, index) {
      const app = appsByIdMap[appId] || {id: appId, title: appId, icon: ''};
      const row = document.createElement('div');
      row.className = 'settings-pinned-row';

      if (app.icon) {
        const icon = document.createElement('img');
        icon.className = 'settings-app-icon';
        icon.alt = '';
        // TV-native icons are file:// paths WAM won't load directly.
        icon.addEventListener('error', function () {
          const bundled = getBuiltinAppIcon(app.launchId || app.id);
          if (bundled && icon.dataset.fallbackTried !== '1') {
            icon.dataset.fallbackTried = '1';
            icon.src = bundled;
            return;
          }
          icon.remove();
        });
        setIconSrc(icon, app.icon);
        row.appendChild(icon);
      }

      const title = document.createElement('span');
      title.className = 'settings-pinned-title';
      title.textContent = app.title || app.id;
      // Not shown on the home row (see apps.js): say why, so it can go.
      const isCustom = customApps.some(function (entry) { return entry && entry.id === appId; });
      if (!isCustom && !isAppInstalled(installedCatalog, appId)) {
        title.textContent += ' \u2014 not installed on this TV';
        row.classList.add('is-missing');
      }

      const upBtn = document.createElement('button');
      upBtn.type = 'button';
      upBtn.className = 'settings-mini-btn focusable';
      upBtn.dataset.focusIndex = String(1200 + index * 3);
      upBtn.textContent = '↑';
      // At the ends the arrow stays focusable but does nothing (dimmed): when
      // it was disabled, focus fell to the other arrow and the next OK moved
      // the app straight back.
      if (index === 0) upBtn.setAttribute('aria-disabled', 'true');
      upBtn.addEventListener('click', function () { movePinned(index, -1); });

      const downBtn = document.createElement('button');
      downBtn.type = 'button';
      downBtn.className = 'settings-mini-btn focusable';
      downBtn.dataset.focusIndex = String(1201 + index * 3);
      downBtn.textContent = '↓';
      if (index === pinnedOrder.length - 1) downBtn.setAttribute('aria-disabled', 'true');
      downBtn.addEventListener('click', function () { movePinned(index, 1); });

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'settings-mini-btn focusable';
      removeBtn.dataset.focusIndex = String(1202 + index * 3);
      removeBtn.textContent = '✕';
      removeBtn.addEventListener('click', function () {
        const keepFocus = container.contains(document.activeElement);
        const removedId = pinnedOrder[index];
        pinnedOrder.splice(index, 1);
        for (let i = customApps.length - 1; i >= 0; i -= 1) {
          if (customApps[i].id === removedId) customApps.splice(i, 1);
        }
        renderPinnedList(container);
        // The next app slides into this row; land on its ✕.
        if (keepFocus) refocusListButton(container, index, [2]);
      });

      row.appendChild(title);
      row.appendChild(upBtn);
      row.appendChild(downBtn);
      row.appendChild(removeBtn);
      container.appendChild(row);
    });
  }

  // After a restore: draw the panel again from the restored settings and put
  // focus back on the Restore button.
  function redrawAfterRestore() {
    const gen = (renderGen += 1);
    Promise.resolve(render(gen)).then(function () {
      if (!visible || gen !== renderGen) return;
      const btn = panel.querySelector('[data-backup-action="restore"]');
      if (btn) focusSettingsControlNow(btn);
    }).catch(function (err) {
      console.error(err);
    });
  }

  function withDeadline(promise, ms) {
    return new Promise(function (resolve) {
      let done = false;
      const timer = setTimeout(function () {
        if (!done) { done = true; resolve(null); }
      }, ms);
      Promise.resolve(promise).then(function (value) {
        if (!done) { done = true; clearTimeout(timer); resolve(value); }
      }, function () {
        if (!done) { done = true; clearTimeout(timer); resolve(null); }
      });
    });
  }

  async function render(gen) {
    const config = getConfig();
    let inputSettingsReady=false;
    const effective = applyActiveProfile(config);
    const bg = normalizeBackgroundConfig(effective.background);
    // Cap waits so the panel never sits empty after we clear the loading shell.
    const loaded = await withDeadline(loadBuiltinManifest(), 4000);
    if (gen !== renderGen || !visible) return;
    builtinManifest = loaded || builtinManifest || [];

    pinnedOrder = (config.launcher.pinnedApps || []).slice();
    customApps = (config.launcher.customApps || []).map(function (entry) {
      return Object.assign({}, entry);
    });

    // Keep the loading shell until we have a header ready, then replace in one go
    // via a document fragment so the panel is never empty/black.
    const next = document.createDocumentFragment();

    const header = document.createElement('div');
    header.className = 'settings-header';

    const headerTitleWrap = document.createElement('div');
    headerTitleWrap.className = 'settings-header-title';

    const headerTitle = document.createElement('h2');
    headerTitle.textContent = 'Impostazioni';

    const versionLabel = document.createElement('p');
    versionLabel.className = 'settings-version';
    versionLabel.textContent = 'Cinema · ' + APP_VERSION;

    // Effective user the launcher runs privileged calls as (root when the
    // Homebrew Channel service is elevated). Tells the user whether app scanning,
    // which needs root, will work. Populated asynchronously via the Luna bus.
    const runUserLabel = document.createElement('p');
    runUserLabel.className = 'settings-run-user run-user-checking';
    runUserLabel.textContent = 'Verifica accesso ai controlli TV…';
    // Root through Homebrew Channel can stop answering: say so after a while
    // rather than "checking…" for good. A late answer still updates this.
    const runUserSlow = setTimeout(function () {
      runUserLabel.textContent = 'Controlli TV non raggiungibili';
      runUserLabel.className = 'settings-run-user run-user-limited';
    }, 10000);
    whoAmI().then(function (user) {
      clearTimeout(runUserSlow);
      if (!user) {
        runUserLabel.textContent = 'Accesso ai controlli TV non disponibile';
        runUserLabel.className = 'settings-run-user run-user-limited';
        return;
      }
      const isRoot = user === 'root';
      runUserLabel.textContent = (isRoot ? 'Controlli TV disponibili · accesso completo' : 'Accesso limitato · alcune funzioni TV potrebbero non rispondere');
      runUserLabel.className = 'settings-run-user ' + (isRoot ? 'run-user-root' : 'run-user-limited');
    }).catch(function () {
      clearTimeout(runUserSlow);
      runUserLabel.textContent = 'Accesso ai controlli TV non verificato';
      runUserLabel.className = 'settings-run-user run-user-limited';
    });

    headerTitleWrap.appendChild(headerTitle);
    headerTitleWrap.appendChild(versionLabel);
    // Privilege diagnostics belong to System, not the main settings header.

    const headerActions = document.createElement('div');
    headerActions.className = 'settings-header-actions';

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'settings-close focusable';
    closeBtn.dataset.focusIndex = '900';
    closeBtn.textContent = "Chiudi";
    closeBtn.addEventListener('click', requestHide);
    headerActions.appendChild(closeBtn);

    header.appendChild(headerTitleWrap);
    header.appendChild(headerActions);
    next.appendChild(header);

    // Category list on the left, that category's settings on the right (the
    // scrolling .settings-body). Like LG's own Settings, so the remote already
    // knows it: Up/Down picks a category, Right (or OK) enters it, Left or
    // Back comes back to the list.
    const main = document.createElement('div');
    main.className = 'settings-main';
    const nav = document.createElement('nav');
    nav.className = 'settings-nav';
    nav.setAttribute('role', 'tablist');
    nav.setAttribute('aria-orientation', 'vertical');
    const body = document.createElement('div');
    body.className = 'settings-body';
    main.appendChild(nav);
    main.appendChild(body);
    next.appendChild(main);

    // Settings categories, in list order. Each is a pane; sections below are
    // appended to the pane they belong to.
    const CATEGORIES = SETTINGS_CATEGORIES;
    let activeSettingsTab = 'cinema';
    const tabButtons = {};
    const panes = {};
    const panesWrap = document.createElement('div');
    panesWrap.className = 'settings-tab-panes';
    CATEGORIES.forEach(function (cat, i) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'settings-tab focusable' + (i === 0 ? ' active' : '');
      btn.dataset.focusIndex = String(890 + i);
      btn.setAttribute('role', 'tab');
      btn.setAttribute('aria-selected', i === 0 ? 'true' : 'false');
      btn.dataset.tab = cat.id;
      const label = document.createElement('span');
      label.className = 'settings-tab-label';
      label.textContent = cat.label;
      const sub = document.createElement('span');
      sub.className = 'settings-tab-sub';
      sub.textContent = cat.sub;
      btn.appendChild(settingsIcon(cat.id));
      btn.appendChild(label);
      btn.appendChild(sub);
      nav.appendChild(btn);
      tabButtons[cat.id] = btn;

      const pane = document.createElement('div');
      pane.className = 'settings-tab-pane' + (i === 0 ? ' is-active' : '');
      pane.dataset.tab = cat.id;
      pane.id='settings-page-'+cat.id;btn.id='settings-category-'+cat.id;
      btn.setAttribute('aria-controls',pane.id);pane.setAttribute('aria-labelledby',btn.id);
      const heading=document.createElement('div');heading.className='settings-page-heading';
      const pageTitle=document.createElement('h2');pageTitle.textContent=cat.label;
      const pageDescription=document.createElement('p');pageDescription.textContent=cat.description;
      heading.appendChild(pageTitle);heading.appendChild(pageDescription);pane.appendChild(heading);
      pane.setAttribute('role', 'tabpanel');
      pane.setAttribute('aria-hidden', i === 0 ? 'false' : 'true');
      panesWrap.appendChild(pane);
      panes[cat.id] = pane;
    });
    body.appendChild(panesWrap);
    // Sections built below go to these (the AI Voice ones keep aiPane).
    const aiPane = panes.ai;

    // Declared before setSettingsTab so the early Home default cannot hit a TDZ.
    let saveBtn = null;
    let aiStatusLabel = null;
    let aiApiKeyInput = null;
    let aiApiKeyHint = null;
    let aiApiKeyShowBtn = null;
    let aiGeminiKeyInput = null;
    let aiGeminiKeyHint = null;
    let aiGeminiKeyShowBtn = null;
    let aiOpenRouterKeyInput = null;
    let aiOpenRouterKeyHint = null;
    let aiOpenRouterKeyShowBtn = null;
    let aiSttSelect = null;
    let aiChatSelect = null;
    let aiVoiceModelSelect = null;
    let aiGeminiModelSelect = null;
    let aiGeminiSttSelect = null;
    let aiOpenRouterModelSelect = null;
    let aiOpenRouterSttSelect = null;
    let aiDismissSelect = null;
    let aiProviderSelect = null;
    let aiAuthModeSelect = null;
    let aiCreditBanner = null;
    let aiOauthStatus = null;
    let aiOauthCode = null;
    let aiOauthHint = null;
    let aiOauthQrWrap = null;
    let aiOauthModal = null;
    let aiOauthModalCancel = null;
    let aiOauthSignInBtn = null;
    let aiOauthImportBtn = null;
    let aiOauthSignOutBtn = null;
    let aiLoadedConfig = null;
    let lastAiStatus = null;
    // Voice assistant on (launcher.voiceEnabled), an on/off in progress, and
    // retries while the daemon starts.
    let voiceOn = false;
    let voiceBusy = false;
    let aiRetryTimer = null;
    let aiLoadRetries = 0;
    let aiOauthInProgress = false;
    let aiOauthSawPending = false;
    let aiOauthLocalCode = '';
    let aiOauthLocalUri = '';
    let aiXaiKeyRevealed = false;
    let aiGeminiKeyRevealed = false;
    let aiOpenRouterKeyRevealed = false;
    // Key rows are referenced from syncAuthModeUi() before they are built.
    // Keep them as lets (not const) so an early call cannot TDZ-crash render.
    let xaiRow = null;
    let gemRow = null;
    let orRow = null;

    function setSettingsTab(tabId, opts) {
      const tabOpts = opts || {};
      const next = panes[tabId] ? tabId : 'cinema';
      // No-op if already on this tab (avoids thrashing on repeated focus events).
      if (next === activeSettingsTab && !tabOpts.focusContent && !tabOpts.force) {
        return;
      }
      const changed = next !== activeSettingsTab;
      activeSettingsTab = next;
      // Class toggles only — CSS keeps inactive panes out of interaction
      // without a display:none reflow of the whole settings tree.
      Object.keys(panes).forEach(function (id) {
        const on = id === next;
        panes[id].classList.toggle('is-active', on);
        panes[id].setAttribute('aria-hidden', on ? 'false' : 'true');
        tabButtons[id].classList.toggle('active', on);
        tabButtons[id].setAttribute('aria-selected', on ? 'true' : 'false');
      });
      // Each category starts at its top.
      if (changed) body.scrollTop = 0;
      if(changed&&next==='ai')setTimeout(loadAiTab,0);
      if (saveBtn && saveBtn.textContent !== "Salva" && saveBtn.textContent !== "Salvataggio…") {
        saveBtn.textContent = "Salva";
      }
      // Only dive into pane content when the user enters the category
      // (OK / Right), not when Up/Down merely highlights it.
      if (tabOpts.focusContent) {
        const first = panes[next].querySelector('.focusable');
        if (first && typeof first.focus === 'function') {
          try { first.focus(); } catch (err) { /* ignore */ }
          first.classList.add('focused');
        }
      }
    }
    // Pane flips on Up/Down along the list (settings-activate-tab) or a click.
    // A bare focus from the cursor or wheel must not switch category.
    Object.keys(tabButtons).forEach(function (id) {
      tabButtons[id].addEventListener('settings-activate-tab', function () {
        setSettingsTab(id);
      });
      tabButtons[id].addEventListener('click', function () {
        setSettingsTab(id, {focusContent: true, force: true});
      });
    });
    // Settings opens on Look.
    setSettingsTab('cinema', {force: true});

    const aiStatusSection = document.createElement('section');
    aiStatusSection.className = 'settings-section';
    aiStatusSection.innerHTML = '<h3>Servizio voce</h3>';
    aiStatusLabel = document.createElement('p');
    aiStatusLabel.className = 'settings-hint ai-status-line';
    aiStatusLabel.textContent = "Verifica del servizio voce…";
    aiStatusSection.appendChild(aiStatusLabel);
    aiCreditBanner = document.createElement('p');
    aiCreditBanner.className = 'ai-credit-banner';
    aiCreditBanner.hidden = true;
    aiStatusSection.appendChild(aiCreditBanner);
    const aiStatusHint = document.createElement('p');
    aiStatusHint.className = 'settings-hint';
    aiStatusHint.textContent =
      'Hold Voice on the Magic Remote to talk. Pick Grok, Gemini, or OpenRouter, add a key, then Save.';
    aiStatusSection.appendChild(aiStatusHint);
    aiPane.appendChild(aiStatusSection);

    function makeKeyRow(label, focusIndex, placeholder) {
      const wrap = document.createElement('div');
      wrap.className = 'settings-row settings-key-row';
      const span = document.createElement('span');
      span.textContent = label;
      const controls = document.createElement('div');
      controls.className = 'settings-key-controls';
      const input = document.createElement('input');
      input.type = 'password';
      input.className = 'settings-text focusable';
      input.dataset.focusIndex = String(focusIndex);
      input.placeholder = placeholder || '';
      input.spellcheck = false;
      input.autocomplete = 'off';
      const showBtn = document.createElement('button');
      showBtn.type = 'button';
      showBtn.className = 'settings-mini-btn focusable';
      showBtn.dataset.focusIndex = String(focusIndex + 1);
      showBtn.textContent = "Mostra";
      controls.appendChild(input);
      controls.appendChild(showBtn);
      wrap.appendChild(span);
      wrap.appendChild(controls);
      return {row: wrap, input: input, showBtn: showBtn};
    }

    const aiKeySection = document.createElement('section');
    aiKeySection.className = 'settings-section';
    aiKeySection.innerHTML = '<h3>Chiavi di accesso</h3>';
    aiAuthModeSelect = createOptionStepper('', 1990, [
      {value: 'API_KEY', label: 'Grok API key'},
      {value: 'SUPERGROK_OAUTH', label: 'SuperGrok sign-in'}
    ], 'API_KEY', function () {
      syncAuthModeUi();
      if (isSuperGrokMode()) paintOauthFromStatus({}, aiLoadedConfig);
    });
    const authRow = labeledControl("Account Grok", aiAuthModeSelect);
    aiKeySection.appendChild(authRow);
    const aiGrokUsing = document.createElement('p');
    aiGrokUsing.className = 'ai-using-badge';
    aiGrokUsing.hidden = true;
    aiKeySection.appendChild(aiGrokUsing);
    const authHint = document.createElement('p');
    authHint.className = 'settings-hint';
    authHint.textContent = 'Get a key at console.x.ai — stored only on this TV.';
    aiKeySection.appendChild(authHint);

    const oauthBox = document.createElement('div');
    oauthBox.hidden = true;
    aiOauthStatus = document.createElement('p');
    aiOauthStatus.className = 'settings-hint';
    aiOauthStatus.textContent = "SuperGrok: accesso da effettuare";
    oauthBox.appendChild(aiOauthStatus);

    // Full-panel modal so the QR cannot be scrolled away, dismissed by a
    // stale "signed in" poll, or closed when the Magic Remote pointer
    // drifts onto Save / Close.
    aiOauthModal = document.createElement('div');
    aiOauthModal.className = 'ai-oauth-modal';
    aiOauthModal.hidden = true;
    aiOauthModal.setAttribute('role', 'dialog');
    aiOauthModal.setAttribute('aria-modal', 'true');
    aiOauthModal.setAttribute('aria-hidden', 'true');
    aiOauthModal.setAttribute('aria-label', 'SuperGrok sign-in');
    aiOauthModal.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
    });
    const oauthCard = document.createElement('div');
    oauthCard.className = 'ai-oauth-modal-card';
    oauthCard.addEventListener('click', function (event) {
      event.stopPropagation();
    });
    const oauthTitle = document.createElement('h3');
    oauthTitle.className = 'ai-oauth-modal-title';
    oauthTitle.textContent = "Accedi con SuperGrok";
    oauthCard.appendChild(oauthTitle);
    aiOauthQrWrap = document.createElement('div');
    aiOauthQrWrap.className = 'ai-oauth-qr-wrap';
    aiOauthQrWrap.hidden = true;
    aiOauthQrWrap.setAttribute('aria-hidden', 'true');
    oauthCard.appendChild(aiOauthQrWrap);
    aiOauthCode = document.createElement('p');
    aiOauthCode.className = 'ai-oauth-code';
    aiOauthCode.hidden = true;
    oauthCard.appendChild(aiOauthCode);
    aiOauthHint = document.createElement('p');
    aiOauthHint.className = 'settings-hint ai-oauth-modal-hint';
    aiOauthHint.hidden = true;
    oauthCard.appendChild(aiOauthHint);
    aiOauthModalCancel = document.createElement('button');
    aiOauthModalCancel.type = 'button';
    aiOauthModalCancel.className = 'settings-mini-btn focusable ai-oauth-modal-cancel';
    aiOauthModalCancel.dataset.focusIndex = '1994';
    aiOauthModalCancel.textContent = "Annulla accesso";
    oauthCard.appendChild(aiOauthModalCancel);
    aiOauthModal.appendChild(oauthCard);
    next.appendChild(aiOauthModal);

    function hideOauthQr() {
      if (aiOauthQrWrap) {
        aiOauthQrWrap.hidden = true;
        aiOauthQrWrap.setAttribute('aria-hidden', 'true');
        aiOauthQrWrap.innerHTML = '';
      }
      if (aiOauthCode) aiOauthCode.hidden = true;
      if (aiOauthHint) aiOauthHint.hidden = true;
      if (aiOauthModal) {
        aiOauthModal.hidden = true;
        aiOauthModal.setAttribute('aria-hidden', 'true');
      }
    }

    function showOauthQr(uri) {
      if (!aiOauthQrWrap) return;
      const svg = qrSvgMarkup(uri);
      if (!svg) {
        aiOauthQrWrap.hidden = true;
        aiOauthQrWrap.setAttribute('aria-hidden', 'true');
        aiOauthQrWrap.innerHTML = '';
        return;
      }
      aiOauthQrWrap.innerHTML = svg;
      aiOauthQrWrap.hidden = false;
      aiOauthQrWrap.setAttribute('aria-hidden', 'false');
    }

    function isSuperGrokMode() {
      return !!(aiAuthModeSelect && aiAuthModeSelect.value === 'SUPERGROK_OAUTH');
    }

    function setBtnTone(btn, tone) {
      if (!btn) return;
      btn.classList.remove(
        'btn-tone-ok', 'btn-tone-warn', 'btn-tone-danger', 'btn-tone-quiet'
      );
      if (tone) btn.classList.add('btn-tone-' + tone);
    }

    function paintGrokUsing(kind, email) {
      const grok = typeof isGrokProvider === 'function' ? isGrokProvider() : true;
      if (!aiGrokUsing) return;
      if (!grok) {
        aiGrokUsing.hidden = true;
        return;
      }
      aiGrokUsing.hidden = false;
      if (kind === 'signed-in') {
        aiGrokUsing.className = 'ai-using-badge is-supergrok';
        aiGrokUsing.textContent = email
          ? ('Using SuperGrok · ' + email)
          : 'Using SuperGrok';
      } else if (kind === 'expired') {
        aiGrokUsing.className = 'ai-using-badge is-warn';
        aiGrokUsing.textContent = 'SuperGrok session expired — sign in again';
      } else if (kind === 'pending') {
        aiGrokUsing.className = 'ai-using-badge is-warn';
        aiGrokUsing.textContent = 'Waiting for SuperGrok approval';
      } else if (kind === 'signed-out') {
        aiGrokUsing.className = 'ai-using-badge is-warn';
        aiGrokUsing.textContent = 'SuperGrok — not signed in';
      } else {
        aiGrokUsing.className = 'ai-using-badge is-apikey';
        aiGrokUsing.textContent = "Accesso con chiave Grok";
      }
    }

    function setOauthActionState(kind) {
      if (kind === 'signed-in') {
        aiOauthSignInBtn.textContent = "Cambia accesso";
        setBtnTone(aiOauthSignInBtn, 'quiet');
        setBtnTone(aiOauthImportBtn, 'quiet');
        setBtnTone(aiOauthSignOutBtn, 'danger');
        aiOauthSignOutBtn.hidden = false;
        aiOauthImportBtn.hidden = false;
      } else if (kind === 'pending') {
        aiOauthSignInBtn.textContent = "Annulla accesso";
        setBtnTone(aiOauthSignInBtn, 'warn');
        setBtnTone(aiOauthImportBtn, 'quiet');
        aiOauthSignOutBtn.hidden = true;
        aiOauthImportBtn.hidden = true;
      } else if (kind === 'expired') {
        aiOauthSignInBtn.textContent = "Accedi di nuovo";
        setBtnTone(aiOauthSignInBtn, 'ok');
        setBtnTone(aiOauthImportBtn, 'quiet');
        setBtnTone(aiOauthSignOutBtn, 'danger');
        aiOauthSignOutBtn.hidden = false;
        aiOauthImportBtn.hidden = false;
      } else {
        aiOauthSignInBtn.textContent = "Accedi con SuperGrok";
        setBtnTone(aiOauthSignInBtn, 'ok');
        setBtnTone(aiOauthImportBtn, 'quiet');
        aiOauthSignOutBtn.hidden = true;
        aiOauthImportBtn.hidden = false;
      }
    }

    function showOauthPending(code, uri) {
      if (!isSuperGrokMode()) {
        hideOauthQr();
        return;
      }
      const url = uri || 'https://accounts.x.ai/oauth2/device';
      aiOauthLocalCode = code || aiOauthLocalCode || '';
      aiOauthLocalUri = url;
      aiOauthStatus.textContent = 'Waiting for phone approval — keep this QR on screen';
      aiOauthStatus.className = 'settings-hint';
      if (aiOauthCode) {
        aiOauthCode.hidden = false;
        aiOauthCode.textContent = aiOauthLocalCode;
      }
      if (aiOauthHint) {
        aiOauthHint.hidden = false;
        aiOauthHint.textContent = 'Scan with your phone, or open ' + url +
          ' and enter the code. This stays open until you approve or cancel.';
      }
      showOauthQr(url);
      if (aiOauthModal) {
        aiOauthModal.hidden = false;
        aiOauthModal.setAttribute('aria-hidden', 'false');
      }
      if (aiOauthModalCancel && typeof aiOauthModalCancel.focus === 'function') {
        try { aiOauthModalCancel.focus(); } catch (err) { /* ignore */ }
        aiOauthModalCancel.classList.add('focused');
      }
      setOauthActionState('pending');
      paintGrokUsing('pending');
    }

    function syncAuthModeUi() {
      const heavy = isSuperGrokMode();
      const grok = typeof isGrokProvider === 'function' ? isGrokProvider() : true;
      if (oauthBox) oauthBox.hidden = !grok || !heavy;
      if (authHint) {
        authHint.hidden = !grok;
        authHint.textContent = heavy
          ? 'SuperGrok is an account sign-in (same as grok login). Green = sign in, red = sign out. The Grok API key is not used while SuperGrok is signed in.'
          : 'Using a Grok API key from console.x.ai. Switch Grok account to SuperGrok sign-in if you have a SuperGrok subscription instead.';
      }
      if (authRow) authRow.hidden = !grok;
      if (!heavy && grok) paintGrokUsing('apikey');
      if ((!heavy || !grok) && !aiOauthInProgress) {
        hideOauthQr();
        stopOauthPoll();
      }
      if (xaiRow && xaiRow.row && typeof syncProviderUi === 'function') {
        syncProviderUi();
      }
    }
    const oauthRow = document.createElement('div');
    oauthRow.className = 'ai-oauth-row';
    aiOauthSignInBtn = document.createElement('button');
    aiOauthSignInBtn.type = 'button';
    aiOauthSignInBtn.className = 'settings-mini-btn focusable btn-tone-ok';
    aiOauthSignInBtn.dataset.focusIndex = '1991';
    aiOauthSignInBtn.textContent = "Accedi con SuperGrok";
    aiOauthImportBtn = document.createElement('button');
    aiOauthImportBtn.type = 'button';
    aiOauthImportBtn.className = 'settings-mini-btn focusable btn-tone-quiet';
    aiOauthImportBtn.dataset.focusIndex = '1992';
    aiOauthImportBtn.textContent = "Importa accesso";
    aiOauthSignOutBtn = document.createElement('button');
    aiOauthSignOutBtn.type = 'button';
    aiOauthSignOutBtn.className = 'settings-mini-btn focusable btn-tone-danger';
    aiOauthSignOutBtn.dataset.focusIndex = '1993';
    aiOauthSignOutBtn.textContent = "Esci dall’account";
    oauthRow.appendChild(aiOauthSignInBtn);
    oauthRow.appendChild(aiOauthImportBtn);
    oauthRow.appendChild(aiOauthSignOutBtn);
    oauthBox.appendChild(oauthRow);
    aiKeySection.appendChild(oauthBox);
    syncAuthModeUi();

    function stopOauthPoll() {
      if (aiOauthPollTimer) {
        clearInterval(aiOauthPollTimer);
        aiOauthPollTimer = null;
      }
    }

    function oauthPendingFrom(status, cfg) {
      return (status && status.oauthPending) || (cfg && cfg.oauth_pending) || null;
    }

    function isOauthPendingWaiting(pending) {
      if (!pending || !pending.userCode) return false;
      const st = String(pending.status || 'pending').toLowerCase();
      return !st || st === 'pending';
    }

    function paintSignedIn(email) {
      if (aiAuthModeSelect && aiAuthModeSelect.value !== 'SUPERGROK_OAUTH') {
        aiAuthModeSelect.value = 'SUPERGROK_OAUTH';
        if (typeof aiAuthModeSelect.setValue === 'function') {
          aiAuthModeSelect.setValue('SUPERGROK_OAUTH');
        }
        syncAuthModeUi();
      }
      aiOauthStatus.textContent = email
        ? ('Signed in as ' + email + ' — voice uses SuperGrok, not the API key')
        : 'Signed in — voice uses SuperGrok, not the API key';
      aiOauthStatus.className = 'settings-hint ai-status-ok';
      hideOauthQr();
      setOauthActionState('signed-in');
      paintGrokUsing('signed-in', email);
      stopOauthPoll();
    }

    function paintOauthFromStatus(status, cfg) {
      syncAuthModeUi();
      // SuperGrok token / session warnings belong only on Grok + SuperGrok.
      if (!isGrokProvider() || !isSuperGrokMode()) return;
      const pending = oauthPendingFrom(status, cfg);
      const pendingWaiting = isOauthPendingWaiting(pending);
      if (pendingWaiting) aiOauthSawPending = true;
      const email = (status && status.oauthEmail) || (cfg && cfg.oauth_email) || '';
      const err = (status && status.oauthError) ||
        (pending && pending.error) ||
        (cfg && cfg.oauth_error) || '';
      const tokenExpired = !!(status && status.oauthTokenExpired) ||
        !!(cfg && cfg.oauth_token_expired);
      const signedIn = !tokenExpired && (
        !!(status && status.oauthSignedIn) || !!(cfg && cfg.oauth_signed_in)
      );
      // applyAiConfigToForm paints with {} — never treat that as "login done".
      const liveStatus = !!(status && (
        status.oauthSignedIn !== undefined ||
        status.oauthPending !== undefined ||
        status.daemonActive !== undefined
      ));

      // Device-code login in flight wins over a leftover oauth.json session.
      // Otherwise the 2s status poll hides the QR and claims "signed in".
      if (aiOauthInProgress || pendingWaiting) {
        if (liveStatus && aiOauthInProgress && aiOauthSawPending &&
            signedIn && !pendingWaiting) {
          aiOauthInProgress = false;
          paintSignedIn(email);
          return;
        }
        if (liveStatus && aiOauthInProgress && aiOauthSawPending &&
            !pendingWaiting && !signedIn) {
          aiOauthInProgress = false;
          hideOauthQr();
          aiOauthStatus.textContent = err
            ? ('SuperGrok: ' + err)
            : 'SuperGrok: sign-in did not complete';
          aiOauthStatus.className = 'settings-hint ai-status-warn';
          setOauthActionState('signed-out');
          paintGrokUsing('signed-out');
          stopOauthPoll();
          return;
        }
        showOauthPending(
          (pending && pending.userCode) || aiOauthLocalCode,
          (pending && pending.verificationUri) || aiOauthLocalUri ||
            'https://accounts.x.ai/oauth2/device'
        );
        return;
      }

      if (signedIn) {
        paintSignedIn(email);
      } else {
        aiOauthStatus.textContent = err
          ? ('SuperGrok: ' + err)
          : (tokenExpired
            ? 'SuperGrok session expired — sign in again to keep using SuperGrok'
            : 'Not signed in — use Sign in (green) or a Grok API key instead');
        aiOauthStatus.className = (err || tokenExpired)
          ? 'settings-hint ai-status-warn'
          : 'settings-hint';
        hideOauthQr();
        setOauthActionState(tokenExpired ? 'expired' : 'signed-out');
        paintGrokUsing(tokenExpired ? 'expired' : 'signed-out');
        stopOauthPoll();
      }
    }

    function pollOauthUntilDone() {
      stopOauthPoll();
      aiOauthPollTimer = setInterval(function () {
        if (!visible) {
          stopOauthPoll();
          return;
        }
        getVoiceStatus().then(function (status) {
          const pending = status && status.oauthPending;
          const stillWaiting = isOauthPendingWaiting(pending) ||
            (aiOauthInProgress && !aiOauthSawPending);
          const tokenExpired = !!(status && status.oauthTokenExpired);
          const signedIn = !!(status && status.oauthSignedIn) && !tokenExpired;
          paintOauthFromStatus(status || {}, aiLoadedConfig);
          if (signedIn && !stillWaiting && (!aiOauthInProgress || aiOauthSawPending)) {
            if (options.onToast) options.onToast('SuperGrok signed in');
            aiOauthInProgress = false;
            loadAiTab();
          }
        }).catch(function () { /* ignore */ });
      }, 2000);
    }

    function cancelOauthLogin() {
      aiOauthInProgress = false;
      aiOauthSawPending = false;
      hideOauthQr();
      stopOauthPoll();
      cancelSuperGrokLogin().then(function () {
        loadAiTab();
      }).catch(function (err) {
        if (options.onToast) options.onToast((err && err.message) || 'Cancel failed');
        loadAiTab();
      });
    }

    aiOauthSignInBtn.addEventListener('click', function () {
      const pending = aiLoadedConfig && aiLoadedConfig.oauth_pending;
      if (aiOauthInProgress ||
          aiOauthSignInBtn.textContent.indexOf('Cancel') === 0 ||
          isOauthPendingWaiting(pending)) {
        cancelOauthLogin();
        return;
      }
      aiOauthSignInBtn.disabled = true;
      aiOauthInProgress = true;
      aiOauthSawPending = false;
      startSuperGrokLogin().then(function (res) {
        aiOauthSignInBtn.disabled = false;
        const code = (res && res.userCode) || '';
        const uri = (res && res.verificationUri) || 'https://accounts.x.ai/oauth2/device';
        showOauthPending(code, uri);
        aiOauthSignInBtn.textContent = "Annulla accesso";
        if (code) aiOauthSawPending = true;
        if (options.onToast) options.onToast('SuperGrok code: ' + code);
        pollOauthUntilDone();
      }).catch(function (err) {
        aiOauthInProgress = false;
        aiOauthSignInBtn.disabled = false;
        hideOauthQr();
        if (options.onToast) {
          options.onToast((err && err.message) || 'Could not start SuperGrok sign-in');
        }
      });
    });
    if (aiOauthModalCancel) {
      aiOauthModalCancel.addEventListener('click', function (event) {
        event.preventDefault();
        event.stopPropagation();
        cancelOauthLogin();
      });
    }
    aiOauthImportBtn.addEventListener('click', function () {
      aiOauthImportBtn.disabled = true;
      importSuperGrokAuth().then(function (res) {
        aiOauthImportBtn.disabled = false;
        if (options.onToast) {
          options.onToast(res && res.email
            ? ('Imported SuperGrok for ' + res.email)
            : 'Imported SuperGrok session');
        }
        loadAiTab();
      }).catch(function (err) {
        aiOauthImportBtn.disabled = false;
        if (options.onToast) {
          options.onToast((err && err.message) ||
            'Copy ~/.grok/auth.json to /home/root/.grok/auth.json on the TV');
        }
      });
    });
    aiOauthSignOutBtn.addEventListener('click', function () {
      signOutSuperGrok().then(function () {
        if (aiAuthModeSelect) {
          aiAuthModeSelect.value = 'API_KEY';
          if (typeof aiAuthModeSelect.setValue === 'function') {
            aiAuthModeSelect.setValue('API_KEY');
          }
        }
        if (options.onToast) options.onToast('Signed out of SuperGrok');
        loadAiTab();
      }).catch(function (err) {
        if (options.onToast) options.onToast((err && err.message) || 'Sign out failed');
      });
    });

    xaiRow = makeKeyRow('Grok API key', 2001, 'xai-…');
    aiApiKeyInput = xaiRow.input;
    aiApiKeyShowBtn = xaiRow.showBtn;
    aiKeySection.appendChild(xaiRow.row);
    aiApiKeyHint = document.createElement('p');
    aiApiKeyHint.className = 'settings-hint';
    aiApiKeyHint.textContent = 'Get a key at console.x.ai — stored only on this TV. Leave blank to keep the current key.';
    aiKeySection.appendChild(aiApiKeyHint);

    gemRow = makeKeyRow('Gemini key', 2003, 'AIza…');
    aiGeminiKeyInput = gemRow.input;
    aiGeminiKeyShowBtn = gemRow.showBtn;
    aiKeySection.appendChild(gemRow.row);
    aiGeminiKeyHint = document.createElement('p');
    aiGeminiKeyHint.className = 'settings-hint';
    aiGeminiKeyHint.textContent = 'Optional. Google AI Studio key (usually starts with AIza). Leave blank to keep current.';
    aiKeySection.appendChild(aiGeminiKeyHint);

    orRow = makeKeyRow('OpenRouter key', 2005, 'sk-or-…');
    aiOpenRouterKeyInput = orRow.input;
    aiOpenRouterKeyShowBtn = orRow.showBtn;
    aiKeySection.appendChild(orRow.row);
    aiOpenRouterKeyHint = document.createElement('p');
    aiOpenRouterKeyHint.className = 'settings-hint';
    aiOpenRouterKeyHint.textContent = 'Get a key at openrouter.ai — stored only on this TV. Leave blank to keep current.';
    aiKeySection.appendChild(aiOpenRouterKeyHint);

    aiApiKeyShowBtn.addEventListener('click', function () {
      aiXaiKeyRevealed = !aiXaiKeyRevealed;
      const full = (aiLoadedConfig && aiLoadedConfig.xai_api_key_full) || '';
      const typed = (aiApiKeyInput.value || '').trim();
      if (aiXaiKeyRevealed) {
        aiApiKeyInput.type = 'text';
        if (!typed && full) aiApiKeyInput.value = full;
        aiApiKeyShowBtn.textContent = "Nascondi";
      } else {
        aiApiKeyInput.type = 'password';
        if (full && aiApiKeyInput.value === full) aiApiKeyInput.value = '';
        aiApiKeyShowBtn.textContent = "Mostra";
      }
    });
    aiGeminiKeyShowBtn.addEventListener('click', function () {
      aiGeminiKeyRevealed = !aiGeminiKeyRevealed;
      const full = (aiLoadedConfig && aiLoadedConfig.gemini_api_key_full) || '';
      const typed = (aiGeminiKeyInput.value || '').trim();
      if (aiGeminiKeyRevealed) {
        aiGeminiKeyInput.type = 'text';
        if (!typed && full) aiGeminiKeyInput.value = full;
        aiGeminiKeyShowBtn.textContent = "Nascondi";
      } else {
        aiGeminiKeyInput.type = 'password';
        if (full && aiGeminiKeyInput.value === full) aiGeminiKeyInput.value = '';
        aiGeminiKeyShowBtn.textContent = "Mostra";
      }
    });
    aiOpenRouterKeyShowBtn.addEventListener('click', function () {
      aiOpenRouterKeyRevealed = !aiOpenRouterKeyRevealed;
      const full = (aiLoadedConfig && aiLoadedConfig.openrouter_api_key_full) || '';
      const typed = (aiOpenRouterKeyInput.value || '').trim();
      if (aiOpenRouterKeyRevealed) {
        aiOpenRouterKeyInput.type = 'text';
        if (!typed && full) aiOpenRouterKeyInput.value = full;
        aiOpenRouterKeyShowBtn.textContent = "Nascondi";
      } else {
        aiOpenRouterKeyInput.type = 'password';
        if (full && aiOpenRouterKeyInput.value === full) aiOpenRouterKeyInput.value = '';
        aiOpenRouterKeyShowBtn.textContent = "Mostra";
      }
    });

    aiPane.appendChild(aiKeySection);

    const aiProviderSection = document.createElement('section');
    aiProviderSection.className = 'settings-section';
    aiProviderSection.innerHTML = '<h3>Servizio</h3>';
    const providerHint = document.createElement('p');
    providerHint.className = 'settings-hint';
    providerHint.textContent = "Il servizio che ascolta e risponde quando premi il tasto voce.";
    aiProviderSelect = createProviderPicker(1970, function () {
      syncProviderUi();
    });
    aiProviderSection.appendChild(aiProviderSelect);
    aiProviderSection.appendChild(providerHint);

    const aiVoiceSection = document.createElement('section');
    aiVoiceSection.className = 'settings-section';
    aiVoiceSection.innerHTML = '<h3>Voce e conversazione</h3>';
    aiSttSelect = createOptionStepper('', 1973, [], '');
    aiVoiceSection.appendChild(labeledControl("Lingua parlata", aiSttSelect));
    aiVoiceModelSelect = createOptionStepper('', 1974, [], '');
    const aiVoiceModelRow = labeledControl("Modello voce", aiVoiceModelSelect);
    aiVoiceSection.appendChild(aiVoiceModelRow);
    aiChatSelect = createOptionStepper('', 1975, [], '');
    const aiChatModelRow = labeledControl("Modello conversazione", aiChatSelect);
    aiVoiceSection.appendChild(aiChatModelRow);
    aiGeminiSttSelect = createOptionStepper('', 1976, [], '');
    const aiGeminiSttRow = labeledControl("Modello ascolto", aiGeminiSttSelect);
    aiVoiceSection.appendChild(aiGeminiSttRow);
    aiGeminiModelSelect = createOptionStepper('', 1977, [], '');
    const aiGeminiModelRow = labeledControl("Modello risposte", aiGeminiModelSelect);
    aiVoiceSection.appendChild(aiGeminiModelRow);
    aiOpenRouterSttSelect = createOptionStepper('', 1977, [], '');
    const aiOpenRouterSttRow = labeledControl("Modello ascolto", aiOpenRouterSttSelect);
    aiVoiceSection.appendChild(aiOpenRouterSttRow);
    aiOpenRouterModelSelect = createOptionStepper('', 1978, [], '');
    const aiOpenRouterModelRow = labeledControl("Modello risposte", aiOpenRouterModelSelect);
    aiVoiceSection.appendChild(aiOpenRouterModelRow);
    aiDismissSelect = createOptionStepper('', 1979, [
      {value: '6', label: "6 secondi"},
      {value: '8', label: "8 secondi"},
      {value: '10', label: "10 secondi"},
      {value: '12', label: "12 secondi"},
      {value: '20', label: "20 secondi"},
      {value: '30', label: "30 secondi"}
    ], '8');
    aiVoiceSection.appendChild(labeledControl("Chiudi risposta dopo", aiDismissSelect));
    const aiSaveHint = document.createElement('p');
    aiSaveHint.className = 'settings-hint';
    aiSaveHint.textContent = "Salva per applicare le modifiche. Cambiare servizio o accesso riavvia l’assistente.";
    aiVoiceSection.appendChild(aiSaveHint);

    function currentAiProvider() {
      const v = aiProviderSelect && aiProviderSelect.value;
      if (v === 'gemini' || v === 'openrouter') return v;
      return 'xai';
    }

    function isGrokProvider() {
      return currentAiProvider() === 'xai';
    }

    function isGeminiProvider() {
      return currentAiProvider() === 'gemini';
    }

    function isOpenRouterProvider() {
      return currentAiProvider() === 'openrouter';
    }

    function syncProviderUi() {
      const grok = isGrokProvider();
      const gemini = isGeminiProvider();
      const openrouter = isOpenRouterProvider();
      if (providerHint) {
        if (gemini) {
          providerHint.textContent =
            'Gemini listens and answers with the models below. Spoken replies use Gemini TTS.';
        } else if (openrouter) {
          providerHint.textContent =
            'OpenRouter listens with the speech-to-text model you pick, then answers with the chat model.';
        } else {
          providerHint.textContent =
            'Grok listens, answers, and can speak. Choose SuperGrok sign-in or a Grok API key under Grok account.';
        }
      }
      if (aiVoiceModelRow) aiVoiceModelRow.hidden = !grok;
      if (aiChatModelRow) aiChatModelRow.hidden = !grok;
      if (aiGeminiSttRow) aiGeminiSttRow.hidden = !gemini;
      if (aiGeminiModelRow) aiGeminiModelRow.hidden = !gemini;
      if (aiOpenRouterSttRow) aiOpenRouterSttRow.hidden = !openrouter;
      if (aiOpenRouterModelRow) aiOpenRouterModelRow.hidden = !openrouter;
      if (authRow) authRow.hidden = !grok;
      if (authHint) authHint.hidden = !grok;
      if (oauthBox) oauthBox.hidden = !grok || !isSuperGrokMode();
      const superGrok = grok && isSuperGrokMode();
      const showXaiKey = grok && !superGrok;
      if (xaiRow && xaiRow.row) {
        xaiRow.row.hidden = !showXaiKey;
        xaiRow.row.classList.remove('ai-key-inactive');
      }
      if (aiApiKeyHint) {
        aiApiKeyHint.hidden = !showXaiKey;
        if (showXaiKey) {
          const xaiConfigured = !!(aiLoadedConfig && (aiLoadedConfig.xai_api_key_configured ||
            (aiLoadedConfig.xai_api_key_masked && aiLoadedConfig.api_key_configured)));
          const xaiMasked = (aiLoadedConfig && aiLoadedConfig.xai_api_key_masked) || '';
          aiApiKeyHint.textContent = xaiConfigured
            ? ('Grok API key on file: ' + xaiMasked + ' — leave blank to keep it.')
            : 'Get a key at console.x.ai — stored only on this TV.';
        }
      }
      if (gemRow && gemRow.row) gemRow.row.hidden = !gemini;
      if (aiGeminiKeyHint) aiGeminiKeyHint.hidden = !gemini;
      if (orRow && orRow.row) orRow.row.hidden = !openrouter;
      if (aiOpenRouterKeyHint) aiOpenRouterKeyHint.hidden = !openrouter;
      if (grok && !isSuperGrokMode()) paintGrokUsing('apikey');
      if (aiGrokUsing) aiGrokUsing.hidden = !grok && aiGrokUsing.hidden;
      if (!grok && aiGrokUsing) aiGrokUsing.hidden = true;
      if (!grok && !aiOauthInProgress) {
        hideOauthQr();
        stopOauthPoll();
      }
      // Re-paint daemon status so leftover xAI credit/token errors hide as soon
      // as Gemini or OpenRouter is selected (even before Save).
      if (lastAiStatus != null || aiLoadedConfig) {
        paintVoiceStatus(aiLoadedConfig, lastAiStatus || {});
      }
    }

    // Voice assistant on/off. Cinema installs and runs its own voice
    // daemon (voice/ in this app) as root; everything below talks to it, so
    // those sections only show while it is on.
    const aiPowerSection = document.createElement('section');
    aiPowerSection.className = 'settings-section';
    aiPowerSection.innerHTML = '<h3>Assistente vocale</h3>';
    const aiPowerBtn = document.createElement('button');
    aiPowerBtn.type = 'button';
    aiPowerBtn.className = 'settings-mini-btn settings-scan-btn focusable';
    aiPowerBtn.dataset.focusIndex = '1960';
    aiPowerSection.appendChild(aiPowerBtn);
    const aiPowerStatus = document.createElement('p');
    aiPowerStatus.className = 'settings-hint ai-status-line';
    aiPowerSection.appendChild(aiPowerStatus);
    const aiOtherVoice = document.createElement('p');
    aiOtherVoice.className = 'ai-credit-banner';
    aiOtherVoice.hidden = true;
    aiPowerSection.appendChild(aiOtherVoice);
    const aiPowerHint = document.createElement('p');
    aiPowerHint.className = 'settings-hint';
    aiPowerHint.textContent =
      'Answers the Voice button on the Magic Remote with Grok, Gemini or OpenRouter. ' +
      'It runs in the background as root (Homebrew Channel). Turning it off hands the ' +
      'button back to LG and keeps your keys and sign-in.';
    aiPowerSection.appendChild(aiPowerHint);

    voiceOn = !!(config.launcher && config.launcher.voiceEnabled);

    function paintVoicePower(message, kind) {
      aiPowerBtn.textContent = voiceBusy
        ? (voiceOn ? 'Turning off…' : 'Turning on…')
        : (voiceOn ? 'Turn off' : 'Turn on');
      aiPowerStatus.textContent = message || (voiceOn ? 'On' : "Disattivato");
      aiPowerStatus.className = 'settings-hint ai-status-line ' +
        (kind === 'err' ? 'ai-status-err' : (voiceOn ? 'ai-status-ok' : 'ai-status-warn'));
      [aiKeySection, aiProviderSection, aiVoiceSection, aiStatusSection].forEach(function (el) {
        el.hidden = !voiceOn;
      });
    }

    // VoxRelay (a separate project) answering the same button would clash.
    // Cinema only reports it; it never stops or changes it.
    function paintOtherVoice(state) {
      aiOtherVoice.hidden = !state;
      aiOtherVoice.textContent = state === 'running'
        ? 'VoxRelay is also running on this TV. Both answer the Voice button, so ' +
          'answers can clash. Cinema leaves it alone: turn one of them off.'
        : (state === 'installed'
          ? 'VoxRelay is also installed on this TV. If it runs, both answer the Voice ' +
            'button. Cinema leaves it alone.'
          : '');
    }

    // Saves just this setting: the panel's other edits still wait for Save.
    function persistVoiceEnabled(on) {
      config.launcher.voiceEnabled = on;
      try {
        const stored = loadConfig();
        stored.launcher.voiceEnabled = on;
        saveConfig(stored);
      } catch (err) {
        console.error(err);
      }
      if (options.onVoiceEnabledChange) options.onVoiceEnabledChange(on);
    }

    aiPowerBtn.addEventListener('click', function () {
      if (voiceBusy) return;
      // Not disabled while busy: a disabled button drops focus.
      voiceBusy = true;
      const turningOn = !voiceOn;
      paintVoicePower(turningOn
        ? 'Turning on… the first time installs the voice card, up to a minute.'
        : 'Turning off…');
      (turningOn ? enableVoice() : disableVoice()).then(function (res) {
        voiceBusy = false;
        persistVoiceEnabled(turningOn);
        voiceOn = turningOn;
        paintOtherVoice(turningOn ? res.otherVoice : '');
        paintVoicePower(turningOn ? 'On' : 'Off. Your keys and sign-in are kept.');
        if (turningOn) loadAiTab();
      }, function (err) {
        voiceBusy = false;
        paintVoicePower((turningOn ? 'Could not turn on: ' : 'Could not turn off: ') +
          ((err && err.message) || 'it needs root (Homebrew Channel)'), 'err');
      });
    });

    // Voice assistant on/off first, then the Assistant choice (Grok, Gemini,
    // OpenRouter) with its API key / SuperGrok sign-in right underneath,
    // Voice & chat, and the service status.
    aiPane.insertBefore(aiVoiceSection, aiStatusSection);
    aiPane.insertBefore(aiKeySection, aiVoiceSection);
    aiPane.insertBefore(aiProviderSection, aiKeySection);
    aiPane.insertBefore(aiPowerSection, aiProviderSection);
    paintVoicePower();
    syncProviderUi();

    /**
     * Fill a picker from the voice service's own choices (config.options),
     * so Cinema ships no model or language lists. The saved value is
     * always shown, even if the service no longer offers it.
     */
    function fillFromService(select, key) {
      if (!select || typeof select.setOptions !== 'function' || !aiLoadedConfig) return;
      const offered = (aiLoadedConfig.options && aiLoadedConfig.options[key]) || [];
      const list = offered.map(function (o) {
        return typeof o === 'object' && o
          ? {value: String(o.value), label: String(o.label || o.value)}
          : {value: String(o), label: String(o)};
      });
      let current = aiLoadedConfig[key] != null ? String(aiLoadedConfig[key]) : '';
      if (!current && list.length) current = list[0].value;
      if (current && !list.some(function (o) { return o.value === current; })) {
        list.unshift({value: current, label: current});
      }
      select.setOptions(list, current);
    }

    function applyAiConfigToForm(cfg) {
      aiLoadedConfig = cfg || {};
      aiXaiKeyRevealed = false;
      aiGeminiKeyRevealed = false;
      aiOpenRouterKeyRevealed = false;
      const xaiConfigured = !!(aiLoadedConfig.xai_api_key_configured ||
        (aiLoadedConfig.xai_api_key_masked && aiLoadedConfig.api_key_configured));
      const gemConfigured = !!aiLoadedConfig.gemini_api_key_configured ||
        !!(aiLoadedConfig.gemini_api_key_masked);
      const orConfigured = !!aiLoadedConfig.openrouter_api_key_configured ||
        !!(aiLoadedConfig.openrouter_api_key_masked);
      const xaiMasked = aiLoadedConfig.xai_api_key_masked || '';
      const gemMasked = aiLoadedConfig.gemini_api_key_masked || '';
      const orMasked = aiLoadedConfig.openrouter_api_key_masked || '';
      const provider = (aiLoadedConfig.ai_provider === 'gemini' ||
        aiLoadedConfig.ai_provider === 'openrouter')
        ? aiLoadedConfig.ai_provider
        : 'xai';
      aiApiKeyInput.type = 'password';
      aiApiKeyInput.value = '';
      aiApiKeyInput.placeholder = xaiConfigured ? (xaiMasked || '••••••••') : 'xai-…';
      aiApiKeyShowBtn.textContent = "Mostra";
      aiApiKeyHint.textContent = xaiConfigured
        ? ('Grok API key on file: ' + xaiMasked + ' — leave blank to keep it.')
        : 'Get a key at console.x.ai — stored only on this TV.';
      if (aiProviderSelect) {
        aiProviderSelect.value = provider;
        if (typeof aiProviderSelect.setValue === 'function') {
          aiProviderSelect.setValue(provider);
        }
      }
      const authMode = ((aiLoadedConfig.oauth_signed_in &&
        !aiLoadedConfig.oauth_token_expired) && 'SUPERGROK_OAUTH') ||
        aiLoadedConfig.auth_mode || 'API_KEY';
      if (aiAuthModeSelect) {
        aiAuthModeSelect.value = authMode;
        if (typeof aiAuthModeSelect.setValue === 'function') {
          aiAuthModeSelect.setValue(authMode);
        }
      }
      fillFromService(aiGeminiModelSelect, 'gemini_model');
      fillFromService(aiGeminiSttSelect, 'gemini_stt_model');
      fillFromService(aiOpenRouterModelSelect, 'openrouter_model');
      fillFromService(aiOpenRouterSttSelect, 'openrouter_stt_model');
      syncAuthModeUi();
      if (typeof syncProviderUi === 'function') syncProviderUi();
      paintOauthFromStatus({}, aiLoadedConfig);
      aiGeminiKeyInput.type = 'password';
      aiGeminiKeyInput.value = '';
      aiGeminiKeyInput.placeholder = gemConfigured ? (gemMasked || '••••••••') : 'AIza…';
      aiGeminiKeyShowBtn.textContent = "Mostra";
      aiGeminiKeyHint.textContent = gemConfigured
        ? ('Current Gemini key: ' + gemMasked + ' — leave blank to keep it')
        : 'Required for Gemini. Google AI Studio key (usually starts with AIza).';
      if (aiOpenRouterKeyInput) {
        aiOpenRouterKeyInput.type = 'password';
        aiOpenRouterKeyInput.value = '';
        aiOpenRouterKeyInput.placeholder = orConfigured ? (orMasked || '••••••••') : 'sk-or-…';
      }
      if (aiOpenRouterKeyShowBtn) aiOpenRouterKeyShowBtn.textContent = "Mostra";
      if (aiOpenRouterKeyHint) {
        aiOpenRouterKeyHint.textContent = orConfigured
          ? ('Current OpenRouter key: ' + orMasked + ' — leave blank to keep it')
          : 'Required for OpenRouter. Get a key at openrouter.ai (usually starts with sk-or-).';
      }
      fillFromService(aiSttSelect, 'stt_language');
      fillFromService(aiChatSelect, 'chat_model');
      fillFromService(aiVoiceModelSelect, 'voice_model');
      let dismissN = Math.round(Number(aiLoadedConfig.overlay_auto_dismiss_sec));
      if (!isFinite(dismissN) || dismissN < 3) dismissN = 8;
      const dismiss = String(dismissN);
      aiDismissSelect.value = dismiss;
      if (typeof aiDismissSelect.setValue === 'function') aiDismissSelect.setValue(dismiss);
    }

    function paintVoiceStatus(cfg, status) {
      if (!aiStatusLabel) return;
      cfg = cfg || {};
      status = status || {};
      const provider = currentAiProvider();
      const usingGemini = provider === 'gemini';
      const usingOpenRouter = provider === 'openrouter';
      const usingGrok = !usingGemini && !usingOpenRouter;
      // Leftover xAI errors (credits, spend limit, expired API tokens)
      // are Grok-only. Gemini / OpenRouter must not inherit it.
      const lastErr = usingGrok ? (status.lastXaiError || cfg.last_xai_error) : null;
      if (aiCreditBanner) {
        if (lastErr && lastErr.message) {
          aiCreditBanner.hidden = false;
          aiCreditBanner.textContent = lastErr.message;
        } else {
          aiCreditBanner.hidden = true;
          aiCreditBanner.textContent = '';
        }
      }
      const tokenExpired = !!(status.oauthTokenExpired || cfg.oauth_token_expired);
      const oauthOk = !tokenExpired &&
        !!(status.oauthSignedIn || cfg.oauth_signed_in);
      const ready = usingGemini
        ? !!cfg.gemini_api_key_configured
        : (usingOpenRouter
          ? !!cfg.openrouter_api_key_configured
          : !!(cfg.api_key_configured || oauthOk));
      if (lastErr && lastErr.message) {
        aiStatusLabel.textContent = lastErr.kind === 'credits'
          ? 'Voice blocked — xAI API credits / spend limit'
          : 'Voice blocked — xAI API error';
        aiStatusLabel.className = 'settings-hint ai-status-line ai-status-err';
      } else if (status.daemonActive) {
        aiStatusLabel.textContent = ready
          ? 'Voice daemon running — ready'
          : (usingGemini
            ? 'Daemon running — Gemini key still needed'
            : (usingOpenRouter
              ? 'Daemon running — OpenRouter key still needed'
              : 'Daemon running — API key or SuperGrok sign-in still needed'));
        aiStatusLabel.className = 'settings-hint ai-status-line ' +
          (ready ? 'ai-status-ok' : 'ai-status-warn');
      } else {
        aiStatusLabel.textContent = ready
          ? ((usingGemini ? 'Gemini' : (usingOpenRouter ? 'OpenRouter' : 'Signed in')) +
            ' configured — daemon not running (Save AI to restart)')
          : (usingGemini
            ? 'Voice service idle — add a Gemini key, then Save'
            : (usingOpenRouter
              ? 'Voice service idle — add an OpenRouter key, then Save'
              : 'Voice service idle — add an API key or SuperGrok sign-in, then Save'));
        aiStatusLabel.className = 'settings-hint ai-status-line ai-status-warn';
      }
    }

    function loadAiTab(isRetry) {
      clearTimeout(aiRetryTimer);
      if (isRetry !== true) aiLoadRetries = 0;
      if (!voiceOn) {
        // Off in this app's settings, but the daemon may still be running
        // (e.g. Cinema was reinstalled): show what is really there.
        isVoiceRunning().then(function (running) {
          if (gen !== renderGen || !visible || voiceBusy || voiceOn || !running) return;
          persistVoiceEnabled(true);
          voiceOn = true;
          paintVoicePower();
          loadAiTab();
        }).catch(function () { /* not rooted / desktop preview */ });
        return;
      }
      Promise.all([
        getVoiceConfig().catch(function (err) { return {__error: err}; }),
        getVoiceStatus().catch(function () { return {}; })
      ]).then(function (results) {
        if (gen !== renderGen || !visible) return;
        const cfg = results[0] || {};
        const status = results[1] || {};
        if (cfg.__error) {
          lastAiStatus = null;
          if (aiCreditBanner) {
            aiCreditBanner.hidden = true;
            aiCreditBanner.textContent = '';
          }
          // Just turned on or restarting after Save: keep trying for a while.
          aiLoadRetries += 1;
          if (voiceOn && aiLoadRetries <= 10) {
            aiStatusLabel.textContent = "Avvio dell’assistente vocale…";
            aiStatusLabel.className = 'settings-hint ai-status-line ai-status-warn';
            aiRetryTimer = setTimeout(function () { loadAiTab(true); }, 2500);
            return;
          }
          aiStatusLabel.textContent = 'The voice assistant is not answering. Turn it off and on ' +
            'again; its log is /tmp/launch-home-voice.log on the TV.';
          aiStatusLabel.className = 'settings-hint ai-status-line ai-status-err';
          return;
        }
        aiLoadRetries = 0;
        lastAiStatus = status;
        applyAiConfigToForm(cfg);
        paintOauthFromStatus(status, cfg);
        paintVoiceStatus(cfg, status);
      });
    }

    const profileSection = document.createElement('section');
    profileSection.className = 'settings-section';
    profileSection.innerHTML = '<h3>Profilo</h3>';

    const profileSelect = createOptionStepper('', 901,
      PROFILE_OPTIONS.map(function (entry) {
        return {value: entry.id, label: entry.label};
      }),
      config.profile || 'default',
      function (value) { syncProfileBackgroundNote(value); });
    profileSection.appendChild(labeledControl("Profilo", profileSelect));

    const profileHint = document.createElement('p');
    profileHint.className = 'settings-hint';
    profileHint.textContent = "Notte abbassa la musica e scurisce lo sfondo. Il profilo Cinema disattiva la musica ambiente.";
    profileSection.appendChild(profileHint);
    panes.look.appendChild(profileSection);

    const section = document.createElement('section');
    section.className = 'settings-section';
    section.innerHTML = '<h3>Sfondo</h3>';

    const sourceSelect = createOptionStepper('', 902, [
      {value: 'preset', label: "Gradiente"},
      {value: 'animated-gradient', label: "Gradiente animato"},
      {value: 'builtin', label: "Foto incluse"},
      {value: 'usb', label: "Cartella USB"},
      {value: 'url', label: "Foto online"},
      {value: 'aerial', label: "Video aerei"}
    ], bg.source, function (value) {
      syncFields({
        revealGallery: value === 'url' || value === 'builtin' || value === 'aerial'
      });
    });
    section.appendChild(labeledControl("Sorgente", sourceSelect));

    // A profile with its own background (Cinema) overrides the Source above.
    // Unexplained, Save looked like it reset photos back to Gradient.
    const profileBgNote = document.createElement('p');
    profileBgNote.className = 'settings-hint';
    section.appendChild(profileBgNote);
    function syncProfileBackgroundNote(profileId) {
      const overrides = getProfileOverrides({profile: profileId, profiles: config.profiles});
      const forced = !!(overrides.background && overrides.background.source);
      const entry = PROFILE_OPTIONS.filter(function (p) { return p.id === profileId; })[0];
      profileBgNote.hidden = !forced;
      profileBgNote.textContent = forced
        ? 'The ' + (entry ? entry.label : profileId) + ' profile uses its own dark background, ' +
          'so this Source applies once Active profile is Default or Night.'
        : '';
    }
    syncProfileBackgroundNote(config.profile || 'default');

    const presetSelect = createOptionStepper('', 903, [
      {value: 'warm-gradient', label: "Gradiente caldo"},
      {value: 'cool-gradient', label: "Gradiente freddo"},
      {value: 'midnight', label: "Mezzanotte"},
      {value: 'ember', label: "Brace"}
    ], bg.preset);
    // Only shown when Source is Gradient / Animated Gradient (not when Photo is set).
    const presetRow = labeledControl("Stile del gradiente", presetSelect);
    section.appendChild(presetRow);

    const displaySelect = createOptionStepper('', 904, [
      {value: 'static', label: "Immagine singola"},
      {value: 'slideshow', label: "Presentazione"}
    ], bg.mode, function () {
      syncFields();
    });
    const displayRow = labeledControl("Visualizzazione", displaySelect);
    section.appendChild(displayRow);

    // Aerial Slideshow only: randomise the clip order.
    const bgShuffleToggle = document.createElement('input');
    bgShuffleToggle.type = 'checkbox';
    bgShuffleToggle.checked = !!bg.shuffle;
    bgShuffleToggle.className = 'focusable';
    bgShuffleToggle.dataset.focusIndex = '936';
    const bgShuffleRow = labeledControl("Video in ordine casuale", bgShuffleToggle);
    section.appendChild(bgShuffleRow);

    // Aerial clips (Apple) — title-only picker; the clips stream from Apple's
    // CDN, so there are no packaged thumbnails to show.
    let selectedAerialId = bg.aerial || (AERIAL_BACKGROUNDS[0] && AERIAL_BACKGROUNDS[0].id) || '';
    const aerialRow = document.createElement('div');
    aerialRow.className = 'settings-block photo-picker-block';
    const aerialHeading = document.createElement('span');
    aerialHeading.className = 'settings-block-label';
    aerialHeading.textContent =
      'Choose an aerial clip (' + AERIAL_BACKGROUNDS.length + ' \u00b7 streams from Apple)';
    aerialRow.appendChild(aerialHeading);

    const aerialGrid = document.createElement('div');
    aerialGrid.className = 'photo-picker-grid aerial-picker-grid';
    aerialRow.appendChild(aerialGrid);

    function markAerialSelection() {
      const tiles = aerialGrid.querySelectorAll('.photo-picker-tile');
      for (let i = 0; i < tiles.length; i += 1) {
        const tile = tiles[i];
        const id = tile.dataset.aerialId || '';
        const isSel = id === selectedAerialId;
        tile.classList.toggle('is-selected', isSel);
        tile.setAttribute('aria-pressed', isSel ? 'true' : 'false');
      }
    }

    function selectAerial(id) {
      selectedAerialId = id || '';
      markAerialSelection();
    }

    AERIAL_BACKGROUNDS.forEach(function (entry, index) {
      const tile = document.createElement('div');
      tile.className = 'photo-picker-tile photo-picker-tile-text focusable';
      tile.setAttribute('role', 'button');
      // Shares the gallery range with built-in / online; only one shows at once.
      tile.dataset.focusIndex = String(905 + index);
      tile.dataset.aerialId = entry.id;
      tile.setAttribute('aria-label', entry.title || entry.id);
      tile.tabIndex = 0;

      const caption = document.createElement('span');
      caption.className = 'photo-picker-caption';
      caption.textContent = entry.title || entry.id;
      caption.style.pointerEvents = 'none';

      tile.appendChild(caption);
      // Browse with arrows only; Select/click keeps is-selected when focus leaves.
      tile.addEventListener('click', function (event) {
        if (event && event.preventDefault) event.preventDefault();
        selectAerial(entry.id);
      });
      aerialGrid.appendChild(tile);
    });
    markAerialSelection();

    const aerialHint = document.createElement('p');
    aerialHint.className = 'settings-hint';
    aerialHint.textContent =
      'Clips stream from Apple\u2019s network (nothing is packaged) and play muted, full-screen and looping. The TV must be online; if a clip will not play, the gradient above is used instead. ' +
      'Aerials are the heaviest background source (network plus continuous video decode), and Performance mode has no effect on video.';
    aerialRow.appendChild(aerialHint);
    section.appendChild(aerialRow);

    // Built-in photo gallery (thumbnails) — only visible when Source is Built-in photos.
    let selectedBuiltinId = bg.builtin || (builtinManifest[0] && builtinManifest[0].id) || '';
    const builtinRow = document.createElement('div');
    builtinRow.className = 'settings-block photo-picker-block';
    const builtinHeading = document.createElement('span');
    builtinHeading.className = 'settings-block-label';
    builtinHeading.textContent = "Scegli una foto";
    builtinRow.appendChild(builtinHeading);

    const builtinGrid = document.createElement('div');
    builtinGrid.className = 'photo-picker-grid';
    builtinRow.appendChild(builtinGrid);

    function markBuiltinSelection() {
      const tiles = builtinGrid.querySelectorAll('.photo-picker-tile');
      for (let i = 0; i < tiles.length; i += 1) {
        const tile = tiles[i];
        const id = tile.dataset.builtinId || '';
        const isSel = id === selectedBuiltinId;
        tile.classList.toggle('is-selected', isSel);
        tile.setAttribute('aria-pressed', isSel ? 'true' : 'false');
      }
    }

    function selectBuiltin(id) {
      selectedBuiltinId = id || '';
      markBuiltinSelection();
    }

    (builtinManifest || []).forEach(function (entry, index) {
      // div+role=button: native <button> on webOS often eats Select/OK and
      // leaves focus stuck so you cannot scroll to the next settings rows.
      const tile = document.createElement('div');
      tile.className = 'photo-picker-tile focusable';
      tile.setAttribute('role', 'button');
      // 905… after Display (904), before USB filename (930).
      tile.dataset.focusIndex = String(905 + index);
      tile.dataset.builtinId = entry.id;
      tile.setAttribute('aria-label', entry.title || entry.id);
      tile.tabIndex = 0;

      const img = document.createElement('img');
      img.className = 'photo-picker-thumb';
      img.alt = '';
      img.loading = 'lazy';
      img.decoding = 'async';
      img.draggable = false;
      img.style.pointerEvents = 'none';
      // 480px thumbnails: decoding the full wallpapers for 200px tiles
      // stalled the panel on open and while scrolling past the gallery.
      const thumbSources = [
        builtinImageUrl('thumbs/' + entry.file),
        builtinImageUrl(entry.file),
        'assets/backgrounds/' + entry.file
      ];
      let thumbIndex = 0;
      img.src = thumbSources[0];
      img.addEventListener('error', function () {
        thumbIndex += 1;
        if (thumbIndex >= thumbSources.length) {
          tile.classList.add('photo-picker-thumb-failed');
          return;
        }
        img.src = thumbSources[thumbIndex];
      });

      const caption = document.createElement('span');
      caption.className = 'photo-picker-caption';
      caption.textContent = entry.title || entry.id;
      caption.style.pointerEvents = 'none';

      tile.appendChild(img);
      tile.appendChild(caption);
      // Do NOT select on focus — arrows only browse. Select/OK/click chooses
      // so the gold “is-selected” state stays when you scroll away.
      tile.addEventListener('click', function (event) {
        if (event && event.preventDefault) event.preventDefault();
        selectBuiltin(entry.id);
      });
      builtinGrid.appendChild(tile);
    });
    markBuiltinSelection();

    const builtinPickHint = document.createElement('p');
    builtinPickHint.className = 'settings-hint';
    builtinPickHint.textContent =
      'Packaged at ~3840px for 4K TVs; Performance mode downloads 1920px copies. Arrows browse \u00b7 OK chooses the photo and moves on.';
    builtinRow.appendChild(builtinPickHint);
    section.appendChild(builtinRow);

    const usbHint = document.createElement('p');
    usbHint.className = 'settings-hint';
    usbHint.textContent = 'Scegli una cartella USB con images.json oppure inserisci il nome di una singola immagine.';
    section.appendChild(usbHint);

    const usbFileInput = document.createElement('input');
    usbFileInput.type = 'text';
    usbFileInput.className = 'settings-text focusable';
    usbFileInput.dataset.focusIndex = '930';
    usbFileInput.placeholder = 'living-room.jpg';
    usbFileInput.value = config.background.file || '';
    const usbFileRow = labeledControl("Nome file USB", usbFileInput);
    section.appendChild(usbFileRow);

    // Match curated remote by saved id, else by URL, else default first entry.
    let initialRemote = bg.remote || '';
    if (!findRemoteBackgroundById(initialRemote)) {
      const byUrl = findRemoteBackgroundByUrl(bg.url);
      initialRemote = byUrl ? byUrl.id : (REMOTE_BACKGROUNDS[0] && REMOTE_BACKGROUNDS[0].id) || '';
    }
    // Empty string = custom typed URL (not a catalog entry).
    if (bg.url && !findRemoteBackgroundByUrl(bg.url) && !findRemoteBackgroundById(bg.remote)) {
      initialRemote = '';
    }

    const urlHint = document.createElement('p');
    urlHint.className = 'settings-hint';
    urlHint.textContent = 'Scegli una foto oppure incolla un collegamento diretto a un’immagine. Serve una connessione a Internet.';
    section.appendChild(urlHint);

    const urlInput = document.createElement('input');
    urlInput.type = 'text';
    urlInput.className = 'settings-text focusable';
    urlInput.dataset.focusIndex = '931';
    urlInput.placeholder = 'https://images.unsplash.com/photo-…';
    // Prefer saved URL; if empty and a catalog pick is selected, prefill that.
    const remotePrefill = findRemoteBackgroundById(initialRemote);
    urlInput.value = bg.url || (remotePrefill && remotePrefill.url) || '';

    // Visual photo gallery (replaces text-only stepper) — D-pad pickable tiles.
    let selectedRemoteId = initialRemote;
    const remoteRow = document.createElement('div');
    remoteRow.className = 'settings-block photo-picker-block';
    const remoteHeading = document.createElement('span');
    remoteHeading.className = 'settings-block-label';
    remoteHeading.textContent =
      'Choose an online photo (' + REMOTE_BACKGROUNDS.length + ' network images · nature + anime)';
    remoteRow.appendChild(remoteHeading);

    const remoteGrid = document.createElement('div');
    remoteGrid.className = 'photo-picker-grid';
    remoteRow.appendChild(remoteGrid);

    function markRemoteSelection() {
      const tiles = remoteGrid.querySelectorAll('.photo-picker-tile');
      for (let i = 0; i < tiles.length; i += 1) {
        const tile = tiles[i];
        const id = tile.dataset.remoteId || '';
        const isSel = id === selectedRemoteId;
        tile.classList.toggle('is-selected', isSel);
        tile.setAttribute('aria-pressed', isSel ? 'true' : 'false');
      }
    }

    function selectRemote(id) {
      selectedRemoteId = id || '';
      const picked = findRemoteBackgroundById(selectedRemoteId);
      if (picked) {
        urlInput.value = picked.url;
      }
      markRemoteSelection();
    }

    REMOTE_BACKGROUNDS.forEach(function (entry, index) {
      const tile = document.createElement('div');
      tile.className = 'photo-picker-tile focusable';
      tile.setAttribute('role', 'button');
      tile.dataset.focusIndex = String(905 + index);
      tile.dataset.remoteId = entry.id;
      tile.setAttribute('aria-label', entry.title || entry.id);
      tile.tabIndex = 0;

      const img = document.createElement('img');
      img.className = 'photo-picker-thumb';
      img.alt = '';
      img.loading = 'lazy';
      img.decoding = 'async';
      img.draggable = false;
      img.style.pointerEvents = 'none';
      img.src = remoteThumbUrl(entry.url);
      img.addEventListener('error', function () {
        tile.classList.add('photo-picker-thumb-failed');
      });

      const caption = document.createElement('span');
      caption.className = 'photo-picker-caption';
      caption.textContent = entry.title || entry.id;
      caption.style.pointerEvents = 'none';

      tile.appendChild(img);
      tile.appendChild(caption);
      // Browse with arrows only; Select/click keeps is-selected when focus leaves.
      tile.addEventListener('click', function (event) {
        if (event && event.preventDefault) event.preventDefault();
        selectRemote(entry.id);
      });
      remoteGrid.appendChild(tile);
    });

    const customTile = document.createElement('div');
    customTile.className = 'photo-picker-tile photo-picker-custom focusable';
    customTile.setAttribute('role', 'button');
    customTile.dataset.focusIndex = String(905 + REMOTE_BACKGROUNDS.length);
    customTile.dataset.remoteId = '';
    customTile.setAttribute('aria-label', "Indirizzo personale");
    customTile.tabIndex = 0;
    const customCaption = document.createElement('span');
    customCaption.className = 'photo-picker-caption';
    customCaption.textContent = "Indirizzo personale";
    customCaption.style.pointerEvents = 'none';
    const customHint = document.createElement('span');
    customHint.className = 'photo-picker-custom-hint';
    customHint.textContent = "Incolla un indirizzo";
    customHint.style.pointerEvents = 'none';
    customTile.appendChild(customCaption);
    customTile.appendChild(customHint);
    customTile.addEventListener('click', function (event) {
      if (event && event.preventDefault) event.preventDefault();
      selectRemote('');
      try {
        urlInput.scrollIntoView({block: 'nearest', behavior: 'smooth'});
      } catch (err) {
        try { urlInput.scrollIntoView(true); } catch (err2) { /* ignore */ }
      }
      window.setTimeout(function () {
        beginSettingsTextEdit(urlInput);
      }, 120);
    });
    remoteGrid.appendChild(customTile);
    markRemoteSelection();
    section.appendChild(remoteRow);

    // Keep remote id aligned when the user edits the URL by hand.
    // Under the field: whether the link loads as an image. A web page link
    // (an image host's page for the photo) was accepted and silently showed
    // nothing on the home screen.
    const urlStatus = document.createElement('p');
    urlStatus.className = 'settings-hint settings-url-status';
    urlStatus.hidden = true;
    let urlCheckTimer = null;
    let urlCheckGen = 0;
    function showUrlStatus(text, kind) {
      urlStatus.textContent = text;
      urlStatus.hidden = !text;
      urlStatus.classList.toggle('is-ok', kind === 'ok');
      urlStatus.classList.toggle('is-error', kind === 'error');
    }
    function checkUrl() {
      const url = urlInput.value.trim();
      const gen = ++urlCheckGen;
      // A built-in online photo: known good.
      if (!url || findRemoteBackgroundByUrl(url)) {
        showUrlStatus('', '');
        return;
      }
      if (!/^https?:\/\//i.test(url)) {
        showUrlStatus('This needs a web link starting with https://', 'error');
        return;
      }
      showUrlStatus('Checking the link\u2026', '');
      const img = new Image();
      let settled = false;
      function done(ok) {
        if (settled || gen !== urlCheckGen) return;
        settled = true;
        if (ok) {
          showUrlStatus('The link loads as an image (' + img.naturalWidth + ' \u00d7 ' +
            img.naturalHeight + '). Press Save to use it.', 'ok');
        } else {
          showUrlStatus('That link didn\u2019t load as an image. Use the direct image link: it ' +
            'usually ends in .jpg or .png (on an image host, \u201cCopy image address\u201d or ' +
            '\u201cDirect link\u201d). A link to a web page about the photo won\u2019t work.', 'error');
        }
      }
      img.onload = function () { done(true); };
      img.onerror = function () { done(false); };
      setTimeout(function () { done(false); }, 20000);
      img.src = jpegForTv(url);
    }
    urlInput.addEventListener('input', function () {
      const match = findRemoteBackgroundByUrl(urlInput.value.trim());
      selectedRemoteId = match ? match.id : '';
      markRemoteSelection();
      clearTimeout(urlCheckTimer);
      urlCheckTimer = setTimeout(checkUrl, 800);
    });

    const urlRow = labeledControl("Indirizzo immagine", urlInput);
    section.appendChild(urlRow);
    section.appendChild(urlStatus);
    // A saved link is checked when Settings opens, too.
    if (urlInput.value.trim()) checkUrl();

    const urlsInput = document.createElement('textarea');
    urlsInput.className = 'settings-textarea focusable';
    urlsInput.dataset.focusIndex = '932';
    urlsInput.rows = 4;
    urlsInput.placeholder = 'One https image URL per line (leave empty to use curated online set)';
    urlsInput.value = (bg.urls || []).join('\n');
    const urlsRow = labeledBlock("Indirizzi della presentazione", urlsInput);
    section.appendChild(urlsRow);

    const intervalInput = document.createElement('input');
    intervalInput.type = 'number';
    intervalInput.min = '30';
    intervalInput.max = '3600';
    intervalInput.step = '30';
    intervalInput.className = 'settings-text focusable';
    intervalInput.dataset.focusIndex = '933';
    intervalInput.value = String(bg.slideshowIntervalSec || 300);
    const intervalRow = labeledControl("Secondi per immagine", intervalInput);
    section.appendChild(intervalRow);

    const kenBurnsToggle = document.createElement('input');
    kenBurnsToggle.type = 'checkbox';
    kenBurnsToggle.checked = !!bg.kenBurns;
    kenBurnsToggle.className = 'focusable';
    kenBurnsToggle.dataset.focusIndex = '934';
    const kenBurnsRow = labeledControl("Zoom lento sullo sfondo", kenBurnsToggle);
    section.appendChild(kenBurnsRow);
    const kenBurnsHint = document.createElement('p');
    kenBurnsHint.className = 'settings-hint';
    kenBurnsHint.textContent =
      'When on, the wallpaper slowly zooms in and drifts a little (like a calm slideshow). When off, the picture stays still. Photos only — not gradients. ' +
      'While the wallpaper moves, tiles and buttons are tinted instead of frosted glass: blurring a moving picture makes TVs stutter.';
    section.appendChild(kenBurnsHint);

    const oledNote = document.createElement('p');
    oledNote.className = 'oled-note';
    oledNote.textContent = "Puoi alternare più immagini con la modalità Presentazione.";
    section.appendChild(oledNote);
    panes.look.appendChild(section);

    const refs = {
      displayRow: displayRow,
      bgShuffleRow: bgShuffleRow,
      aerialRow: aerialRow,
      builtinRow: builtinRow,
      usbHint: usbHint,
      usbFileRow: usbFileRow,
      remoteRow: remoteRow,
      urlHint: urlHint,
      urlRow: urlRow,
      urlsRow: urlsRow,
      intervalRow: intervalRow,
      kenBurnsRow: kenBurnsRow,
      kenBurnsHint: kenBurnsHint,
      displaySelect: displaySelect
    };

    function syncFields(opts) {
      // Gradient style only applies to gradient sources — hide entirely for
      // photos (builtin/USB/URL) so a leftover "Warm gradient" is not confusing.
      const isGradientSource =
        sourceSelect.value === 'preset' || sourceSelect.value === 'animated-gradient';
      presetRow.hidden = !isGradientSource;
      syncBackgroundFields(sourceSelect.value, refs, opts);
    }

    syncFields();

    // Swap loading shell → full chrome now (profile + background already in body).
    // Remaining sections append to the live body so the user always sees content.
    panel.innerHTML = '';
    panel.appendChild(next);

    const music = normalizeMusicConfig(config.music);
    const builtinTracks = (await withDeadline(loadBuiltinMusicManifest(), 4000)) || [];

    if (gen !== renderGen || !visible) return;

    const musicSection = document.createElement('section');
    musicSection.className = 'settings-section';
    musicSection.innerHTML = '<h3>Musica ambiente</h3>';

    const musicEnabled = document.createElement('input');
    musicEnabled.type = 'checkbox';
    musicEnabled.checked = !!effective.music.enabled;
    musicEnabled.className = 'focusable';
    musicEnabled.dataset.focusIndex = '940';
    musicSection.appendChild(labeledControl("Musica ambiente", musicEnabled));

    const showMusicBar = document.createElement('input');
    showMusicBar.type = 'checkbox';
    showMusicBar.checked = !!music.showBar;
    showMusicBar.className = 'focusable';
    showMusicBar.dataset.focusIndex = '9405';
    musicSection.appendChild(labeledControl("Mostra nome del brano", showMusicBar));

    const musicBarHint = document.createElement('p');
    musicBarHint.className = 'settings-hint';
    musicBarHint.textContent = "Mostra il nome del brano accanto al volume. Se disattivato, rimangono solo i controlli audio.";
    musicSection.appendChild(musicBarHint);

    const musicSourceSelect = createOptionStepper('', 941, [
      {value: 'builtin', label: "Brani ambiente inclusi"},
      {value: 'usb', label: "I miei brani USB"}
    ], music.source, function () {
      syncMusicFields();
    });
    const musicSourceRow = labeledControl("Sorgente", musicSourceSelect);
    musicSection.appendChild(musicSourceRow);

    // --- Built-in: multi-select which of the 8 packaged tracks to rotate ---
    const savedBuiltinPlaylist = Array.isArray(music.builtinPlaylist)
      ? music.builtinPlaylist.slice()
      : [];
    // Empty playlist in config means “all packaged tracks”.
    const builtinSelected = {};
    builtinTracks.forEach(function (entry) {
      builtinSelected[entry.id] = !savedBuiltinPlaylist.length
        || savedBuiltinPlaylist.indexOf(entry.id) >= 0;
    });

    const builtinPlaylistBlock = document.createElement('div');
    builtinPlaylistBlock.className = 'settings-block';
    const builtinPlaylistLabel = document.createElement('span');
    builtinPlaylistLabel.className = 'settings-block-label';
    builtinPlaylistLabel.textContent = "Brani inclusi, seleziona quelli da ascoltare";
    builtinPlaylistBlock.appendChild(builtinPlaylistLabel);

    const builtinPlaylistList = document.createElement('div');
    builtinPlaylistList.className = 'settings-track-list';
    builtinPlaylistBlock.appendChild(builtinPlaylistList);

    builtinTracks.forEach(function (entry, index) {
      const row = document.createElement('div');
      row.className = 'settings-track-row';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'focusable';
      checkbox.dataset.focusIndex = String(942 + index);
      checkbox.checked = !!builtinSelected[entry.id];
      checkbox.addEventListener('change', function () {
        builtinSelected[entry.id] = checkbox.checked;
        // Keep “Start with” options in sync with enabled set.
        refreshBuiltinStartOptions();
      });

      const title = document.createElement('span');
      title.className = 'settings-track-title';
      const detail = entry.description ? ' — ' + entry.description : '';
      title.textContent = (entry.title || entry.id) + detail;

      row.appendChild(checkbox);
      row.appendChild(title);
      builtinPlaylistList.appendChild(row);
    });
    musicSection.appendChild(builtinPlaylistBlock);

    function enabledBuiltinIds() {
      return builtinTracks
        .map(function (entry) { return entry.id; })
        .filter(function (id) { return builtinSelected[id]; });
    }

    function builtinStartOptions() {
      const enabled = enabledBuiltinIds();
      const source = enabled.length
        ? builtinTracks.filter(function (e) { return enabled.indexOf(e.id) >= 0; })
        : builtinTracks;
      return source.map(function (entry) {
        return {value: entry.id, label: entry.title || entry.id};
      });
    }

    const builtinTrackSelect = createOptionStepper('', 950,
      builtinStartOptions(),
      music.builtin);
    const builtinTrackRow = labeledControl("Brano iniziale", builtinTrackSelect);
    musicSection.appendChild(builtinTrackRow);

    function refreshBuiltinStartOptions() {
      const opts = builtinStartOptions();
      let cur = builtinTrackSelect.value;
      const still = opts.some(function (o) { return o.value === cur; });
      if (!still && opts.length) cur = opts[0].value;
      builtinTrackSelect.setOptions(opts, cur || '');
    }

    // --- USB: folder + multi-select discovered tracks ---
    const musicFolderPicker = createOptionStepper('', 951, [
      {value: '', label: "Inserisci una cartella…"}
    ], '', function (value) {
      if (value) {
        musicPathInput.value = value;
        scanUsbTracks(value);
      }
    });
    const musicFolderRow = labeledControl("Sfoglia cartelle", musicFolderPicker);
    musicSection.appendChild(musicFolderRow);

    findLoungeRoots().then(function (roots) {
      const opts = [{value: '', label: "Inserisci una cartella…"}];
      roots.forEach(function (root) {
        opts.push({value: joinPath(root, 'music'), label: joinPath(root, 'music')});
        opts.push({value: joinPath(root, 'music', 'ambient'), label: joinPath(root, 'music', 'ambient')});
        opts.push({value: joinPath(root, 'music', 'jazz'), label: joinPath(root, 'music', 'jazz')});
      });

      if (opts.length === 1) {
        opts[0].label = 'No USB drives detected — type a path below';
      }
      musicFolderPicker.setOptions(opts, config.music.path || '');
    }).catch(function () {
      musicFolderPicker.setOptions(
        [{value: '', label: "USB non rilevata. Inserisci una cartella."}], '');
    });

    const musicPathInput = document.createElement('input');
    musicPathInput.type = 'text';
    musicPathInput.className = 'settings-text focusable';
    musicPathInput.dataset.focusIndex = '952';
    musicPathInput.placeholder = 'e.g. /media/usb1/lounge/music';
    musicPathInput.value = config.music.path || '';
    const musicPathRow = labeledControl("Cartella della musica", musicPathInput);
    musicSection.appendChild(musicPathRow);

    musicPathInput.addEventListener('change', function () {
      musicFolderPicker.setValue(musicPathInput.value);
      scanUsbTracks(musicPathInput.value.trim());
    });
    musicPathInput.addEventListener('blur', function () {
      scanUsbTracks(musicPathInput.value.trim());
    });

    const usbPlaylistBlock = document.createElement('div');
    usbPlaylistBlock.className = 'settings-block';
    const usbPlaylistLabel = document.createElement('span');
    usbPlaylistLabel.className = 'settings-block-label';
    usbPlaylistLabel.textContent = "Brani su USB";
    usbPlaylistBlock.appendChild(usbPlaylistLabel);

    const usbScanStatus = document.createElement('p');
    usbScanStatus.className = 'settings-hint';
    usbScanStatus.textContent = "Scegli una cartella con playlist.m3u o tracks.json e cerca i brani.";
    usbPlaylistBlock.appendChild(usbScanStatus);

    const usbPlaylistList = document.createElement('div');
    usbPlaylistList.className = 'settings-track-list';
    usbPlaylistBlock.appendChild(usbPlaylistList);
    musicSection.appendChild(usbPlaylistBlock);

    // url -> checked
    const usbSelected = {};
    const savedUsb = Array.isArray(music.usbPlaylist) ? music.usbPlaylist : [];
    let usbTrackEntries = [];

    function renderUsbTrackList(entries) {
      usbTrackEntries = entries || [];
      usbPlaylistList.innerHTML = '';
      if (!usbTrackEntries.length) {
        usbScanStatus.textContent = musicPathInput.value.trim()
          ? 'No tracks found. Add playlist.m3u or tracks.json in that folder.'
          : 'Set a USB music folder to load your tracks.';
        return;
      }
      usbScanStatus.textContent = usbTrackEntries.length + ' track(s) found — tick the ones to play.';
      const hadSaved = savedUsb.length > 0;
      usbTrackEntries.forEach(function (entry, index) {
        const url = entry.url || '';
        if (usbSelected[url] === undefined) {
          usbSelected[url] = !hadSaved || savedUsb.indexOf(url) >= 0;
        }
        const row = document.createElement('div');
        row.className = 'settings-track-row';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'focusable';
        checkbox.dataset.focusIndex = String(960 + index);
        checkbox.checked = !!usbSelected[url];
        checkbox.addEventListener('change', function () {
          usbSelected[url] = checkbox.checked;
        });

        const title = document.createElement('span');
        title.className = 'settings-track-title';
        if (entry.artist && entry.title) {
          title.textContent = entry.artist + ' — ' + entry.title;
        } else if (entry.title) {
          title.textContent = entry.title;
        } else {
          const parts = String(url).split('/');
          title.textContent = (parts[parts.length - 1] || url).replace(/\.[^.]+$/, '');
        }

        row.appendChild(checkbox);
        row.appendChild(title);
        usbPlaylistList.appendChild(row);
      });
      if (options.onRendered) options.onRendered();
    }

    let usbScanGen = 0;
    function scanUsbTracks(folder) {
      const gen = (usbScanGen += 1);
      if (!folder) {
        renderUsbTrackList([]);
        return;
      }
      usbScanStatus.textContent = "Ricerca brani su USB…";
      withDeadline(discoverMusicTracks(folder), 5000).then(function (list) {
        if (gen !== usbScanGen || !visible) return;
        renderUsbTrackList(list || []);
      });
    }

    if (music.path) {
      scanUsbTracks(music.path);
    }

    const shuffleToggle = document.createElement('input');
    shuffleToggle.type = 'checkbox';
    shuffleToggle.checked = config.music.shuffle !== false;
    shuffleToggle.className = 'focusable';
    shuffleToggle.dataset.focusIndex = '990';
    const shuffleRow = labeledControl("Ordine casuale", shuffleToggle);
    musicSection.appendChild(shuffleRow);

    const repeatSelect = createOptionStepper('', 991, [
      {value: 'all', label: "Ripeti tutti"},
      {value: 'one', label: "Ripeti il brano"},
      {value: 'off', label: "Una sola volta"}
    ], config.music.repeat || 'one');
    const repeatRow = labeledControl("Ripetizione", repeatSelect);
    musicSection.appendChild(repeatRow);

    const musicVolume = document.createElement('input');
    musicVolume.type = 'range';
    musicVolume.min = '0';
    musicVolume.max = '50';
    musicVolume.value = String(Math.round((effective.music.volume || 0.15) * 100));
    musicVolume.className = 'focusable';
    musicVolume.dataset.focusIndex = '992';
    musicSection.appendChild(labeledControl("Volume ambiente", musicVolume));

    const musicHint = document.createElement('p');
    musicHint.className = 'settings-hint';
    musicHint.textContent = "Rosso: pausa. Verde: brano successivo. Aggiungi i tuoi brani scegliendo una cartella USB. La libreria musicale Jellyfin si apre dalla scheda Musica nella Home.";
    musicSection.appendChild(musicHint);

    function syncMusicFields() {
      const isBuiltin = musicSourceSelect.value === 'builtin';
      builtinPlaylistBlock.hidden = !isBuiltin;
      builtinTrackRow.hidden = !isBuiltin;
      musicFolderRow.hidden = isBuiltin;
      musicPathRow.hidden = isBuiltin;
      usbPlaylistBlock.hidden = isBuiltin;
      // Shuffle/repeat apply to multi-track playlists (built-in or USB).
      shuffleRow.hidden = false;
      repeatRow.hidden = false;
    }

    syncMusicFields();
    panes.music.appendChild(musicSection);

    // The old Launcher section, now three: System (volume levels, then
    // Performance mode, Home button, boot), Screensaver, and Clock & icons in
    // Look. `launcherSection` is pointed at each in turn as controls are built.
    const systemSection = document.createElement('section');
    systemSection.className = 'settings-section';
    systemSection.innerHTML = '<h3>Audio e prestazioni</h3>';
    systemSection.appendChild(runUserLabel);
    const screensaverSection = document.createElement('section');
    screensaverSection.className = 'settings-section';
    screensaverSection.innerHTML = '<h3>Salvaschermo</h3>';
    const clockSection = document.createElement('section');
    clockSection.className = 'settings-section';
    clockSection.innerHTML = '<h3>Orologio e icone</h3>';
    let launcherSection = systemSection;

    // TV system volume levels (0–100), separate from ambient music slider.
    // '' = "Don't change": leave whatever the remote set (stored as null).
    function volumeLevelValue(level) {
      return typeof level === 'number' ? String(level) : '';
    }

    function volumeLevelOptions(selected) {
      const opts = [{value: '', label: "Mantieni il volume attuale"}];
      for (let v = 0; v <= 30; v += 1) {
        opts.push({value: String(v), label: String(v)});
      }
      // Also offer a few higher steps for loud setups.
      [35, 40, 45, 50, 60, 70, 80, 90, 100].forEach(function (v) {
        opts.push({value: String(v), label: String(v)});
      });
      if (!opts.some(function (o) { return o.value === selected; })) {
        opts.splice(1, 0, {value: selected, label: selected});
      }
      return opts;
    }

    const volumeAtHomeValue = volumeLevelValue(config.launcher.volumeAtHome);
    const volumeAtHomeSelect = createOptionStepper(
      '',
      993,
      volumeLevelOptions(volumeAtHomeValue),
      volumeAtHomeValue
    );
    launcherSection.appendChild(labeledControl("Volume nella Home", volumeAtHomeSelect));

    const volumeOnAppValue = volumeLevelValue(config.launcher.volumeOnAppLaunch);
    const volumeOnAppSelect = createOptionStepper(
      '',
      994,
      volumeLevelOptions(volumeOnAppValue),
      volumeOnAppValue
    );
    launcherSection.appendChild(labeledControl("Volume nelle app e nella Live", volumeOnAppSelect));

    const volumeLevelsHint = document.createElement('p');
    volumeLevelsHint.className = 'settings-hint';
    volumeLevelsHint.textContent = "Puoi usare volumi diversi per la Home e per app o Live. Mantieni il volume attuale lascia il controllo al telecomando.";
    launcherSection.appendChild(volumeLevelsHint);

    // ── Cinema (in-app) screensaver ──────────────────────────────
    launcherSection = screensaverSection;
    const customSsToggle = document.createElement('input');
    customSsToggle.type = 'checkbox';
    customSsToggle.checked = config.launcher.customScreensaver !== false;
    customSsToggle.className = 'focusable';
    customSsToggle.dataset.focusIndex = '990';
    launcherSection.appendChild(labeledControl("Salvaschermo di Cinema", customSsToggle));

    const customSsIdle = createOptionStepper('', 991, [
      {value: '2', label: "2 minuti"},
      {value: '5', label: "5 minuti"},
      {value: '10', label: "10 minuti"},
      {value: '15', label: "15 minuti"},
      {value: '20', label: "20 minuti"},
      {value: '30', label: "30 minuti"},
      {value: '45', label: "45 minuti"},
      {value: '60', label: "60 minuti"}
    ], String(
      typeof config.launcher.customScreensaverMinutes === 'number'
        ? config.launcher.customScreensaverMinutes
        : 5
    ));
    launcherSection.appendChild(labeledControl("Avvia dopo inattività", customSsIdle));

    const ssPowerOff = createOptionStepper('', 991, [
      {value: '0', label: "Mai"},
      {value: '1', label: "Dopo 1 ora"},
      {value: '2', label: "Dopo 2 ore"},
      {value: '3', label: "Dopo 3 ore"},
      {value: '4', label: "Dopo 4 ore"},
      {value: '6', label: "Dopo 6 ore"},
      {value: '8', label: "Dopo 8 ore"}
    ], String(config.launcher.screensaverPowerOffHours || 0));
    launcherSection.appendChild(labeledControl("Spegni la TV durante il salvaschermo", ssPowerOff));
    const ssPowerOffHint = document.createElement('p');
    ssPowerOffHint.className = 'settings-hint';
    ssPowerOffHint.textContent = 'La TV si spegne solo se il salvaschermo di Cinema è ancora acceso da quel tempo, senza tasti premuti: un film o un’app in uso non vengono mai interrotti.';
    launcherSection.appendChild(ssPowerOffHint);

    const customSsSlide = createOptionStepper('', 992, [
      {value: '12', label: "12 secondi"},
      {value: '20', label: "20 secondi"},
      {value: '30', label: "30 secondi"},
      {value: '45', label: "45 secondi"},
      {value: '60', label: "1 minuto"},
      {value: '120', label: "2 minuti"}
    ], String(
      typeof config.launcher.customScreensaverSlideSec === 'number'
        ? config.launcher.customScreensaverSlideSec
        : 20
    ));
    launcherSection.appendChild(labeledControl("Cambia immagine ogni", customSsSlide));

    const customSsClock = document.createElement('input');
    customSsClock.type = 'checkbox';
    customSsClock.checked = config.launcher.customScreensaverShowClock !== false;
    customSsClock.className = 'focusable';
    customSsClock.dataset.focusIndex = '993';
    launcherSection.appendChild(labeledControl("Orologio nel salvaschermo", customSsClock));

    const customSsDate = document.createElement('input');
    customSsDate.type = 'checkbox';
    customSsDate.checked = config.launcher.customScreensaverShowDate !== false;
    customSsDate.className = 'focusable';
    customSsDate.dataset.focusIndex = '994';
    launcherSection.appendChild(labeledControl("Data nel salvaschermo", customSsDate));

    const customSsHint = document.createElement('p');
    customSsHint.className = 'settings-hint';
    customSsHint.textContent =
      'Full-screen photo slideshow from your Cinema wallpapers while this app is open. Any remote button wakes. Uses Ken Burns motion for OLED care.';
    launcherSection.appendChild(customSsHint);

    const previewSsBtn = document.createElement('button');
    previewSsBtn.type = 'button';
    previewSsBtn.className = 'settings-preview-ss-btn focusable';
    previewSsBtn.dataset.focusIndex = '996';
    previewSsBtn.textContent = "Anteprima salvaschermo";
    // Preview over the open panel. Closing Settings first threw away any
    // unsaved changes; the saver sits above it and hands focus back here.
    previewSsBtn.addEventListener('click', function () {
      if (options.onPreviewScreensaver) {
        options.onPreviewScreensaver();
      } else if (options.onToast) {
        options.onToast('Save & reopen Cinema to preview');
      }
    });
    launcherSection.appendChild(previewSsBtn);

    // System LG gallery saver (rooted write). Pushed to 30 min when custom is on.
    const ssMins = coerceScreensaverMinutes(
      typeof config.launcher.screensaverMinutes === 'number'
        ? config.launcher.screensaverMinutes
        : 30
    );
    const screensaverSelect = createOptionStepper('', 995, [
      {value: '0', label: "Mai"},
      {value: '3', label: "3 minuti"},
      {value: '10', label: "10 minuti"},
      {value: '20', label: "20 minuti"},
      {value: '30', label: "30 minuti"}
    ], String(ssMins));
    launcherSection.appendChild(labeledControl("Salvaschermo della TV", screensaverSelect));

    const screensaverHint = document.createElement('p');
    screensaverHint.className = 'settings-hint';
    screensaverHint.textContent =
      'Tempo di attesa del salvaschermo LG. Se usi il salvaschermo Cinema, 30 minuti evita che la TV lo interrompa.';
    launcherSection.appendChild(screensaverHint);

    launcherSection = clockSection;
    const showClockToggle = document.createElement('input');
    showClockToggle.type = 'checkbox';
    showClockToggle.checked = config.launcher.showClock !== false;
    showClockToggle.className = 'focusable';
    showClockToggle.dataset.focusIndex = '1000';
    launcherSection.appendChild(labeledControl("Mostra orologio", showClockToggle));

    const clockFormatSelect = createOptionStepper('', 1090, [
      {value: '24', label: "24 ore, 18:30"},
      {value: '12', label: "12 ore, 6:30 PM"}
    ], config.launcher.clockFormat === '12' ? '12' : '24');
    launcherSection.appendChild(labeledControl("Formato ora", clockFormatSelect));

    const showDateToggle = document.createElement('input');
    showDateToggle.type = 'checkbox';
    showDateToggle.checked = config.launcher.showDate !== false;
    showDateToggle.className = 'focusable';
    showDateToggle.dataset.focusIndex = '1001';
    launcherSection.appendChild(labeledControl("Mostra data", showDateToggle));

    const clockAlignSelect = createOptionStepper('', 1002, [
      {value: 'left', label: "In alto a sinistra"},
      {value: 'center', label: "In alto al centro"},
      {value: 'center-middle', label: "Al centro"},
      {value: 'right', label: "In alto a destra"}
    ], config.launcher.clockAlign || 'center');
    launcherSection.appendChild(labeledControl("Posizione orologio", clockAlignSelect));

    const clockSizeSelect = createOptionStepper('', 1003, [
      {value: 'small', label: "Piccolo"},
      {value: 'medium', label: "Medio"},
      {value: 'large', label: "Grande"},
      {value: 'x-large', label: "Molto grande"},
      {value: 'xx-large', label: "Massimo"}
    ], config.launcher.clockSize || 'large');
    launcherSection.appendChild(labeledControl("Dimensione orologio", clockSizeSelect));

    const timezoneSelect = createOptionStepper('', 1004,
      TIMEZONE_OPTIONS.map(function (option) {
        return {value: option.value, label: option.label};
      }),
      config.launcher.timezone || '');
    launcherSection.appendChild(labeledControl("Fuso orario", timezoneSelect));

    const iconSizeSelect = createOptionStepper('', 1005, [
      {value: 'small', label: "Piccolo"},
      {value: 'medium', label: "Medio"},
      {value: 'large', label: "Grande"}
    ], config.launcher.iconSize || 'medium');
    launcherSection.appendChild(labeledControl("Dimensione icone", iconSizeSelect));

    const dockStyleSelect = createOptionStepper('', 1005, [
      {value: 'wide', label: "Estesa, con nomi e ingressi"},
      {value: 'compact', label: "Compatta, solo icone"}
    ], config.launcher.dockStyle === 'compact' ? 'compact' : 'wide');
    launcherSection.appendChild(labeledControl("Barra delle app", dockStyleSelect));

    const dockInputsToggle = document.createElement('input');
    dockInputsToggle.type = 'checkbox';
    dockInputsToggle.className = 'focusable';
    dockInputsToggle.dataset.focusIndex = '1005';
    dockInputsToggle.checked = config.launcher.dockInputs !== false;
    launcherSection.appendChild(labeledControl("Ingressi HDMI nella barra estesa", dockInputsToggle));

    const iconAlignSelect = createOptionStepper('', 1006, [
      {value: 'left', label: "Sinistra"},
      {value: 'center', label: "Centro"},
      {value: 'right', label: "Destra"}
    ], config.launcher.iconAlign || 'center');
    launcherSection.appendChild(labeledControl("Allineamento icone", iconAlignSelect));

    const iconLayoutSelect = createOptionStepper('', 1007, [
      {value: 'scroll', label: "Una riga scorrevole"},
      {value: 'wrap', label: "Più righe"}
    ], config.launcher.iconLayout || 'scroll');
    launcherSection.appendChild(labeledControl("Disposizione app", iconLayoutSelect));

    const perRowValue = config.launcher.iconsPerRow || 7;
    const iconsPerRowSelect = createOptionStepper('', 1008, [
      {value: '4', label: '4'}, {value: '5', label: '5'}, {value: '6', label: '6'},
      {value: '7', label: '7'}, {value: '8', label: '8'}, {value: '9', label: '9'},
      {value: '10', label: '10'}, {value: '11', label: '11'}, {value: '12', label: '12'}
    ], String(perRowValue));
    launcherSection.appendChild(labeledControl("App nella riga del dock", iconsPerRowSelect));

    const bundledIconsToggle = document.createElement('input');
    bundledIconsToggle.type = 'checkbox';
    bundledIconsToggle.checked = config.launcher.bundledIcons !== false;
    bundledIconsToggle.className = 'focusable';
    bundledIconsToggle.dataset.focusIndex = '1008';
    launcherSection.appendChild(labeledControl("Usa le icone incluse", bundledIconsToggle));

    const bundledIconsHint = document.createElement('p');
    bundledIconsHint.className = 'settings-hint';
    bundledIconsHint.textContent = "Disattivato: usa le vere icone delle app installate sulla TV. Attivato: preferisci le icone incluse.";
    launcherSection.appendChild(bundledIconsHint);

    launcherSection = systemSection;
    const perfModeToggle = document.createElement('input');
    perfModeToggle.type = 'checkbox';
    perfModeToggle.checked = !!config.launcher.perfMode;
    perfModeToggle.className = 'focusable';
    perfModeToggle.dataset.focusIndex = '1009';
    launcherSection.appendChild(labeledControl("Modalità prestazioni", perfModeToggle));
    const perfModeHint = document.createElement('p');
    perfModeHint.className = 'settings-hint';
    perfModeHint.textContent = 'Usa sfondi più leggeri e riduce gli effetti. Consigliata su questa TV.';
    launcherSection.appendChild(perfModeHint);

    // Off by default: when enabled, stock Home coming to the foreground
    // (Home button press after another app, or an app exiting to home)
    // relaunches Cinema.
    const launchOnHomeToggle = document.createElement('input');
    launchOnHomeToggle.type = 'checkbox';
    launchOnHomeToggle.checked = !!(config.launcher.launchOnHome || config.launcher.returnOnAppExit);
    launchOnHomeToggle.className = 'focusable';
    launchOnHomeToggle.dataset.focusIndex = '1010';launchOnHomeToggle.dataset.setting='home-watcher';
    launcherSection.appendChild(labeledControl("Rilevamento Home alternativo", launchOnHomeToggle));

    const launchOnHomeHint = document.createElement('p');
    launchOnHomeHint.className = 'settings-hint';
    launchOnHomeHint.textContent = "Compatibilità con altri modelli: rileva la Home LG. Su questa TV il tasto Home usa LG Input Hook, configurabile nella sezione Cinema.";
    launcherSection.appendChild(launchOnHomeHint);

    const bootToggle = document.createElement('input');
    bootToggle.type = 'checkbox';
    bootToggle.checked = !!config.launcher.bootOnStart;
    bootToggle.className = 'focusable';
    bootToggle.dataset.focusIndex = '1011';bootToggle.dataset.setting='boot';
    launcherSection.appendChild(labeledControl("Avvia Cinema all’accensione", bootToggle));

    const bootHint = document.createElement('p');
    bootHint.className = 'settings-hint';
    bootHint.textContent = "Apre Cinema all’accensione e al ritorno dallo standby. Attendi che la TV completi l’avvio.";
    launcherSection.appendChild(bootHint);
    // ── Glass: the see-through tiles and buttons on the home screen ──────
    const glassSection = document.createElement('section');
    glassSection.className = 'settings-section';
    glassSection.innerHTML = '<h3>Colori e contrasto</h3>';
    function glassNote(text) {
      const note = document.createElement('p');
      note.className = 'settings-hint';
      note.textContent = text;
      return note;
    }
    glassSection.appendChild(glassNote('How the see-through app tiles, input buttons and Settings button ' +
      'look over your wallpaper. The preview shows your choices; press Save to keep them.'));

    // A sample over the current wallpaper: a tile, the tile the remote is on,
    // the current input and another input, in the choices below (before Save).
    const glassPreview = document.createElement('div');
    glassPreview.className = 'glass-preview';
    const wallpaperLayer = document.getElementById('background-layer');
    const wallpaperImage = wallpaperLayer ? getComputedStyle(wallpaperLayer).backgroundImage : '';
    if (wallpaperImage && wallpaperImage !== 'none') glassPreview.style.backgroundImage = wallpaperImage;
    // The same dark gradient as the home screen's scrim (#scrim), at the
    // dimming chosen below, so the slider shows its effect at once.
    const previewScrim = document.createElement('div');
    previewScrim.className = 'glass-preview-scrim';
    previewScrim.setAttribute('aria-hidden', 'true');
    glassPreview.appendChild(previewScrim);
    const previewDim = document.createElement('div');
    previewDim.className = 'glass-preview-dim';
    previewDim.setAttribute('aria-hidden', 'true');
    glassPreview.appendChild(previewDim);
    function previewTile(title, icon, selected) {
      const tile = document.createElement('div');
      // Not .focused: the focus manager clears that class from everything.
      tile.className = 'app-tile' + (selected ? ' is-preview-focus' : '');
      const img = document.createElement('img');
      img.className = 'app-icon';
      img.alt = '';
      setIconSrc(img, icon);
      const label = document.createElement('span');
      label.className = 'app-label';
      label.textContent = title;
      tile.appendChild(img);
      tile.appendChild(label);
      return tile;
    }
    function previewChip(text, current) {
      const chip = document.createElement('div');
      chip.className = 'input-chip' + (current ? ' active' : '');
      chip.textContent = text;
      return chip;
    }
    const previewInputs = document.createElement('div');
    previewInputs.className = 'glass-preview-inputs';
    previewInputs.appendChild(previewChip('Current input', true));
    previewInputs.appendChild(previewChip('Other input', false));
    glassPreview.appendChild(previewTile('A tile', 'assets/app-icons/netflix.png', false));
    glassPreview.appendChild(previewTile('Selected', 'assets/app-icons/youtube.png', true));
    glassPreview.appendChild(previewInputs);
    glassSection.appendChild(glassPreview);

    // Two shades over the wallpaper, both shown live in the preview above:
    // dimming of the whole picture (new; 0 by default), and the gradient along
    // the bottom behind the tiles (the old "Overlay opacity", kept as it was).
    const dimRange = document.createElement('input');
    dimRange.type = 'range';
    dimRange.min = '0';
    dimRange.max = '80';
    dimRange.value = String(Math.round((typeof bg.dimming === 'number' ? bg.dimming : 0) * 100));
    dimRange.className = 'focusable';
    dimRange.dataset.focusIndex = '937';
    function paintPreviewDimming() {
      previewDim.style.opacity = String(Number(dimRange.value) / 100);
    }
    dimRange.addEventListener('input', paintPreviewDimming);
    paintPreviewDimming();
    glassSection.appendChild(labeledControl("Oscuramento dello sfondo", dimRange));
    glassSection.appendChild(glassNote('Darkens the whole wallpaper evenly, for glare, evenings or an OLED. ' +
      '0 shows the picture as it is.'));

    const overlayRange = document.createElement('input');
    overlayRange.type = 'range';
    overlayRange.min = '0';
    overlayRange.max = '80';
    const savedDim = typeof bg.overlayOpacity === 'number' ? bg.overlayOpacity : 0.45;
    overlayRange.value = String(Math.round(savedDim * 100));
    overlayRange.className = 'focusable';
    overlayRange.dataset.focusIndex = '935';
    function paintPreviewDim() {
      previewScrim.style.opacity = String(Number(overlayRange.value) / 100);
    }
    overlayRange.addEventListener('input', paintPreviewDim);
    paintPreviewDim();
    glassSection.appendChild(labeledControl("Ombra dietro al dock", overlayRange));
    glassSection.appendChild(glassNote("Scurisce la parte bassa dello sfondo, dietro al dock, " +
      "per mantenere leggibili i nomi delle app. I profili Notte e Cinema hanno una propria intensità."));

    function paintGlassPreview() {
      const tint = glassSelect.value;
      const border = glassBorderSelect.value;
      const highlight = focusColourSelect.value;
      glassPreview.className = 'glass-preview' +
        (tint && tint !== 'light' ? ' glass-' + tint : '') +
        (border && border !== 'white' ? ' glass-border-' + border : '') +
        (highlight && highlight !== 'warm' ? ' focus-' + highlight : '');
    }

    const glassSelect = createOptionStepper('', 1091, [
      {value: 'light', label: "Chiaro"},
      {value: 'dark', label: "Scuro"},
      {value: 'black', label: "Nero"},
      {value: 'blue', label: "Blu"},
      {value: 'purple', label: "Viola"},
      {value: 'green', label: "Verde"},
      {value: 'warm', label: "Caldo"}
    ], config.launcher.glassTint || 'light', paintGlassPreview);
    glassSection.appendChild(labeledControl("Colore delle tessere", glassSelect));
    glassSection.appendChild(glassNote('Inside the app tiles, input buttons and Settings button. ' +
      'Dark or Black suit dark wallpapers.'));

    const glassBorderSelect = createOptionStepper('', 1092, [
      {value: 'white', label: "Bianco"},
      {value: 'glass', label: "Come la tessera"},
      {value: 'none', label: "Nessuno"},
      {value: 'black', label: "Nero"},
      {value: 'blue', label: "Blu"},
      {value: 'purple', label: "Viola"},
      {value: 'green', label: "Verde"},
      {value: 'warm', label: "Caldo"},
      {value: 'gold', label: "Oro"}
    ], config.launcher.glassBorder || 'white', paintGlassPreview);
    glassSection.appendChild(labeledControl("Bordo delle tessere", glassBorderSelect));
    glassSection.appendChild(glassNote("Il bordo intorno alle tessere e ai pulsanti."));

    const focusColourSelect = createOptionStepper('', 1093, [
      {value: 'warm', label: "Caldo"},
      {value: 'white', label: "Bianco"},
      {value: 'border', label: "Come il bordo"},
      {value: 'blue', label: "Blu"},
      {value: 'purple', label: "Viola"},
      {value: 'green', label: "Verde"},
      {value: 'gold', label: "Oro"}
    ], config.launcher.focusColour || 'warm', paintGlassPreview);
    glassSection.appendChild(labeledControl("Indicatore del focus", focusColourSelect));
    glassSection.appendChild(glassNote('The glow around the tile or button the remote is on, ' +
      'and the colour of the current input.'));

    paintGlassPreview();
    panes.look.appendChild(glassSection);

    panes.look.appendChild(clockSection);
    panes.screensaver.appendChild(screensaverSection);
    panes.system.appendChild(systemSection);

    // ── Weather (today + 4 days on the home screen) ─────────────────────
    const weatherSection = document.createElement('section');
    weatherSection.className = 'settings-section';
    weatherSection.innerHTML = '<h3>Meteo</h3>';

    const weatherCfg = normalizeWeatherConfig(config.weather);
    let weatherPlace = Object.assign({}, weatherCfg.location);

    const weatherToggle = document.createElement('input');
    weatherToggle.type = 'checkbox';
    weatherToggle.checked = weatherCfg.enabled;
    weatherToggle.className = 'focusable';
    weatherToggle.dataset.focusIndex = '1020';
    weatherSection.appendChild(labeledControl("Mostra meteo", weatherToggle));

    const weatherUnitsSelect = createOptionStepper('', 1021, [
      {value: 'c', label: '°C'},
      {value: 'f', label: '°F'}
    ], weatherCfg.units);
    weatherSection.appendChild(labeledControl("Temperatura", weatherUnitsSelect));

    const weatherPlaceHint = document.createElement('p');
    weatherPlaceHint.className = 'settings-hint';
    function paintWeatherPlace(pending) {
      weatherPlaceHint.textContent = 'Location: ' + weatherPlace.name +
        (pending ? ' — press Save to use it' : '');
    }
    paintWeatherPlace(false);
    weatherSection.appendChild(weatherPlaceHint);

    const weatherSearchInput = document.createElement('input');
    weatherSearchInput.type = 'text';
    weatherSearchInput.className = 'settings-text focusable';
    weatherSearchInput.dataset.focusIndex = '1022';
    weatherSearchInput.placeholder = 'Start typing a place, e.g. tok';
    weatherSearchInput.setAttribute('autocomplete', 'off');
    weatherSection.appendChild(labeledControl("Cambia località", weatherSearchInput));

    // Type-ahead: matches appear under the field as you type ("tok" →
    // Tokyo, Japan). Close the keyboard, press Down, then OK to pick one.
    const weatherSuggestions = document.createElement('div');
    weatherSuggestions.className = 'settings-suggestions';
    weatherSuggestions.setAttribute('role', 'listbox');
    weatherSuggestions.hidden = true;
    weatherSection.appendChild(weatherSuggestions);

    const WEATHER_IDLE_HINT = 'Start typing a town or city — matching places appear as you type. ' +
      'Forecast from Open-Meteo (no account needed); needs the TV to be online. ' +
      'Untick Show weather to hide it — nothing is downloaded while it’s off.';
    const weatherStatus = document.createElement('p');
    weatherStatus.className = 'settings-hint';
    weatherStatus.textContent = WEATHER_IDLE_HINT;
    weatherSection.appendChild(weatherStatus);

    function clearWeatherSuggestions() {
      weatherSuggestions.innerHTML = '';
      weatherSuggestions.hidden = true;
    }

    // Bold the part of the place name that matches what was typed.
    function appendMatchHighlight(el, label, typed) {
      const foldedLabel = foldPlaceText(label);
      const foldedTyped = foldPlaceText(typed);
      if (foldedTyped && foldedLabel.length === label.length &&
          foldedLabel.indexOf(foldedTyped) === 0) {
        const strong = document.createElement('strong');
        strong.textContent = label.slice(0, foldedTyped.length);
        el.appendChild(strong);
        el.appendChild(document.createTextNode(label.slice(foldedTyped.length)));
      } else {
        el.textContent = label;
      }
    }

    let weatherTyped = '';
    function pickWeatherPlace(place) {
      clearTimeout(weatherLookupTimer);
      weatherLookupSeq += 1; // drop any lookup still in flight
      weatherPlace = place;
      weatherTyped = place.name;
      weatherSearchInput.value = place.name;
      clearWeatherSuggestions();
      paintWeatherPlace(true);
      weatherStatus.textContent = 'Press Save to show the weather for ' + place.name + '.';
      focusSettingsControl(weatherSearchInput);
    }

    function renderWeatherSuggestions(places, typed) {
      weatherSuggestions.innerHTML = '';
      places.forEach(function (place) {
        const option = document.createElement('button');
        option.type = 'button';
        option.className = 'settings-suggestion focusable';
        option.dataset.focusIndex = '1023';
        option.setAttribute('role', 'option');
        appendMatchHighlight(option, place.name, typed);
        option.addEventListener('click', function () {
          pickWeatherPlace(place);
        });
        weatherSuggestions.appendChild(option);
      });
      weatherSuggestions.hidden = !places.length;
    }

    let weatherLookupSeq = 0;
    let weatherLookupTimer = null;
    function lookUpWeatherPlaces(typed) {
      clearTimeout(weatherLookupTimer);
      const seq = ++weatherLookupSeq;
      if (typed.length < 2) {
        clearWeatherSuggestions();
        weatherStatus.textContent = WEATHER_IDLE_HINT;
        return;
      }
      // Short pause so each keystroke doesn't fire a request.
      weatherLookupTimer = setTimeout(function () {
        weatherStatus.textContent = 'Looking up “' + typed + '”…';
        searchPlaces(typed, 6).then(function (places) {
          if (seq !== weatherLookupSeq) return; // a newer keystroke won
          renderWeatherSuggestions(places, typed);
          weatherStatus.textContent = places.length
            ? 'Close the keyboard, then press ↓ and OK to pick a place (or point and click).'
            : 'No places match “' + typed + '” — check the spelling.';
        }).catch(function () {
          if (seq !== weatherLookupSeq) return;
          weatherStatus.textContent = 'Could not look up places — check the TV is online.';
        });
      }, 300);
    }

    // The TV keyboard doesn't always send `input`; watch every edit signal
    // and only react when the text actually changed.
    ['input', 'keyup', 'change', 'compositionend'].forEach(function (type) {
      weatherSearchInput.addEventListener(type, function () {
        const typed = weatherSearchInput.value.trim();
        if (typed === weatherTyped) return;
        weatherTyped = typed;
        lookUpWeatherPlaces(typed);
      });
    });
    panes.weather.appendChild(weatherSection);

    const inputsSection = document.createElement('section');
    inputsSection.className = 'settings-section';
    inputsSection.innerHTML = '<h3>Fonti</h3><p class="settings-hint">Rinomina le fonti e scegli quelle da mostrare nella vista essenziale. In Live restano disponibili tutte le fonti rilevate.</p>';

    const inputsList = document.createElement('div');
    inputsList.className = 'settings-inputs';
    inputsSection.appendChild(inputsList);
    // Channels chip on the home screen (channels.js): LG's favourite channels
    // (every channel if there are none), all channels, or none.
    const channelsSelect = createOptionStepper('', 1095, [
      {value: 'favourites', label: "Preferiti, oppure tutti"},
      {value: 'all', label: "Tutti i canali"},
      {value: 'off', label: "Disattivato"}
    ], config.launcher.channels === 'all' || config.launcher.channels === 'off'
      ? config.launcher.channels : 'favourites');
    inputsSection.appendChild(labeledControl("Canali TV", channelsSelect));
    const channelsHint = document.createElement('p');
    channelsHint.className = 'settings-hint';
    channelsHint.textContent = 'Apre i canali sintonizzati: scegli un canale oppure guarda il programma in corso.';
    inputsSection.appendChild(channelsHint);
    panes.inputs.appendChild(inputsSection);

    const appsSection = document.createElement('section');
    appsSection.className = 'settings-section';
    appsSection.innerHTML = '<h3>App nel dock</h3><p class="settings-hint">Riordina le app del dock o rimuovi quelle che non usi.</p>';

    // All apps: a tile on the home row that opens every app on the TV.
    const allAppsTileToggle = document.createElement('input');
    allAppsTileToggle.type = 'checkbox';
    allAppsTileToggle.className = 'focusable';
    allAppsTileToggle.dataset.focusIndex = '1190';
    allAppsTileToggle.checked = config.launcher.allAppsTile !== false;
    appsSection.appendChild(labeledControl("Mostra Tutte le app nel dock", allAppsTileToggle));
    const allAppsHint = document.createElement('p');
    allAppsHint.className = 'settings-hint';
    allAppsHint.textContent = "Apre tutte le app installate, anche quelle che non hai aggiunto al dock.";
    appsSection.appendChild(allAppsHint);

    // Number keys: press 1-9 on the remote to open the home row tile at that
    // position (apps.js numbers the tiles and launches by number).
    const numberKeyToggle = document.createElement('input');
    numberKeyToggle.type = 'checkbox';
    numberKeyToggle.className = 'focusable';
    numberKeyToggle.dataset.focusIndex = '1191';
    numberKeyToggle.checked = config.launcher.numberKeyLaunch !== false;
    appsSection.appendChild(labeledControl("Numeri del telecomando per le app", numberKeyToggle));
    const numberKeyHint = document.createElement('p');
    numberKeyHint.className = 'settings-hint';
    numberKeyHint.textContent = 'Premi un numero da 1 a 9 per aprire l’app nella posizione corrispondente del dock. In Live i numeri restano disponibili alla TV.';
    appsSection.appendChild(numberKeyHint);

    const pinnedList = document.createElement('div');
    pinnedList.className = 'settings-pinned-list';
    appsSection.appendChild(pinnedList);

    const addHeading = document.createElement('h4');
    addHeading.className = 'settings-subheading';
    addHeading.textContent = "Aggiungi un’app";
    appsSection.appendChild(addHeading);

    const addHint = document.createElement('p');
    addHint.className = 'settings-hint';
    addHint.textContent = 'Importa le app della Home LG oppure apri l’elenco e premi + accanto a quelle che vuoi nel dock.';
    appsSection.appendChild(addHint);

    // Every app on LG's own home screen in one press, in LG's order, after
    // the ones already here (instead of adding them one by one).
    const importLgBtn = document.createElement('button');
    importLgBtn.type = 'button';
    importLgBtn.className = 'settings-mini-btn focusable';
    importLgBtn.dataset.focusIndex = '1298';
    importLgBtn.textContent = 'Importa tutte le app dalla Home LG';
    appsSection.appendChild(importLgBtn);
    const importLgStatus = document.createElement('p');
    importLgStatus.className = 'settings-hint';
    importLgStatus.hidden = true;
    appsSection.appendChild(importLgStatus);
    let importingLg = false;
    importLgBtn.addEventListener('click', async function () {
      if (importingLg) return;
      importingLg = true;
      // Not disabled while busy: a disabled button drops focus.
      importLgBtn.textContent = 'Reading LG\u2019s home screen\u2026';
      importLgStatus.hidden = false;
      importLgStatus.textContent = '';
      try {
        const points = await listLaunchPoints();
        // Their names and icons, for when the TV can't be asked later.
        rememberApps(points);
        if (!points.length) {
          importLgStatus.textContent = 'Couldn\u2019t read LG\u2019s home screen. It needs root ' +
            '(Homebrew Channel).';
          return;
        }
        const toAdd = lgHomeAppsToAdd(points, pinnedOrder, customApps);
        if (!toAdd.length) {
          importLgStatus.textContent = 'Every app on LG\u2019s home screen is already here.';
          return;
        }
        toAdd.forEach(function (id) { pinnedOrder.push(id); });
        await loadAppsLists(pinnedList, addAppsList, config);
        importLgStatus.textContent = 'Added ' + toAdd.length + (toAdd.length === 1 ? ' app' : ' apps') +
          ' from LG\u2019s home screen, in LG\u2019s order, after the ones you had. Remove or move ' +
          'any of them above, then press Save to keep them.';
      } catch (err) {
        importLgStatus.textContent = 'Couldn\u2019t read LG\u2019s home screen: ' +
          ((err && err.message) || 'it needs root (Homebrew Channel)');
      } finally {
        importingLg = false;
        importLgBtn.textContent = 'Importa tutte le app dalla Home LG';
      }
    });

    // Collapsed by default: with root this lists every installed app, and
    // scrolling past it was the only way to reach the sections below.
    const addAppsToggle = document.createElement('button');
    addAppsToggle.type = 'button';
    addAppsToggle.className = 'settings-mini-btn settings-apps-toggle focusable';
    addAppsToggle.dataset.focusIndex = '1299';
    appsSection.appendChild(addAppsToggle);

    const showHiddenToggle = document.createElement('input');
    showHiddenToggle.type = 'checkbox';
    showHiddenToggle.className = 'focusable';
    showHiddenToggle.dataset.focusIndex = '1280';
    showHiddenToggle.checked = showHiddenApps;
    showHiddenToggle.addEventListener('change', function () {
      showHiddenApps = showHiddenToggle.checked;
      loadAppsLists(pinnedList, addAppsList, config);
    });
    appsSection.appendChild(labeledControl("Mostra app nascoste e di sistema", showHiddenToggle));

    const addAppsList = document.createElement('div');
    addAppsList.className = 'settings-apps';
    appsSection.appendChild(addAppsList);
    panes.apps.appendChild(appsSection);

    let addAppsExpanded = false;
    syncAddAppsToggle = function () {
      const count = addAppsList.querySelectorAll('.settings-app-row').length;
      // No rows: skip the button and show the "all pinned / none found" note.
      addAppsToggle.hidden = !count;
      addAppsList.hidden = !!count && !addAppsExpanded;
      addAppsToggle.textContent = addAppsExpanded
        ? "Nascondi app installate"
        : 'Mostra app installate (' + count + ')';
    };
    addAppsToggle.addEventListener('click', function () {
      addAppsExpanded = !addAppsExpanded;
      syncAddAppsToggle();
    });
    syncAddAppsToggle();

    const customSection = document.createElement('section');
    customSection.className = 'settings-section';
    customSection.innerHTML = '<h3>App personalizzata</h3><p class="settings-hint">Aggiungi un’app tramite il suo ID. Puoi mantenere la sua icona o sceglierne una inclusa.</p>';

    const customAppIdInput = document.createElement('input');
    customAppIdInput.type = 'text';
    customAppIdInput.className = 'settings-text focusable';
    customAppIdInput.dataset.focusIndex = '1400';
    customAppIdInput.placeholder = 'e.g. com.spotify.tv';
    customSection.appendChild(labeledControl("ID app", customAppIdInput));

    const customNameInput = document.createElement('input');
    customNameInput.type = 'text';
    customNameInput.className = 'settings-text focusable';
    customNameInput.dataset.focusIndex = '1401';
    customNameInput.placeholder = 'e.g. Spotify';
    customSection.appendChild(labeledControl("Nome", customNameInput));

    const iconPreview = document.createElement('img');
    iconPreview.className = 'settings-app-icon';
    iconPreview.alt = '';
    iconPreview.hidden = true;

    // '' = the app's own icon, looked up on the TV when the dock is drawn.
    const iconSelect = createOptionStepper(
      '',
      1402,
      [{value: '', label: "Icona dell’app"}].concat(BUILTIN_ICON_CHOICES),
      '',
      function (value) {
        iconPreview.hidden = !value;
        if (value) iconPreview.src = value;
      }
    );

    const iconRow = labeledControl("Icona", iconSelect);
    iconRow.insertBefore(iconPreview, iconRow.lastChild);
    customSection.appendChild(iconRow);

    const addCustomBtn = document.createElement('button');
    addCustomBtn.type = 'button';
    addCustomBtn.className = 'settings-mini-btn settings-add-custom focusable';
    addCustomBtn.dataset.focusIndex = '1403';
    addCustomBtn.textContent = "Aggiungi app";
    addCustomBtn.addEventListener('click', function () {
      const launchId = customAppIdInput.value.trim();
      if (!launchId) {
        if (options.onToast) options.onToast('Enter an App ID first');
        return;
      }

      const id = 'custom:' + Date.now() + '-' + Math.floor(Math.random() * 1000);
      const title = customNameInput.value.trim() || getBuiltinAppTitle(launchId) || launchId;

      customApps.push({id: id, launchId: launchId, title: title, icon: iconSelect.value});
      pinnedOrder.push(id);

      customAppIdInput.value = '';
      customNameInput.value = '';

      loadAppsLists(pinnedList, addAppsList, config);
    });
    customSection.appendChild(addCustomBtn);
    panes.apps.appendChild(customSection);

    const discoverSection = document.createElement('section');
    discoverSection.className = 'settings-section';
    discoverSection.innerHTML = '<h3>Altre app</h3><p class="settings-hint">Cerca le app installate e aggiungile al dock con la loro icona.</p>';

    const scanBtn = document.createElement('button');
    scanBtn.type = 'button';
    scanBtn.className = 'settings-mini-btn settings-scan-btn focusable';
    scanBtn.dataset.focusIndex = '1500';
    scanBtn.textContent = "Cerca app";
    discoverSection.appendChild(scanBtn);

    const discoverIconSelect = createOptionStepper(
      '',
      1501,
      [{value: '', label: "Icona originale dell’app"}].concat(BUILTIN_ICON_CHOICES),
      '',
      null
    );
    discoverSection.appendChild(labeledControl("Icona personalizzata", discoverIconSelect));

    const discoverStatus = document.createElement('p');
    discoverStatus.className = 'settings-hint';
    discoverSection.appendChild(discoverStatus);

    const discoverList = document.createElement('div');
    discoverList.className = 'settings-apps';
    discoverSection.appendChild(discoverList);
    panes.apps.appendChild(discoverSection);

    let discovered = [];

    function inDock(appId) {
      if (pinnedOrder.indexOf(appId) >= 0) return true;
      for (let i = 0; i < customApps.length; i += 1) {
        if (customApps[i].launchId === appId) return true;
      }
      return false;
    }

    function renderDiscoverList() {
      discoverList.innerHTML = '';
      if (!discovered.length) return;

      const available = discovered.filter(function (app) {
        return app && app.id && !inDock(app.id);
      });

      discoverStatus.textContent = available.length
        ? 'Found ' + discovered.length + ' apps.'
        : 'All discovered apps are already in your dock.';

      available.forEach(function (app, index) {
        const row = document.createElement('div');
        row.className = 'settings-app-row';

        if (app.icon) {
          const icon = document.createElement('img');
          icon.className = 'settings-app-icon';
          icon.alt = '';
          icon.addEventListener('error', function () { icon.remove(); });
          lazyLoadIcon(icon, app.icon, discoverList);
          row.appendChild(icon);
        }

        const title = document.createElement('span');
        title.textContent = app.title || app.id;

        const addBtn = document.createElement('button');
        addBtn.type = 'button';
        addBtn.className = 'settings-mini-btn focusable';
        addBtn.dataset.focusIndex = String(1510 + index);
        addBtn.dataset.pointerFocus = 'off';
        addBtn.textContent = '+';
        addBtn.addEventListener('click', function () {
          if (inDock(app.id)) return; // second OK before the list redraws
          const keepFocus = document.activeElement === addBtn;
          const override = discoverIconSelect.value;
          if (override) {
            const id = 'custom:' + Date.now() + '-' + Math.floor(Math.random() * 1000);
            customApps.push({id: id, launchId: app.id, title: app.title || app.id, icon: override});
            pinnedOrder.push(id);
          } else {
            pinnedOrder.push(app.id);
          }
          loadAppsLists(pinnedList, addAppsList, config);
          renderDiscoverList();
          // The next app slides into this row; land on its +.
          if (keepFocus) refocusListButton(discoverList, index, [0]);
        });

        row.appendChild(title);
        row.appendChild(addBtn);
        discoverList.appendChild(row);
      });
    }

    let scanning = false;
    scanBtn.addEventListener('click', async function () {
      if (scanning) return;
      scanning = true;
      scanBtn.disabled = true;
      discoverStatus.textContent = 'Scanning\u2026';
      try {
        discovered = await listInstalledApps({includeHidden: true});
        discovered.sort(function (a, b) {
          return (a.title || a.id).localeCompare(b.title || b.id);
        });
        if (!discovered.length) {
          discoverStatus.textContent = "Nessuna app trovata sulla TV.";
        } else {
          renderDiscoverList();
        }
      } catch (err) {
        discoverStatus.textContent = "Ricerca delle app non riuscita.";
      } finally {
        scanning = false;
        scanBtn.disabled = false;
      }
    });

    // Backup & restore: every Cinema setting to a file on the TV (kept
    // when Cinema is reinstalled) and to a plugged-in USB drive, to move
    // them to another TV. Cinema also keeps copies by itself, before each
    // restore and each update. Backups from other versions restore as far as
    // they fit (config.js, configFromBackup). Needs root (Homebrew Channel).
    const backupSection = document.createElement('section');
    backupSection.className = 'settings-section';
    backupSection.innerHTML = '<h3>Backup e ripristino</h3><p class="settings-hint">Salva preferenze Cinema, app, sfondi, audio e profili. Una copia resta sulla TV; se presente, viene copiata anche su USB. Credenziali e accessi restano su questo dispositivo.</p>';
    const backupActions = document.createElement('div');
    backupActions.className = 'settings-backup-actions';
    const backupBtn = document.createElement('button');
    backupBtn.type = 'button';
    backupBtn.className = 'settings-mini-btn settings-scan-btn focusable';
    backupBtn.dataset.focusIndex = '1590';
    backupBtn.dataset.backupAction = 'backup';
    backupBtn.textContent = "Crea backup";
    const restoreBtn = document.createElement('button');
    restoreBtn.type = 'button';
    restoreBtn.className = 'settings-mini-btn settings-scan-btn focusable';
    restoreBtn.dataset.focusIndex = '1591';
    restoreBtn.dataset.backupAction = 'restore';
    restoreBtn.textContent = "Ripristina backup";
    backupActions.appendChild(backupBtn);
    backupActions.appendChild(restoreBtn);
    backupSection.appendChild(backupActions);
    // Which backup to restore: shown once Restore has found them.
    let backupsFound = [];
    const backupPicker = createOptionStepper('', 1592, [], '', function () {
      showChosenBackup();
    });
    const backupPickRow = labeledControl("Backup da ripristinare", backupPicker);
    backupPickRow.hidden = true;
    backupSection.appendChild(backupPickRow);
    const backupStatus = document.createElement('p');
    backupStatus.className = 'settings-hint';
    backupStatus.textContent = backupNote || lastBackupNote();
    backupNote = '';
    backupSection.appendChild(backupStatus);
    panes.tools.appendChild(backupSection);

    let backupBusy = false;
    function chosenBackup() {
      return backupsFound[parseInt(backupPicker.value, 10)] || null;
    }
    function showChosenBackup() {
      const chosen = chosenBackup();
      if (!chosen) return;
      backupStatus.textContent = compatibilityNote(chosen) + (chosen.readable
        ? ' Press “Restore this backup” to replace your current settings with it; ' +
          'a copy of them is kept first.'
        : '');
    }
    function closeBackupPicker() {
      backupsFound = [];
      backupPickRow.hidden = true;
      restoreBtn.textContent = "Ripristina backup";
    }

    backupBtn.addEventListener('click', async function () {
      if (backupBusy) return;
      backupBusy = true;
      closeBackupPicker();
      // Not disabled while busy: a disabled button drops focus.
      backupBtn.textContent = "Creazione backup…";
      backupStatus.textContent = "Creazione backup…";
      try {
        const roots = (await withDeadline(findLoungeRoots(), 4000)) || [];
        const text = settingsBackupText(loadConfig(), {reason: 'manual'});
        const res = await writeSettingsBackup(text, roots[0] || '');
        const savedAt = JSON.parse(text).savedAt;
        const where = res.usb ? 'TV and USB drive' : 'TV';
        try {
          localStorage.setItem(LAST_BACKUP_KEY, JSON.stringify({savedAt: savedAt, where: where}));
        } catch (err) {
          // The note is optional.
        }
        backupStatus.textContent = 'Backed up on ' + backupWhen(savedAt) + ' to the ' + where + '.' +
          (res.usb === false ? ' The USB drive couldn’t be written' +
            (res.usbError ? ' (' + res.usbError + ')' : '') + '.' : '') +
          (res.usb === null ? ' No USB drive plugged in.' : '');
      } catch (err) {
        backupStatus.textContent = 'Backup failed: ' +
          ((err && err.message) || 'it needs root (Homebrew Channel)');
      } finally {
        backupBusy = false;
        backupBtn.textContent = "Crea backup";
      }
    });

    restoreBtn.addEventListener('click', async function () {
      if (backupBusy) return;
      backupBusy = true;
      try {
        if (!backupsFound.length) {
          // First press: find the backups and let the user pick one.
          restoreBtn.textContent = "Ricerca…";
          backupStatus.textContent = "Cerco backup sulla TV e su USB…";
          const roots = (await withDeadline(findLoungeRoots(), 4000)) || [];
          backupsFound = listBackups(await readSettingsBackups(roots));
          if (!backupsFound.length) {
            restoreBtn.textContent = "Ripristina backup";
            backupStatus.textContent = "Nessun backup trovato sulla TV o su USB.";
            return;
          }
          backupPicker.setOptions(backupsFound.map(function (b, i) {
            return {value: String(i), label: backupLabel(b)};
          }), '0');
          backupPickRow.hidden = false;
          restoreBtn.textContent = "Ripristina questo backup";
          showChosenBackup();
          return;
        }
        const chosen = chosenBackup();
        if (!chosen || !chosen.readable) return;
        restoreBtn.textContent = "Ripristino…";
        // Keep the current settings first, so this restore can be undone
        // (it shows up as "before your last restore").
        try {
          await writeAutoBackup('before-restore.json',
            settingsBackupText(loadConfig(), {reason: 'before-restore'}));
        } catch (err) {
          restoreBtn.textContent = "Ripristina questo backup";
          backupStatus.textContent = 'Couldn’t keep a copy of your current settings first, so ' +
            'nothing was changed' + (err && err.message ? ': ' + err.message : '.');
          return;
        }
        const result = configFromBackup(chosen.data.config, config);
        if (!result) {
          restoreBtn.textContent = "Ripristina questo backup";
          backupStatus.textContent = "Il backup non contiene preferenze Cinema.";
          return;
        }
        saveConfig(result.config);
        if (options.onSave) options.onSave(result.config);
        backupNote = restoreReport(chosen, result);
        redrawAfterRestore();
      } catch (err) {
        closeBackupPicker();
        backupStatus.textContent = 'Could not look for backups: ' +
          ((err && err.message) || 'it needs root (Homebrew Channel)');
      } finally {
        backupBusy = false;
      }
    });

    // TV check: a root script reports the TV's model, memory, CPU load and
    // background activity, and times how long TV Settings takes to open. The
    // summary is shown with a QR code so it can be sent from a phone.
    const tvCheckSection = document.createElement('section');
    tvCheckSection.className = 'settings-section';
    tvCheckSection.innerHTML = '<h3>Diagnostica TV</h3><p class="settings-hint">Controlla memoria, carico e tempi di apertura delle impostazioni LG. Il controllo apre e chiude le impostazioni della TV e dura circa 40 secondi.</p>';

    const tvCheckBtn = document.createElement('button');
    tvCheckBtn.type = 'button';
    tvCheckBtn.className = 'settings-mini-btn settings-scan-btn focusable';
    tvCheckBtn.dataset.focusIndex = '1600';
    tvCheckBtn.textContent = "Controlla la TV";
    tvCheckSection.appendChild(tvCheckBtn);

    const tvCheckStatus = document.createElement('p');
    tvCheckStatus.className = 'settings-hint';
    tvCheckSection.appendChild(tvCheckStatus);

    const tvCheckResult = document.createElement('div');
    tvCheckResult.className = 'tv-check-result focusable';
    tvCheckResult.dataset.focusIndex = '1601';
    tvCheckResult.tabIndex = 0;
    tvCheckResult.hidden = true;
    const tvCheckText = document.createElement('pre');
    tvCheckText.className = 'tv-check-report';
    const tvCheckQr = document.createElement('div');
    tvCheckQr.className = 'tv-check-qr';
    tvCheckResult.appendChild(tvCheckText);
    tvCheckResult.appendChild(tvCheckQr);
    tvCheckSection.appendChild(tvCheckResult);
    panes.tools.appendChild(tvCheckSection);

    let checking = false;
    tvCheckBtn.addEventListener('click', async function () {
      if (checking) return;
      checking = true;
      // Not disabled: a disabled button drops focus, and Settings would jump
      // back to the top when TV Settings closes.
      tvCheckBtn.textContent = "Controllo…";
      tvCheckResult.hidden = true;
      tvCheckStatus.textContent =
        'Checking… about 40 seconds. TV Settings will open and close by itself, twice ' +
        '(if it stays open, press Exit).';
      try {
        const head = tvCheckHead(getConfig());
        const probe = startLauncherProbe();
        let report;
        try {
          report = await runTvCheck(head);
        } catch (err) {
          probe.stop();
          throw err;
        }
        const probeLine = probe.stop();
        const summary = tvCheckSummary(report, head) + '\n' + probeLine;
        // Also into the saved report, which is what people usually send.
        execRoot('printf \'%s\\n\' \'' + probeLine.replace(/'/g, '') +
          '\' >> /tmp/launch-home-diagnostics.txt').catch(function () { /* optional */ });
        tvCheckText.textContent = summary;
        tvCheckQr.innerHTML = qrSvgMarkup(summary);
        tvCheckResult.hidden = false;
        // Some TVs (webOS 9) keep TV Settings open despite the check's close.
        const stuck = /didn.t close by itself/.test(report);
        tvCheckStatus.textContent = (stuck
          ? 'Done, but TV Settings didn\u2019t close by itself on this TV: press Exit or Back ' +
            'to close it. '
          : 'Done. ') + 'Scan the code to copy this text. The full report is in ' +
          '/tmp/launch-home-diagnostics.txt on the TV.';
        focusSettingsControlNow(tvCheckResult);
      } catch (err) {
        tvCheckStatus.textContent = 'TV check failed: ' +
          ((err && err.message) || 'it needs root (Homebrew Channel)');
      } finally {
        checking = false;
        tvCheckBtn.textContent = "Controlla la TV";
      }
    });

    saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'settings-save focusable';
    saveBtn.dataset.focusIndex = '899';
    saveBtn.textContent = "Salva";
    saveBtn.addEventListener('click', function () {
      // AI tab: send the voice service its settings only.
      if (activeSettingsTab === 'ai') {
        const payload = {
          ai_provider: (aiProviderSelect && aiProviderSelect.value) || 'xai',
          overlay_auto_dismiss_sec: parseInt(aiDismissSelect.value, 10) || 8,
          auth_mode: (aiAuthModeSelect && aiAuthModeSelect.value) || 'API_KEY'
        };
        // Model / language choices: only what the service offered and the
        // user has; the service keeps its own defaults.
        [
          [aiSttSelect, 'stt_language'],
          [aiChatSelect, 'chat_model'],
          [aiVoiceModelSelect, 'voice_model'],
          [aiGeminiModelSelect, 'gemini_model'],
          [aiGeminiSttSelect, 'gemini_stt_model'],
          [aiOpenRouterModelSelect, 'openrouter_model'],
          [aiOpenRouterSttSelect, 'openrouter_stt_model']
        ].forEach(function (pair) {
          if (pair[0] && pair[0].value) payload[pair[1]] = pair[0].value;
        });
        const key = (aiApiKeyInput.value || '').trim();
        // Hidden Grok key field must not toast xAI/SuperGrok token warnings
        // when Gemini or OpenRouter is the selected assistant.
        if (key && isGrokProvider()) {
          if (key.indexOf('xai-') !== 0 && key.indexOf('eyJ') !== 0) {
            if (options.onToast) {
              options.onToast('Grok key should start with xai- (or paste a SuperGrok token)');
            }
            return;
          }
          payload.xai_api_key = key;
        }
        const gemKey = (aiGeminiKeyInput.value || '').trim();
        if (gemKey) {
          payload.gemini_api_key = gemKey;
        }
        const orKey = ((aiOpenRouterKeyInput && aiOpenRouterKeyInput.value) || '').trim();
        if (orKey) {
          payload.openrouter_api_key = orKey;
        }
        saveBtn.disabled = true;
        saveBtn.textContent = "Salvataggio…";
        setVoiceConfig(payload).then(function (res) {
          if(options.onCustomSave){options.onCustomSave(config);saveConfig(config);}
          saveBtn.disabled = false;
          saveBtn.textContent = "Salva";
          if (res && res.restarting) {
            if (options.onToast) options.onToast('AI settings saved — restarting voice…');
          } else if (options.onToast) {
            options.onToast('AI settings saved');
          }
          aiApiKeyInput.value = '';
          aiGeminiKeyInput.value = '';
          if (aiOpenRouterKeyInput) aiOpenRouterKeyInput.value = '';
          loadAiTab();
        }).catch(function (err) {
          saveBtn.disabled = false;
          saveBtn.textContent = "Salva";
          if (options.onToast) {
            options.onToast((err && err.message) || 'Could not save AI settings');
          }
        });
        return;
      }

      config.profile = profileSelect.value;
      config.background.source = sourceSelect.value;
      config.background.mode = displaySelect.value;
      config.background.preset = presetSelect.value;
      config.background.builtin = selectedBuiltinId || '';
      config.background.aerial = selectedAerialId || '';
      config.background.file = usbFileInput.value.trim();
      // Online catalog is independent of built-in; only apply when source is url.
      config.background.remote = selectedRemoteId || '';
      config.background.url = urlInput.value.trim();
      // Keep remote id aligned when the URL still matches a catalog entry.
      if (config.background.url) {
        const match = findRemoteBackgroundByUrl(config.background.url);
        if (match) config.background.remote = match.id;
      } else if (selectedRemoteId) {
        const picked = findRemoteBackgroundById(selectedRemoteId);
        if (picked) {
          config.background.url = picked.url;
          config.background.remote = picked.id;
        }
      }
      config.background.urls = parseUrlList(urlsInput.value);
      config.background.slideshowIntervalSec = Number(intervalInput.value) || 300;
      config.background.kenBurns = kenBurnsToggle.checked;
      config.background.shuffle = bgShuffleToggle.checked;
      config.background.overlayOpacity = Number(overlayRange.value) / 100;
      config.background.dimming = Number(dimRange.value) / 100;

      config.music.enabled = musicEnabled.checked;
      config.music.showBar = showMusicBar.checked;
      config.music.source = musicSourceSelect.value;
      config.music.builtin = builtinTrackSelect.value;
      // Empty array = all built-ins; otherwise only ticked ids.
      let pickedBuiltin = enabledBuiltinIds();
      if (!pickedBuiltin.length && builtinTracks.length) {
        // Don't allow empty playlist — keep the start track (or first).
        pickedBuiltin = [builtinTrackSelect.value || builtinTracks[0].id];
      }
      config.music.builtinPlaylist =
        pickedBuiltin.length === builtinTracks.length ? [] : pickedBuiltin;
      config.music.path = musicPathInput.value.trim();
      // Empty = all USB tracks found; otherwise only ticked urls.
      let pickedUsb = [];
      usbTrackEntries.forEach(function (entry) {
        const url = entry && entry.url;
        if (url && usbSelected[url]) pickedUsb.push(url);
      });
      if (!pickedUsb.length && usbTrackEntries.length) {
        pickedUsb = [usbTrackEntries[0].url];
      }
      config.music.usbPlaylist =
        usbTrackEntries.length && pickedUsb.length === usbTrackEntries.length
          ? []
          : pickedUsb;
      config.music.shuffle = shuffleToggle.checked;
      config.music.repeat = repeatSelect.value;
      config.music.volume = Number(musicVolume.value) / 100;

      // null = "Don't change" (leave the TV volume alone).
      const homeLevel = parseInt(volumeAtHomeSelect.value, 10);
      config.launcher.volumeAtHome = isNaN(homeLevel) ? null : homeLevel;
      const appLevel = parseInt(volumeOnAppSelect.value, 10);
      config.launcher.volumeOnAppLaunch = isNaN(appLevel) ? null : appLevel;
      config.launcher.customScreensaver = customSsToggle.checked;
      config.launcher.customScreensaverMinutes = parseInt(customSsIdle.value, 10);
      config.launcher.screensaverPowerOffHours = parseInt(ssPowerOff.value, 10) || 0;
      if (isNaN(config.launcher.customScreensaverMinutes) ||
          config.launcher.customScreensaverMinutes < 1) {
        config.launcher.customScreensaverMinutes = 5;
      }
      config.launcher.customScreensaverSlideSec = parseInt(customSsSlide.value, 10);
      if (isNaN(config.launcher.customScreensaverSlideSec) ||
          config.launcher.customScreensaverSlideSec < 8) {
        config.launcher.customScreensaverSlideSec = 20;
      }
      config.launcher.customScreensaverShowClock = customSsClock.checked;
      config.launcher.customScreensaverShowDate = customSsDate.checked;
      config.launcher.screensaverMinutes = coerceScreensaverMinutes(
        parseInt(screensaverSelect.value, 10)
      );
      // Keep system saver from firing before the in-app one.
      if (config.launcher.customScreensaver &&
          config.launcher.screensaverMinutes > 0 &&
          config.launcher.screensaverMinutes < 30) {
        config.launcher.screensaverMinutes = 30;
      }
      config.launcher.showClock = showClockToggle.checked;
      config.launcher.clockFormat = clockFormatSelect.value === '12' ? '12' : '24';
      config.launcher.showDate = showDateToggle.checked;
      config.launcher.clockAlign = clockAlignSelect.value || 'center';
      // Normalise unknown legacy values to centre top.
      if (['left', 'center', 'center-middle', 'right'].indexOf(config.launcher.clockAlign) < 0) {
        config.launcher.clockAlign = 'center';
      }
      config.launcher.clockSize = clockSizeSelect.value || 'large';
      config.launcher.timezone = timezoneSelect.value;
      config.launcher.iconSize = iconSizeSelect.value;
      config.launcher.dockStyle = dockStyleSelect.value === 'compact' ? 'compact' : 'wide';
      config.launcher.dockInputs = !!dockInputsToggle.checked;
      config.launcher.iconAlign = iconAlignSelect.value;
      config.launcher.iconLayout = iconLayoutSelect.value;
      config.launcher.iconsPerRow = parseInt(iconsPerRowSelect.value, 10) || 7;
      config.launcher.bundledIcons = bundledIconsToggle.checked;
      config.launcher.perfMode = perfModeToggle.checked;
      config.launcher.allAppsTile = allAppsTileToggle.checked;
      config.launcher.numberKeyLaunch = numberKeyToggle.checked;
      config.launcher.glassTint = glassSelect.value || 'light';
      config.launcher.glassBorder = glassBorderSelect.value || 'white';
      config.launcher.focusColour = focusColourSelect.value || 'warm';
      config.launcher.launchOnHome = launchOnHomeToggle.checked;
      // Keep legacy key in sync so older builds / USB config still work.
      config.launcher.returnOnAppExit = launchOnHomeToggle.checked;
      config.launcher.bootOnStart = bootToggle.checked;
      config.launcher.pinnedApps = pinnedOrder.slice();
      config.launcher.customApps = customApps.slice();
      config.weather = {
        enabled: weatherToggle.checked,
        units: weatherUnitsSelect.value === 'f' ? 'f' : 'c',
        location: Object.assign({}, weatherPlace)
      };

      if(inputSettingsReady)saveInputSettings(inputsList, config);
      config.launcher.channels = channelsSelect.value;

      if(options.onCustomSave)options.onCustomSave(config);
      saveConfig(config);
      if (options.onSave) options.onSave(config);
      if (config.launcher.launchOnHome && options.onToast) {
        options.onToast('Enabling Home → Cinema watcher…');
      } else if (config.launcher.bootOnStart && options.onToast) {
        options.onToast('Enabling boot on TV start…');
      }
      hide();
    });
    headerActions.insertBefore(saveBtn, closeBtn);
    const footer=document.createElement('div');footer.className='settings-footer';
    footer.innerHTML='<span><strong>↑ ↓</strong> Scorri &nbsp; <strong>OK</strong> Seleziona &nbsp; <strong>← →</strong> Regola &nbsp; <strong>Indietro</strong> Torna</span><span>Salva per applicare le modifiche</span>';panel.appendChild(footer);

    await withDeadline(loadInputSettings(inputsList, config).then(function(){inputSettingsReady=true;}), 6000);
    if (gen !== renderGen || !visible) return;
    await withDeadline(loadAppsLists(pinnedList, addAppsList, config), 8000);
    if (gen !== renderGen || !visible) return;
    attachInputScrollHelpers(body);
    // Voice service is loaded when its category is opened.
    decorateSettings(panel);
  }

  function inputSettingsRow(device, index, checked, label, added) {
    const row = document.createElement('div');
    row.className = 'settings-input-row';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'focusable';
    checkbox.dataset.focusIndex = String(1100 + index * 2);
    checkbox.dataset.inputId = device.id;
    if (added) checkbox.dataset.added = '1';
    checkbox.checked = checked;

    const labelInput = document.createElement('input');
    labelInput.type = 'text';
    labelInput.className = 'settings-text focusable';
    labelInput.dataset.focusIndex = String(1101 + index * 2);
    labelInput.dataset.inputId = device.id;
    labelInput.placeholder = device.label || device.id.replace(/_/g, ' ');
    labelInput.value = label || '';

    const name = document.createElement('span');
    name.className = 'settings-input-name';
    name.textContent = device.label || device.id;

    row.appendChild(checkbox);
    row.appendChild(name);
    row.appendChild(labelInput);
    return row;
  }

  // Inputs the TV didn't list that can be added by hand: HDMI ports up to 4
  // (or the highest it listed) and Live TV.
  function addableInputs(devices) {
    const listed = {};
    let maxHdmi = 4;
    devices.forEach(function (d) {
      listed[d.id] = true;
      const m = /^HDMI_(\d+)$/.exec(d.id || '');
      if (m) maxHdmi = Math.max(maxHdmi, Number(m[1]));
    });
    const out = [];
    for (let n = 1; n <= maxHdmi; n += 1) {
      if (!listed['HDMI_' + n]) out.push(inputFromId('HDMI_' + n));
    }
    if (!devices.some(function (d) { return isTvInputId(d.id); })) out.push(inputFromId('TV'));
    return out;
  }

  async function loadInputSettings(container, config) {
    const added = config.launcher.addedInputs || [];
    const devices = await fetchInputDevices(!!(options.hasTvChannels && options.hasTvChannels()), added);
    const allowed = config.launcher.inputs || DEFAULT_INPUTS.slice();
    const labels = config.launcher.inputLabels || {};

    devices.forEach(function (device, index) {
      container.appendChild(inputSettingsRow(device, index, allowed.indexOf(device.id) >= 0,
        labels[device.id], added.indexOf(device.id) >= 0));
    });

    // Some TVs list fewer HDMI ports to an app than they have, and without
    // root (Homebrew Channel) Live TV may not be offered: add one by hand.
    const addable = addableInputs(devices);
    if (!addable.length) return;
    const addRow = document.createElement('div');
    addRow.className = 'settings-input-add';
    const addName = document.createElement('span');
    addName.className = 'settings-input-name';
    addName.textContent = "Aggiungi una fonte";
    addRow.appendChild(addName);
    addable.forEach(function (device, i) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'settings-mini-btn focusable';
      btn.dataset.focusIndex = String(1190 + i);
      btn.textContent = '+ ' + device.label;
      btn.addEventListener('click', function () {
        const rows = container.querySelectorAll('.settings-input-row').length;
        const row = inputSettingsRow(device, rows, true, '', true);
        container.insertBefore(row, addRow);
        btn.parentNode.removeChild(btn);
        if (!addRow.querySelector('button')) addRow.parentNode.removeChild(addRow);
        // The pressed button is gone: go to the new input's tick.
        focusSettingsControlNow(row.querySelector('input[type=checkbox]'));
      });
      addRow.appendChild(btn);
    });
    container.appendChild(addRow);
  }

  function saveInputSettings(container, config) {
    const allowed = [];
    const labels = {};
    const added = [];

    container.querySelectorAll('.settings-input-row').forEach(function (row) {
      const checkbox = row.querySelector('input[type=checkbox]');
      const labelInput = row.querySelector('input[type=text]');
      const inputId = checkbox.dataset.inputId;

      if (checkbox.checked) allowed.push(inputId);
      // An added input stays listed while ticked; untick it to take it away.
      if (checkbox.checked && checkbox.dataset.added === '1') added.push(inputId);
      if (labelInput.value.trim()) labels[inputId] = labelInput.value.trim();
    });

    // Empty array is intentional ("show no inputs"). Do not fall back to defaults.
    config.launcher.inputs = allowed;
    config.launcher.inputLabels = labels;
    config.launcher.addedInputs = added;
  }

  async function loadAppsLists(pinnedListEl, addContainer, config) {
    // The old list stays up (and keeps focus) until the new one is ready; it
    // is cleared just before the synchronous rebuild below.
    const catalog = await loadAppCatalog();
    installedCatalog = catalog;
    const listed = await listInstalledApps({includeHidden: true});
    const apps = listed.filter(function (app) { return !app.hidden; });
    appsByIdMap = Object.assign({}, catalog);
    apps.forEach(function (app) {
      appsByIdMap[app.id] = app;
    });

    customApps.forEach(function (entry) {
      if (!entry || !entry.id) return;
      appsByIdMap[entry.id] = {
        id: entry.id,
        launchId: entry.launchId,
        title: entry.title || entry.launchId || entry.id,
        icon: entry.icon || (appsByIdMap[entry.launchId] && appsByIdMap[entry.launchId].icon) || ''
      };
    });

    for (let i = 0; i < pinnedOrder.length; i += 1) {
      const appId = pinnedOrder[i];
      if (findCustomApp(appId)) continue;
      if (!appsByIdMap[appId] || !appsByIdMap[appId].title || !appsByIdMap[appId].icon) {
        appsByIdMap[appId] = await resolvePinnedApp(appId, appsByIdMap);
      }
    }

    KNOWN_BUILTIN_APPS.forEach(function (id) {
      if (appsByIdMap[id] && appsByIdMap[id].title) return;
      appsByIdMap[id] = {
        id: id,
        title: getBuiltinAppTitle(id) || id,
        icon: getBuiltinAppIcon(id) || ''
      };
    });

    pinnedContainer = pinnedListEl;
    // Redrawn after a + elsewhere: keep focus if the user is in this list.
    let pinnedSpot = null;
    const oldRows = pinnedListEl.querySelectorAll('.settings-pinned-row');
    for (let r = 0; r < oldRows.length; r += 1) {
      const btns = Array.prototype.slice.call(oldRows[r].querySelectorAll('.settings-mini-btn'));
      const b = btns.indexOf(document.activeElement);
      if (b >= 0) pinnedSpot = {row: r, button: b};
    }
    renderPinnedList(pinnedListEl);
    if (pinnedSpot) refocusListButton(pinnedListEl, pinnedSpot.row, [pinnedSpot.button, 0, 1, 2]);

    const seen = {};
    const candidates = [];
    apps.forEach(function (app) {
      if (app && app.id && !seen[app.id]) {
        seen[app.id] = true;
        candidates.push(app);
      }
    });
    // Hidden and system apps only on request: with root the TV lists every
    // installed app, and the list ran to hundreds of rows.
    if (showHiddenApps) {
      listed.forEach(function (app) {
        if (app && app.id && !seen[app.id]) {
          seen[app.id] = true;
          candidates.push(app);
        }
      });
    }
    // The TV's list couldn't be read (no root): offer the apps Cinema knows.
    if (!listed.length) {
      KNOWN_BUILTIN_APPS.forEach(function (id) {
        const app = appsByIdMap[id];
        if (app && app.title && !seen[id]) {
          seen[id] = true;
          candidates.push(app);
        }
      });
    }

    candidates.sort(function (a, b) {
      return (a.title || a.id).localeCompare(b.title || b.id);
    });

    const customLaunchIds = {};
    customApps.forEach(function (entry) {
      if (entry && entry.launchId) customLaunchIds[entry.launchId] = true;
    });

    const remaining = candidates.filter(function (app) {
      return pinnedOrder.indexOf(app.id) < 0 && !customLaunchIds[app.id];
    });

    addContainer.innerHTML = '';
    if (!remaining.length) {
      const empty = document.createElement('p');
      empty.className = 'settings-hint';
      empty.textContent = candidates.length
        ? 'All available apps are already pinned.'
        : 'No other apps were found on this TV.';
      addContainer.appendChild(empty);
    }

    remaining.forEach(function (app, index) {
      const row = document.createElement('div');
      row.className = 'settings-app-row';

      if (app.icon) {
        const icon = document.createElement('img');
        icon.className = 'settings-app-icon';
        icon.alt = '';
        icon.addEventListener('error', function () { icon.remove(); });
        lazyLoadIcon(icon, app.icon, addContainer);
        row.appendChild(icon);
      }

      const title = document.createElement('span');
      title.textContent = app.title || app.id;

      const addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.className = 'settings-mini-btn focusable';
      addBtn.dataset.focusIndex = String(1300 + index);
      addBtn.dataset.pointerFocus = 'off';
      addBtn.textContent = '+';
      addBtn.addEventListener('click', function () {
        if (pinnedOrder.indexOf(app.id) >= 0) return; // second OK before the redraw
        const keepFocus = document.activeElement === addBtn;
        pinnedOrder.push(app.id);
        loadAppsLists(pinnedListEl, addContainer, config).then(function () {
          // The next app slides into this row; land on its + (unless the
          // user already moved on while the list was loading).
          if (keepFocus && !panel.contains(document.activeElement)) {
            refocusListButton(addContainer, index, [0]);
          }
        });
      });

      row.appendChild(title);
      row.appendChild(addBtn);
      addContainer.appendChild(row);
    });
    if (syncAddAppsToggle) syncAddAppsToggle();
  }

  return {
    show: show,
    hide: hide,
    isVisible: function () { return visible; },
    handleBack: function () {
      const modal = panel && panel.querySelector('.ai-oauth-modal:not([hidden])');
      if (modal) {
        const cancelBtn = modal.querySelector('.ai-oauth-modal-cancel');
        if (cancelBtn) cancelBtn.click();
        else modal.hidden = true;
        return true;
      }
      // Back from inside a category goes to the category list; Back on the
      // list (or the header) closes Settings.
      const active = document.activeElement;
      if (active && active.closest && active.closest('.settings-tab-pane')) {
        const tab = panel.querySelector('.settings-tab.active');
        if (tab) {
          focusSettingsControlNow(tab);
          return true;
        }
      }
      return false;
    }
  };
}
