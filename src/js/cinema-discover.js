export function discoverAvailability({installed,connection,seerr}) {
  if(installed===null)return {state:'unknown',title:'Scegli il tuo client Jellyfin',description:'Questo sistema non permette di verificare tutte le app installate. Puoi provare ad aprire un client oppure sceglierne uno da Homebrew Channel. La Home funziona anche senza Jellyfin.'};
  if(!installed)return {state:'install',title:'Scopri cosa guardare',description:'Installa un client Jellyfin da Homebrew Channel. Litefin e Moonfin includono funzioni per Scopri e richieste tramite Seerr. Cinema, le app e la TV funzionano anche senza questi servizi.'};
  if(!connection)return {state:'connect',title:'Collega la tua libreria',description:'Apri Litefin e accedi al tuo server Jellyfin. Puoi usare Scopri da Litefin anche se non hai collegato Jellyfin alla Home di Cinema.'};
  if(!seerr)return {state:'setup',title:'Prepara Scopri',description:'Per cercare e richiedere nuovi titoli, configura Seerr nel plugin Litefin Companion del tuo server Jellyfin. Se il server è momentaneamente offline, riprova più tardi.'};
  return {state:'ready'};
}

export function createDiscoverPanel(root,options){
 const panel=document.createElement('section');panel.className='cinema-discover';panel.hidden=true;panel.setAttribute('aria-label','Scopri');
 const kicker=document.createElement('p');kicker.className='cinema-kicker';kicker.textContent='SCOPRI';const heading=document.createElement('h1'),text=document.createElement('p'),actions=document.createElement('div');actions.className='cinema-actions';
 function action(label,fn,primary){const b=document.createElement('button');b.type='button';b.className='focusable '+(primary?'cinema-primary':'cinema-secondary');b.textContent=label;b.onclick=fn;return b;}
 [kicker,heading,text,actions].forEach(n=>panel.appendChild(n));root.appendChild(panel);
 function close(){panel.hidden=true;document.body.classList.remove('cinema-discover-open');options.focusBack();}
 function show(state){heading.textContent=state.title;text.textContent=state.description;actions.innerHTML='';
  if(state.state==='install')actions.appendChild(action('Client Homebrew',options.install,true));
  else actions.appendChild(action(state.client?'Apri '+state.client:'Apri app Jellyfin',options.open,true));
  if(state.state!=='install')actions.appendChild(action('Client Homebrew',options.install,false));
  actions.appendChild(action('Riprova',options.retry,false));actions.appendChild(action('Torna alla Home',close,false));panel.hidden=false;document.body.classList.add('cinema-discover-open');actions.querySelector('button').focus();
 }
 return {show,close,isOpen:()=>!panel.hidden};
}
