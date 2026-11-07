/* Página /resena, la que abre el QR del volante.
   Flujo corto: estrellas, texto y nombre. UN botón copia el texto, abre Google
   y guarda la reseña en el sitio en segundo plano. Google va primero: el
   guardado nunca frena al pasajero y se puede reintentar con la misma clave. */
(function(){
  'use strict';
  var GOOGLE_URL='https://search.google.com/local/writereview?placeid=ChIJ5VCfRXvpAJARW1i9n5H4ht4';
  var STAR='M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.6 6.8 19.1l1-5.8L3.5 9.2l5.9-.9z';
  var ERR_ICON='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5h.01" stroke-linecap="round"/></svg>';
  var T={
    es:{title:'Deja tu reseña — Galápagos Hook Adventure',desc:'Cuéntanos cómo estuvo tu aventura en San Cristóbal, Galápagos.',words:['Mala','Regular','Buena','Muy buena','Excelente'],of:' de 5',tap:'Toca las estrellas',
      eRate:'Elige de 1 a 5 estrellas.',eName:'Escribe tu nombre para firmar la reseña.',
      thanks:'¡Gracias, {n}!',
      gTitleGo:'Ya casi: termina en Google',gTextGo:'Tu texto ya está copiado. En Google toca las estrellas, pega y publica.',gTextGoEmpty:'En Google toca las estrellas y publica.',gBtnGo:'Abrir Google de nuevo',
      gTitleSite:'¿La pones también en Google?',gTextSite:'Es lo que más nos ayuda: así nos encuentran otros viajeros. Toma unos segundos.',gBtnSite:'Copiar y abrir Google',
      gTextNoCopy:'Copia tu texto de abajo y pégalo en Google.',
      saving:'Guardando en el sitio…',saved:'En el sitio aparecerá cuando la revisemos.',savedNoText:'Gracias por calificarnos.',saveErr:'No pudimos guardarla en el sitio.',retry:'Reintentar'},
    en:{title:'Leave your review — Galápagos Hook Adventure',desc:'Tell us how your adventure in San Cristóbal, Galápagos went.',words:['Poor','Fair','Good','Very good','Excellent'],of:' of 5',tap:'Tap the stars',
      eRate:'Choose 1 to 5 stars.',eName:'Enter your name to sign the review.',
      thanks:'Thank you, {n}!',
      gTitleGo:'Almost there: finish on Google',gTextGo:'Your text is copied. On Google, tap the stars, paste and post.',gTextGoEmpty:'On Google, tap the stars and post.',gBtnGo:'Open Google again',
      gTitleSite:'Post it on Google too?',gTextSite:'It helps us most: it is how other travelers find us. It only takes a few seconds.',gBtnSite:'Copy and open Google',
      gTextNoCopy:'Copy your text below and paste it on Google.',
      saving:'Saving on the site…',saved:'It will appear on the site once we review it.',savedNoText:'Thanks for rating us.',saveErr:"We couldn't save it on the site.",retry:'Retry'}
  };
  function $(id){return document.getElementById(id);}
  var stored=null; try{stored=localStorage.getItem('GHA_LANG');}catch(e){}
  var L=(stored==='es'||stored==='en')?stored:((navigator.language||'').toLowerCase().indexOf('es')===0?'es':'en');
  var rate=0,viaGoogle=false,copyFailed=false,saveState='',errs={};
  var clientKey=newKey(),sentGoogle=false;

  /* Identifica este envío: reintentar con la misma clave no crea otra reseña. */
  function newKey(){
    if(window.crypto&&crypto.randomUUID)return crypto.randomUUID();
    var b=new Uint8Array(16);crypto.getRandomValues(b);
    b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;
    var h=Array.prototype.map.call(b,function(x){return (x+256).toString(16).slice(1);}).join('');
    return h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20);
  }

  /* --- estrellas --- */
  var stars=$('rsStars');
  [1,2,3,4,5].forEach(function(n){
    var lb=document.createElement('label');lb.className='rs-star';lb.dataset.n=n;
    lb.innerHTML='<input type="radio" name="rate" value="'+n+'"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="'+STAR+'"/></svg>';
    stars.appendChild(lb);
    lb.addEventListener('pointerenter',function(e){if(e.pointerType==='mouse')paint(n);});
    lb.addEventListener('pointerleave',function(e){if(e.pointerType==='mouse')paint(rate);});
    lb.querySelector('input').addEventListener('change',function(){
      rate=n;paint(n);word();clearErr('gRate','eRate');
      lb.classList.remove('pop');void lb.offsetWidth;lb.classList.add('pop');
    });
  });
  function paint(n){stars.querySelectorAll('.rs-star').forEach(function(s){s.classList.toggle('on',+s.dataset.n<=n);});}
  function word(){$('rsWord').textContent=rate?(rate+T[L].of+' · '+T[L].words[rate-1]):T[L].tap;}

  /* --- idioma --- */
  function applyLang(){
    document.documentElement.lang=L;
    document.title=T[L].title;
    var md=document.querySelector('meta[name=description]');if(md)md.content=T[L].desc;
    Object.keys(errs).forEach(function(g){showErr(g,errs[g]);});
    document.querySelectorAll('[data-en]').forEach(function(el){el.textContent=(L==='es'?el.dataset.es:el.dataset.en);});
    document.querySelectorAll('[data-ph-en]').forEach(function(el){el.placeholder=(L==='es'?el.dataset.phEs:el.dataset.phEn);});
    document.querySelectorAll('.rs-lang button').forEach(function(b){var on=b.dataset.lang===L;b.classList.toggle('on',on);b.setAttribute('aria-pressed',on);});
    stars.querySelectorAll('input').forEach(function(inp,i){inp.setAttribute('aria-label',(i+1)+T[L].of+' · '+T[L].words[i]);});
    word();
    if(!$('rsThanks').hidden)fillThanks();
  }
  document.querySelectorAll('.rs-lang button').forEach(function(b){
    b.addEventListener('click',function(){L=b.dataset.lang;try{localStorage.setItem('GHA_LANG',L);}catch(e){}applyLang();});
  });

  /* --- validación: solo estrellas y nombre --- */
  var nameI=$('rsName'),textI=$('rsText');
  nameI.addEventListener('input',function(){clearErr('gName','eName');});
  function showErr(group,errId){
    errs[group]=errId;$(group).classList.add('is-invalid');
    var e=$(errId);e.innerHTML=ERR_ICON+'<span></span>';e.querySelector('span').textContent=T[L][errId];e.style.display='flex';
  }
  function clearErr(group,errId){delete errs[group];$(group).classList.remove('is-invalid');var e=$(errId);e.style.display='none';e.textContent='';}
  function validate(){
    var first=null;
    if(!rate){showErr('gRate','eRate');first=stars.querySelector('input');}
    if(nameI.value.trim().length<2){showErr('gName','eName');first=first||nameI;}
    if(first){first.focus();return false;}
    return true;
  }

  /* --- copiar + abrir Google, en el mismo toque para que el navegador no lo bloquee --- */
  function copy(text){
    if(navigator.clipboard&&navigator.clipboard.writeText){return navigator.clipboard.writeText(text);}
    return new Promise(function(ok,no){
      var ta=document.createElement('textarea');ta.value=text;ta.style.position='fixed';ta.style.opacity='0';document.body.appendChild(ta);ta.select();
      var done=false;try{done=document.execCommand('copy');}catch(e){}
      ta.remove();done?ok():no();
    });
  }
  function goGoogle(){
    var text=textI.value.trim();
    viaGoogle=true;copyFailed=false;
    if(text){copy(text).catch(function(){copyFailed=true;fillThanks();});}
    window.open(GOOGLE_URL,'_blank','noopener');
  }

  /* --- guardado en el sitio, en segundo plano --- */
  function save(){
    saveState='saving';renderSaved();
    var opened=viaGoogle;
    fetch('/api/reviews',{
      method:'POST',
      headers:{'Content-Type':'application/json',Accept:'application/json'},
      credentials:'same-origin',
      keepalive:true,   // el pasajero se va a Google en ese mismo instante
      body:JSON.stringify({client_key:clientKey,rating:rate,name:nameI.value.trim(),text:textI.value.trim(),lang:L,opened_google:opened,company:$('rsCompany').value})
    }).then(function(r){
      if(!r.ok)throw new Error('save failed');
      sentGoogle=sentGoogle||opened;
      if(viaGoogle&&!sentGoogle){save();return;}   // tocó Google mientras se guardaba
      saveState='ok';renderSaved();
    }).catch(function(){saveState='error';renderSaved();});
  }
  function renderSaved(){
    var el=$('rsSaved'),t=T[L];el.classList.toggle('is-error',saveState==='error');
    if(saveState==='saving'){el.textContent=t.saving;}
    else if(saveState==='ok'){el.textContent=textI.value.trim()?t.saved:t.savedNoText;}
    else if(saveState==='error'){
      el.textContent=t.saveErr+' ';
      var b=document.createElement('button');b.type='button';b.textContent=t.retry;b.addEventListener('click',save);el.appendChild(b);
    }
  }

  /* --- gracias --- */
  function fillThanks(){
    var t=T[L],text=textI.value.trim();
    $('rsThanksTitle').textContent=t.thanks.replace('{n}',nameI.value.trim().split(/\s+/)[0]);
    $('rsGTitle').textContent=viaGoogle?t.gTitleGo:t.gTitleSite;
    $('rsGText').textContent=!viaGoogle?t.gTextSite:!text?t.gTextGoEmpty:copyFailed?t.gTextNoCopy:t.gTextGo;
    $('rsGBtn').textContent=viaGoogle?t.gBtnGo:t.gBtnSite;
    var s='';for(var i=1;i<=5;i++){s+='<svg viewBox="0 0 24 24" class="'+(i<=rate?'':'off')+'" aria-hidden="true"><path d="'+STAR+'"/></svg>';}
    $('rsOutStars').innerHTML=s+'<span class="rv-sr">'+rate+t.of+'</span>';
    $('rsOutText').textContent=text;$('rsOutText').hidden=!text;
    $('rsOutName').textContent=nameI.value.trim();
    if(saveState)renderSaved();
  }
  function showThanks(){
    fillThanks();
    $('rsForm').hidden=true;$('rsThanks').hidden=false;
    var motion=!(window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches);
    document.querySelector('.rs-card').scrollIntoView({block:'start',behavior:motion?'smooth':'auto'});
    $('rsThanksTitle').focus({preventScroll:true});
    save();
  }

  $('rsForm').addEventListener('submit',function(ev){
    ev.preventDefault();
    if(!validate())return;
    goGoogle();showThanks();
  });
  $('rsOnlySite').addEventListener('click',function(){
    if(!validate())return;
    viaGoogle=false;showThanks();
  });
  $('rsGoogle').addEventListener('click',function(){
    goGoogle();fillThanks();
    if(!sentGoogle&&saveState!=='saving')save();   // avisa al panel que sí abrió Google
  });

  /* --- marco con esquinas cortadas, el del resto del sitio --- */
  function frame(){
    var f=document.querySelector('.rs-frame');if(!f||getComputedStyle(f).display==='none')return;
    var r=f.getBoundingClientRect(),w=r.width,h=r.height,c=14;
    f.querySelector('path').setAttribute('d','M'+c+' 0H'+(w-c)+'L'+w+' '+c+'V'+(h-c)+'L'+(w-c)+' '+h+'H'+c+'L0 '+(h-c)+'V'+c+'Z');
  }
  addEventListener('resize',frame);
  frame();
  applyLang();
})();
