import {describe,it,expect} from 'vitest';
import {discoverAvailability} from '../src/js/cinema-discover.js';
describe('Scopri on any installation',()=>{
 it('offers installation without Litefin',()=>expect(discoverAvailability({installed:false}).state).toBe('install'));
 it('explains account setup without a Cinema connection',()=>expect(discoverAvailability({installed:true,connection:false}).state).toBe('connect'));
 it('explains Seerr configuration or retry when unavailable',()=>expect(discoverAvailability({installed:true,connection:true,seerr:false}).state).toBe('setup'));
 it('opens discovery when all services are available',()=>expect(discoverAvailability({installed:true,connection:true,seerr:true}).state).toBe('ready'));
});
