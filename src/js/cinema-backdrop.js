// Keep the visible image until its replacement has actually decoded.
export function createBackdropPainter(element, options={}) {
  let revision=0, current='';
  const makeImage=options.image||function(){return new Image();};
  return {
    set(source){
      const mark=++revision;
      if(!source||source===current)return Promise.resolve(false);
      return new Promise(function(resolve){
        const image=makeImage();
        image.onload=function(){if(mark!==revision){resolve(false);return;}current=source;element.style.backgroundImage='url("'+source.replace(/["\\\n\r]/g,'')+'")';resolve(true);};
        image.onerror=function(){resolve(false);};image.src=source;
      });
    },
    clear(){revision++;current='';element.style.backgroundImage='';},
    cancel(){revision++;}
  };
}
