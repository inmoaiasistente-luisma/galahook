/* Panel "Reseñas" del admin: lo que los pasajeros envían con el QR.
   Lo ven owner y admin; solo el owner publica, rechaza y corrige traducciones.
   Todo lo escrito por pasajeros se pinta con textContent. */
(function(){
  'use strict';
  var STAR='M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.6 6.8 19.1l1-5.8L3.5 9.2l5.9-.9z';
  var SVG='http://www.w3.org/2000/svg';
  var PAGE_URL='https://www.galapagoshookadventure.com/resena';

  var TRIPS=[
    ['day_tour','Tour de día','Day tour'],
    ['sport_fishing','Pesca deportiva','Sport fishing'],
    ['all_inclusive','Todo incluido','All-inclusive'],
    ['diving','Buceo','Diving'],
    ['private_trip','Viaje privado','Private trip']
  ];
  var REASONS=[
    ['spam','Spam o publicidad','Spam or advertising'],
    ['abuse','Insultos o lenguaje ofensivo','Insults or offensive language'],
    ['third_party_data','Datos personales de terceros',"Someone else's personal data"],
    ['not_passenger','No fue pasajero nuestro','Not one of our passengers']
  ];

  /* Crea un nodo; el texto siempre entra como texto. */
  function h(tag,cls,text){
    var n=document.createElement(tag);
    if(cls)n.className=cls;
    if(text!=null)n.textContent=text;
    return n;
  }
  function stars(n){
    var box=h('span','rv-stars');
    for(var i=1;i<=5;i++){
      var s=document.createElementNS(SVG,'svg');
      s.setAttribute('viewBox','0 0 24 24');
      s.setAttribute('aria-hidden','true');
      if(i>n)s.setAttribute('class','off');
      var p=document.createElementNS(SVG,'path');
      p.setAttribute('d',STAR);
      s.appendChild(p);
      box.appendChild(s);
    }
    return box;
  }

  window.ghaPanelReviews=function(ctx){
    var ES=ctx.ES,apiGet=ctx.apiGet,apiPost=ctx.apiPost,toast=ctx.adminToast,owner=ctx.canWrite();
    function say(es,en){return ES?es:en;}
    function label(list,key){
      var hit=list.filter(function(x){return x[0]===key;})[0];
      return hit?(ES?hit[1]:hit[2]):key;
    }

    var TABS=[
      ['pending',say('Pendientes','Pending')],
      ['published',say('Publicadas','Published')],
      ['rejected',say('Rechazadas','Rejected')],
      ['rating_only',say('Solo estrellas','Stars only')]
    ];
    var STATUS={pending:say('Pendiente','Pending'),published:say('Publicada','Published'),rejected:say('Rechazada','Rejected')};

    var state={filter:'pending',rejectOpen:null,data:null};
    var drafts={};   // traducciones escritas en esta pantalla, por id

    var root=h('div','bk-screen');
    root.appendChild(h('p','sub',say(
      'Lo que los pasajeros envían con el QR. Lo que más importa es Google, por eso cada reseña indica si el pasajero lo abrió. Al publicar aquí, la reseña aparece también en la bitácora del inicio.',
      'What passengers send with the QR. Google matters most, so each review shows whether the passenger opened it. Publishing here also adds the review to the logbook on the home page.')));
    var total=h('p','rva-total');
    root.appendChild(total);

    var grid=h('div','rva-grid'),mainCol=h('div');
    var bar=h('div','rva-bar');
    bar.setAttribute('role','group');
    bar.setAttribute('aria-label',say('Filtrar reseñas','Filter reviews'));
    var list=h('div');
    list.appendChild(h('div','dash-empty',say('Cargando…','Loading…')));
    mainCol.appendChild(bar);
    mainCol.appendChild(list);
    grid.appendChild(mainCol);
    var side=h('div','rva-side');
    grid.appendChild(side);
    root.appendChild(grid);

    /* ---------- lado: QR y nota de Google ---------- */
    function buildQr(){
      var box=h('aside','dash-card rva-qr');
      box.appendChild(h('h3',null,say('QR para pasajeros','Passenger QR')));
      var img=h('img');
      img.src='assets/img/qr-resena.svg';
      img.alt=say('Código QR que abre la página para dejar una reseña','QR code that opens the review page');
      box.appendChild(img);
      box.appendChild(h('p',null,say(
        'Va impreso en el volante de la lancha y lleva a la página corta que manda al pasajero a Google.',
        'It is printed on the boat flyer and opens the short page that sends the passenger to Google.')));
      var flyer=h('a','btn btn-gold btn-sm',say('Descargar volante','Download flyer'));
      flyer.href='assets/volante-resenas-a5.pdf';
      flyer.download='volante-resenas-a5.pdf';
      box.appendChild(flyer);
      var qr=h('a','mini-btn rva-qr-link',say('Descargar solo el QR','Download QR only'));
      qr.href='assets/img/qr-resena.svg';
      qr.download='qr-resena-galapagos-hook.svg';
      box.appendChild(qr);
      var copy=h('button','mini-btn',say('Copiar enlace','Copy link'));
      copy.type='button';
      copy.addEventListener('click',function(){
        var done=function(){toast(say('Enlace copiado','Link copied'));};
        var clip=navigator.clipboard&&navigator.clipboard.writeText;
        (clip?navigator.clipboard.writeText(PAGE_URL):Promise.reject()).then(done,function(){toast(PAGE_URL);});
      });
      box.appendChild(copy);
      return box;
    }

    function field(labelText,input){
      var w=h('div','rva-score-field'),lb=h('label',null,labelText);
      lb.appendChild(input);
      w.appendChild(lb);
      return w;
    }

    function buildScore(s){
      var box=h('aside','dash-card rva-score');
      box.appendChild(h('h3',null,say('Nota de Google','Google rating')));
      box.appendChild(h('p',null,say(
        'Es la que muestra el inicio. Actualízala cuando cambie tu ficha de Google.',
        'This is what the home page shows. Update it when your Google listing changes.')));
      if(!owner){
        box.appendChild(h('p','rva-score-read',s&&s.google_rating!=null?Number(s.google_rating).toFixed(1)+' · '+s.google_count:say('Sin datos','No data')));
        return box;
      }
      var rate=h('input');rate.type='number';rate.min='1';rate.max='5';rate.step='0.1';rate.inputMode='decimal';
      var count=h('input');count.type='number';count.min='0';count.step='1';count.inputMode='numeric';
      if(s&&s.google_rating!=null)rate.value=Number(s.google_rating).toFixed(1);
      if(s&&s.google_count!=null)count.value=String(s.google_count);
      box.appendChild(field(say('Nota','Rating'),rate));
      box.appendChild(field(say('Número de reseñas','Number of reviews'),count));
      var save=h('button','mini-btn',say('Guardar nota','Save rating'));
      save.type='button';
      save.addEventListener('click',function(){
        save.disabled=true;
        apiPost('/api/admin-review-settings-save',{google_rating:Number(rate.value),google_count:Number(count.value)}).then(function(r){
          save.disabled=false;
          if(r.status===401){ctx.onUnauthorized();return;}
          toast(r.ok?say('Nota guardada','Rating saved'):say('Revisa la nota (1.0 a 5.0) y el número.','Check the rating (1.0 to 5.0) and the number.'));
        }).catch(function(){save.disabled=false;toast(say('No se pudo guardar. Intenta de nuevo.','Could not save. Try again.'));});
      });
      box.appendChild(save);
      return box;
    }

    /* ---------- tarjetas ---------- */
    function whenText(iso){
      var d=new Date(iso);
      if(isNaN(d))return '';
      return d.toLocaleString(ES?'es':'en',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
    }
    function targetLang(r){return r.lang==='es'?say('inglés','English'):say('español','Spanish');}

    function translationBlock(r,card){
      if(!r.body||r.status==='rejected')return null;
      var name=say('Traducción al ','Translation to ')+targetLang(r);
      if(r.status==='published'||!owner){
        if(!r.translation)return null;
        var read=h('p','rva-tr-read');
        read.appendChild(h('b',null,name+': '));
        read.appendChild(document.createTextNode(r.translation));
        return read;
      }
      var box=h('div','rva-tr'),lb=h('label',null,name),ta=h('textarea');
      var id='rvaTr'+r.id;
      lb.htmlFor=id;ta.id=id;ta.rows=3;ta.maxLength=1500;
      ta.value=drafts[r.id]!=null?drafts[r.id]:(r.translation||'');
      ta.addEventListener('input',function(){drafts[r.id]=ta.value;});
      box.appendChild(lb);
      box.appendChild(ta);
      box.appendChild(h('small',null,say(
        'Quien lee el sitio en '+targetLang(r)+' la verá marcada como traducción. Corrígela aquí si hace falta.',
        'Readers of the site in '+targetLang(r)+' will see it marked as a translation. Correct it here if needed.')));
      var note=h('p','rva-tr-note');
      note.hidden=true;
      box.appendChild(note);
      card.rvaTranslate={row:r,area:ta,note:note};
      return box;
    }

    function act(r,body,okMsg,btn){
      btn.disabled=true;
      apiPost('/api/admin-review-update',Object.assign({id:r.id},body)).then(function(res){
        if(res.status===401){ctx.onUnauthorized();return;}
        if(!res.ok){btn.disabled=false;toast(say('No se pudo guardar. Recarga e intenta de nuevo.','Could not save. Reload and try again.'));return;}
        state.rejectOpen=null;
        delete drafts[r.id];
        toast(okMsg);
        load();
      }).catch(function(){btn.disabled=false;toast(say('No se pudo guardar. Intenta de nuevo.','Could not save. Try again.'));});
    }

    function button(cls,text){
      var b=h('button',cls,text);
      b.type='button';
      return b;
    }

    function rejectBox(r){
      var box=h('div','rva-reject'),lb=h('label',null,say('Motivo del rechazo','Reason for rejecting'));
      var sel=h('select'),id='rvaWhy'+r.id;
      lb.htmlFor=id;sel.id=id;
      REASONS.forEach(function(x){var o=h('option',null,ES?x[1]:x[2]);o.value=x[0];sel.appendChild(o);});
      box.appendChild(lb);
      box.appendChild(sel);
      box.appendChild(h('p',null,say('Una nota baja no es motivo de rechazo.','A low rating is not a reason to reject.')));
      var row=h('div','rva-acts');
      var yes=button('mini-btn danger',say('Confirmar rechazo','Confirm rejection'));
      yes.addEventListener('click',function(){act(r,{action:'reject',reason:sel.value},say('Reseña rechazada','Review rejected'),yes);});
      var no=button('mini-btn',say('Cancelar','Cancel'));
      no.addEventListener('click',function(){state.rejectOpen=null;paint();});
      row.appendChild(yes);
      row.appendChild(no);
      box.appendChild(row);
      return box;
    }

    function pendingControls(r,card){
      var wrap=h('div');
      var tripSel=null;
      if(r.body){
        var trip=h('div','rva-trip'),lb=h('label',null,say('Viaje (opcional)','Trip (optional)'));
        var id='rvaTrip'+r.id;
        tripSel=h('select');
        lb.htmlFor=id;tripSel.id=id;
        var none=h('option',null,say('Sin especificar','Not specified'));none.value='';
        tripSel.appendChild(none);
        TRIPS.forEach(function(x){var o=h('option',null,ES?x[1]:x[2]);o.value=x[0];tripSel.appendChild(o);});
        tripSel.value=r.trip||'';
        trip.appendChild(lb);
        trip.appendChild(tripSel);
        wrap.appendChild(trip);
      }
      var row=h('div','rva-acts');
      if(r.body){
        var pub=button('btn btn-gold btn-sm',say('Publicar','Publish'));
        pub.addEventListener('click',function(){
          var ta=card.rvaTranslate&&card.rvaTranslate.area;
          act(r,{action:'publish',translation:ta?ta.value:'',trip:tripSel.value},say('Publicada en la bitácora','Published to the logbook'),pub);
        });
        row.appendChild(pub);
      }
      var rej=button('mini-btn danger',say('Rechazar','Reject'));
      rej.setAttribute('aria-expanded',state.rejectOpen===r.id?'true':'false');
      rej.addEventListener('click',function(){state.rejectOpen=r.id;paint();});
      row.appendChild(rej);
      wrap.appendChild(row);
      if(state.rejectOpen===r.id)wrap.appendChild(rejectBox(r));
      return wrap;
    }

    function card(r){
      var c=h('article','dash-card rva-card');
      var head=h('div','rva-head'),rate=h('div','rva-rate');
      rate.appendChild(stars(r.rating));
      rate.appendChild(h('span',null,r.rating+say(' de 5',' of 5')));
      head.appendChild(rate);
      var pill=h('span','rva-pill '+r.status);
      pill.appendChild(h('i'));
      pill.appendChild(document.createTextNode(STATUS[r.status]||r.status));
      head.appendChild(pill);
      c.appendChild(head);

      var who=h('div','rva-who');
      who.appendChild(h('b',null,r.author_name));
      if(r.trip)who.appendChild(document.createTextNode(' · '+label(TRIPS,r.trip)));
      who.appendChild(h('br'));
      who.appendChild(document.createTextNode(whenText(r.created_at)));
      c.appendChild(who);

      c.appendChild(r.body
        ? h('p','rva-text',r.body)
        : h('p','rva-text rva-muted',say('Solo dejó estrellas: no se publica en la bitácora.','Stars only: it is not published to the logbook.')));
      var tr=translationBlock(r,c);
      if(tr)c.appendChild(tr);

      var facts=h('div','rva-facts');
      facts.appendChild(h('span','rva-g '+(r.opened_google?'yes':'no'),r.opened_google?say('Abrió Google','Opened Google'):say('No abrió Google','Did not open Google')));
      if(r.reject_reason)facts.appendChild(h('span',null,say('Motivo: ','Reason: ')+label(REASONS,r.reject_reason)));
      c.appendChild(facts);

      if(!owner)return c;
      if(r.status==='pending'){
        c.appendChild(pendingControls(r,c));
      } else {
        var row=h('div','rva-acts'),back=button('mini-btn',say('Volver a pendiente','Back to pending'));
        back.addEventListener('click',function(){act(r,{action:'pending'},say('Volvió a pendientes','Back in pending'),back);});
        row.appendChild(back);
        c.appendChild(row);
      }
      return c;
    }

    /* ---------- traducción automática, de una en una ---------- */
    function noteFor(job,text,retry){
      job.note.textContent=text;
      job.note.hidden=false;
      if(!retry)return;
      var b=button('rva-tr-retry',say('Reintentar','Retry'));
      b.addEventListener('click',function(){job.note.hidden=true;runQueue([job]);});
      job.note.appendChild(document.createTextNode(' '));
      job.note.appendChild(b);
    }

    function runQueue(jobs){
      var job=jobs.shift();
      if(!job)return;
      noteFor(job,say('Traduciendo…','Translating…'));
      apiPost('/api/admin-review-translate',{id:job.row.id}).then(function(r){
        if(r.status===401){ctx.onUnauthorized();return;}
        if(r.ok&&r.data&&r.data.configured===false){
          noteFor(job,say('La traducción automática no está activada. Escríbela a mano o publica sin traducir.','Automatic translation is off. Type it by hand or publish without it.'));
          return;
        }
        if(r.ok&&r.data&&r.data.translation){
          if(!job.area.value){job.area.value=r.data.translation;drafts[job.row.id]=r.data.translation;}
          job.note.hidden=true;
        } else {
          noteFor(job,say('No se pudo traducir.','Could not translate.'),true);
        }
        runQueue(jobs);
      }).catch(function(){
        noteFor(job,say('No se pudo traducir.','Could not translate.'),true);
        runQueue(jobs);
      });
    }

    /* ---------- pintar ---------- */
    function paintBar(counts){
      bar.textContent='';
      TABS.forEach(function(t){
        var b=button('mini-btn'+(t[0]===state.filter?' active':''),t[1]+' ('+(counts[t[0]]||0)+')');
        b.setAttribute('aria-pressed',t[0]===state.filter?'true':'false');
        b.addEventListener('click',function(){state.filter=t[0];state.rejectOpen=null;load();});
        bar.appendChild(b);
      });
    }

    function paint(){
      var d=state.data;
      paintBar(d.counts);
      total.textContent=say('Abrieron Google: ','Opened Google: ')+d.counts.opened_google+say(' de ',' of ')+d.counts.total;
      list.textContent='';
      if(!d.rows.length){
        var empty=h('div','dash-card');
        empty.appendChild(h('p','dash-empty',say('No hay reseñas aquí todavía.','No reviews here yet.')));
        list.appendChild(empty);
        return;
      }
      var jobs=[];
      d.rows.forEach(function(r){
        var c=card(r);
        list.appendChild(c);
        var job=c.rvaTranslate;
        if(!job||job.area.value)return;
        if(d.translate_ready)jobs.push(job);
        else noteFor(job,say('La traducción automática no está activada. Escríbela a mano o publica sin traducir.','Automatic translation is off. Type it by hand or publish without it.'));
      });
      runQueue(jobs);
    }

    function load(){
      apiGet('/api/admin-reviews?status='+encodeURIComponent(state.filter)).then(function(r){
        if(r.status===401){ctx.onUnauthorized();return;}
        if(!r.ok||!r.data){throw new Error('load failed');}
        if(!r.data.ready){
          list.textContent='';
          list.appendChild(h('div','dash-empty',say('Las reseñas aún no están activadas.','Reviews are not active yet.')));
          return;
        }
        state.data=r.data;
        paint();
        ctx.refreshBadge();
        side.textContent='';
        side.appendChild(buildQr());
        side.appendChild(buildScore(r.data.settings));
      }).catch(function(){
        list.textContent='';
        list.appendChild(h('div','dash-empty',say('No se pudieron cargar las reseñas.','Could not load the reviews.')));
      });
    }

    load();
    return root;
  };
})();
