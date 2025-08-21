// ========================== Altaris Docs Chat — chat.js (v11.5, no scope bar) ==========================
// Verify loaded version: window.DOCS_CHAT_VERSION
(function(){
  window.DOCS_CHAT_VERSION = 'v11.5';
  let currentDeal = null;
  let currentScope = 'all'; // fixed for now

  const STORAGE_KEYS = { split: 'altarisDocsChatSplit', card: 'altarisDocsChatCard' };
  const qs = (s, el=document)=>el.querySelector(s);
  const el = (tag, props={}, children=[]) => {
    const node = document.createElement(tag);
    Object.assign(node, props);
    (Array.isArray(children)?children:[children]).filter(Boolean).forEach(c => {
      if (typeof c === "string") node.appendChild(document.createTextNode(c));
      else node.appendChild(c);
    });
    return node;
  };

  function injectStyles(){
    if (qs('#docsChatInlineStyles')) return;
    const css = `
      #chatModal.docs-chat-modal{ position:fixed; inset:0; display:none;
        background:rgba(8,10,14,.62);
        backdrop-filter:saturate(110%) blur(12px);
        -webkit-backdrop-filter:saturate(110%) blur(12px);
        z-index:9999;
      }
      #chatModal.docs-chat-modal.open{ display:block; }
      body.docs-blur-on > *:not(#chatModal){ filter: blur(3px); transition: filter .2s ease; }
      #chatModal .docs-chat-card{ position:absolute; right:20px; bottom:20px; width:min(1200px, calc(100vw - 40px));
        background:#111; color:#eee; border:1px solid #333; border-radius:12px; box-shadow:0 10px 30px rgba(0,0,0,.6);
        pointer-events:auto; resize:both; overflow:auto; min-width:720px; min-height:420px; }
      #chatModal .docs-chat-header{ display:flex; align-items:center; justify-content:space-between; padding:10px 12px; border-bottom:1px solid #333; cursor:move; user-select:none; }
      /* Hide scope bar entirely for now */
      #chatModal #docsChatScopeBar{ display:none !important; }
      #chatModal .docs-chat-body{ display:grid; grid-template-columns: var(--left, 1fr) 6px var(--right, 3fr); grid-template-rows: 1fr;
        gap:0; max-height:62vh; align-items:stretch; }
      #chatModal .docs-col{ overflow:auto; padding:10px 12px; }
      #chatModal #chatMessages{ padding-bottom:84px; }
      #chatModal .splitter{ width:6px; background:#202225; border-left:1px solid #333; border-right:1px solid #333; cursor:col-resize; }
      #chatModal .docs-chat-footer{ display:flex; gap:8px; padding:10px 12px; border-top:1px solid #333; align-items:flex-end; background:#111; position:sticky; bottom:0; }
      #chatModal .docs-chip{ font-size:12px; border:1px solid #444; border-radius:999px; padding:4px 10px; background:#1d1d1d; color:#ddd; cursor:pointer; user-select:none; display:inline-flex; align-items:center; gap:6px; position:relative; }
      #chatModal .docs-textarea{ flex:1; min-height:44px; background:#1b1b1b; color:#fff; border:1px solid #444; border-radius:8px; padding:8px; }
      #chatModal .docs-icon-btn{ width:32px; height:32px; border:1px solid #444; border-radius:8px; background:#1d1d1d; color:#eee; cursor:pointer; display:inline-flex; align-items:center; justify-content:center; }
      #chatModal .docs-msg{ background:#151515; border:1px solid #333; border-radius:10px; padding:8px; margin:8px 0; }
      #chatModal .docs-src{ border-top:1px dashed #333; margin-top:6px; padding-top:6px; }
      #chatModal .docs-src h6{ margin:0; font-size:10px; text-transform:uppercase; opacity:.7; }
      #chatModal .docs-src a{ color:#cfe3ff; text-decoration:underline; }
      #chatModal .viewer-pane{ background:#0f0f0f; border-left:1px solid #333; border-radius:8px; min-height:260px; display:flex; flex-direction:column; }
      #chatModal .viewer-head{ display:flex; align-items:center; justify-content:space-between; padding:8px 10px; border-bottom:1px solid #222; font-size:12px; gap:8px; }
      #chatModal .viewer-head .title{ flex:1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; opacity:.9; }
      #chatModal .viewer-head .actions{ display:flex; gap:6px; }
      #chatModal .viewer-body{ flex:1; min-height:220px; }
      #chatModal .viewer-body iframe{ width:100%; height:100%; border:0; border-bottom-left-radius:8px; border-bottom-right-radius:8px; background:#111; }
      #chatModal .viewer-empty{ padding:10px; font-size:12px; opacity:.6; }
    `;
    const style = el('style', { id:'docsChatInlineStyles' });
    style.appendChild(document.createTextNode(css));
    (document.head || document.documentElement).appendChild(style);
  }

  function ensureModal(){
    if (qs('#chatModal')) return;
    injectStyles();

    const modal = el('div', { id:'chatModal', className:'docs-chat-modal', 'aria-hidden':'true' }, [
      el('div', { className:'docs-chat-card', role:'dialog', 'aria-modal':'true', 'aria-labelledby':'chatTitle' }, [
        el('div', { className:'docs-chat-header', id:'docsChatHeader' }, [
          el('div', { id:'chatTitle', innerText:'Chat — ' }),
          el('button', { id:'docsChatClose', className:'docs-icon-btn', title:'Close', 'data-action':'close', type:'button' }, ['✕'])
        ]),
        // Scope bar intentionally omitted/hidden (kept as placeholder for easy re-enable later)
        el('div', { id:'docsChatScopeBar' }),
        el('div', { className:'docs-chat-body', id:'docsChatBody' }, [
          el('div', { id:'chatMessages', className:'docs-col', innerText:'Ask a question about this deal’s documents…' }),
          el('div', { id:'splitter', className:'splitter', title:'Drag to resize' }),
          el('div', { id:'chatViewer', className:'docs-col viewer-pane' }, [
            el('div', { className:'viewer-head' }, [
              el('div', { id:'viewerTitle', className:'title', innerText:'Source preview' }),
              el('div', { className:'actions' }, [
                el('button', { id:'viewerExternal', className:'docs-icon-btn', title:'Open externally', type:'button' }, ['↗']),
                el('button', { id:'viewerClose', className:'docs-icon-btn', title:'Hide preview', type:'button' }, ['✕'])
              ])
            ]),
            el('div', { id:'viewerBody', className:'viewer-body' }, [
              el('div', { className:'viewer-empty', id:'viewerEmpty', innerText:'Click a source to open it here.' })
            ])
          ])
        ]),
        el('div', { className:'docs-chat-footer' }, [
          el('textarea', { id:'chatInput', className:'docs-textarea', placeholder:'e.g., Summarize key risks from the credit memo' }),
          el('button', { id:'chatSendBtn', className:'docs-icon-btn', title:'Send', type:'button' }, ['➤'])
        ])
      ])
    ]);
    document.body.appendChild(modal);
  }

  function openModal(){ ensureModal(); document.body.classList.add('docs-blur-on'); qs('#chatModal')?.classList.add('open'); }
  function closeModal(){ const m = qs('#chatModal'); if (m) m.classList.remove('open'); document.body.classList.remove('docs-blur-on'); currentDeal=null; }

  function setTitle(){ ensureModal(); const t = qs('#chatTitle'); if (t) t.textContent = 'Chat — ' + (currentDeal?.name || ''); }

  // Scope helpers replaced with no-ops (kept for future)
  function setScope(scope){ currentScope = 'all'; }
  function rebuildScopeBar(){ /* intentionally empty */ }

  function getViewerBase(){ const cfg=(window.DOCS_CHAT_CONFIG||{}); return (cfg.viewer && typeof cfg.viewer === 'string') ? cfg.viewer : 'https://mozilla.github.io/pdf.js/web/viewer.html'; }
  function buildViewerUrl(fileUrl, page, search){
    let url = getViewerBase() + '?file=' + encodeURIComponent(fileUrl);
    const parts=[]; if (page) parts.push('page='+encodeURIComponent(page)); if (search) parts.push('search='+encodeURIComponent(search));
    if (parts.length) url += '#'+parts.join('&'); return url;
  }

  function openCitationInViewer(c){
    ensureModal();
    const body = qs('#viewerBody'); const title = qs('#viewerTitle'); const empty = qs('#viewerEmpty');
    if (!body) return; body.innerHTML = ''; if (empty) empty.remove();
    const file = c.file_url || c.url || c.link || ''; if (!file){ body.innerHTML='<div class="viewer-empty">No file URL in citation.</div>'; return; }
    const page = c.page || c.pg || null;
    let search = (c.quote || c.snippet || c.heading || '').trim();
    if (search.length > 120) search = search.slice(0,120);
    if (search.split(/\s+/).length > 20) { const words = search.replace(/[^\w\s-]/g,'').split(/\s+/).filter(Boolean).sort((a,b)=>b.length-a.length); search = words.slice(0,3).join(' '); }
    const builtUrl = buildViewerUrl(file,page,search);
    const iframe = el('iframe',{id:'pdfFrame',src:builtUrl,allow:'clipboard-write'});
    iframe.addEventListener('error',()=>{ iframe.src = file + (page ? ('#page='+page) : ''); });
    const ext = qs('#viewerExternal'); if (ext){ ext.onclick=(e)=>{ e.preventDefault(); window.open(file + (page ? ('#page='+page) : ''), '_blank','noopener'); }; }
    title.textContent = (c.title || c.heading || 'Source') + (page ? (' — p.'+page) : '');
    body.appendChild(iframe);
  }

  function pushMessage(role, content, citations){
    ensureModal();
    const container = qs('#chatMessages'); if (!container) return;
    if (!container._inited){ container.innerHTML=''; container._inited=true; }
    const bubble = el('div',{className:'docs-msg'},[ el('div',{style:'font-size:13px; white-space:pre-wrap;'},[content || '']) ]);
    if (Array.isArray(citations) && citations.length){
      const srcWrap = el('div',{className:'docs-src'},[ el('h6',{innerText:'Sources'}) ]);
      citations.forEach((c,idx)=>{
        const title = c.title || c.heading || 'Document'; const pageStr = c.page ? ` · p.${c.page}` : '';
        const row = el('div',{style:'font-size:12px; margin-top:4px;'});
        const link = el('a',{href:'#',innerText:`[${idx+1}] ${title}${pageStr}`,style:'display:inline-block;'});
        link.addEventListener('click',(e)=>{ e.preventDefault(); openCitationInViewer(c); });
        const openBtn = el('button',{className:'docs-chip',type:'button',style:'margin-left:8px; padding:2px 6px; font-size:11px;',innerText:'Open here'});
        openBtn.onclick=(e)=>{ e.preventDefault(); openCitationInViewer(c); };
        const copyBtn = el('button',{className:'docs-chip',type:'button',style:'margin-left:6px; padding:2px 6px; font-size:11px;',innerText:'Copy link'});
        copyBtn.onclick=(e)=>{ e.preventDefault(); const url=(c.link||c.file_url||c.url||''); if(!url) return; navigator.clipboard && navigator.clipboard.writeText(url); copyBtn.innerText='Copied!'; setTimeout(()=> copyBtn.innerText='Copy link',1200); };
        const snippet = el('div',{style:'font-size:12px; margin-top:2px; opacity:.9;',innerText:(c.snippet||'').slice(0,220)+(((c.snippet||'').length>220)?'…':'')});
        row.appendChild(link); row.appendChild(openBtn); row.appendChild(copyBtn); row.appendChild(snippet);
        srcWrap.appendChild(row);
      });
      bubble.appendChild(srcWrap);
    }
    container.appendChild(bubble); container.scrollTop = container.scrollHeight;
  }

  async function retrieveAnswer(query, dealId, scope){
    const cfg=(window.DOCS_CHAT_CONFIG||{});
    const endpoint=cfg.endpoint || "/functions/v1/doc-search";
    const topK=cfg.topK || 5;
    const headers=Object.assign({'Content-Type':'application/json'}, cfg.headers||{});
    try{
      const res=await fetch(endpoint,{method:'POST',headers,body:JSON.stringify({query,dealId,dealName:currentDeal?.name,scope:currentScope,topK})});
      if(!res.ok) throw new Error('HTTP '+res.status);
      const data=await res.json();
      return { text:data.answer||'', citations:Array.isArray(data.citations)?data.citations:[] };
    }catch(err){
      console.error('[docs-chat] fetch error:', err);
      return { text:"I couldn’t reach the search endpoint (see console for details).", citations:[] };
    }
  }

  function wireDragResize(){
    const card = qs('.docs-chat-card');
    const header = qs('#docsChatHeader');
    if (!card || !header) return;

    // Restore size/position
    try{
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEYS.card) || 'null');
      if (saved && typeof saved === 'object'){
        const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
        card.style.left = clamp(saved.left || 40, 0, window.innerWidth - 120) + 'px';
        card.style.top = clamp(saved.top || 40, 0, window.innerHeight - 120) + 'px';
        card.style.right = 'auto'; card.style.bottom = 'auto';
        if (saved.width) card.style.width = clamp(saved.width, 720, window.innerWidth - 20) + 'px';
        if (saved.height) card.style.height = clamp(saved.height, 420, window.innerHeight - 20) + 'px';
      }
    }catch{}

    // Drag by header
    let dragging=false, sx=0, sy=0, sl=0, st=0;
    header.addEventListener('mousedown',(e)=>{
      if (e.target.closest('button')) return;
      dragging=true;
      const r=card.getBoundingClientRect();
      card.style.left=r.left+'px'; card.style.top=r.top+'px'; card.style.right='auto'; card.style.bottom='auto';
      sx=e.clientX; sy=e.clientY; sl=r.left; st=r.top; document.body.style.userSelect='none';
    });
    window.addEventListener('mousemove',(e)=>{
      if(!dragging) return;
      const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
      card.style.left = clamp(sl + (e.clientX - sx), 8, window.innerWidth - 80) + 'px';
      card.style.top = clamp(st + (e.clientY - sy), 8, window.innerHeight - 80) + 'px';
    });
    window.addEventListener('mouseup',()=>{
      if(dragging){ dragging=false; document.body.style.userSelect='';
        try{ const r=card.getBoundingClientRect(); localStorage.setItem(STORAGE_KEYS.card, JSON.stringify({ left:r.left, top:r.top, width:r.width, height:r.height })); }catch{} }
    });

    // Splitter
    const body = qs('#docsChatBody'); const splitter = qs('#splitter');
    if (!body || !splitter) return;
    // Default split 25/75
    body.style.setProperty('--left','1fr'); body.style.setProperty('--right','3fr');
    try{
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEYS.split) || 'null');
      if (saved && typeof saved === 'object' && saved.left && saved.right){
        body.style.setProperty('--left', saved.left + 'px');
        body.style.setProperty('--right', saved.right + 'px');
      }
    }catch{}
    let sdrag=false, sStartX=0, leftW=0, rightW=0;
    splitter.addEventListener('mousedown',(e)=>{
      sdrag=true; sStartX=e.clientX;
      const leftEl=qs('#chatMessages'); const rightEl=qs('#chatViewer');
      leftW=leftEl.getBoundingClientRect().width; rightW=rightEl.getBoundingClientRect().width;
      document.body.style.cursor='col-resize';
    });
    window.addEventListener('mousemove',(e)=>{
      if(!sdrag) return;
      const dx=e.clientX-sStartX; const minLeft=260, minRight=300;
      let nl=Math.max(minLeft, leftW+dx); let nr=Math.max(minRight, rightW-dx);
      body.style.setProperty('--left', nl+'px'); body.style.setProperty('--right', nr+'px');
    });
    window.addEventListener('mouseup',()=>{
      if(!sdrag) return; sdrag=false; document.body.style.cursor='';
      try{
        const leftEl=qs('#chatMessages'); const rightEl=qs('#chatViewer');
        const nl=Math.round(leftEl.getBoundingClientRect().width);
        const nr=Math.round(rightEl.getBoundingClientRect().width);
        localStorage.setItem(STORAGE_KEYS.split, JSON.stringify({ left:nl, right:nr }));
      }catch{}
    });
  }

  function wireControls(){
    ensureModal();
    const send = qs('#chatSendBtn');
    const input = qs('#chatInput');
    const modalEl = qs('#chatModal');
    const headerClose = qs('#docsChatClose');
    const viewerClose = qs('#viewerClose');

    ['click','pointerdown','pointerup','mousedown','mouseup'].forEach(evt =>
      headerClose && headerClose.addEventListener(evt, (e)=>{ e.preventDefault(); e.stopPropagation(); closeModal(); })
    );
    viewerClose && viewerClose.addEventListener('click',(e)=>{
      e.preventDefault();
      const body=qs('#viewerBody'); const empty=qs('#viewerEmpty');
      if(body){ body.innerHTML=''; } if(!empty){ const ph=el('div',{className:'viewer-empty',id:'viewerEmpty',innerText:'Click a source to open it here.'}); qs('#viewerBody')?.appendChild(ph); }
    });

    send.onclick = async ()=>{
      const q=(input.value||'').trim(); if(!q) return;
      pushMessage('user', q); input.value=''; showTyping(true);
      try{ const res=await retrieveAnswer(q, currentDeal?.id, currentScope); showTyping(false); pushMessage('assistant', res.text, res.citations); }
      catch(err){ showTyping(false); pushMessage('assistant','Sorry — something went wrong retrieving an answer.'); }
    };
    input.addEventListener('keydown',(e)=>{ if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='enter'){ send.click(); } });

    modalEl.addEventListener('click',(e)=>{
      const isOverlay=(e.target===modalEl); const closeBtn=e.target.closest && e.target.closest('[data-action="close"]');
      if(isOverlay||closeBtn) closeModal();
    },true);

    wireDragResize();
  }

  function showTyping(on){
    const container=qs('#chatMessages'); if(!container) return;
    let n=qs('#chatTyping');
    if(on){ if(!n){ n=el('div',{id:'chatTyping',style:'margin:6px 0; font-size:12px; opacity:.7;',innerText:'Analyzing relevant documents…'}); container.appendChild(n);} }
    else if(n){ n.remove(); }
    container.scrollTop = container.scrollHeight;
  }

  window.openDocChat = function(deal){
    currentDeal = deal;
    ensureModal();
    const t=qs('#chatTitle'); if(t) t.textContent='Chat — ' + (currentDeal?.name || '');
    setScope('all'); // fixed
    const container=qs('#chatMessages'); if(container){ container._inited=false; container.innerHTML='Ask a question about this deal’s documents…'; }
    const vb=qs('#viewerBody'); if(vb){ vb.innerHTML='<div class="viewer-empty" id="viewerEmpty">Click a source to open it here.</div>'; }
    const input=qs('#chatInput'); if(input){ input.value=''; input.focus(); }
    openModal(); wireControls();
  };
})();