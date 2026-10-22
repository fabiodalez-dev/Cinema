import {mountCinemaSettings, cinemaDraft, normalizeCinemaPrefs} from './cinema-settings.js';
import {createLivePreview, liveDevices} from './cinema-live.js';
import nativeCatalog from '../../assets/native-icons/catalog.json';
import {request} from './cinema-jellyfin.js';
import {execRoot} from './luna.js';
import {createJellyfinClient, validConnection} from './cinema-jellyfin.js';

const PREFS = 'launch-home.cinema.v1';
const CACHE = 'launch-home.cinema.media.v1';
const PRIVATE_CONNECTION = '/var/lib/launch-home-cinema/jellyfin.json';
function read(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch (_) { return fallback; } }
function write(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (_) { return false; } }
function el(tag, cls, text) { const n = document.createElement(tag); n.className = cls || ''; if (text) n.textContent = text; return n; }
function timeout(p, ms) { return Promise.race([p, new Promise(function (_, reject) { setTimeout(function () { reject(new Error('Timeout')); }, ms); })]); }

export function createCinematic(host) {
  // Real TV icons are a small bundled fallback; runtime scans still find installed updates.
  const appMemory=read('lounge.apps.v1',{});
  Object.keys(nativeCatalog).forEach(function(id){if(!appMemory[id])appMemory[id]=nativeCatalog[id];});
  write('lounge.apps.v1',appMemory);
  const prefs = normalizeCinemaPrefs(Object.assign({},read(PREFS, {}),host.getConfig().cinema||{}));
  let cached = read(CACHE, {items: [], resume: [], at: 0});
  let items = [], hero = null, client = null, connection = null, busy = false;
  let currentTab = 'home', generation = 0, imageGeneration = 0, lastRefresh = 0;
  const root = document.getElementById('app');
  const backdrop = el('div', 'cinema-backdrop');
  backdrop.id = 'cinema-backdrop'; backdrop.setAttribute('aria-hidden', 'true');
  root.insertBefore(backdrop, root.children[1]);
  const scrim = el('div', 'cinema-scrim'); root.insertBefore(scrim, backdrop.nextSibling);
  const nav = el('nav', 'cinema-nav'); nav.id = 'cinema-nav'; nav.setAttribute('aria-label', 'Navigazione');
  const top = document.querySelector('.top-bar'); top.appendChild(nav);
  const status = el('span', 'cinema-status', 'Home locale'); status.id = 'cinema-status';
  top.appendChild(status);
  const tabs = [ ['search', '⌕'], ['home', 'Per te'], ['movies', 'Film'], ['series', 'Serie'], ['music', 'Musica'], ['discover', 'Scopri'], ['live', 'Live'], ['apps', 'App'] ];
  tabs.forEach(function (tab, i) {
    const b = button(tab[1], 'cinema-tab', 150 + i, function () { selectTab(tab[0]); });
    b.dataset.cinemaTab = tab[0]; b.setAttribute('aria-label', tab[0] === 'search' ? 'Cerca in Jellyfin' : tab[1]);
    if (tab[0] === 'search') b.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M16 16l5 5"/></svg>';
    if (tab[0] === 'home') b.classList.add('selected'); nav.appendChild(b);
  });
  const featured = el('section', 'cinema-hero'); featured.id = 'cinema-hero';
  featured.setAttribute('aria-label', 'In evidenza');
  const kicker = el('div', 'cinema-kicker', 'LA TUA TV');
  const title = el('h1', 'cinema-title', 'Il tuo cinema.\nA casa.');
  const meta = el('div', 'cinema-meta', 'App, film e ingressi. Tutto a portata di telecomando.');
  const description = el('p', 'cinema-description', 'Apri Jellyfin per la tua libreria, scegli un’app dal dock oppure passa alla TV e agli ingressi HDMI.');
  const actions = el('div', 'cinema-actions'); actions.id = 'cinema-actions';
  const play = button('▶  Apri Jellyfin', 'cinema-primary', 200, function () { openMedia(hero); });
  const library = button('La mia libreria', 'cinema-secondary', 201, function () { openMedia(null); });
  actions.appendChild(play); actions.appendChild(library);
  [kicker,title,meta,description,actions].forEach(function (n) { featured.appendChild(n); }); root.appendChild(featured);
  const section = el('section', 'cinema-media'); section.id = 'cinema-media';
  const heading = el('div', 'cinema-rail-heading');
  const railTitle = el('h2', '', 'Le tue scorciatoie');
  const railInfo = el('span', '', 'Sempre disponibili'); heading.appendChild(railTitle); heading.appendChild(railInfo);
  const rail = el('div', 'cinema-rail'); rail.id = 'cinema-rail';
  section.appendChild(heading); section.appendChild(rail); root.appendChild(section);
  const search = el('div', 'cinema-search'); search.id = 'cinema-search'; search.hidden = true;
  const searchInput = el('input', 'focusable'); searchInput.type = 'search'; searchInput.placeholder = 'Cerca un film o una serie';
  searchInput.setAttribute('aria-label', 'Titolo da cercare'); searchInput.dataset.focusIndex = '180';
  const searchBtn = button('Cerca', 'cinema-secondary', 181, function () { runSearch(); });
  const searchClose = button('Chiudi', 'cinema-secondary', 182, function () { search.hidden = true; host.focus.focusElement(nav.children[0]); });
  search.appendChild(searchInput); search.appendChild(searchBtn); search.appendChild(searchClose); root.appendChild(search);
  searchInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.keyCode === 13) { e.preventDefault(); e.stopPropagation(); runSearch(); }
    else if (e.key === 'Escape' || e.keyCode === 461) { e.preventDefault(); e.stopPropagation(); search.hidden=true; host.focus.focusElement(nav.children[0]); }
    else if (e.key !== 'ArrowDown') e.stopPropagation();
  });

  const livePanel=el('section','cinema-live-controls');livePanel.id='cinema-live-controls';
  livePanel.setAttribute('aria-label','TV in diretta e fonti');
  const liveName=el('h1','','Live TV');
  const liveStatus=el('p','','');liveStatus.setAttribute('role','status');
  const liveSources=el('div','cinema-live-sources');liveSources.id='cinema-live-sources';
  const liveActions=el('div','cinema-live-actions');liveActions.id='cinema-live-actions';
  const fullScreen=button('Schermo intero','cinema-primary',280,function(){
    suspendLive();host.beforeLaunch();host.switchInput(liveDevice.id,liveDevice).catch(function(){host.showToast('Impossibile aprire la fonte.');resumeLive();});
  });
  liveActions.appendChild(fullScreen);
  liveActions.appendChild(button('Riprova','cinema-secondary',281,function(){startLive(liveDevice);}));
  if(host.openChannels)liveActions.appendChild(button('Canali','cinema-secondary',282,host.openChannels));
  [liveName,liveStatus,liveSources,liveActions].forEach(function(n){livePanel.appendChild(n);});root.appendChild(livePanel);
  let liveDevice={id:'TV',label:'Live TV',appId:'com.webos.app.livetv'};
  const livePreview=createLivePreview(root,{supported:!!window.PalmSystem,onStatus:function(text,state){
    liveStatus.textContent=text;livePanel.dataset.state=state;
  }});
  function isLive(){return prefs.enabled&&currentTab==='live';}
  function suspendLive(){livePreview.stop();}
  function resumeLive(){if(isLive()&&!document.hidden)startLive(liveDevice);}
  function renderLiveSources(){
    const labels=(host.getConfig().launcher||{}).inputLabels||{};
    const focused=document.activeElement&&document.activeElement.dataset.liveSource;
    liveSources.innerHTML='';
    liveDevices(host.getInputs(),labels).forEach(function(device,i){
      const b=button(device.label,'cinema-secondary cinema-source',250+i,function(){startLive(device);});
      b.dataset.liveSource=device.id;liveSources.appendChild(b);
    });
    liveSources.querySelectorAll('button').forEach(function(b){
      const selected=b.dataset.liveSource===liveDevice.id;b.classList.toggle('selected',selected);b.setAttribute('aria-pressed',String(selected));
    });
    if(focused){const same=Array.from(liveSources.children).find(function(n){return n.dataset.liveSource===focused;});if(same)host.focus.focusElement(same);}
  }
  function startLive(device){
    liveDevice=device;liveName.textContent=device.label||device.id;
    host.beforePreview();
    livePreview.start(device.id);
    liveSources.querySelectorAll('button').forEach(function(b){
      const selected=b.dataset.liveSource===device.id;b.classList.toggle('selected',selected);b.setAttribute('aria-pressed',String(selected));
    });
  }

  function button(label, cls, index, action) {
    const b = el('button', cls + ' focusable', label); b.type = 'button'; b.dataset.focusIndex = String(index);
    b.addEventListener('click', action); return b;
  }
  function fit() {
    if (!prefs.enabled) { root.style.transform = ''; root.style.left=''; root.style.top=''; return; }
    const scale = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
    root.style.transform = 'scale(' + scale + ')';
    root.style.left = ((window.innerWidth - 1920 * scale) / 2) + 'px'; root.style.top = ((window.innerHeight - 1080 * scale) / 2) + 'px';
  }
  function paintPreferences(){document.body.classList.toggle('cinema-no-motion',prefs.motion===false);document.body.classList.toggle('cinema-live-no-shadow',prefs.liveShadow===false);}
  function persistPreferences(){write(PREFS,prefs);if(host.persistCinemaPrefs)host.persistCinemaPrefs(Object.assign({},prefs));}
  function setEnabled(on) {
    prefs.enabled=!!on; persistPreferences(); document.body.classList.toggle('cinematic', prefs.enabled);
    if(on)resumeLive();else{suspendLive();host.afterPreview();}
    fit(); if(!document.body.classList.contains('settings-open'))host.focus.focusHomeDock();
    host.showToast(on ? 'Interfaccia Cinema attiva' : 'Vista essenziale · tasto giallo per Cinema');
  }
  function setStatus(text, online) { status.textContent=text; status.classList.toggle('online',!!online); }
  function setHero(item) {
    const mark = ++imageGeneration;
    hero = item || null;
    featured.classList.toggle('fallback-hero',!item);
    if (!item) {
      kicker.textContent = currentTab === 'live' ? 'TV E INGRESSI' : 'LA TUA TV';
      title.textContent = currentTab === 'live' ? 'Scegli cosa\nguardare.' : 'Il tuo cinema.\nA casa.';
      title.classList.remove('long');
      meta.textContent = 'App, film e ingressi. Tutto a portata di telecomando.';
      description.textContent = 'Apri Jellyfin per la tua libreria, scegli un’app dal dock oppure passa alla TV e agli ingressi HDMI.';
      play.textContent='▶  Apri Jellyfin'; backdrop.style.backgroundImage=''; return;
    }
    kicker.textContent = item.progress > 0 ? 'RIPRENDI DA DOVE ERI' : 'DALLA TUA LIBRERIA';
    title.textContent=item.title; title.classList.toggle('long',item.title.length>28);
    featured.classList.toggle('two-lines', title.scrollHeight > 135);
    meta.textContent = [item.artist, item.year, item.genres.join(' · '), item.type === 'Series' ? 'Serie TV' : item.type === 'MusicAlbum' ? 'Album' : item.minutes ? item.minutes+' min' : '', item.rating].filter(Boolean).join('   ·   ');
    description.textContent = item.overview || item.episode || 'Disponibile nella tua libreria Jellyfin.';
    play.textContent = item.isMusic ? '▶  Ascolta in Litefin' : item.progress > 0 ? '▶  Riprendi in Litefin' : '▶  Apri in Litefin';
    if (prefs.backdrops && (item.backdrop || item.image)) backdrop.style.backgroundImage = 'url("'+(item.backdrop || item.image)+'")';
    else backdrop.style.backgroundImage='';
    // Only load the focused hero image. At most one large decoded backdrop.
    if (client && prefs.backdrops && !item.backdrop) client.image(item, 1280).then(function (src) {
      if (mark !== imageGeneration || document.hidden) return;
      item.backdrop=src; backdrop.style.backgroundImage='url("'+src+'")'; saveCache();
    }).catch(function () {});
  }
  function mediaCard(item, i) {
    const b=button('', 'cinema-card', 300+i, function () { openMedia(item); }); b.dataset.itemId=item.id;
    b.setAttribute('aria-label', item.title + (item.episode ? ', '+item.episode : ''));
    const img=el('img','cinema-card-image'); img.alt='';
    img.src=item.image || 'assets/backgrounds/1920/mountain-sunset.jpg'; img.onerror=function(){img.onerror=null;img.src='assets/backgrounds/1920/mountain-sunset.jpg';};
    const shade=el('div','cinema-card-shade'); const text=el('div','cinema-card-text');
    text.appendChild(el('strong','',item.title));
    const detail = item.episode ? 'S'+(item.season||1)+' · E'+(item.episodeNumber||1)+' · '+item.episode : [item.year, item.genres[0]].filter(Boolean).join(' · ');
    text.appendChild(el('span','', item.progress>0 && item.remaining ? item.remaining+' min rimasti' : detail));
    if(item.progress>0) {const track=el('div','cinema-progress'); const fill=el('i','');fill.style.width=item.progress+'%';track.appendChild(fill);text.appendChild(track);}
    [img,shade,text].forEach(function(n){b.appendChild(n);});
    b.addEventListener('focus',function(){setHero(item);if(client&&!item.image)client.image(item,480).then(function(src){item.image=src;img.src=src;saveCache();}).catch(function(){});}); return b;
  }
  function showItems(next, label) {
    section.classList.remove('cinema-content-enter');
    requestAnimationFrame(function(){if(!document.hidden)section.classList.add('cinema-content-enter');});
    const oldFocus=document.activeElement; const wasInRail=rail.contains(oldFocus); const oldId=oldFocus&&oldFocus.dataset.itemId;
    items=next.slice(0,12); rail.innerHTML=''; railTitle.textContent=label;
    railInfo.textContent=items.length ? items.length+(items.length===1?' titolo':' titoli') : 'Sempre disponibili';
    if(!items.length) { shortcuts(); setHero(null); return; }
    items.forEach(function(item,i){rail.appendChild(mediaCard(item,i));}); setHero(items[0]);
    if(wasInRail) host.focus.focusElement(Array.from(rail.children).filter(function(n){return n.dataset.itemId===oldId;})[0]||rail.children[0]);
  }
  function shortcuts() {
    rail.innerHTML='';
    const entries=[['Jellyfin','La tua libreria personale','jellyfin',function(){openMedia(null);}],['YouTube AdFree','Video e canali preferiti','youtube',function(){host.openApp('youtube.leanback.v4');}],['TV e HDMI','Canali e dispositivi collegati','inputs',function(){selectTab('live');}],['Tutte le app','Tutte le app installate','apps',host.openApps]];
    entries.forEach(function(a,i){const b=button('','cinema-card cinema-shortcut '+a[2],300+i,a[3]);const icon=el('img','cinema-shortcut-icon'); icon.alt=''; icon.src=['assets/native-icons/org.litefin.app.png','assets/native-icons/youtube.leanback.v4.png','assets/native-icons/com.webos.app.livetv.png','assets/native-icons/org.webosbrew.hbchannel.png'][i]; b.appendChild(icon);b.appendChild(el('strong','',a[0]));b.appendChild(el('span','',a[1]));rail.appendChild(b);});
  }
  function saveCache() {
    // Store bounded media data, never a token. Only the active backdrop is retained.
    const all=cached.items.concat(cached.resume).concat(cached.music||[]);
    all.forEach(function(item){if(!hero||item.id!==hero.id)item.backdrop='';});
    write(CACHE,cached);
  }
  async function hydrate(list, mark) {
    // Two requests at a time; only six thumbnails, no full-library artwork fetch.
    for(let i=0;i<Math.min(list.length,6);i+=2) {
      if(mark!==generation||document.hidden)return;
      await Promise.all(list.slice(i,i+2).map(function(item){
        return client.image(item,480).then(function(src){
          if(mark!==generation)return; item.image=src;
          const card=Array.from(rail.children).filter(function(n){return n.dataset.itemId===item.id;})[0];
          if(card)card.querySelector('img').src=src;
        }).catch(function(){});
      }));
    }
    saveCache();
  }
  async function selectTab(kind) {
    if(kind==='discover'){suspendLive();host.beforeLaunch();host.openApp('org.litefin.app',{cinemaPage:'discover'}).catch(function(){host.showToast('Apri Litefin per cercare e richiedere film con Seerr.');});return;}
    if(kind==='apps'){host.openApps();return;}
    if(kind==='search'){if(currentTab==='live')selectTab('home');search.hidden=false;host.focus.focusElement(searchInput);return;}
    const wasLive=currentTab==='live';
    if(kind!=='live')suspendLive();
    currentTab=kind;nav.querySelectorAll('button').forEach(function(b){const selected=b.dataset.cinemaTab===kind;b.classList.toggle('selected',selected);b.setAttribute('aria-current',selected?'page':'false');});
    const mark=++generation;
    document.body.classList.toggle('cinema-live',kind==='live');
    document.body.classList.toggle('cinema-music',kind==='music');
    if(wasLive&&kind!=='live')host.afterPreview();
    if(kind==='live') {search.hidden=true;renderLiveSources();startLive({id:'TV',label:'Live TV',appId:'com.webos.app.livetv'});host.focus.focusWithin('#cinema-live-sources');return;}
    if(kind==='home'){showItems(cached.resume.length?cached.resume:cached.items,cached.resume.length?'Continua a guardare':'Aggiunti di recente');return;}
    if(!client){if(kind==='music'){showItems(cached.music||[],'La tua musica');return;}showItems(cached.items.filter(function(item){return kind==='movies'?item.type==='Movie':item.type==='Series';}),kind==='movies'?'I tuoi film':'Le tue serie');return;}
    setStatus('Caricamento…',true);
    try {const next=await client.load(kind);if(mark!==generation)return;if(kind==='music'){cached.music=next;saveCache();}showItems(next,kind==='movies'?'I tuoi film':kind==='music'?'La tua musica':'Le tue serie');setStatus(connection.userName||'Jellyfin',true);hydrate(next,mark);}
    catch(_){setStatus('Jellyfin offline',false);if(kind==='music'){showItems(cached.music||[],'La tua musica');return;}showItems(cached.items.filter(function(item){return kind==='movies'?item.type==='Movie':item.type==='Series';}),kind==='movies'?'I tuoi film':'Le tue serie');}
  }
  async function runSearch() {
    const query=searchInput.value.trim(); if(!query)return;
    if(!client){host.showToast('Jellyfin non disponibile. Le app restano accessibili.');return;}
    const mark=++generation;search.hidden=true;setStatus('Ricerca…',true);
    try {const found=await client.load('all',query);if(mark!==generation)return;showItems(found,'Risultati per “'+query+'”');setStatus(found.length?'Jellyfin':'Nessun titolo trovato',true);if(rail.children[0])host.focus.focusElement(rail.children[0]);hydrate(found,mark);}
    catch(_){setStatus('Jellyfin non raggiungibile',false);host.showToast('Ricerca non disponibile. Riprova più tardi.');host.focus.focusElement(nav.children[0]);}
  }
  function openMedia(item) {
    host.beforeLaunch();
    const params=item?{cinemaItemId:item.id,cinemaAction:item.progress>0?'resume':'details'}:{};
    host.openApp('org.litefin.app', params).catch(function(){host.showToast('Litefin non disponibile. Apri Jellyfin dalle app.');});
  }
  async function loadConnection() {
    if (!window.PalmSystem && /^(127\.0\.0\.1|localhost)$/.test(location.hostname)) return request('/preview/connection', '', false);
    const raw=await timeout(execRoot('cat '+PRIVATE_CONNECTION),5000);
    const text=raw.stdoutString||(raw.stdoutBytes?atob(raw.stdoutBytes):'');
    const c=JSON.parse(text);if(!validConnection(c))throw new Error('Jellyfin non configurato');return c;
  }
  async function refresh(force) {
    if(busy||document.hidden||!prefs.enabled||!prefs.jellyfin||(!force&&Date.now()-lastRefresh<60000))return;
    busy=true;lastRefresh=Date.now();const mark=++generation;
    try {
      if(!client){connection=await loadConnection();client=createJellyfinClient(connection);if(cached.userId&&cached.userId!==connection.userId){cached={items:[],resume:[],at:0};showItems([],'Le tue scorciatoie');}}
      const results=await Promise.all([client.load('resume').catch(function(){return null;}),client.load('all')]);
      if(mark!==generation)return;
      cached={items:results[1],resume:results[0]||cached.resume,music:cached.music||[],at:Date.now(),userId:connection.userId};
      setStatus(connection.userName||'Jellyfin',true);
      if(currentTab==='home'){const list=cached.resume.length?cached.resume:cached.items;showItems(list,cached.resume.length?'Continua a guardare':'Aggiunti di recente');hydrate(list,mark);}
      saveCache();
    }catch(_){setStatus(cached.at?'Jellyfin offline':'Jellyfin offline',false);}
    finally{busy=false;}
  }
  function mountSettings(panel) {
    mountCinemaSettings(panel,{
      prefs:prefs, refresh:refresh,
      getInfo:function(){return {online:status.classList.contains('online'),userName:connection&&connection.userName,server:connection&&connection.server.replace(/^https?:\/\//,''),cached:!!cached.at};},
      openLitefin:function(){suspendLive();host.beforeLaunch();host.openApp('org.litefin.app').catch(function(){host.showToast('Litefin non disponibile.');});},
      openDiscover:function(){selectTab('discover');},
      checkSeerr:async function(){if(!connection)connection=await loadConnection();return request(connection.server.replace(/\/+$/,'')+'/Litefin/Seerr/Status',connection.token,false);},
      homeStatus:async function(){
        if(!window.PalmSystem)throw new Error('Solo sulla TV');
        const out=await timeout(execRoot('python -c \'import json; c=json.load(open("/home/root/.config/lginputhook/keybinds.json")); print(json.dumps({"home":c.get("773",{}).get("id")=="org.webosbrew.lounge.launcher"}))\''),5000);
        return JSON.parse(out.stdoutString||(out.stdoutBytes?atob(out.stdoutBytes):''));
      },
      openInputHook:function(){suspendLive();host.beforeLaunch();host.openApp('org.webosbrew.inputhook').catch(function(){host.showToast('LG Input Hook non disponibile.');});}
    });
  }
  function applyPreferences(next){
    const wasLive=isLive(), enabledChanged=next.enabled!==prefs.enabled, jellyfinChanged=next.jellyfin!==prefs.jellyfin, backdropChanged=next.backdrops!==prefs.backdrops;
    Object.assign(prefs,normalizeCinemaPrefs(next));write(PREFS,prefs);
    document.body.classList.toggle('cinematic',prefs.enabled);paintPreferences();fit();
    if(enabledChanged){if(!prefs.enabled){suspendLive();if(wasLive)host.afterPreview();}else resumeLive();}
    if(jellyfinChanged){generation++;if(!prefs.jellyfin){client=null;showItems([],'Le tue scorciatoie');setStatus('Home locale',false);}else refresh(true);}
    if(backdropChanged){if(!prefs.backdrops)backdrop.style.backgroundImage='';else setHero(hero);}
  }
  function applySettings(panel,config){
    const next=cinemaDraft(panel,prefs);config.cinema=normalizeCinemaPrefs(next);applyPreferences(next);
  }
  function syncConfig(config){
    if(config.cinema)applyPreferences(normalizeCinemaPrefs(Object.assign({},prefs,config.cinema)));
  }
  // Yellow is unused upstream; all existing colour-key actions remain intact.
  document.addEventListener('keydown',function(e){if((e.keyCode===405||e.key==='y')&&!document.body.classList.contains('settings-open')&&document.activeElement.tagName!=='INPUT'){e.preventDefault();setEnabled(!prefs.enabled);}});
  document.addEventListener('visibilitychange',function(){if(document.hidden)suspendLive();else{resumeLive();refresh(false);}});
  window.addEventListener('pagehide',suspendLive);
  document.addEventListener('webOSRelaunch',function(){refresh(false);});
  window.addEventListener('resize',fit);
  document.body.classList.toggle('cinematic',prefs.enabled);paintPreferences();fit();
  showItems(prefs.jellyfin?(cached.resume.length?cached.resume:cached.items):[],cached.resume.length?'Continua a guardare':cached.items.length?'Aggiunti di recente':'Le tue scorciatoie');
  if(cached.at)setStatus('Jellyfin offline',false);
  setTimeout(function(){refresh(true);},300);
  return {refresh:refresh,mountSettings:mountSettings,applySettings:applySettings,syncConfig:syncConfig,setEnabled:setEnabled,isLive:isLive,suspendLive:suspendLive,refreshInputs:function(){if(isLive())renderLiveSources();},back:function(){if(!isLive())return false;selectTab('home');host.focus.focusElement(nav.querySelector('[data-cinema-tab=live]'));return true;}};
}
