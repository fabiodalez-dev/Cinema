import {MEDIA_CLIENTS,normalizeMediaClient} from './cinema-clients.js';
import {decorateSettings} from './settings-design.js';
const KEYS=['enabled','jellyfin','backdrops','motion','liveShadow'];
export function normalizeCinemaPrefs(value){const prefs={};KEYS.forEach(function(key){prefs[key]=!value||typeof value[key]!=='boolean'?true:value[key];});prefs.client=normalizeMediaClient(value&&value.client);return prefs;}
function node(tag,cls,text){const n=document.createElement(tag);n.className=cls||'';if(text)n.textContent=text;return n;}
export function mountCinemaSettings(panel,api){
 const pane=panel.querySelector('.settings-tab-pane[data-tab="cinema"]');if(!pane)return;
 let section=pane.querySelector('.cinema-settings');
 if(!section){
  section=node('section','settings-section cinema-settings');pane.appendChild(section);
  section.appendChild(node('h3','','La tua Home'));
  const draft={};
  function toggle(label,key){
   const row=node('div','settings-row');const text=node('span','',label);const input=document.createElement('input');
   input.type='checkbox';input.className='focusable';input.checked=api.prefs[key]!==false;input.dataset.focusIndex=String(940+KEYS.indexOf(key));input.dataset.cinemaPref=key;input.setAttribute('aria-label',label);input.setAttribute('role','switch');
   row.appendChild(text);row.appendChild(input);draft[key]=input;return row;
  }
  section.appendChild(toggle('Interfaccia Cinema','enabled'));
  section.appendChild(toggle('Animazioni leggere','motion'));
  section.appendChild(node('p','settings-hint','Il tasto giallo alterna Cinema e vista essenziale. Le animazioni rispettano anche le preferenze di movimento ridotto del dispositivo.'));
  const media=node('section','settings-section');media.appendChild(node('h3','','Jellyfin'));
  const connection=node('div','cinema-connection');connection.dataset.connection='jellyfin';
  const account=node('strong','','Collegamento Jellyfin');const detail=node('p','','Controllo del server…');connection.appendChild(account);connection.appendChild(detail);media.appendChild(connection);
  function paint(){const info=api.getInfo();account.textContent=info.online?'Collegato a Jellyfin':info.server?'Jellyfin non raggiungibile':'Jellyfin da collegare';connection.dataset.state=info.online?'online':'offline';detail.textContent=[info.userName,info.server].filter(Boolean).join(' · ')||(info.cached?'La cache è disponibile. Puoi continuare ad aprire le app.':'Apri il tuo client Jellyfin per gestire l’accesso.');}
  paint();media.appendChild(toggle('Contenuti nella Home','jellyfin'));media.appendChild(toggle('Sfondi dalla libreria','backdrops'));
  const clientRow=node('div','settings-row');clientRow.appendChild(node('span','','App Jellyfin preferita'));const clientSelect=document.createElement('select');clientSelect.className='focusable';clientSelect.dataset.cinemaClient='true';clientSelect.setAttribute('aria-label','App Jellyfin preferita');[{id:'auto',name:'Automatico'}].concat(MEDIA_CLIENTS).forEach(function(c){const o=document.createElement('option');o.value=c.id;o.textContent=c.name+(c.webos>5?' · webOS '+c.webos+'+':'');clientSelect.appendChild(o);});clientSelect.value=normalizeMediaClient(api.prefs.client);clientRow.appendChild(clientSelect);media.appendChild(clientRow);
  const actions=node('div','cinema-settings-actions');
  function action(label,handler){const b=node('button','settings-button focusable',label);b.type='button';b.dataset.focusIndex='946';b.addEventListener('click',handler);return b;}
  const refresh=action('Aggiorna libreria',async function(){refresh.disabled=true;refresh.textContent='Aggiornamento…';try{await api.refresh(true);}finally{refresh.disabled=false;refresh.textContent='Aggiorna libreria';paint();}});
  actions.appendChild(refresh);actions.appendChild(action('Apri app Jellyfin',function(){api.openLitefin();}));media.appendChild(actions);
  media.appendChild(node('p','settings-hint','Film, serie e album musicali dalla tua libreria. Se il server è offline, restano i contenuti salvati e tutte le app. Gli accessi sono conservati sulla TV.'));pane.appendChild(media);
  const requests=node('section','settings-section');requests.appendChild(node('h3','','Scopri e richieste'));
  const seerr=node('div','cinema-connection');const seerrTitle=node('strong','','Seerr');const seerrDetail=node('p','','Verifica il collegamento del servizio richieste.');seerr.appendChild(seerrTitle);seerr.appendChild(seerrDetail);requests.appendChild(seerr);
  const requestActions=node('div','cinema-settings-actions');requestActions.appendChild(action('Apri Scopri',api.openDiscover));
  const check=action('Verifica Seerr',async function(){check.disabled=true;seerrDetail.textContent='Verifica in corso…';try{const result=await api.checkSeerr();const ok=!!(result.configured&&result.available);seerr.dataset.state=ok?'online':'offline';seerrTitle.textContent=ok?'Seerr disponibile':'Seerr non disponibile';seerrDetail.textContent=ok?'Puoi cercare e richiedere titoli da Scopri in Litefin.':'Apri Litefin e controlla il servizio richieste sul server.';}catch(_){seerr.dataset.state='offline';seerrTitle.textContent='Verifica non riuscita';seerrDetail.textContent='Jellyfin o il servizio richieste non risponde. Le app restano disponibili.';}finally{check.disabled=false;}});requestActions.appendChild(check);requests.appendChild(requestActions);pane.appendChild(requests);
  const live=node('section','settings-section');live.appendChild(node('h3','','Live TV'));
  live.appendChild(toggle('Ombra sui titoli della Live','liveShadow'));
  live.appendChild(node('p','settings-hint','Live avvia subito la TV dietro ai controlli. I comandi scompaiono dopo 10 secondi senza interazioni. Schermo intero li nasconde subito; OK o una freccia li riapre. Nella sezione Live e fonti trovi canali e nomi degli ingressi.'));pane.appendChild(live);
  const remote=node('section','settings-section cinema-remote-settings');remote.appendChild(node('h3','','Telecomando e avvio'));
  const home=node('div','cinema-connection');const homeTitle=node('strong','','Tasto Home');const homeInfo=node('p','','Verifica della rimappatura…');home.appendChild(homeTitle);home.appendChild(homeInfo);remote.appendChild(home);
  api.homeStatus().then(function(result){home.dataset.state=result.home?'online':'offline';homeTitle.textContent=result.home?'Home apre Cinema':'Tasto Home da configurare';homeInfo.textContent=result.home?'Rimappatura diretta attiva con LG Input Hook.':'Apri LG Input Hook per scegliere l’app da aprire con Home.';}).catch(function(){homeInfo.textContent='Verifica non disponibile. Puoi gestire il tasto da LG Input Hook.';});
  remote.appendChild(action('Configura telecomando',api.openInputHook));pane.appendChild(remote);
  panel.__cinemaDraft=draft;
 }
 // The base controller adds boot controls asynchronously; move the same controls, never copies.
 const boot=panel.querySelector('[data-setting="boot"]');const target=pane.querySelector('.cinema-remote-settings');
 if(boot&&target&&!target.contains(boot)){
  const row=boot.closest('.settings-row');const hint=row.nextElementSibling;target.appendChild(row);
  if(hint&&hint.classList.contains('settings-hint'))target.appendChild(hint);
 }
 decorateSettings(panel);
}
export function cinemaDraft(panel,current){
 const next=normalizeCinemaPrefs(current);const controls=panel.__cinemaDraft;
 if(controls)KEYS.forEach(function(key){if(controls[key]&&panel.contains(controls[key]))next[key]=!!controls[key].checked;});
 const clientSelect=panel.querySelector('[data-cinema-client]');if(clientSelect)next.client=normalizeMediaClient(clientSelect.value);
 return next;
}
