export const MEDIA_CLIENTS=[
 {id:'org.litefin.app',name:'Litefin',webos:5,seerr:true,deepLink:true,url:'https://repo.webosbrew.org/apps/org.litefin.app/'},
 {id:'org.moonfin.webos',name:'Moonfin',webos:5,seerr:true,url:'https://repo.webosbrew.org/apps/org.moonfin.webos/'},
 {id:'org.jellyfin.webos',name:'Jellyfin',webos:5,url:'https://repo.webosbrew.org/apps/org.jellyfin.webos/'},
 {id:'com.breezyfin.app',name:'Breezyfin',webos:7,url:'https://repo.webosbrew.org/apps/com.breezyfin.app/'},
 {id:'com.ocenfin.app',name:'OcenFin',webos:10,url:'https://repo.webosbrew.org/apps/com.ocenfin.app/'}
];
export function normalizeMediaClient(value){return MEDIA_CLIENTS.some(c=>c.id===value)?value:'auto';}
export function mediaCandidates(snapshot,preferred,discover){
 const installed=(snapshot.apps||[]).map(a=>a.id||a.appId||(a.appInfo&&a.appInfo.id));
 let candidates=MEDIA_CLIENTS.filter(c=>!snapshot.complete||installed.indexOf(c.id)>=0);
 // Positive observations first when a platform returns an incomplete app list.
 candidates.sort((a,b)=>Number(installed.indexOf(b.id)>=0)-Number(installed.indexOf(a.id)>=0));
 if(discover)candidates.sort((a,b)=>Number(!!b.seerr)-Number(!!a.seerr));
 const chosen=normalizeMediaClient(preferred);
 if(chosen!=='auto')candidates.sort((a,b)=>Number(b.id===chosen)-Number(a.id===chosen));
 return candidates;
}
export function mediaLaunchParams(client,item,discover){
 if(!client.deepLink)return {};
 return discover?{cinemaPage:'discover'}:item?{cinemaItemId:item.id,cinemaAction:item.progress>0?'resume':'details'}:{};
}
