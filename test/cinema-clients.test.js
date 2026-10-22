import {describe,it,expect} from 'vitest';
import {mediaCandidates,mediaLaunchParams,normalizeMediaClient} from '../src/js/cinema-clients.js';
describe('Jellyfin client selection',()=>{
 it('uses the installed client instead of assuming Litefin',()=>{const c=mediaCandidates({complete:true,apps:[{id:'org.moonfin.webos'}]},'auto',false);expect(c.map(n=>n.id)).toEqual(['org.moonfin.webos']);expect(mediaLaunchParams(c[0],{id:'movie'},false)).toEqual({});});
 it('falls back when the preferred app has been removed',()=>expect(mediaCandidates({complete:true,apps:[{id:'org.jellyfin.webos'}]},'org.litefin.app',false)[0].id).toBe('org.jellyfin.webos'));
 it('honours an installed preferred app',()=>expect(mediaCandidates({complete:true,apps:[{id:'org.litefin.app'},{id:'org.moonfin.webos'}]},'org.moonfin.webos',false)[0].id).toBe('org.moonfin.webos'));
 it('has no fake client on an empty complete installation',()=>expect(mediaCandidates({complete:true,apps:[]},'auto',false)).toHaveLength(0));
 it('preserves optimistic fallbacks when enumeration is unavailable',()=>{expect(mediaCandidates({complete:false,apps:[]},'auto',false)).toHaveLength(5);expect(normalizeMediaClient('anything')).toBe('auto');});
 it('only sends Cinema deep links to the verified Litefin adapter',()=>{const client=mediaCandidates({complete:true,apps:[{id:'org.litefin.app'}]},'auto',true)[0];expect(mediaLaunchParams(client,null,true)).toEqual({cinemaPage:'discover'});expect(mediaLaunchParams(client,{id:'a',progress:4},false)).toEqual({cinemaItemId:'a',cinemaAction:'resume'});});
});
