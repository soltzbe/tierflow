(() => {
  'use strict';

  const palette = ['#ff7f7f','#ffbf7f','#ffdf7f','#ffff7f','#bfff7f','#7fff7f','#7fffff','#7fbfff','#7f7fff','#bf7fff','#ff7fff','#cfcfcf'];
  const $ = selector => document.querySelector(selector);
  const state = { title:'', source:'', tiers:[], remaining:[], ranked:[], history:[] };
  let draggedRankedId = null;
  let selectedRankedId = null;

  function setStatus(text, isError=false){ const el=$('#status'); el.textContent=text; el.className=`status${isError?' error':''}`; }
  function normalizeInputUrl(value){
    let raw=String(value||'').trim().replace(/^<|>$/g,'').trim();
    if(!raw)return null;
    if(!/^https?:\/\//i.test(raw))raw=`https://${raw}`;
    try{
      const url=new URL(raw);
      const host=url.hostname.toLowerCase();

      const isTemplate=(host==='tiermaker.com'||host==='www.tiermaker.com')&&/^\/create\/[^/]+/i.test(url.pathname);
      const isLive=host==='live.tiermaker.com'&&/^\/[^/]+\/?$/i.test(url.pathname)&&url.pathname!=='/';

      if(!isTemplate&&!isLive)return null;
      url.protocol='https:';
      url.hash='';
      return url.href;
    }catch{
      return null;
    }
  }
  const WORKER_BASE = 'https://tierflow-importer.marcusoltzberg-4a1.workers.dev';
  const IMPORT_ENDPOINT = `${WORKER_BASE}/api/import`;
  const IMAGE_PROXY_ENDPOINT = `${WORKER_BASE}/api/image`;
  function basename(url){ try{const part=new URL(url).pathname.split('/').pop()||'item';return decodeURIComponent(part).replace(/[-_]+/g,' ').replace(/\.[^.]+$/,'').slice(0,70)}catch{return 'item'} }
  function sanitizeImages(images){ return [...new Set((images||[]).filter(Boolean))].map((src,i)=>({id:`i${i}`,src,name:basename(src)})); }

  function rerankItem(itemId){
    const entry=state.ranked.find(entry=>entry.item.id===itemId);
    if(!entry)return;
    selectedRankedId=itemId;
    setStatus(`Re-ranking ${entry.item.name}. It stays in ${state.tiers[entry.tier]?.name||'its current tier'} until you choose a different tier.`);
    render();
  }

  function moveRankedItem(itemId, targetTier){
    const entry=state.ranked.find(e=>e.item.id===itemId); if(!entry||!state.tiers[targetTier])return;
    const previousTier=entry.tier; if(previousTier===targetTier)return;
    entry.tier=targetTier;
    if(selectedRankedId===itemId)selectedRankedId=null;
    state.history.push({type:'move-ranked',itemId,from:previousTier,to:targetTier});
    setStatus(`Moved ${entry.item.name} to ${state.tiers[targetTier].name}.`);
    render();
  }

  function fitVoteButtonText(button, text){
  if(!button) return;
  button.textContent = text;
  button.title = text;
}

function fitBoardLabel(label){
  if(!label) return;
  let size = 21;
  label.style.fontSize = size + 'px';

  // Shrink until the renamed tier fits inside the fixed-height label.
  while (
    size > 10 &&
    (label.scrollHeight > label.clientHeight || label.scrollWidth > label.clientWidth)
  ){
    size -= 1;
    label.style.fontSize = size + 'px';
  }
}

function getSkipKey(){
  const count=state.tiers.length;
  if(count<9)return String(count+1);
  if(count===9)return '0';
  return 's';
}

function updateShortcutLabels(){
  const skipKey=getSkipKey();
  const skip=$('#skip');
  if(skip){
    skip.textContent=`SKIP · ${skipKey.toUpperCase()}`;
    skip.title=`Skip (${skipKey.toUpperCase()})`;
    skip.setAttribute('aria-keyshortcuts',skipKey);
  }
}

async function loadExportImage(src){
  const proxyUrl=`${IMAGE_PROXY_ENDPOINT}?url=${encodeURIComponent(src)}`;
  const response=await fetch(proxyUrl);
  if(!response.ok)throw new Error(`Could not load an image for export (HTTP ${response.status}).`);
  const blob=await response.blob();
  if('createImageBitmap' in window){
    try{return await createImageBitmap(blob)}catch{}
  }
  const objectUrl=URL.createObjectURL(blob);
  try{
    return await new Promise((resolve,reject)=>{
      const img=new Image();
      img.onload=()=>resolve(img);
      img.onerror=()=>reject(new Error('Could not decode an image for export.'));
      img.src=objectUrl;
    });
  } finally {
    setTimeout(()=>URL.revokeObjectURL(objectUrl),1000);
  }
}

function drawFittedLabel(ctx,text,x,y,w,h){
  const value=String(text||'');
  let size=28;
  ctx.textAlign='center';
  ctx.textBaseline='middle';
  ctx.font=`900 ${size}px Arial, sans-serif`;
  while(size>12 && ctx.measureText(value).width>w-14){
    size-=1;
    ctx.font=`900 ${size}px Arial, sans-serif`;
  }
  let draw=value;
  if(ctx.measureText(draw).width>w-12){
    while(draw.length>1 && ctx.measureText(draw+'…').width>w-12)draw=draw.slice(0,-1);
    draw+='…';
  }
  ctx.fillStyle='#161816';
  ctx.fillText(draw,x+w/2,y+h/2);
}

async function downloadTierList(){
  if(!state.ranked.length){setStatus('Rank at least one item before downloading.',true);return}
  const button=$('#downloadPng');
  button.disabled=true;
  const oldText=button.textContent;
  button.textContent='Preparing…';
  setStatus('Preparing PNG…');
  try{
    const labelWidth=190;
    const rowHeight=108;
    const thumb=96;
    const gap=0;
    const minItemsWidth=720;
    const perTier=state.tiers.map((_,i)=>state.ranked.filter(entry=>entry.tier===i));
    const maxCount=Math.max(1,...perTier.map(items=>items.length));
    const itemsWidth=Math.max(minItemsWidth,maxCount*(thumb+gap));
    const width=labelWidth+itemsWidth;
    const titleHeight=70;
    const height=titleHeight+state.tiers.length*rowHeight;
    const scale=Math.min(2,Math.max(1,window.devicePixelRatio||1));
    const canvas=document.createElement('canvas');
    canvas.width=Math.round(width*scale);
    canvas.height=Math.round(height*scale);
    const ctx=canvas.getContext('2d');
    ctx.scale(scale,scale);
    ctx.fillStyle='#0b0c0b';
    ctx.fillRect(0,0,width,height);
    ctx.fillStyle='#f5f5f3';
    ctx.font='900 30px Arial, sans-serif';
    ctx.textAlign='left';
    ctx.textBaseline='middle';
    const title=String(state.title||'Tier List');
    ctx.fillText(title.slice(0,80),20,titleHeight/2);

    const imageMap=new Map();
    const unique=[...new Set(state.ranked.map(entry=>entry.item.src))];
    await Promise.all(unique.map(async src=>{
      try{imageMap.set(src,await loadExportImage(src))}catch(error){console.warn(error)}
    }));

    state.tiers.forEach((tier,tierIndex)=>{
      const y=titleHeight+tierIndex*rowHeight;
      ctx.fillStyle=tier.color;
      ctx.fillRect(0,y,labelWidth,rowHeight-4);
      drawFittedLabel(ctx,tier.name,0,y,labelWidth,rowHeight-4);
      ctx.fillStyle='#181a18';
      ctx.fillRect(labelWidth,y,itemsWidth,rowHeight-4);
      const entries=perTier[tierIndex];
      entries.forEach((entry,index)=>{
        const img=imageMap.get(entry.item.src);
        if(!img)return;
        const x=labelWidth+index*thumb+6;
        const iy=y+6;
        const box=thumb-12;
        const iw=img.width||img.naturalWidth||box;
        const ih=img.height||img.naturalHeight||box;
        const ratio=Math.min(box/iw,box/ih);
        const dw=iw*ratio, dh=ih*ratio;
        ctx.drawImage(img,x+(box-dw)/2,iy+(box-dh)/2,dw,dh);
      });
    });

    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
    if(!blob)throw new Error('The browser could not create the PNG.');
    const a=document.createElement('a');
    const safe=(state.title||'tier-list').replace(/[^a-z0-9]+/gi,'-').replace(/^-|-$/g,'').toLowerCase()||'tier-list';
    a.href=URL.createObjectURL(blob);
    a.download=`${safe}.png`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(()=>URL.revokeObjectURL(a.href),1500);
    setStatus('Downloaded tier list PNG.');
  }catch(error){
    setStatus(error?.message||'Could not download the tier list.',true);
  }finally{
    button.disabled=false;
    button.textContent=oldText;
  }
}

function render(){
    const done=state.ranked.length, total=done+state.remaining.length;
    const selectedEntry=selectedRankedId?state.ranked.find(entry=>entry.item.id===selectedRankedId):null;
    const current=selectedEntry?.item||state.remaining[0];
    $('#workspace').hidden=!(current||done); $('#title').textContent=state.title||'Imported Tier List'; $('#progress').textContent=`${done} / ${total}`; $('#progressFill').style.width=`${total?Math.round(done/total*100):0}%`;
    const source=$('#source'); source.href=state.source||'#'; source.textContent=state.source||''; source.hidden=!state.source;
    const currentImg=$('#currentImg'); currentImg.src=current?.src||''; currentImg.alt=current?.name||'No remaining item'; currentImg.hidden=!current;
    $('#currentHeading').textContent=current?.name||(total?'All items ranked':'No items'); $('#itemIndex').textContent=current?(selectedEntry?`Currently in ${state.tiers[selectedEntry.tier]?.name||'tier'}`:`${done+1} of ${total}`):'';
    $('#undo').disabled=state.history.length===0; $('#skip').disabled=selectedEntry?false:state.remaining.length<2; $('#shuffle').disabled=state.remaining.length<2; updateShortcutLabels();

    const tierButtons=$('#tierButtons'); tierButtons.replaceChildren();
    state.tiers.forEach((tier,i)=>{const button=document.createElement('button');button.type='button';button.className='tier-btn';button.style.background=tier.color;button.title=tier.name;const label=document.createElement('span');label.className='tier-btn-label';label.textContent=tier.name;button.append(label);button.addEventListener('click',()=>rank(i));tierButtons.append(button)});

    const queue=$('#queue'); queue.replaceChildren();
    if(!state.remaining.length){const empty=document.createElement('div');empty.className='queue-empty';empty.textContent=total?'All items ranked.':'No items loaded.';queue.append(empty)}
    else state.remaining.forEach((item,i)=>{const cell=document.createElement('div');cell.className=`queue-thumb${i===0?' current':''}`;cell.title=item.name;const img=document.createElement('img');img.src=item.src;img.alt=item.name;img.loading=i<10?'eager':'lazy';cell.append(img);queue.append(cell)});

    const board=$('#board'); board.replaceChildren();
    // Grow the LEFT tier-label column when a renamed tier has a longer title.
    // The compact vote buttons on the right intentionally remain unchanged.
    const longestTierName = state.tiers.reduce((max,tier)=>Math.max(max,String(tier.name||'').length),1);
    const tierLabelWidth = Math.min(155, Math.max(92, 70 + longestTierName * 4.2));
    board.style.setProperty('--tier-label-width', `${tierLabelWidth}px`);
    state.tiers.forEach((tier,tierIndex)=>{
      const row=document.createElement('div'); row.className='board-row'; row.dataset.tier=String(tierIndex);
      const label=document.createElement('div'); label.className='board-label'; label.style.background=tier.color; label.textContent=tier.name;
      const items=document.createElement('div'); items.className='board-items';

      row.addEventListener('dragover',e=>{if(!draggedRankedId)return;e.preventDefault();row.classList.add('drag-over')});
      row.addEventListener('dragleave',e=>{if(!row.contains(e.relatedTarget))row.classList.remove('drag-over')});
      row.addEventListener('drop',e=>{e.preventDefault();row.classList.remove('drag-over');const id=e.dataTransfer?.getData('text/plain')||draggedRankedId;if(id)moveRankedItem(id,tierIndex)});

      state.ranked.filter(entry=>entry.tier===tierIndex).forEach(entry=>{
        const cell=document.createElement('button'); cell.type='button'; cell.className=`thumb${selectedRankedId===entry.item.id?' selected':''}`; cell.title=`${entry.item.name} — click to re-rank or drag to another tier`; cell.draggable=true; cell.dataset.itemId=entry.item.id;
        const img=document.createElement('img'); img.src=entry.item.src; img.alt=entry.item.name; img.loading='lazy'; cell.append(img);
        cell.addEventListener('click',()=>rerankItem(entry.item.id));
        cell.addEventListener('dragstart',e=>{draggedRankedId=entry.item.id;cell.classList.add('dragging');if(e.dataTransfer){e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',entry.item.id)}});
        cell.addEventListener('dragend',()=>{draggedRankedId=null;cell.classList.remove('dragging');document.querySelectorAll('.board-row.drag-over').forEach(el=>el.classList.remove('drag-over'))});
        items.append(cell);
      });
      row.append(label,items); board.append(row); fitBoardLabel(label);
    });
  }

  function rank(tierIndex){
    if(!state.tiers[tierIndex])return;
    if(selectedRankedId){
      const entry=state.ranked.find(e=>e.item.id===selectedRankedId);
      if(!entry){selectedRankedId=null;render();return;}
      const from=entry.tier;
      if(from!==tierIndex){
        entry.tier=tierIndex;
        state.history.push({type:'move-ranked',itemId:entry.item.id,from,to:tierIndex});
        setStatus(`Moved ${entry.item.name} to ${state.tiers[tierIndex].name}.`);
      }else{
        setStatus(`${entry.item.name} stays in ${state.tiers[from].name}.`);
      }
      selectedRankedId=null;
      render();
      return;
    }
    const item=state.remaining.shift();
    if(!item)return;
    state.ranked.push({item,tier:tierIndex});
    state.history.push({type:'rank',item,tier:tierIndex});
    render();
  }
  function undo(){
    const action=state.history.pop(); if(!action)return;
    if(action.type==='rank'){const index=state.ranked.findIndex(entry=>entry.item.id===action.item.id);if(index>=0)state.ranked.splice(index,1);state.remaining.unshift(action.item)}
    else if(action.type==='skip'){state.remaining=[...action.before]}
    else if(action.type==='move-ranked'){const entry=state.ranked.find(e=>e.item.id===action.itemId);if(entry)entry.tier=action.from}
    else if(action.type==='rerank-open'){state.remaining=state.remaining.filter(item=>item.id!==action.entry.item.id);const insertAt=Math.max(0,Math.min(action.index,state.ranked.length));state.ranked.splice(insertAt,0,action.entry)}
    render();
  }
  function skip(){
    if(selectedRankedId){
      const entry=state.ranked.find(e=>e.item.id===selectedRankedId);
      selectedRankedId=null;
      if(entry)setStatus(`${entry.item.name} stays in ${state.tiers[entry.tier]?.name||'its current tier'}.`);
      render();
      return;
    }
    if(state.remaining.length<2)return;
    const before=[...state.remaining];
    state.remaining.push(state.remaining.shift());
    state.history.push({type:'skip',before});
    render();
  }
  function shuffleRemaining(){ for(let i=state.remaining.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[state.remaining[i],state.remaining[j]]=[state.remaining[j],state.remaining[i]]} render(); }

  async function importTemplate(event){
    event.preventDefault(); const tierMakerUrl=normalizeInputUrl($('#url').value); if(!tierMakerUrl){setStatus('Paste a TierMaker template link or a live.tiermaker.com event link.',true);return}
    setStatus('Importing template…');
    try{const response=await fetch(IMPORT_ENDPOINT,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({url:tierMakerUrl})});let data;try{data=await response.json()}catch{throw new Error(`Importer returned HTTP ${response.status} instead of JSON.`)}if(!response.ok)throw new Error(data.error||'Import failed.');state.title=data.title||'Imported Tier List';state.source=data.source||tierMakerUrl;state.tiers=(data.labels?.length?data.labels:['S','A','B','C','D','F']).slice(0,12).map((name,i)=>({name,color:palette[i%palette.length]}));state.remaining=sanitizeImages(data.images);state.ranked=[];state.history=[];selectedRankedId=null;if(!state.remaining.length)throw new Error('The importer did not return any candidate images.');setStatus(`Imported ${state.remaining.length} images. Rank one item at a time.`);render()}catch(error){setStatus(error?.message||String(error),true)}
  }

  function openTierEditor(){ const editor=$('#tierEditor');editor.replaceChildren();state.tiers.forEach((tier,i)=>{const row=document.createElement('div');row.className='editor-row';const color=document.createElement('input');color.type='color';color.value=/^#[0-9a-f]{6}$/i.test(tier.color)?tier.color:'#cccccc';color.dataset.index=String(i);color.dataset.role='color';const name=document.createElement('input');name.type='text';name.value=tier.name;name.dataset.index=String(i);name.dataset.role='name';const remove=document.createElement('button');remove.type='button';remove.className='btn danger delete-tier';remove.textContent='Delete';remove.disabled=state.tiers.length<=2;remove.addEventListener('click',()=>deleteTier(i));row.append(color,name,remove);editor.append(row)});$('#tierDialog').showModal() }
  function deleteTier(index){ if(state.tiers.length<=2)return;const removed=state.ranked.filter(entry=>entry.tier===index).map(entry=>entry.item);state.ranked=state.ranked.filter(entry=>entry.tier!==index).map(entry=>({...entry,tier:entry.tier>index?entry.tier-1:entry.tier}));state.remaining.unshift(...removed);if(selectedRankedId&&removed.some(item=>item.id===selectedRankedId))selectedRankedId=null;state.tiers.splice(index,1);state.history=[];openTierEditor() }
  function addTier(){ if(state.tiers.length>=12)return;state.tiers.push({name:'New tier',color:palette[state.tiers.length%palette.length]});openTierEditor() }
  function saveTiers(){ document.querySelectorAll('#tierEditor input').forEach(input=>{const i=Number(input.dataset.index);if(!Number.isInteger(i)||!state.tiers[i])return;if(input.dataset.role==='name')state.tiers[i].name=input.value.trim()||`Tier ${i+1}`;if(input.dataset.role==='color')state.tiers[i].color=input.value});$('#tierDialog').close();render() }

  $('#importForm').addEventListener('submit',importTemplate);$('#downloadPng').addEventListener('click',downloadTierList);$('#undo').addEventListener('click',undo);$('#skip').addEventListener('click',skip);$('#shuffle').addEventListener('click',shuffleRemaining);$('#editTiers').addEventListener('click',openTierEditor);$('#addTier').addEventListener('click',addTier);$('#saveTiers').addEventListener('click',saveTiers);
  document.addEventListener('keydown',event=>{if(/INPUT|TEXTAREA|SELECT/.test(event.target.tagName))return;const key=event.key.toLowerCase();const skipKey=getSkipKey();if(key===skipKey){event.preventDefault();skip();return}if(event.key>='1'&&event.key<='9'){const i=Number(event.key)-1;if(state.tiers[i]){event.preventDefault();rank(i)}return}if(key==='z'){event.preventDefault();undo();return}if(key==='s'){event.preventDefault();skip()}});
  render();
})();
