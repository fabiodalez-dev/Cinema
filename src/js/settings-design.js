// Cinema's TV settings shell. Existing service/config controllers stay in place.
export const SETTINGS_CATEGORIES = [
 {id:'cinema',label:'Cinema',sub:'Home, Jellyfin e telecomando',description:'La tua Home. I tuoi contenuti. Il tuo modo di guardare.'},
 {id:'look',label:'Aspetto',sub:'Sfondi, orologio e icone',description:'Scegli lo sfondo e rendi la Home tua.'},
 {id:'apps',label:'App',sub:'Il dock e le app installate',description:'Tieni a portata di telecomando le app che usi di più.'},
 {id:'inputs',label:'Live e fonti',sub:'TV, HDMI e canali',description:'Personalizza le fonti e scegli i tuoi canali.'},
 {id:'music',label:'Audio ambiente',sub:'Brani, playlist e volume',description:'Una colonna sonora per la Home. La musica Jellyfin resta nella scheda Musica.'},
 {id:'system',label:'Sistema',sub:'Avvio, audio e prestazioni',description:'Il comportamento di Cinema e della tua TV.'},
 {id:'screensaver',label:'Salvaschermo',sub:'Attesa, immagini e orologio',description:'Cosa mostrare quando il telecomando riposa.'},
 {id:'weather',label:'Meteo',sub:'Località e previsioni',description:'Le previsioni per il posto che chiami casa.'},
 {id:'ai',label:'Assistente vocale',sub:'Voce, servizi e accesso',description:'Configura il servizio da usare con il tasto voce.'},
 {id:'tools',label:'Gestione',sub:'Backup e diagnostica',description:'Conserva le tue preferenze e controlla la TV.'}
];
const paths={cinema:'M3 5h18v12H3z M8 21h8 M12 17v4 M10 8l5 3-5 3z',look:'M12 3a9 9 0 1 0 0 18h2a2 2 0 0 0 0-4h-1a1.5 1.5 0 0 1 0-3h3a5 5 0 0 0 0-10z M7 9h.01 M10 6h.01 M15 7h.01 M6 13h.01',apps:'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',inputs:'M3 5h18v13H3z M8 22h8 M12 18v4 M7 11h10 M14 8l3 3-3 3',music:'M9 18V5l12-2v13 M9 9l12-2 M9 18a3 3 0 1 1-3-3 3 3 0 0 1 3 3z M21 16a3 3 0 1 1-3-3 3 3 0 0 1 3 3z',system:'M4 7h16 M4 17h16 M8 4v6 M16 14v6',screensaver:'M3 4h18v14H3z M8 22h8 M12 18v4 M6 14l4-5 4 4 3-3 2 4',weather:'M8 16a5 5 0 1 1 9-3 4 4 0 0 1 0 8H8a3 3 0 0 1 0-6 M4 3v2 M1 8h2 M11 3l-1 2',ai:'M9 5a3 3 0 0 1 6 0v7a3 3 0 0 1-6 0z M5 10v2a7 7 0 0 0 14 0v-2 M12 19v3 M8 22h8',tools:'M3 6h18v15H3z M3 6l3-4h12l3 4 M8 11h8 M10 15h4'};
export function settingsIcon(id){
 const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
 for(const pair of [['viewBox','0 0 24 24'],['fill','none'],['stroke','currentColor'],['stroke-width','1.6'],['stroke-linecap','round'],['stroke-linejoin','round'],['aria-hidden','true']])svg.setAttribute(pair[0],pair[1]);
 svg.classList.add('settings-category-icon');const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d',paths[id]||paths.system);svg.appendChild(path);return svg;
}
export function decorateSettings(panel){
 panel.querySelectorAll('.settings-row,.settings-block,.settings-input-row').forEach(function(row){
  const label=row.querySelector('.settings-block-label,.settings-input-name')||row.querySelector('span');
  row.querySelectorAll('input,.option-stepper,textarea').forEach(function(control){
   if(label&&!control.getAttribute('aria-label'))control.setAttribute('aria-label',label.textContent.trim());
   if(control.type==='checkbox')control.setAttribute('role','switch');
  });
  if(row.dataset.cinemaRowBound)return;row.dataset.cinemaRowBound='1';
  const toggle=row.querySelector('input[type=checkbox]');
  if(toggle)row.addEventListener('click',function(e){if(e.target.closest('button,input,textarea,.option-stepper,a'))return;toggle.focus();toggle.click();});
 });
 panel.querySelectorAll('input[type=range]').forEach(function(range){
  if(range.dataset.cinemaRangeBound)return;range.dataset.cinemaRangeBound='1';
  const value=document.createElement('output');value.className='settings-range-value';range.parentNode.insertBefore(value,range.nextSibling);
  const paint=function(){value.textContent=range.value;range.setAttribute('aria-valuetext',range.value);};paint();range.addEventListener('input',paint);
 });
}
