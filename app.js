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
  const IMPORT_ENDPOINT = 'https://tierflow-importer.marcusoltzberg-4a1.workers.dev/api/import';
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

function render(){
    const done=state.ranked.length, total=done+state.remaining.length;
    const selectedEntry=selectedRankedId?state.ranked.find(entry=>entry.item.id===selectedRankedId):null;
    const current=selectedEntry?.item||state.remaining[0];
    $('#workspace').hidden=!(current||done); $('#title').textContent=state.title||'Imported Tier List'; $('#progress').textContent=`${done} / ${total}`; $('#progressFill').style.width=`${total?Math.round(done/total*100):0}%`;
    const source=$('#source'); source.href=state.source||'#'; source.textContent=state.source||''; source.hidden=!state.source;
    const currentImg=$('#currentImg'); currentImg.src=current?.src||''; currentImg.alt=current?.name||'No remaining item'; currentImg.hidden=!current;
    $('#currentHeading').textContent=current?.name||(total?'All items ranked':'No items'); $('#itemIndex').textContent=current?(selectedEntry?`Currently in ${state.tiers[selectedEntry.tier]?.name||'tier'}`:`${done+1} of ${total}`):'';
    $('#undo').disabled=state.history.length===0; $('#skip').disabled=selectedEntry?false:state.remaining.length<2; $('#shuffle').disabled=state.remaining.length<2;

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

  $('#importForm').addEventListener('submit',importTemplate);$('#undo').addEventListener('click',undo);$('#skip').addEventListener('click',skip);$('#shuffle').addEventListener('click',shuffleRemaining);$('#editTiers').addEventListener('click',openTierEditor);$('#addTier').addEventListener('click',addTier);$('#saveTiers').addEventListener('click',saveTiers);
  document.addEventListener('keydown',event=>{if(/INPUT|TEXTAREA|SELECT/.test(event.target.tagName))return;if(event.key>='1'&&event.key<='9'){const i=Number(event.key)-1;if(state.tiers[i])rank(i);return}if(event.key.toLowerCase()==='z')undo();if(event.key.toLowerCase()==='s')skip()});
  render();
})();
