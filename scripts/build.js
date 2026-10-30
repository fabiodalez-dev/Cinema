#!/usr/bin/env node

const crypto = require('crypto');
const esbuild = require('esbuild');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {execSync} = require('child_process');

const {readVersion} = require('./read-version');
const {verifyIpk} = require('./verify-ipk');

const root = path.join(__dirname, '..');
const dist = path.join(root, 'dist');

// Dev / source-only assets that must not ship in the .ipk: paths under
// assets/, matched by assetExcluded(). Kept in the repo, left out of the package.
const ASSET_EXCLUDE = [
  /^icon-source(-clay)?\.png$/,
  // Older icon generations — appinfo uses v8 only.
  /^icon-(60|80|130)-v[4-7]\.png$/,
  // Byte-identical copies of the v8 icons appinfo points at. icon.png stays:
  // install2tvfrommacos.sh checks it on the TV.
  /^icon-(60|80|130|large|mini)\.png$/,
  // assets/backgrounds/*.jpg: the 4K originals. The IPK carries the 1920px set
  // (assets/backgrounds/1920/) and these are downloaded from this repo via
  // jsDelivr when performance mode is off (HD_WALLPAPER_BASE in backgrounds.js).
  /^backgrounds\/[^/]+\.jpg$/,
  // Ambient tracks: streamed from jsDelivr on demand (MUSIC_BASE in
  // builtin-music.js); the manifest still ships.
  /^music\/.*\.mp3$/,
  // Fonts ship as WOFF2; the TTF sources stay in the repo.
  /^fonts\/.*\.ttf$/
];

function assetExcluded(rel) {
  const name = rel.split(path.sep).join('/');
  return ASSET_EXCLUDE.some(function (re) { return re.test(name); });
}

/**
 * Copy a file or tree. `skip(rel)` (optional) is asked for each entry with its
 * path relative to `src`, and drops it when true.
 */
function copyRecursive(src, dest, skip, rel) {
  if (!fs.existsSync(src)) return;
  const here = rel || '';
  if (here && skip && skip(here)) return;
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, {recursive: true});
    for (const entry of fs.readdirSync(src)) {
      copyRecursive(path.join(src, entry), path.join(dest, entry), skip, here ? here + '/' + entry : entry);
    }
    return;
  }
  fs.mkdirSync(path.dirname(dest), {recursive: true});
  fs.copyFileSync(src, dest);
}

async function build() {
  const version = readVersion();

  fs.rmSync(dist, {recursive: true, force: true});
  fs.mkdirSync(dist, {recursive: true});

  await esbuild.build({
    entryPoints: [path.join(root, 'src/js/main.js')],
    outfile: path.join(dist, 'main.js'),
    bundle: true,
    format: 'iife',
    target: ['es2015'],
    minify: true,
    legalComments: 'none',
    define: {
      __LOUNGE_VERSION__: JSON.stringify(version)
    }
  });

  copyRecursive(path.join(root, 'src/index.html'), path.join(dist, 'index.html'));
  // Cache-bust asset URLs. webOS WAM caches web resources by URL and ignores
  // the app version bump, so without a changing query string a reinstall keeps
  // serving the previously cached main.js/CSS. ?v=<version>.<content hash>
  // forces a fresh fetch whenever the file changes — including a rebuild that
  // overwrites the same version on the TV.
  const webosLibSrc = path.join(root, 'node_modules/@procot/webostv/webOSTV/index.js');
  function cacheTag(file) {
    if (!fs.existsSync(file)) return version;
    const hash = crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex').slice(0, 8);
    return version + '.' + hash;
  }
  const indexPath = path.join(dist, 'index.html');
  let indexHtml = fs.readFileSync(indexPath, 'utf8');
  indexHtml = indexHtml
    .replace('href="styles/main.css"', 'href="styles/main.css?v=' + cacheTag(path.join(root, 'src/styles/main.css')) + '"')
    .replace('href="styles/settings-cinema.css"', 'href="styles/settings-cinema.css?v=' + cacheTag(path.join(root, 'src/styles/settings-cinema.css')) + '"')
    .replace('href="styles/cinematic.css"', 'href="styles/cinematic.css?v=' + cacheTag(path.join(root, 'src/styles/cinematic.css')) + '"')
    .replace('src="webOS.js"', 'src="webOS.js?v=' + cacheTag(webosLibSrc) + '"')
    .replace('src="main.js"', 'src="main.js?v=' + cacheTag(path.join(dist, 'main.js')) + '"');
  fs.writeFileSync(indexPath, indexHtml);
  copyRecursive(path.join(root, 'src/styles'), path.join(dist, 'styles'));
  copyRecursive(path.join(root, 'assets'), path.join(dist, 'assets'), assetExcluded);
  fs.copyFileSync(path.join(root, 'version.md'), path.join(dist, 'version.md'));

  // Root Home-button watcher + boot-on-start helpers (started via settings / init.d).
  [
    'home-watcher.sh',
    'cinema-litefin-bridge.js',
    'enable-home-watcher.sh',
    'disable-home-watcher.sh',
    'boot-launch.sh',
    'enable-boot-launch.sh',
    'disable-boot-launch.sh',
    // Settings -> TV check (run as root via Homebrew Channel).
    'diagnostics.sh',
    // Home -> Channels chip: Live TV's channel list, now playing, switching.
    'channels.sh',
    // Settings -> AI Voice -> Voice assistant on/off, and its run loop.
    'voice-run.sh',
    'enable-voice.sh',
    'disable-voice.sh',
    // Settings -> TV: root daemon keeping LG's extras off.
    'tvtools.py',
    'update-app.py',
    'failsafe-check.sh',
    // Homebrew Channel watchdog, installed as a boot hook by enable-tvtools.sh.
    'hbchannel-watchdog.sh',
    'enable-tvtools.sh',
    'disable-tvtools.sh',
    // Device-only restore: hooks off, Litefin's HTML back, launcher removed.
    'restore.sh'
  ].forEach(function (name) {
    const src = path.join(root, 'scripts', name);
    if (fs.existsSync(src)) {
      const dest = path.join(dist, name);
      fs.copyFileSync(src, dest);
      try { fs.chmodSync(dest, 0o755); } catch (err) { /* windows */ }
    }
  });

  // Voice assistant: the daemon (run as root by voice-run.sh once voice is
  // turned on) and its settings template. Sources only, no __pycache__.
  const voiceSrc = path.join(root, 'voice');
  const voiceDist = path.join(dist, 'voice');
  fs.mkdirSync(path.join(voiceDist, 'daemon'), {recursive: true});
  for (const name of fs.readdirSync(path.join(voiceSrc, 'daemon'))) {
    if (name.endsWith('.py')) {
      fs.copyFileSync(path.join(voiceSrc, 'daemon', name), path.join(voiceDist, 'daemon', name));
    }
  }
  fs.copyFileSync(path.join(voiceSrc, 'config.example.json'), path.join(voiceDist, 'config.example.json'));

  const appinfo = JSON.parse(fs.readFileSync(path.join(root, 'appinfo.json'), 'utf8'));
  appinfo.version = version;
  fs.writeFileSync(path.join(dist, 'appinfo.json'), JSON.stringify(appinfo, null, 2) + '\n');

  const webosLib = path.join(root, 'node_modules/@procot/webostv/webOSTV/index.js');
  if (!fs.existsSync(webosLib)) {
    throw new Error('Missing @procot/webostv — run npm install');
  }
  fs.copyFileSync(webosLib, path.join(dist, 'webOS.js'));

  console.log('Built dist/');
}

