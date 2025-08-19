// ========================== Altaris Docs Chat — chat.js (v10.5) ==========================
(function(){
  window.DOCS_CHAT_VERSION = 'v10.5';
  let currentDeal = null;
  let currentScope = 'all';

  const qs = (s, el=document)=>el.querySelector(s);
  const qsa = (s, el=document)=>Array.from(el.querySelectorAll(s));
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
      #chatModal.docs-chat-modal{ position:fixed; inset:0; display:none; background:rgba(0,0,0,.4); z-index:9999; }
      #chatModal.docs-chat-modal.open{ display:block; }
      #chatModal .docs-chat-card{ position:absolute; right:20px; bottom:20px; width:600px; max-width:calc(100vw - 40px); background:#111; color:#eee; border:1px solid #333; border-radius:12px; box-shadow:0 10px 30px rgba(0,0,0,.6); pointer-events:auto; }
      #chatModal .docs-chat-header{ display:flex; align-items:center; justify-content:space-between; padding:10px 12px; border-bottom:1px solid #333; }
      #chatModal .docs-chat-body{ padding:10px 12px; max-height:55vh; overflow:auto; }
      #chatModal .docs-chat-footer{ display:flex; gap:8px; padding:10px 12px; border-top:1px solid #333; align-items:flex-end; }
      #chatModal .docs-chip{ font-size:12px; border:1px solid #444; border-radius:999px; padding:4px 10px; background:#1d1d1d; color:#ddd; cursor:pointer; user-select:none; display:inline-flex; align-items:center; gap:6px; position:relative; }
      #chatModal .docs-chip[data-active="true"]{ background:#2b6cb0 !important; border-color:#63b3ed !important; color:#fff !important; box-shadow:0 0 0 2px rgba(99,179,237,.45) !important; }
      #chatModal .docs-chip[data-active="true"]::before{ content:"✓"; position:relative; margin-right:6px; font-weight:700; }
      #chatModal .docs-textarea{ flex:1; min-height:44px; background:#1b1b1b; color:#fff; border:1px solid #444; border-radius:8px; padding:8px; }
      #chatModal .docs-icon-btn{ width:32px; height:32px; border:1px solid #444; border-radius:8px; background:#1d1d1d; color:#eee; cursor:pointer; display:inline-flex; align-items:center; justify-content:center; }
      #chatModal .docs-msg{ background:#151515; border:1px solid #333; border-radius:10px; padding:8px; margin:8px 0; }
      #chatModal .docs-src{ border-top:1px dashed #333; margin-top:6px; padding-top:6px; }
      #chatModal .docs-src h6{ margin:0; font-size:10px; text-transform:uppercase; opacity:.7; }
      #chatModal .docs-src a{ color:#cfe3ff; text-decoration:underline; }
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
        el('div', { className:'docs-chat-header' }, [
          el('div', { id:'chatTitle', innerText:'Chat — ' }),
          el('button', { id:'docsChatClose', className:'docs-icon-btn', title:'Close', 'data-action':'close', type:'button' }, ['✕'])
        ]),
        el('div', { id:'docsChatScopeBar', style:'display:flex; gap:8px; flex-wrap:wrap; align-items:center; padding:8px 12px;' }),
        el('div', { id:'chatMessages', className:'docs-chat-body', innerText:'Ask a question about this deal’s documents…' }),
        el('div', { className:'docs-chat-footer' }, [
          el('textarea', { id:'chatInput', className:'docs-textarea', placeholder:'e.g., Summarize key risks from the credit memo' }),
          el('button', { id:'chatSendBtn', className:'docs-icon-btn', title:'Send', type:'button' }, ['➤'])
        ])
      ])
    ]);
    document.body.appendChild(modal);
  }

  function rebuildScopeBar(){
    ensureModal();
    const bar = qs('#docsChatScopeBar');
    if (!bar) return;

    bar.innerHTML = '';
    bar.appendChild(el('span', { style:'opacity:.7; font-size:12px;', innerText:'Scope:' }));

    const options = [
      ['all','All docs'],
      ['credit_memo','Credit Memo'],
      ['financials','Financials'],
      ['diligence','Diligence'],
      ['legal','Legal']
    ];

    options.forEach(([key, label])=>{
      const b = el('button', { className:'docs-chip', 'data-scope':key, type:'button' }, [label]);
      const activate = ()=> setScope(key);
      b.addEventListener('click', (e)=>{ e.preventDefault(); e.stopPropagation(); activate(); });
      b.addEventListener('pointerup', (e)=>{ e.preventDefault(); e.stopPropagation(); activate(); });
      bar.appendChild(b);
    });

    updateScopeUI(currentScope);
  }

  function openModal(){ ensureModal(); qs('#chatModal')?.classList.add('open'); }
  function closeModal(){ const m = qs('#chatModal'); if (m) m.classList.remove('open'); currentDeal=null; }

  function setTitle(){
    ensureModal();
    const t = qs('#chatTitle'); if (t) t.textContent = 'Chat — ' + (currentDeal?.name || '');
  }

  function applyActiveStyles(btn, active){
    btn.setAttribute('data-active', active ? 'true' : 'false');
    btn.style.setProperty('background', active ? '#2b6cb0' : '#1d1d1d', 'important');
    btn.style.setProperty('border-color', active ? '#63b3ed' : '#444', 'important');
    btn.style.setProperty('color', active ? '#ffffff' : '#dddddd', 'important');
    btn.style.setProperty('box-shadow', active ? '0 0 0 2px rgba(99,179,237,.45)' : 'none', 'important');
  }
  function updateScopeUI(scope){
    const root = qs('#chatModal'); if (!root) return;
    qsa('#docsChatScopeBar button.docs-chip', root).forEach(btn => {
      applyActiveStyles(btn, btn.getAttribute('data-scope') === scope);
    });
  }
  function setScope(scope){ currentScope = scope; updateScopeUI(scope); }

  // Build deep links for citations (uses viewer fallback if configured)
  function buildCitationLink(c){
    if (c.link) return c.link;
    const viewer = (window.DOCS_CHAT_CONFIG && window.DOCS_CHAT_CONFIG.viewer) || '';
    const file = c.file_url || c.url || '';
    const page = c.page || c.pg || null;
    const anchor = c.section_id || c.anchor || '';
    if (!file) return '#';
    const isPDF = /\.pdf(\?|#|$)/i.test(file);

    if (isPDF && viewer) {
      const base = `${viewer}?file=${encodeURIComponent(file)}`;
      const withPage = page ? `${base}&page=${page}` : base;
      const q = (c.quote || c.heading || c.snippet || '').slice(0,80);
      return q ? `${withPage}&search=${encodeURIComponent(q)}` : withPage;
    }
    if (isPDF) return page ? `${file}#page=${page}` : file;
    return anchor ? `${file}#${anchor}` : file;
  }

  function pushMessage(role, content, citations){
    ensureModal();
    const container = qs('#chatMessages'); if (!container) return;
    if (!container._inited){ container.innerHTML = ''; container._inited = true; }
    const bubble = el('div', { className:'docs-msg' }, [
      el('div', { style:'font-size:13px; white-space:pre-wrap;' }, [content || ''])
    ]);

    if (Array.isArray(citations) && citations.length){
      const srcWrap = el('div', { className:'docs-src' }, [ el('h6', { innerText:'Sources' }) ]);
      citations.forEach((c, idx)=>{
        const href = buildCitationLink(c);
        const title = c.title || c.heading || 'Document';
        const pageStr = c.page ? ` · p.${c.page}` : '';
        const row = el('div', { style:'font-size:12px; margin-top:4px;' });

        const link = el('a', { href: href || '#', target: '_blank', rel: 'noopener',
          innerText: `[${idx+1}] ${title}${pageStr}`, style: 'display:inline-block;' });

        const copyBtn = el('button', { className: 'docs-chip', type: 'button',
          style: 'margin-left:8px; padding:2px 6px; font-size:11px;', innerText: 'Copy link' });
        copyBtn.onclick = (e)=>{ e.preventDefault(); const url = link.href || ''; if(!url || url==='#') return;
          navigator.clipboard && navigator.clipboard.writeText(url); copyBtn.innerText='Copied!';
          setTimeout(()=> copyBtn.innerText='Copy link', 1200); };

        const snippet = el('div', { style:'font-size:12px; margin-top:2px; opacity:.9;',
          innerText: (c.snippet||'').slice(0,220) + ((c.snippet||'').length>220?'…':'') });

        row.appendChild(link); row.appendChild(copyBtn); row.appendChild(snippet);
        srcWrap.appendChild(row);
      });
      bubble.appendChild(srcWrap);
    }
    container.appendChild(bubble);
    container.scrollTop = container.scrollHeight;
  }

  function showTyping(on){
    ensureModal();
    const container = qs('#chatMessages'); if (!container) return;
    let n = qs('#chatTyping');
    if (on){
      if (!n){ n = el('div', { id:'chatTyping', style:'margin:6px 0; font-size:12px; opacity:.7;' , innerText:'Analyzing relevant documents…' }); container.appendChild(n); }
    } else if (n){ n.remove(); }
    container.scrollTop = container.scrollHeight;
  }

  async function retrieveAnswer(query, dealId, scope){
    const cfg = (window.DOCS_CHAT_CONFIG||{});
    const endpoint = cfg.endpoint || "/functions/v1/doc-search";
    const topK = cfg.topK || 5;
    const headers = Object.assign({ 'Content-Type': 'application/json' }, cfg.headers || {});
    try{
      const res = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify({ query, dealId, dealName: currentDeal?.name, scope, topK }) });
      if (!res.ok) throw new Error('HTTP '+res.status);
      const data = await res.json();
      if (!data || typeof data.answer !== 'string') throw new Error('Malformed response');
      return { text: data.answer, citations: Array.isArray(data.citations)? data.citations : [] };
    }catch(err){
      console.error('[docs-chat] fetch error:', err);
      return {
        text: "I couldn’t reach the search endpoint (see console for details), so here’s a placeholder answer. Configure window.DOCS_CHAT_CONFIG.endpoint/headers to enable real search.",
        citations: [{ title:"Example — Credit Memo.pdf", snippet:"This is a placeholder snippet — wire your Edge Function to return real excerpts.", page:1 }]
      };
    }
  }

  function wireControls(){
    ensureModal();
    const send = qs('#chatSendBtn');
    const input = qs('#chatInput');
    const modalEl = qs('#chatModal');
    const headerClose = qs('#docsChatClose');

    ;['click','pointerdown','pointerup','mousedown','mouseup'].forEach(evt =>
      headerClose && headerClose.addEventListener(evt, (e)=>{ e.preventDefault(); e.stopPropagation(); closeModal(); })
    );

    send.onclick = async ()=>{
      const q = (input.value||'').trim(); if (!q) return;
      pushMessage('user', q);
      input.value = '';
      showTyping(true);
      try{
        const res = await retrieveAnswer(q, currentDeal?.id, currentScope);
        showTyping(false);
        pushMessage('assistant', res.text, res.citations);
      }catch(err){
        showTyping(false);
        pushMessage('assistant', 'Sorry — something went wrong retrieving an answer.');
      }
    };
    input.addEventListener('keydown', (e)=>{ if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase()==='enter'){ send.click(); } });

    modalEl.addEventListener('click', (e)=>{
      const isOverlay = (e.target === modalEl);
      const closeBtn = e.target.closest && e.target.closest('[data-action="close"]');
      if (isOverlay || closeBtn) closeModal();
    }, true);
  }

  window.openDocChat = function(deal){
    currentDeal = deal;
    ensureModal(); setTitle(); rebuildScopeBar(); setScope('all');
    const container = qs('#chatMessages'); if (container){ container._inited = false; container.innerHTML = 'Ask a question about this deal’s documents…'; }
    const input = qs('#chatInput'); if (input){ input.value = ''; input.focus(); }
    openModal(); wireControls();
  };
})();
