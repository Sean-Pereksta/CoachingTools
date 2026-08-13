(function initCoachToolsFolders(root) {
  'use strict';
  const FOLDERS = Object.freeze([
    { id:'coach-analytics-tools', name:'Coach Analytics Tools', icon:'icons/analyticsfolder.png', members:['coaching-gaps','kpi-impact','qa-scores'], description:'Coaching Gaps, KPI Impact, and QA Scores' },
    { id:'audit-apps', name:'Audit Apps', icon:'icons/otherfolder.png', members:['coach-timeline','audit-checklist'], description:'Coach Timeline and Audit / Checklist' },
    { id:'under-construction', name:'Under Construction', icon:'icons/underconstructionfolder.png', members:['people-profiles','coaching-command-center'], description:'People Profiles and Coaching Command Center' }
  ]);
  const folderByMember = new Map();
  FOLDERS.forEach(folder => folder.members.forEach(id => folderByMember.set(id, folder)));
  const dialogs = new Map();
  let appGrid, observer, organizing = false;

  function makeIcon(folder) {
    const wrap = document.createElement('span'); wrap.className = 'app-icon';
    const fallback = document.createElement('span'); fallback.className='fallback-initials'; fallback.textContent=folder.name.split(/\s+/).map(w=>w[0]).join('').slice(0,3).toUpperCase();
    const img = document.createElement('img'); img.alt=''; img.src=folder.icon; img.loading='eager'; img.addEventListener('load',()=>wrap.classList.add('loaded')); img.addEventListener('error',()=>img.remove());
    wrap.append(fallback,img); return wrap;
  }

  function ensureDialog(folder) {
    if (dialogs.has(folder.id)) return dialogs.get(folder.id);
    const dialog=document.createElement('dialog'); dialog.className='folder-dialog'; dialog.dataset.folderId=folder.id;
    dialog.innerHTML=`<section class="folder-dialog-shell"><header class="folder-dialog-header"><img class="folder-dialog-icon" src="${folder.icon}" alt=""><div class="folder-dialog-heading"><p class="eyebrow">CoachTools folder</p><h2>${folder.name}</h2><p>${folder.description}</p></div><button type="button" class="folder-dialog-close" aria-label="Close ${folder.name}">×</button></header><div class="folder-app-grid" data-folder-grid="${folder.id}" role="listbox" aria-label="${folder.name} applications"></div></section>`;
    const headerIcon=dialog.querySelector('.folder-dialog-icon'); headerIcon.addEventListener('error',()=>{ headerIcon.hidden=true; });
    dialog.querySelector('.folder-dialog-close').addEventListener('click',()=>dialog.close());
    dialog.addEventListener('click',event=>{ if(event.target===dialog) dialog.close(); });
    dialog.querySelector('.folder-app-grid').addEventListener('dblclick',event=>{ if(event.target.closest('[data-app-id]')) root.setTimeout(()=>dialog.close(),0); });
    document.body.appendChild(dialog); dialogs.set(folder.id,dialog); return dialog;
  }

  function openFolder(folder) { const dialog=ensureDialog(folder); if(typeof dialog.showModal==='function'){ if(!dialog.open) dialog.showModal(); } else dialog.setAttribute('open',''); }

  function folderCard(folder,count) {
    const tile=document.createElement('button'); tile.type='button'; tile.className='app-card desktop-folder-card'; tile.dataset.folderId=folder.id; tile.setAttribute('role','option'); tile.setAttribute('aria-selected','false'); tile.setAttribute('aria-label',`${folder.name}. ${count} applications. Double-click to open.`);
    const main=document.createElement('span'); main.className='app-card-main'; main.appendChild(makeIcon(folder));
    const name=document.createElement('span'); name.className='app-name'; name.textContent=folder.name; main.appendChild(name);
    const status=document.createElement('span'); status.className='app-status ready'; status.textContent=`${count} app${count===1?'':'s'}`; tile.append(main,status);
    tile.addEventListener('click',()=>{ appGrid.querySelectorAll('.desktop-folder-card').forEach(card=>{ const selected=card===tile; card.classList.toggle('selected',selected); card.setAttribute('aria-selected',String(selected)); }); });
    tile.addEventListener('dblclick',()=>openFolder(folder)); tile.addEventListener('keydown',event=>{ if(event.key==='Enter'){ event.preventDefault(); openFolder(folder); } }); return tile;
  }

  function organize() {
    if(!appGrid||organizing) return; organizing=true; observer&&observer.disconnect();
    try {
      appGrid.querySelectorAll('.desktop-folder-card').forEach(card=>card.remove());
      const grouped=new Map();
      Array.from(appGrid.querySelectorAll('[data-app-id]')).forEach(tile=>{ const folder=folderByMember.get(tile.dataset.appId); if(!folder) return; if(!grouped.has(folder.id)) grouped.set(folder.id,[]); grouped.get(folder.id).push(tile); });
      const fragment=document.createDocumentFragment();
      FOLDERS.forEach(folder=>{ const tiles=grouped.get(folder.id)||[]; const dialog=ensureDialog(folder); dialog.querySelector('[data-folder-grid]').replaceChildren(...tiles); if(tiles.length) fragment.appendChild(folderCard(folder,tiles.length)); else if(dialog.open) dialog.close(); });
      appGrid.prepend(fragment);
    } finally { observer&&observer.observe(appGrid,{childList:true}); organizing=false; }
  }

  function start(){ appGrid=document.getElementById('appGrid'); if(!appGrid) return; FOLDERS.forEach(ensureDialog); observer=new MutationObserver(()=>root.requestAnimationFrame(organize)); observer.observe(appGrid,{childList:true}); organize(); }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',start,{once:true}); else start();
})(window);