/**
 * Pack the voice card (voice/overlay, app org.webosbrew.lounge.voice) and put
 * it inside Launch Home as voice/card.pkg; enable-voice.sh installs it on the
 * TV. Not named .ipk: ares-package leaves out every *.ipk file.
 */
function packVoiceCard(aresPackage, version) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'launch-home-voice-card-'));
  try {
    const stage = path.join(work, 'app');
    copyRecursive(path.join(root, 'voice/overlay'), stage);
    const cardInfo = JSON.parse(fs.readFileSync(path.join(stage, 'appinfo.json'), 'utf8'));
    cardInfo.version = version;
    fs.writeFileSync(path.join(stage, 'appinfo.json'), JSON.stringify(cardInfo, null, 2) + '\n');
    fs.copyFileSync(path.join(root, 'assets/icon-80-v8.png'), path.join(stage, 'icon.png'));
    const out = path.join(work, 'out');
    fs.mkdirSync(out);
    execSync(`"${aresPackage}" --no-minify -o "${out}" "${stage}"`, {stdio: 'inherit'});
    const ipk = path.join(out, cardInfo.id + '_' + version + '_all.ipk');
    if (!fs.existsSync(ipk)) {
      throw new Error('ares-package did not produce ' + ipk);
    }
    verifyIpk(ipk);
    fs.copyFileSync(ipk, path.join(dist, 'voice', 'card.pkg'));
    fs.writeFileSync(path.join(dist, 'voice', 'card-version'), version + '\n');
  } finally {
    fs.rmSync(work, {recursive: true, force: true});
  }
}

async function main() {
  await build();

  if (process.argv.includes('--pack')) {
    // Use the project-local @webos-tools/cli packager. The older global
    // @webosose/ares-cli writes epoch-zero tar timestamps (1970-01-01) that
    // make pkgverifier fail on webOS 5.x with "-5: ipk verified failed".
    const aresPackage = path.join(root, 'node_modules', '.bin', 'ares-package');
    if (!fs.existsSync(aresPackage)) {
      throw new Error('Missing @webos-tools/cli — run npm install');
    }
    packVoiceCard(aresPackage, readVersion());
    execSync(`"${aresPackage}" --no-minify .`, {cwd: dist, stdio: 'inherit'});

    const packed = JSON.parse(fs.readFileSync(path.join(dist, 'appinfo.json'), 'utf8'));
    const ipkPath = path.join(dist, packed.id + '_' + packed.version + '_all.ipk');
    if (!fs.existsSync(ipkPath)) {
      throw new Error('ares-package did not produce ' + ipkPath);
    }
    verifyIpk(ipkPath);
    const mb = (fs.statSync(ipkPath).size / (1024 * 1024)).toFixed(2);
    console.log('Packaged ' + path.basename(ipkPath) + ' (' + mb + ' MB, file dates and contents verified)');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});