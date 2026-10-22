import {describe,it,expect} from 'vitest';
import {createBackdropPainter} from '../src/js/cinema-backdrop.js';
describe('Cinema backdrop loading',()=>{
 it('keeps the visible artwork while a replacement loads or fails',async()=>{const el={style:{backgroundImage:'old'}};const images=[];const painter=createBackdropPainter(el,{image:()=>{const i={};images.push(i);return i;}});const a=painter.set('new');expect(el.style.backgroundImage).toBe('old');images[0].onerror();await a;expect(el.style.backgroundImage).toBe('old');const b=painter.set('ready');images[1].onload();await b;expect(el.style.backgroundImage).toBe('url("ready")');});
 it('ignores stale downloads and explicit clears invalidate them',async()=>{const el={style:{backgroundImage:'old'}};const images=[];const painter=createBackdropPainter(el,{image:()=>{const i={};images.push(i);return i;}});const a=painter.set('late');const b=painter.set('latest');images[1].onload();images[0].onload();await Promise.all([a,b]);expect(el.style.backgroundImage).toBe('url("latest")');const c=painter.set('pending');painter.clear();images[2].onload();await c;expect(el.style.backgroundImage).toBe('');});
});
