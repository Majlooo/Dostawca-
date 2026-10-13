(() => {
  'use strict';

  const $ = (s, root=document) => root.querySelector(s);
  const $$ = (s, root=document) => [...root.querySelectorAll(s)];
  const STORE_KEY = 'dostawca_plus_v1';
  const DEFAULT_CHECKLIST = ['Pasy transportowe','Wkrętarka + bity','Poziomica / miarka','Pokrowce i koce','Wózek transportowy','Dokumenty / terminal','Rękawice ochronne'];
  let geoWatchId = null;
  let ticker = null;
  let toastTimer = null;

  const todayKey = () => new Date().toISOString().slice(0,10);
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const clamp = (n,a,b) => Math.min(Math.max(n,a),b);
  const fmtKm = n => Number(n || 0).toLocaleString('pl-PL',{minimumFractionDigits:1,maximumFractionDigits:1});
  const fmtDuration = mins => {
    if (!Number.isFinite(mins)) return '—';
    const m = Math.max(0, Math.round(mins));
    if (m < 60) return `${m} min`;
    const h = Math.floor(m/60), r = m%60;
    return r ? `${h} h ${r} min` : `${h} h`;
  };
  const fmtClockDuration = ms => {
    const total = Math.floor(Math.max(0,ms)/60000), h=Math.floor(total/60), m=total%60;
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
  };
  const escapeHtml = s => String(s ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));

  function initialState(){
    return {
      date: todayKey(),
      stops: [],
      shift: {active:false,startAt:null,totalMs:0,km:0,lastPosition:null},
      routeInfo: {distanceKm:null,durationMin:null,lastOptimized:null,source:null},
      checklist: Object.fromEntries(DEFAULT_CHECKLIST.map(x=>[x,false])),
      history: [],
      settings: {tracking:true,navProvider:'google',defaultCity:'',theme:'auto'},
      odoStart:'', odoEnd:''
    };
  }

  function loadState(){
    try {
      const raw = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
      if (!raw) return initialState();
      const base = initialState();
      const merged = {...base,...raw,settings:{...base.settings,...raw.settings},shift:{...base.shift,...raw.shift},routeInfo:{...base.routeInfo,...raw.routeInfo},checklist:{...base.checklist,...raw.checklist}};
      if (merged.date !== todayKey()) return rollover(merged);
      return merged;
    } catch { return initialState(); }
  }

  function rollover(old){
    const done = (old.stops||[]).filter(s=>s.status==='done').length;
    const summary = {date:old.date,km:Number(old.shift?.km||0),jobs:done,workMs:shiftElapsed(old.shift||{})};
    const next = initialState();
    next.history = [summary,...(old.history||[])].slice(0,60);
    next.settings = {...next.settings,...old.settings};
    next.odoStart=''; next.odoEnd='';
    localStorage.setItem(STORE_KEY,JSON.stringify(next));
    return next;
  }

  let state = loadState();

  function save(){ localStorage.setItem(STORE_KEY,JSON.stringify(state)); }
  function shiftElapsed(shift=state.shift){ return Number(shift.totalMs||0) + (shift.active && shift.startAt ? Date.now()-shift.startAt : 0); }
  function toast(msg){
    const el=$('#toast'); el.textContent=msg; el.classList.add('show'); clearTimeout(toastTimer); toastTimer=setTimeout(()=>el.classList.remove('show'),2600);
  }
  function showModal(id){ const el=$('#'+id); if(el){el.hidden=false; document.body.style.overflow='hidden';} }
  function hideModal(id){ const el=$('#'+id); if(el){el.hidden=true; document.body.style.overflow='';} }

  function applyTheme(){
    const pref = state.settings.theme || 'auto';
    const dark = pref==='dark' || (pref==='auto' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  }

  function render(){
    applyTheme();
    renderToday(); renderRoute(); renderLoad(); renderStats(); renderChecklist();
    $('#trackingToggle').checked = !!state.settings.tracking;
    $('#navProvider').value = state.settings.navProvider || 'google';
    $('#defaultCity').value = state.settings.defaultCity || '';
    $('#odoStart').value = state.odoStart ?? '';
    $('#odoEnd').value = state.odoEnd ?? '';
    renderOdo();
  }

  function renderToday(){
    const d = new Date();
    $('#todayLabel').textContent = d.toLocaleDateString('pl-PL',{weekday:'long',day:'numeric',month:'long'});
    const done = state.stops.filter(s=>s.status==='done').length;
    const total = state.stops.length;
    const status = $('#shiftStatus');
    status.classList.toggle('active',state.shift.active);
    status.innerHTML = `<span></span>${state.shift.active?'Zmiana aktywna':'Zmiana nieaktywna'}`;
    $('#shiftBtn').textContent = state.shift.active ? 'Zakończ zmianę' : 'Rozpocznij zmianę';
    $('#heroTitle').textContent = state.shift.active ? (total ? `W trasie · ${Math.max(0,total-done)} punktów zostało` : 'Zmiana trwa') : (total ? `${total} punktów gotowych` : 'Gotowy na trasę?');
    $('#heroSubtitle').textContent = state.shift.active ? 'GPS liczy kilometry, a następny punkt czeka poniżej.' : 'Dodaj adresy, zoptymalizuj kolejność i ruszaj.';
    $('#kmMetric').textContent = fmtKm(state.shift.km);
    $('#jobsMetric').textContent = `${done}/${total}`;
    $('#jobsSmall').textContent = total ? `${Math.round((done/total)*100)||0}% planu` : 'brak punktów';
    $('#timeMetric').textContent = fmtClockDuration(shiftElapsed());
    $('#timeSmall').textContent = state.shift.active ? 'liczę na żywo' : (shiftElapsed()>0?'dzisiejszy czas':'zmiana nieaktywna');
    $('#routeMetric').textContent = state.routeInfo.distanceKm!=null ? `${fmtKm(state.routeInfo.distanceKm)} km` : '—';
    $('#routeSmall').textContent = state.routeInfo.durationMin!=null ? `jazda ~ ${fmtDuration(state.routeInfo.durationMin)}` : 'nie policzono';

    const next = state.stops.find(s=>s.status!=='done' && s.status!=='issue');
    const go=$('#goNextBtn'), arr=$('#arrivedNextBtn');
    if(next){
      $('#nextTitle').textContent = next.customer || 'Następna dostawa';
      $('#nextAddress').textContent = next.address;
      $('#nextEta').textContent = next.windowFrom ? `${next.windowFrom}${next.windowTo?'–'+next.windowTo:''}` : `${next.duration||30} min pracy`;
      $('#nextTags').innerHTML = [...(next.services||[]),...(next.conditions||[])].slice(0,4).map((x,i)=>`<span class="tag ${i===0?'green':''}">${escapeHtml(x)}</span>`).join('');
      go.disabled=false; arr.disabled=false; go.dataset.id=next.id; arr.dataset.id=next.id;
      arr.textContent = next.status==='arrived' ? 'Pracuję na miejscu' : 'Jestem na miejscu';
    } else {
      $('#nextTitle').textContent = total ? 'Plan na dziś zakończony' : 'Brak zaplanowanego punktu';
      $('#nextAddress').textContent = total ? 'Wszystkie aktywne punkty są zakończone.' : 'Dodaj adresy w zakładce Trasa.';
      $('#nextEta').textContent='—'; $('#nextTags').innerHTML=''; go.disabled=true; arr.disabled=true;
    }
  }

  function renderRoute(){
    $('#routeStopsCount').textContent = state.stops.length;
    $('#routeDistance').textContent = state.routeInfo.distanceKm!=null ? `${fmtKm(state.routeInfo.distanceKm)} km` : '—';
    const service = state.stops.filter(s=>s.status!=='done').reduce((a,s)=>a+Number(s.duration||0),0);
    $('#routeServiceTime').textContent = fmtDuration(service);
    const list=$('#stopsList'), empty=$('#emptyStops');
    empty.style.display=state.stops.length?'none':'block'; list.style.display=state.stops.length?'grid':'none';
    const nextId = state.stops.find(s=>s.status!=='done' && s.status!=='issue')?.id;
    list.innerHTML = state.stops.map((s,i)=>{
      const meta=[];
      if(s.windowFrom) meta.push(`⏱ ${s.windowFrom}${s.windowTo?'–'+s.windowTo:''}`);
      meta.push(`~ ${s.duration||30} min`);
      if(s.floor) meta.push(`piętro ${s.floor}`);
      if(s.services?.includes('Montaż')) meta.push('montaż');
      const statusLabel = s.status==='done'?'✓ Gotowe':s.status==='arrived'?'● Na miejscu':s.status==='issue'?'! Problem':'';
      return `<article class="stop-card ${s.status==='done'?'done':''} ${s.id===nextId?'next':''}" data-id="${s.id}">
        <div class="stop-index">${s.status==='done'?'✓':i+1}</div>
        <div class="stop-main" data-open-detail="${s.id}"><h3>${escapeHtml(s.address)}</h3><p>${escapeHtml(s.customer||s.items||'Dostawa')}</p><div class="stop-meta">${meta.map(x=>`<span>${escapeHtml(x)}</span>`).join('')}${statusLabel?`<span>${statusLabel}</span>`:''}</div></div>
        <div class="stop-actions"><button class="mini-btn" title="Nawiguj" data-nav="${s.id}">▶</button><button class="mini-btn" title="Wyżej" data-up="${s.id}">↑</button><button class="mini-btn" title="Niżej" data-down="${s.id}">↓</button></div>
      </article>`;
    }).join('');
  }

  function renderLoad(){
    const list=$('#loadList');
    if(!state.stops.length){ list.innerHTML='<div class="empty-state"><div class="empty-icon">▣</div><h3>Najpierw zaplanuj trasę</h3><p>Po dodaniu punktów pokażę kolejność układania sprzętu w aucie.</p></div>'; return; }
    const route = state.stops.filter(s=>s.status!=='done');
    const reversed=[...route].reverse();
    list.innerHTML = reversed.map((s,i)=>{
      const routeIndex=state.stops.indexOf(s)+1;
      return `<article class="load-card"><div class="load-num">${i+1}</div><div><h3>${escapeHtml(s.items||'Sprzęt do dostawy')}</h3><p><b>Trasa #${routeIndex}</b> · ${escapeHtml(s.address)}</p><p>${i===0?'Najgłębiej w aucie':i===reversed.length-1?'Przy drzwiach — wyjmujesz jako pierwsze':'Środkowa strefa załadunku'}</p></div></article>`;
    }).join('');
  }

  function renderStats(){
    const doneStops=state.stops.filter(s=>s.status==='done');
    $('#statsKm').textContent=fmtKm(state.shift.km);
    $('#statsDone').textContent=doneStops.length;
    $('#avgKm').textContent=doneStops.length ? fmtKm(state.shift.km/doneStops.length) : '—';
    const durations=doneStops.filter(s=>s.actualMinutes).map(s=>s.actualMinutes);
    $('#avgJobTime').textContent=durations.length ? fmtDuration(durations.reduce((a,b)=>a+b,0)/durations.length) : '—';
    const hist=$('#historyList');
    const current={date:state.date,km:state.shift.km,jobs:doneStops.length,workMs:shiftElapsed()};
    const rows=[current,...state.history].slice(0,10);
    hist.innerHTML=rows.map((h,i)=>`<div class="history-row"><div><b>${i===0?'Dzisiaj':new Date(h.date+'T12:00:00').toLocaleDateString('pl-PL',{day:'2-digit',month:'short',year:'numeric'})}</b><small>${h.jobs||0} zleceń · ${fmtClockDuration(h.workMs||0)} pracy</small></div><strong>${fmtKm(h.km)} km</strong></div>`).join('');
  }

  function renderChecklist(){
    $('#checklist').innerHTML=Object.entries(state.checklist).map(([name,done])=>`<label class="check-row ${done?'done':''}"><input type="checkbox" data-check="${escapeHtml(name)}" ${done?'checked':''}><span>${escapeHtml(name)}</span></label>`).join('');
  }

  function renderOdo(){
    const a=parseFloat(state.odoStart), b=parseFloat(state.odoEnd);
    $('#odoResult').textContent=Number.isFinite(a)&&Number.isFinite(b)&&b>=a ? `${fmtKm(b-a)} km` : '—';
  }

  function switchView(view){
    if(view==='scan'){ openScanner(); return; }
    $$('.view').forEach(v=>v.classList.toggle('active',v.dataset.view===view));
    $$('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.target===view));
    window.scrollTo({top:0,behavior:'smooth'});
  }

  function openStopForm(stop=null){
    $('#stopModalTitle').textContent=stop?'Edytuj punkt':'Dodaj punkt';
    $('#stopId').value=stop?.id||''; $('#addressInput').value=stop?.address||''; $('#customerInput').value=stop?.customer||''; $('#phoneInput').value=stop?.phone||'';
    $('#windowFromInput').value=stop?.windowFrom||''; $('#windowToInput').value=stop?.windowTo||''; $('#durationInput').value=String(stop?.duration||30); $('#floorInput').value=stop?.floor||'';
    $('#itemsInput').value=stop?.items||''; $('#notesInput').value=stop?.notes||'';
    $$('#serviceSelector button').forEach(b=>b.classList.toggle('selected',(stop?.services||['Dostawa']).includes(b.dataset.value)));
    $$('#conditionSelector button').forEach(b=>b.classList.toggle('selected',(stop?.conditions||[]).includes(b.dataset.value)));
    showModal('stopModal');
    setTimeout(()=>$('#addressInput').focus(),180);
  }

  function saveStopFromForm(e){
    e.preventDefault();
    const id=$('#stopId').value;
    const services=$$('#serviceSelector button.selected').map(b=>b.dataset.value);
    const conditions=$$('#conditionSelector button.selected').map(b=>b.dataset.value);
    const data={
      id:id||uid(), address:$('#addressInput').value.trim(), customer:$('#customerInput').value.trim(), phone:$('#phoneInput').value.trim(),
      windowFrom:$('#windowFromInput').value, windowTo:$('#windowToInput').value, duration:Number($('#durationInput').value||30), floor:$('#floorInput').value.trim(),
      services:services.length?services:['Dostawa'],conditions,items:$('#itemsInput').value.trim(),notes:$('#notesInput').value.trim(),
      coords:null, status:'pending', createdAt:Date.now(), arrivedAt:null, doneAt:null, actualMinutes:null
    };
    if(id){ const idx=state.stops.findIndex(s=>s.id===id); if(idx>=0) data.createdAt=state.stops[idx].createdAt, data.status=state.stops[idx].status, data.coords=state.stops[idx].address===data.address?state.stops[idx].coords:null, data.arrivedAt=state.stops[idx].arrivedAt, data.doneAt=state.stops[idx].doneAt, data.actualMinutes=state.stops[idx].actualMinutes, state.stops[idx]=data; }
    else state.stops.push(data);
    state.routeInfo={distanceKm:null,durationMin:null,lastOptimized:null,source:null}; save(); hideModal('stopModal'); render(); toast(id?'Punkt zaktualizowany':'Punkt dodany do trasy');
  }

  function showDetail(id){
    const s=state.stops.find(x=>x.id===id); if(!s) return;
    $('#detailTitle').textContent=s.customer||'Szczegóły punktu';
    const phone=s.phone?`<div class="detail-tile"><small>Telefon</small><b>${escapeHtml(s.phone)}</b></div>`:'';
    const time=s.windowFrom?`${s.windowFrom}${s.windowTo?'–'+s.windowTo:''}`:'dowolnie';
    $('#detailBody').innerHTML=`<div class="detail-address">${escapeHtml(s.address)}</div>
      <div class="job-tags">${[...(s.services||[]),...(s.conditions||[])].map(x=>`<span class="tag">${escapeHtml(x)}</span>`).join('')}</div>
      <div class="detail-grid"><div class="detail-tile"><small>Okno</small><b>${escapeHtml(time)}</b></div><div class="detail-tile"><small>Plan pracy</small><b>${s.duration||30} min</b></div>${phone}<div class="detail-tile"><small>Sprzęt</small><b>${escapeHtml(s.items||'—')}</b></div></div>
      ${s.notes?`<div class="detail-notes">${escapeHtml(s.notes)}</div>`:''}
      <div class="status-actions"><button data-status="pending" class="${s.status==='pending'?'active':''}">Do zrobienia</button><button data-status="arrived" class="${s.status==='arrived'?'active':''}">Na miejscu</button><button data-status="done" class="${s.status==='done'?'active':''}">✓ Gotowe</button><button data-status="issue" class="${s.status==='issue'?'active':''}">! Problem</button></div>
      <div class="detail-actions"><button class="primary wide" data-detail-nav="${s.id}">▶ Nawiguj</button>${s.phone?`<button class="secondary" data-call="${s.id}">☎ Zadzwoń</button><button class="secondary" data-sms="${s.id}">✉ Wyślij ETA</button>`:''}<button class="secondary" data-edit="${s.id}">Edytuj</button><button class="danger subtle" data-delete="${s.id}">Usuń</button></div>`;
    $('#detailBody').dataset.id=id; showModal('detailModal');
  }

  function setStatus(id,status){
    const s=state.stops.find(x=>x.id===id); if(!s) return;
    const prev=s.status; s.status=status;
    if(status==='arrived' && !s.arrivedAt) s.arrivedAt=Date.now();
    if(status==='done'){
      s.doneAt=Date.now();
      if(s.arrivedAt) s.actualMinutes=Math.max(1,Math.round((s.doneAt-s.arrivedAt)/60000));
    }
    if(status==='pending' && prev!=='pending'){ s.arrivedAt=null; s.doneAt=null; s.actualMinutes=null; }
    save(); render(); showDetail(id); toast(status==='done'?'Zlecenie zakończone':status==='arrived'?'Oznaczono: na miejscu':'Status zmieniony');
  }

  function moveStop(id,delta){
    const i=state.stops.findIndex(s=>s.id===id), j=clamp(i+delta,0,state.stops.length-1); if(i<0||i===j)return;
    const [x]=state.stops.splice(i,1); state.stops.splice(j,0,x); state.routeInfo={distanceKm:null,durationMin:null,lastOptimized:null,source:null}; save(); render();
  }

  function navigateTo(stop,provider=state.settings.navProvider){
    if(!stop) return;
    const dest=encodeURIComponent(stop.address);
    const url=provider==='apple' ? `https://maps.apple.com/directions?destination=${dest}&mode=driving` : `https://www.google.com/maps/dir/?api=1&destination=${dest}&travelmode=driving&dir_action=navigate`;
    window.location.href=url;
  }

  function startShift(){
    if(state.shift.active){
      state.shift.totalMs += Date.now()-state.shift.startAt; state.shift.startAt=null; state.shift.active=false; state.shift.lastPosition=null; stopGeoWatch(); save(); render(); toast('Zmiana zakończona i zapisana');
    } else {
      state.shift.active=true; state.shift.startAt=Date.now(); state.shift.lastPosition=null; save(); if(state.settings.tracking) startGeoWatch(); render(); toast('Zmiana rozpoczęta');
    }
  }

  function startGeoWatch(){
    if(geoWatchId!==null || !navigator.geolocation) return;
    geoWatchId=navigator.geolocation.watchPosition(pos=>{
      const p={lat:pos.coords.latitude,lon:pos.coords.longitude,acc:pos.coords.accuracy,t:pos.timestamp};
      if(p.acc>100) return;
      const prev=state.shift.lastPosition;
      if(prev){
        const km=haversine(prev,p); const dt=Math.max(1,(p.t-prev.t)/3600000); const implied=km/dt;
        if(km>=0.012 && implied<170){ state.shift.km=Number(state.shift.km||0)+km; }
      }
      state.shift.lastPosition=p; save(); renderToday(); renderStats();
    },err=>{ if(err.code===1) toast('Brak dostępu do lokalizacji — km możesz wpisać z licznika.'); },{enableHighAccuracy:true,maximumAge:5000,timeout:15000});
  }
  function stopGeoWatch(){ if(geoWatchId!==null){navigator.geolocation.clearWatch(geoWatchId);geoWatchId=null;} }
  function haversine(a,b){
    const R=6371, rad=x=>x*Math.PI/180, dLat=rad(b.lat-a.lat), dLon=rad(b.lon-a.lon);
    const x=Math.sin(dLat/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(dLon/2)**2;
    return 2*R*Math.asin(Math.sqrt(x));
  }
  function currentPosition(){
    return new Promise((resolve,reject)=>{
      if(!navigator.geolocation) return reject(new Error('Brak GPS'));
      navigator.geolocation.getCurrentPosition(p=>resolve({lat:p.coords.latitude,lon:p.coords.longitude}),reject,{enableHighAccuracy:true,timeout:12000,maximumAge:30000});
    });
  }

  async function geocode(stop){
    if(stop.coords) return stop.coords;
    let q=stop.address;
    if(state.settings.defaultCity && !q.toLowerCase().includes(state.settings.defaultCity.toLowerCase())) q+=`, ${state.settings.defaultCity}`;
    const url=`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=pl&q=${encodeURIComponent(q)}`;
    const r=await fetch(url,{headers:{'Accept':'application/json'}}); if(!r.ok) throw new Error('Geokodowanie niedostępne');
    const data=await r.json(); if(!data[0]) throw new Error(`Nie znaleziono: ${stop.address}`);
    stop.coords={lat:Number(data[0].lat),lon:Number(data[0].lon)}; return stop.coords;
  }

  function timeToMinutes(t){ if(!t)return null; const [h,m]=t.split(':').map(Number); return h*60+m; }
  function nowMinutes(){ const d=new Date(); return d.getHours()*60+d.getMinutes(); }

  function optimizeGreedy(stops,matrix,hasOrigin){
    const remaining=stops.map((s,i)=>({s,i:i+(hasOrigin?1:0)}));
    const order=[]; let currentIdx=0; let clock=nowMinutes();
    while(remaining.length){
      let best=null;
      for(const cand of remaining){
        const travelSec=matrix?.durations?.[currentIdx]?.[cand.i];
        const travel=Number.isFinite(travelSec)?travelSec/60:25;
        const arrival=clock+travel, ws=timeToMinutes(cand.s.windowFrom), we=timeToMinutes(cand.s.windowTo);
        const wait=ws!=null&&arrival<ws?ws-arrival:0;
        const late=we!=null&&arrival>we?arrival-we:0;
        const urgent=we!=null?Math.max(0,we-arrival):999;
        const score=travel + late*25 + wait*.25 + (urgent<90?-12:0);
        if(!best||score<best.score) best={...cand,score,travel,wait};
      }
      order.push(best.s); clock += best.travel+best.wait+Number(best.s.duration||30); currentIdx=best.i;
      remaining.splice(remaining.findIndex(x=>x.s.id===best.s.id),1);
    }
    return order;
  }

  function optimizeNearest(stops,matrix,hasOrigin){
    const remaining=stops.map((s,i)=>({s,i:i+(hasOrigin?1:0)})); const out=[]; let current=0;
    while(remaining.length){
      remaining.sort((a,b)=>((matrix?.durations?.[current]?.[a.i]??Infinity)-(matrix?.durations?.[current]?.[b.i]??Infinity)));
      const x=remaining.shift(); out.push(x.s); current=x.i;
    }
    return out;
  }

  function routeDistanceForOrder(order, matrix, indexMap, originIndex=0){
    if(!matrix?.distances)return null; let total=0, prev=originIndex;
    for(const s of order){ const idx=indexMap.get(s.id); const d=matrix.distances?.[prev]?.[idx]; if(!Number.isFinite(d)) return null; total+=d; prev=idx; }
    return total/1000;
  }
  function routeDurationForOrder(order, matrix, indexMap, originIndex=0){
    if(!matrix?.durations)return null; let total=0, prev=originIndex;
    for(const s of order){ const idx=indexMap.get(s.id); const d=matrix.durations?.[prev]?.[idx]; if(!Number.isFinite(d)) return null; total+=d; prev=idx; }
    return total/60;
  }

  async function optimizeRoute(){
    const active=state.stops.filter(s=>s.status!=='done'); if(active.length<2){ toast(active.length?'Dodaj co najmniej 2 aktywne punkty.':'Najpierw dodaj adresy.'); return; }
    const progress=$('#routeProgress'); progress.classList.remove('hidden'); $('#optimizeBtn').disabled=true;
    try{
      let origin=null; try{origin=await currentPosition();}catch{toast('GPS niedostępny — liczę trasę od pierwszego adresu.');}
      for(let i=0;i<active.length;i++){ $('#routeProgress em').textContent=`Lokalizuję adres ${i+1}/${active.length}…`; await geocode(active[i]); if(i<active.length-1) await new Promise(r=>setTimeout(r,180)); }
      const points=[...(origin?[origin]:[]),...active.map(s=>s.coords)];
      let matrix=null, source='odległość geograficzna';
      if(points.length<=25){
        try{
          $('#routeProgress em').textContent='Pobieram czasy przejazdu…';
          const coords=points.map(p=>`${p.lon},${p.lat}`).join(';');
          const r=await fetch(`https://router.project-osrm.org/table/v1/driving/${coords}?annotations=duration,distance`);
          if(r.ok){matrix=await r.json(); if(matrix.code!=='Ok')matrix=null; else source='drogi (OSRM)';}
        }catch{}
      }
      if(!matrix){
        const n=points.length; matrix={durations:Array.from({length:n},()=>Array(n).fill(0)),distances:Array.from({length:n},()=>Array(n).fill(0))};
        for(let i=0;i<n;i++)for(let j=0;j<n;j++){const km=haversine(points[i],points[j]);matrix.distances[i][j]=km*1000*1.22;matrix.durations[i][j]=(km*1.22/45)*3600;}
      }
      const hasOrigin=!!origin;
      if(!hasOrigin){
        // matrices without GPS begin at first stop; keep first as anchor and optimize the rest.
        const first=active[0], rest=active.slice(1), subOrder=rest.length ? optimizeGreedy(rest,{durations:matrix.durations.map(r=>r),distances:matrix.distances.map(r=>r)},false) : [];
        // Greedy index mapping above is not meaningful without origin, so use nearest on manual distance below.
        const ordered=[first]; const rem=[...rest]; let cur=first;
        while(rem.length){rem.sort((a,b)=>haversine(cur.coords,a.coords)-haversine(cur.coords,b.coords));cur=rem.shift();ordered.push(cur);} 
        reorderActive(ordered); state.routeInfo.distanceKm=ordered.slice(1).reduce((sum,s,i)=>sum+haversine(ordered[i].coords,s.coords)*1.22,0); state.routeInfo.durationMin=(state.routeInfo.distanceKm/45)*60;
      } else {
        const hasWindows=active.some(s=>s.windowFrom||s.windowTo);
        const ordered=hasWindows?optimizeGreedy(active,matrix,true):optimizeNearest(active,matrix,true);
        reorderActive(ordered);
        const indexMap=new Map(active.map((s,i)=>[s.id,i+1]));
        state.routeInfo.distanceKm=routeDistanceForOrder(ordered,matrix,indexMap,0);
        state.routeInfo.durationMin=routeDurationForOrder(ordered,matrix,indexMap,0);
      }
      state.routeInfo.lastOptimized=Date.now(); state.routeInfo.source=source; save(); render(); toast(`Trasa zoptymalizowana · ${state.routeInfo.distanceKm!=null?fmtKm(state.routeInfo.distanceKm)+' km':'gotowe'}`);
    }catch(e){ console.error(e); toast(e.message||'Nie udało się policzyć trasy. Sprawdź internet i adresy.'); }
    finally{progress.classList.add('hidden'); $('#optimizeBtn').disabled=false; $('#routeProgress em').textContent='Liczenie trasy…';}
  }

  function reorderActive(ordered){
    const done=state.stops.filter(s=>s.status==='done');
    // Completed points stay on top as historical sequence; active route follows.
    state.stops=[...done,...ordered];
  }

  function openScanner(){
    $('#scanBox').classList.remove('hidden'); $('#ocrProgress').classList.add('hidden'); $('#ocrResult').classList.add('hidden'); $('#cameraInput').value=''; showModal('scanModal');
  }
  async function ensureTesseract(){
    if(window.Tesseract)return;
    await new Promise((resolve,reject)=>{ const sc=document.createElement('script'); sc.src='https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js'; sc.onload=resolve; sc.onerror=()=>reject(new Error('Nie udało się załadować OCR. Potrzebny internet.')); document.head.appendChild(sc); });
  }
  function extractAddress(text){
    const lines=text.split(/\r?\n/).map(x=>x.replace(/\s+/g,' ').trim()).filter(Boolean);
    if(!lines.length)return '';
    const streetRx=/(^|\s)(ul\.?|ulica|al\.?|aleja|os\.?|osiedle|pl\.?|plac|rondo|rynek)\s+/i;
    const numRx=/\b\d{1,4}[a-zA-Z]?([\/-]\d{1,4}[a-zA-Z]?)?\b/;
    const postalRx=/\b\d{2}-\d{3}\b/;
    let scored=lines.map((line,i)=>({line,i,score:(streetRx.test(line)?5:0)+(numRx.test(line)?2:0)+(postalRx.test(line)?4:0)+(line.length<70?1:0)})).sort((a,b)=>b.score-a.score);
    let best=scored[0]; if(!best||best.score<2)best={line:lines.slice(0,2).join(', '),i:0};
    let result=best.line;
    const neighbor=lines[best.i+1]; if(neighbor && (postalRx.test(neighbor)||(!streetRx.test(neighbor)&&neighbor.length<45&&/[A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż]/.test(neighbor)))) result+=`, ${neighbor}`;
    if(state.settings.defaultCity && !result.toLowerCase().includes(state.settings.defaultCity.toLowerCase())) result+=`, ${state.settings.defaultCity}`;
    return result;
  }
  async function handleCamera(file){
    if(!file)return;
    $('#scanBox').classList.add('hidden'); $('#ocrProgress').classList.remove('hidden'); $('#ocrResult').classList.add('hidden');
    try{
      $('#ocrStatus').textContent='Ładowanie lokalnego silnika OCR…'; await ensureTesseract();
      const opts={logger:m=>{ if(m.status){ const pct=m.progress?` ${Math.round(m.progress*100)}%`:''; $('#ocrStatus').textContent=`${translateOcrStatus(m.status)}${pct}`; } }};
      let result;
      try{ result=await Tesseract.recognize(file,'pol+eng',opts); } catch { result=await Tesseract.recognize(file,'eng',opts); }
      const raw=result?.data?.text||''; $('#ocrRaw').textContent=raw; $('#ocrAddress').value=extractAddress(raw);
      $('#ocrProgress').classList.add('hidden'); $('#ocrResult').classList.remove('hidden');
    }catch(e){console.error(e); $('#ocrProgress').classList.add('hidden'); $('#scanBox').classList.remove('hidden'); toast(e.message||'OCR nie zadziałał. Spróbuj ponownie.');}
  }
  function translateOcrStatus(s){ return ({'loading tesseract core':'Uruchamiam OCR…','initializing tesseract':'Inicjalizacja…','loading language traineddata':'Pobieram język…','initializing api':'Przygotowuję model…','recognizing text':'Czytam adres…'}[s]||'Przetwarzam zdjęcie…'); }

  function useOcr(){
    const address=$('#ocrAddress').value.trim(); if(!address){toast('Nie wykryto adresu — wpisz go ręcznie.');return;}
    hideModal('scanModal'); openStopForm(); $('#addressInput').value=address;
  }

  function exportCsv(){
    const rows=[['data','km','zlecenia','czas_pracy_min'],[state.date,state.shift.km,state.stops.filter(s=>s.status==='done').length,Math.round(shiftElapsed()/60000)],...state.history.map(h=>[h.date,h.km,h.jobs,Math.round((h.workMs||0)/60000)])];
    const csv='\ufeff'+rows.map(r=>r.map(v=>`"${String(v??'').replace(/"/g,'""')}"`).join(';')).join('\n');
    const blob=new Blob([csv],{type:'text/csv;charset=utf-8'}), url=URL.createObjectURL(blob), a=document.createElement('a'); a.href=url;a.download=`dostawca-plus-${state.date}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }

  function sendEta(id){
    const s=state.stops.find(x=>x.id===id); if(!s?.phone)return;
    const msg=`Dzień dobry, jestem dostawcą. Jestem w trasie do Państwa pod adres ${s.address}. Przewidywany czas dojazdu może zależeć od poprzednich zleceń. W razie potrzeby proszę o kontakt.`;
    window.location.href=`sms:${s.phone.replace(/\s/g,'')}?&body=${encodeURIComponent(msg)}`;
  }

  function tick(){ renderToday(); }

  function bind(){
    $$('.nav-item').forEach(b=>b.addEventListener('click',()=>switchView(b.dataset.target)));
    $('#shiftBtn').addEventListener('click',startShift);
    $('#addStopBtn').addEventListener('click',()=>openStopForm()); $('#emptyAddBtn').addEventListener('click',()=>openStopForm());
    $('#scanAddressBtn').addEventListener('click',openScanner); $('#optimizeBtn').addEventListener('click',optimizeRoute);
    $$('.quick-action').forEach(b=>b.addEventListener('click',()=>{ const a=b.dataset.action;if(a==='scan')openScanner();if(a==='add')openStopForm();if(a==='optimize'){switchView('route');optimizeRoute();}if(a==='load')switchView('load'); }));
    $('#stopForm').addEventListener('submit',saveStopFromForm);
    $$('.chip-selector').forEach(sel=>sel.addEventListener('click',e=>{ if(e.target.tagName==='BUTTON')e.target.classList.toggle('selected'); }));
    $$('[data-close]').forEach(b=>b.addEventListener('click',()=>hideModal(b.dataset.close)));
    $$('.modal-backdrop').forEach(m=>m.addEventListener('click',e=>{if(e.target===m)hideModal(m.id)}));
    $('#cameraInput').addEventListener('change',e=>handleCamera(e.target.files?.[0])); $('#useOcrBtn').addEventListener('click',useOcr);
    $('#settingsBtn').addEventListener('click',()=>showModal('settingsModal'));
    $('#themeBtn').addEventListener('click',()=>{ const isDark=document.documentElement.dataset.theme==='dark'; state.settings.theme=isDark?'light':'dark';save();applyTheme();});
    $('#trackingToggle').addEventListener('change',e=>{state.settings.tracking=e.target.checked;save(); if(state.shift.active){e.target.checked?startGeoWatch():stopGeoWatch();}});
    $('#navProvider').addEventListener('change',e=>{state.settings.navProvider=e.target.value;save();});
    $('#defaultCity').addEventListener('input',e=>{state.settings.defaultCity=e.target.value.trim();save();});
    $('#clearDataBtn').addEventListener('click',()=>{if(confirm('Na pewno usunąć adresy, historię, kilometry i ustawienia zapisane na tym urządzeniu?')){localStorage.removeItem(STORE_KEY);state=initialState();stopGeoWatch();save();hideModal('settingsModal');render();toast('Dane wyczyszczone');}});
    $('#resetChecklistBtn').addEventListener('click',()=>{Object.keys(state.checklist).forEach(k=>state.checklist[k]=false);save();renderChecklist();});
    $('#checklist').addEventListener('change',e=>{if(e.target.dataset.check){state.checklist[e.target.dataset.check]=e.target.checked;save();renderChecklist();}});
    $('#stopsList').addEventListener('click',e=>{
      const id=e.target.dataset.nav||e.target.dataset.up||e.target.dataset.down||e.target.dataset.openDetail||e.target.closest('[data-open-detail]')?.dataset.openDetail;
      if(e.target.dataset.nav){navigateTo(state.stops.find(s=>s.id===id));return;} if(e.target.dataset.up){moveStop(id,-1);return;} if(e.target.dataset.down){moveStop(id,1);return;} if(id)showDetail(id);
    });
    $('#detailBody').addEventListener('click',e=>{
      const id=$('#detailBody').dataset.id; if(!id)return;
      if(e.target.dataset.status){setStatus(id,e.target.dataset.status);return;}
      if(e.target.dataset.detailNav){navigateTo(state.stops.find(s=>s.id===id));return;}
      if(e.target.dataset.call){const s=state.stops.find(x=>x.id===id);window.location.href=`tel:${s.phone.replace(/\s/g,'')}`;return;}
      if(e.target.dataset.sms){sendEta(id);return;}
      if(e.target.dataset.edit){const s=state.stops.find(x=>x.id===id);hideModal('detailModal');openStopForm(s);return;}
      if(e.target.dataset.delete){if(confirm('Usunąć ten punkt z trasy?')){state.stops=state.stops.filter(x=>x.id!==id);state.routeInfo={distanceKm:null,durationMin:null,lastOptimized:null,source:null};save();hideModal('detailModal');render();toast('Punkt usunięty');}return;}
    });
    $('#goNextBtn').addEventListener('click',e=>navigateTo(state.stops.find(s=>s.id===e.currentTarget.dataset.id)));
    $('#arrivedNextBtn').addEventListener('click',e=>{const id=e.currentTarget.dataset.id;setStatus(id,'arrived');hideModal('detailModal');});
    $('#odoStart').addEventListener('input',e=>{state.odoStart=e.target.value;save();renderOdo();}); $('#odoEnd').addEventListener('input',e=>{state.odoEnd=e.target.value;save();renderOdo();});
    $('#exportBtn').addEventListener('click',exportCsv);
    document.addEventListener('visibilitychange',()=>{if(!document.hidden&&state.shift.active&&state.settings.tracking)startGeoWatch();});
  }

  function init(){
    bind(); render();
    if(state.shift.active&&state.settings.tracking)startGeoWatch();
    ticker=setInterval(tick,30000);
    if('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('./service-worker.js').catch(()=>{});
  }

  init();
})();
