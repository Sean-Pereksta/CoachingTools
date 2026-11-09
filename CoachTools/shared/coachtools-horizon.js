(function horizonWorkspace(root) {
  'use strict';
  const $ = id => document.getElementById(id);
  let scopeGeneration = 0;
  let opener = null;
  function currentScope() { return root.CoachToolsStorage?.getScope?.() || {mode:'all',label:'All people'}; }
  function scopeName(scope) { return scope.mode === 'all' ? 'All people' : scope.label || scope.coaches?.[0] || scope.representatives?.[0] || scope.team || scope.department || 'Selected data view'; }
  function modeName(mode) { return ({coach:'Coach',representative:'Representative',team:'Team',department:'Department',coordinator:'Coordinator'})[mode] || 'Data view'; }
  function scopeOptions() {
    return [...($('globalScopeSelect')?.options || [])].filter(option => option.value !== 'all:').map(option => {
      const mode = option.value.split(':')[0];
      return {value:option.value,mode,label:option.textContent.replace(/^(?:Saved )?(?:Coach|Representative|Team|Department|Coordinator):\s*/i,'')};
    });
  }
  function renderScopeResults() {
    const query = $('scopeSearch').value.trim().toLowerCase(), type = $('scopeType').value;
    const options = scopeOptions().filter(option => (type === 'all' || option.mode === type) && (!query || option.label.toLowerCase().includes(query)));
    const selected = $('globalScopeSelect').value;
    $('scopeResults').replaceChildren(...options.map(option => {
      const item=document.createElement('div');item.setAttribute('role','listitem');
      const button=document.createElement('button');button.type='button';button.className='scope-result'+(selected===option.value?' selected':'');
      const avatar=document.createElement('span');avatar.className='scope-avatar';avatar.textContent=option.label.split(/\s+/).map(part=>part[0]).slice(0,2).join('').toUpperCase();avatar.setAttribute('aria-hidden','true');
      const copy=document.createElement('span'),name=document.createElement('strong'),detail=document.createElement('small');
      name.textContent=option.label;detail.textContent=modeName(option.mode);copy.append(name,detail);button.append(avatar,copy);
      const marker=document.createElement('span');marker.className='scope-check';marker.textContent=selected===option.value?'✓':'→';button.append(marker);
      button.setAttribute('aria-label',modeName(option.mode)+': '+option.label+(selected===option.value?', current data view':''));
      button.addEventListener('click',()=>chooseScope(option.value));item.append(button);return item;
    }));
    $('scopeResultCount').textContent=options.length ? options.length+' matching data view'+(options.length===1?'':'s') : scopeOptions().length ? 'No matches. Try a different name or type.' : 'No coach directory is available yet. Load weekly team data in Data Manager to add coaches and representatives.';
    $('scopeAllPeople').classList.toggle('selected',selected==='all:');
  }
  function closePicker() { if($('scopePicker').open)$('scopePicker').close();else $('scopePicker').removeAttribute('open');opener?.focus(); }
  function chooseScope(value) {
    const select=$('globalScopeSelect');
    if (![...select.options].some(option=>option.value===value)) return;
    select.value=value;select.dispatchEvent(new Event('change',{bubbles:true}));closePicker();updateScope();
  }
  function openPicker(event) {
    opener=event?.currentTarget || $('scopeTrigger');$('scopeSearch').value='';
    const mode=currentScope().mode;$('scopeType').value=mode==='all'?'coach':mode;
    renderScopeResults();
    if(typeof $('scopePicker').showModal==='function'){if(!$('scopePicker').open)$('scopePicker').showModal();}else $('scopePicker').setAttribute('open','');
    $('scopeSearch').focus();
  }
  async function updateScope() {
    const generation=++scopeGeneration,scope=currentScope(),name=scopeName(scope),specific=scope.mode!=='all';
    $('activeScopeName').textContent=name;$('workspaceScopeName').textContent=name;$('clearScope').hidden=!specific;
    document.querySelector('.scope-card').classList.toggle('scoped',specific);
    $('activeScopeDetail').textContent=specific?modeName(scope.mode)+' view · Connected reports show this selection’s data.':'All available people · Choose a coach to focus connected reports on that coach’s team.';
    try {
      if(!specific || !root.CoachToolsAppData?.filterPeople || !root.CoachToolsIdentity?.getAllPeople)return;
      const people=await root.CoachToolsAppData.filterPeople(await root.CoachToolsIdentity.getAllPeople());
      if(generation!==scopeGeneration)return;
      const reps=people.filter(person=>person.role==='representative').length;
      $('activeScopeDetail').textContent=modeName(scope.mode)+' view · '+reps+' representative'+(reps===1?'':'s')+' in the loaded directory. Connected reports follow this selection.';
    } catch(_) { /* The selected view remains explicit even before the directory loads. */ }
    finally { if($('scopePicker').open)renderScopeResults(); }
  }
  function favoriteIds() {
    const fallback=(root.COACHTOOLS_MANIFEST?.apps||[]).filter(app=>app.enabled!==false&&app.favorite).map(app=>app.id);
    try { const stored=JSON.parse(localStorage.getItem('coachtools.desktop.favorites.v1')||'null');return Array.isArray(stored)?stored:fallback; }catch(_){return fallback;}
  }
  function renderFavorites() {
    const ids=favoriteIds(),apps=(root.COACHTOOLS_MANIFEST?.apps||[]).filter(app=>app.enabled!==false);
    const favorites=ids.map(id=>apps.find(app=>app.id===id)).filter(Boolean);
    $('favoritesEmpty').hidden=Boolean(favorites.length);
    $('favoriteTools').replaceChildren(...favorites.map(app=>{
      const button=document.createElement('button');button.type='button';button.className='favorite-tool';
      const icon=document.createElement('img');icon.src=app.icon;icon.alt='';
      const name=document.createElement('span');name.textContent=app.name;
      button.append(icon,name);button.addEventListener('click',()=>{
        // Existing desktop tiles own app activation, window restore, and data readiness.
        let tile=document.querySelector('[data-app-id="'+app.id+'"]');
        if(!tile){const search=$('appSearch');search.value='';search.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#categoryFilters .category-filter')?.click();tile=document.querySelector('[data-app-id="'+app.id+'"]');}
        tile?.click();
      });return button;
    }));
  }
  function editFavorites() {
    const selected=new Set(favoriteIds());
    $('favoritesChoices').replaceChildren(...(root.COACHTOOLS_MANIFEST?.apps||[]).filter(app=>app.enabled!==false).map(app=>{
      const label=document.createElement('label'),input=document.createElement('input'),icon=document.createElement('img'),name=document.createElement('span');
      input.type='checkbox';input.value=app.id;input.checked=selected.has(app.id);icon.src=app.icon;icon.alt='';name.textContent=app.name;label.append(input,icon,name);return label;
    }));
    if(typeof $('favoritesPicker').showModal==='function')$('favoritesPicker').showModal();else $('favoritesPicker').setAttribute('open','');
  }
  function closeFavorites() { if($('favoritesPicker').open)$('favoritesPicker').close();else $('favoritesPicker').removeAttribute('open');$('editFavorites').focus(); }
  function start() {
    if(!$('scopePicker')||!$('globalScopeSelect'))return;
    for(const id of ['scopeTrigger','changeScope','workspaceScopeButton'])$(id).addEventListener('click',openPicker);
    $('closeScopePicker').addEventListener('click',closePicker);
    $('scopePicker').addEventListener('click',event=>{if(event.target===$('scopePicker'))closePicker();});
    $('scopeSearch').addEventListener('input',renderScopeResults);$('scopeType').addEventListener('change',renderScopeResults);
    $('scopeAllPeople').addEventListener('click',()=>chooseScope('all:'));$('clearScope').addEventListener('click',()=>chooseScope('all:'));
    $('globalScopeSelect').addEventListener('change',()=>{updateScope();renderScopeResults();});
    new MutationObserver(()=>{updateScope();renderScopeResults();}).observe($('globalScopeSelect'),{childList:true,subtree:true});
    root.addEventListener('coachtools:scope-updated',updateScope);root.addEventListener('coachtools:identity-updated',updateScope);
    $('editFavorites').addEventListener('click',editFavorites);$('closeFavoritesPicker').addEventListener('click',closeFavorites);
    $('favoritesPicker').addEventListener('click',event=>{if(event.target===$('favoritesPicker'))closeFavorites();});
    $('saveFavorites').addEventListener('click',()=>{const ids=[...$('favoritesChoices').querySelectorAll('input:checked')].map(input=>input.value);localStorage.setItem('coachtools.desktop.favorites.v1',JSON.stringify(ids));root.dispatchEvent(new CustomEvent('coachtools:favorites-updated'));renderFavorites();closeFavorites();});
    root.addEventListener('coachtools:favorites-updated',renderFavorites);
    updateScope();renderFavorites();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})(window);
