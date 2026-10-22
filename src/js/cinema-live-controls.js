// Idle chrome for the embedded TV/HDMI picture. No polling and no native app launch.
export function createLiveControls(options){
 let timer=null,active=false,hidden=false;
 const delay=options.delay===undefined?10000:options.delay;
 function clear(){if(timer!==null)clearTimeout(timer);timer=null;}
 function paint(next){if(hidden===next)return;hidden=next;options.onHidden(next);}
 function hide(){clear();if(active&&options.isEligible())paint(true);}
 function arm(){clear();if(active&&!hidden&&options.isEligible())timer=setTimeout(hide,delay);}
 function activity(){if(!active||!options.isEligible())return false;const wasHidden=hidden;paint(false);arm();return wasHidden;}
 return {
  enter:function(){active=true;paint(false);arm();},
  leave:function(){active=false;clear();paint(false);},
  pause:function(){clear();paint(false);},
  resume:function(){if(active)arm();},
  activity:activity,hide:hide,isHidden:function(){return hidden;}
 };
}
