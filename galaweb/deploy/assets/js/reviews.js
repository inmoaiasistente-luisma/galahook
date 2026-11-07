/* Sección "La bitácora de a bordo" del inicio.
   Pinta las reseñas que el owner publicó. Todo llega de personas desconocidas,
   así que se escribe siempre como texto. El cambio de idioma del sitio funciona
   solo: cada nodo lleva data-en / data-es y lo actualiza applyStaticLang. */
(function(){
  'use strict';
  var wall=document.getElementById('rvWall');
  if(!wall)return;

  var SVG='http://www.w3.org/2000/svg';
  var STAR='M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.6 6.8 19.1l1-5.8L3.5 9.2l5.9-.9z';
  var TRIPS={
    day_tour:['Day tour','Tour de día'],
    sport_fishing:['Sport fishing','Pesca deportiva'],
    all_inclusive:['All-inclusive','Todo incluido'],
    diving:['Diving','Buceo'],
    private_trip:['Private trip','Viaje privado']
  };
  var MONTHS_EN=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var MONTHS_ES=['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

  function isEs(){return !!(window.GHA&&window.GHA.lang==='es');}

  function node(tag,cls){
    var el=document.createElement(tag);
    if(cls)el.className=cls;
    return el;
  }
  function both(el,en,es){
    el.dataset.en=en;el.dataset.es=es;
    el.textContent=isEs()?es:en;
    return el;
  }

  function starIcon(on){
    var s=document.createElementNS(SVG,'svg');
    s.setAttribute('viewBox','0 0 24 24');
    s.setAttribute('aria-hidden','true');
    if(!on)s.setAttribute('class','off');
    var p=document.createElementNS(SVG,'path');
    p.setAttribute('d',STAR);
    s.appendChild(p);
    return s;
  }
  function starsInto(host,rating){
    var n=Math.max(1,Math.min(5,Math.round(Number(rating)||0)));
    for(var i=1;i<=5;i++)host.appendChild(starIcon(i<=n));
    host.appendChild(both(node('span','rv-sr'),n+' out of 5 stars',n+' de 5 estrellas'));
    return host;
  }

  function monthLabel(ym){
    var m=/^(\d{4})-(\d{2})$/.exec(ym||'');
    if(!m)return ['',''];
    var i=Number(m[2])-1;
    return [MONTHS_EN[i]+' '+m[1],MONTHS_ES[i]+' '+m[1]];
  }

  function textsFor(r){
    var tr=r.translation;
    return {
      en:r.lang==='en'?r.body:(tr||r.body),
      es:r.lang==='es'?r.body:(tr||r.body),
      labelEn:r.lang==='es'&&tr?'Translated from Spanish':'',
      labelEs:r.lang==='en'&&tr?'Traducida del inglés':''
    };
  }

  function bodyOf(r){
    var body=node('div','rv-body'),meta=node('div','rv-meta');
    var trip=TRIPS[r.trip],when=monthLabel(r.month),t=textsFor(r);
    if(trip)meta.appendChild(both(node('span'),trip[0],trip[1]));
    meta.appendChild(both(node('span'),when[0],when[1]));
    body.appendChild(meta);
    body.appendChild(starsInto(node('span','rv-stars'),r.rating));
    body.appendChild(both(node('blockquote'),t.en,t.es));
    body.appendChild(both(node('small','rv-tr'),t.labelEn,t.labelEs));
    var by=node('div','rv-by'),sign=node('b','rv-sign');
    sign.textContent=r.author_name;
    by.appendChild(sign);
    body.appendChild(by);
    return body;
  }

  function card(r,lead){
    var a=node('article','rv-entry'+(lead?' is-lead':''));
    if(lead){
      var ph=node('div','rv-photo'),img=node('img');
      img.src='assets/img/kicker-day.jpg';
      img.alt='Kicker Rock, San Cristóbal';
      img.loading='lazy';
      ph.appendChild(img);
      a.appendChild(ph);
    }
    a.appendChild(bodyOf(r));
    return a;
  }

  function paintWall(list){
    if(!list.length)return;
    var cta=wall.querySelector('.rv-cta');
    list.forEach(function(r,i){wall.insertBefore(card(r,i===0),cta);});
    wall.classList.remove('is-empty');
    // Con un número par de tarjetas pequeñas el cierre ocupa toda la fila.
    cta.classList.toggle('is-wide',(list.length-1)%2===0);
  }

  function paintScore(g){
    var box=document.getElementById('rvScore');
    if(!box||!g)return;
    document.getElementById('rvScoreNum').textContent=Number(g.rating).toFixed(1);
    starsInto(document.getElementById('rvScoreStars'),g.rating);
    both(document.getElementById('rvScoreCount'),
      g.count===1?'1 review on Google':g.count+' reviews on Google',
      g.count===1?'1 reseña en Google':g.count+' reseñas en Google');
    box.hidden=false;
  }

  fetch('/api/reviews',{headers:{Accept:'application/json'},credentials:'same-origin'})
    .then(function(r){return r.ok?r.json():null;})
    .then(function(d){
      if(!d)return;
      paintWall(d.reviews||[]);
      paintScore(d.google);
    })
    .catch(function(){});   // sin datos la sección sigue invitando a dejar reseña
})();
