// ========================== Altaris Deal Pipeline — app.js (clickable legends) ==========================
let client = null;
if (!window.DEMO_MODE) {
  client = supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
}
const DEMO_KEY = 'altaris-demo-data-v-pro';
console.log(`[Altaris] Mode=${window.DEMO_MODE ? 'DEMO' : (client ? 'SUPABASE' : 'NO_CLIENT')}`);

let editing=false, editTimer=null;
function beginEdit(){ editing=true; if(editTimer) clearTimeout(editTimer); }
function endEditSoon(){ if(editTimer) clearTimeout(editTimer); editTimer=setTimeout(()=>{ editing=false; refresh(); }, 1200); }

// ---------------- CSV helpers ----------------
function parseCSV(text){
  const rows = []; let i=0, cur='', inq=false, row=[];
  while(i<text.length){
    const ch=text[i];
    if(inq){
      if(ch==='"' && text[i+1]==='"'){ cur+='"'; i+=2; continue; }
      if(ch==='"'){ inq=false; i++; continue; }
      cur+=ch; i++; continue;
    } else {
      if(ch==='"'){ inq=true; i++; continue; }
      if(ch===','){ row.push(cur); cur=''; i++; continue; }
      if(ch==='\n' || ch==='\r'){ 
        if(cur.length||row.length){ row.push(cur); rows.push(row); row=[]; cur=''; }
        if(ch==='\r' && text[i+1]=='\n') i+=2; else i++;
        continue;
      }
      cur+=ch; i++; continue;
    }
  }
  if(cur.length||row.length) { row.push(cur); rows.push(row); }
  if(!rows.length) return [];
  const headers = rows[0].map(h=>h.trim().toLowerCase());
  return rows.slice(1).filter(r=>r.length && r.some(x=>String(x).trim().length)).map(r=>{
    const obj={}; headers.forEach((h,idx)=>obj[h]=r[idx]!==undefined?r[idx].trim():''); return obj;
  });
}
function toCSV(rows){
  if(!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const esc = (v)=> {
    if (v===null || v===undefined) return '';
    const s = String(v).replace(/"/g,'""');
    return /[",\n]/.test(s) ? '"'+s+'"' : s;
  };
  const lines = [headers.join(',')];
  for (const r of rows) lines.push(headers.map(h=>esc(r[h])).join(','));
  return lines.join('\n');
}
function downloadFile(name, text){
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ---------------- Charts (canvas) ----------------
function drawDoughnutChart(canvas, labels, data, highlightKey=null) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0,0,w,h);
  const legendW = 130;
  const availW = w - legendW;
  const size = Math.min(availW, h) - 20;
  const cx = Math.floor((availW)/2);
  const cy = Math.floor(h/2);
  const r = Math.floor(size/2);
  const innerR = Math.floor(r * 0.6);
  const total = data.reduce((a,b)=>a+b,0) || 1;
  const colors = ['#4ea3ff','#28a745','#ffc107','#dc3545','#6f42c1','#17a2b8','#ff7f50','#9acd32','#20c997','#e83e8c'];
  let start = -Math.PI/2;
  const arcs = [];
  const legends = [];
  function lighten(hex, amt){
    const c = parseInt(hex.slice(1), 16);
    const rr = Math.min(255, ((c>>16)&255) + Math.round(255*amt));
    const gg = Math.min(255, ((c>>8)&255) + Math.round(255*amt));
    const bb = Math.min(255, (c&255) + Math.round(255*amt));
    return '#'+((1<<24)+(rr<<16)+(gg<<8)+bb).toString(16).slice(1);
  }
  labels.forEach((lab, i) => {
    const val = data[i]||0;
    const ang = (val/total) * Math.PI*2;
    ctx.beginPath(); ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, start, start+ang); ctx.closePath();
    const base = colors[i % colors.length];
    ctx.fillStyle = (highlightKey && highlightKey===lab) ? lighten(base, 0.18) : base;
    ctx.fill();
    arcs.push({ start, end: start+ang, cx, cy, r, innerR, key: lab });
    start += ang;
  });
  // donut hole
  ctx.globalCompositeOperation = 'destination-out';
  ctx.beginPath(); ctx.arc(cx, cy, innerR, 0, Math.PI*2); ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
  // legend
  ctx.font = '12px system-ui'; ctx.fillStyle = '#ddd'; ctx.textAlign='left'; ctx.textBaseline='middle';
  let y = 18;
  const legendX = availW + 12;
  const box = 10, gapY = 18;
  labels.forEach((lab, i)=>{
    ctx.fillStyle = colors[i % colors.length];
    ctx.fillRect(legendX, y-6, box, box);
    legends.push({ x: legendX - 2, y: y - 9, w: (w - legendX) - 8, h: 16, key: lab }); // clickable row (box + text)
    ctx.fillStyle = '#ddd';
    ctx.fillText(`${lab}: ${data[i]||0}`, legendX + 16, y);
    y += gapY;
  });
  // return arcs but attach legends so existing code keeps working
  arcs.legends = legends;
  arcs.center = { cx, cy, r, innerR };
  return arcs;
}

// ---------------- Model ----------------
const Stages = {
  PRELIMINARY: "preliminary",
  ACTIVE: "active",
  APPROVAL: "approval",
  CLOSING: "closing",
  ASSET_MGMT: "asset_management",
  REJECTED: "rejected",
};
const STAGE_ORDER = [ "preliminary","active","approval","closing","asset_management","rejected" ];
const Allowed = {
  [Stages.PRELIMINARY]: [Stages.ACTIVE],
  [Stages.ACTIVE]: [Stages.APPROVAL, Stages.REJECTED],
  [Stages.APPROVAL]: [Stages.CLOSING, Stages.REJECTED],
  [Stages.CLOSING]: [Stages.ASSET_MGMT, Stages.ACTIVE],
  [Stages.REJECTED]: [Stages.ACTIVE],
};
const Guards = {
  [`${Stages.ACTIVE}->${Stages.REJECTED}`]: (d) => {
    const val = document.querySelector(`#reject-${d.id}`)?.value || "";
    const rr = val.trim();
    if (!rr) return ["reject reason required"];
    d.data = { ...(d.data||{}), reject_reason: rr };
    return [];
  },
  [`${Stages.CLOSING}->${Stages.ASSET_MGMT}`]: (d) => {
    const docs = document.querySelector(`#docs-${d.id}`)?.checked;
    const funds = document.querySelector(`#funds-${d.id}`)?.checked;
    const e=[]; if(!docs) e.push("docs executed required"); if(!funds) e.push("funds settled required");
    d.data = { ...(d.data||{}), docs_executed: !!docs, funds_settled: !!funds };
    return e;
  }
};

// ---------------- Data access ----------------
async function loadDeals(){ 
  if (window.DEMO_MODE) return JSON.parse(localStorage.getItem(DEMO_KEY)||'{"deals":[]}').deals || [];
  const { data } = await client.from('deals').select('*').order('id'); return data||[]; 
}
async function insertDeal(row){ 
  if (window.DEMO_MODE) {
    const s = JSON.parse(localStorage.getItem(DEMO_KEY)||'{"deals":[]}');
    const id = Date.now(); s.deals.push({ ...row, id }); localStorage.setItem(DEMO_KEY, JSON.stringify(s)); 
    return { ...row, id };
  }
  const { data, error } = await client.from('deals').insert(row).select().single(); if(error){alert(error.message);return null;} return data; 
}
async function updateDeal(row){ 
  if (window.DEMO_MODE) {
    const s = JSON.parse(localStorage.getItem(DEMO_KEY)||'{"deals":[]}');
    s.deals = s.deals.map(d=> d.id===row.id ? { ...d, ...row } : d); localStorage.setItem(DEMO_KEY, JSON.stringify(s));
    return row;
  }
  const { data, error } = await client.from('deals').update(row).eq('id', row.id).select().single(); if(error){alert(error.message);return null;} return data; 
}
async function loadFunds(){ 
  if (window.DEMO_MODE) return [{id:1,name:'Fund One'},{id:2,name:'Fund Two'},{id:3,name:'Fund Three'}];
  const { data } = await client.from('funds').select('*').order('name'); return data||[]; 
}
async function loadDealFunds(){ 
  if (window.DEMO_MODE) return JSON.parse(localStorage.getItem(DEMO_KEY)||'{"parts":[]}').parts||[];
  const { data } = await client.from('deal_funds').select('*').order('deal_id'); return data||[]; 
}
async function insertDealFund(row){ 
  if (window.DEMO_MODE) {
    const s = JSON.parse(localStorage.getItem(DEMO_KEY)||'{"deals":[],"parts":[]}');
    const id = Date.now(); s.parts.push({ ...row, id }); localStorage.setItem(DEMO_KEY, JSON.stringify(s));
    return { ...row, id };
  }
  const { data, error } = await client.from('deal_funds').insert(row).select().single(); if(error){alert(error.message);return null;} return data; 
}
async function updateDealFund(row){ 
  if (window.DEMO_MODE) {
    const s = JSON.parse(localStorage.getItem(DEMO_KEY)||'{"parts":[]}');
    s.parts = (s.parts||[]).map(p=> p.id===row.id ? { ...p, ...row } : p); localStorage.setItem(DEMO_KEY, JSON.stringify(s));
    return row;
  }
  const { data, error } = await client.from('deal_funds').update(row).eq('id', row.id).select().single(); if(error){alert(error.message);return null;} return data; 
}
async function deleteDealFund(id){ 
  if (window.DEMO_MODE) {
    const s = JSON.parse(localStorage.getItem(DEMO_KEY)||'{"parts":[]}'); s.parts = (s.parts||[]).filter(p=>p.id!==id); localStorage.setItem(DEMO_KEY, JSON.stringify(s)); return true;
  }
  const { error } = await client.from('deal_funds').delete().eq('id', id); if(error){alert(error.message);return false;} return true; 
}

// ---------------- Filters / Search ----------------
const activeFilter = { stage: null, type: null, sector: null };
let searchQuery = '';
let areasType = [];
let areasSector = [];

function toTitle(str){ return (str||'').replace(/_/g,' ').replace(/\b\w/g, c=>c.toUpperCase()); }
function setFilter(kind, value) {
  activeFilter[kind] = (activeFilter[kind] === value ? null : value);
  renderFilterBar();
  renderBoard(filteredDeals(), move, currentFunds, indexDealFunds(currentDealFunds));
  renderStats(currentDeals);              // instant palette highlight
  renderCharts(currentDeals);             // instant chart highlight
}
function clearFilter(kind) {
  activeFilter[kind] = null;
  renderFilterBar();
  renderBoard(filteredDeals(), move, currentFunds, indexDealFunds(currentDealFunds));
  renderStats(currentDeals);
  renderCharts(currentDeals);
}
function clearAllFilters() {
  activeFilter.stage = null;
  activeFilter.type = null;
  activeFilter.sector = null;
  searchQuery = '';
  const sb = document.getElementById('searchBox'); if (sb) sb.value = '';
  renderFilterBar();
  renderBoard(filteredDeals(), move, currentFunds, indexDealFunds(currentDealFunds));
  renderStats(currentDeals);
  renderCharts(currentDeals);
}
function searchMatches(d){
  if(!searchQuery) return true;
  const q = searchQuery.toLowerCase();
  return [d.name, d.source, d.deal_type, d.sector, d.currency]
    .filter(Boolean).some(v => String(v).toLowerCase().includes(q));
}
function filteredDeals() {
  return currentDeals.filter(d =>
    (!activeFilter.stage || d.stage === activeFilter.stage) &&
    (!activeFilter.type  || d.deal_type === activeFilter.type) &&
    (!activeFilter.sector|| (d.sector||'Unspecified') === activeFilter.sector) &&
    searchMatches(d)
  );
}
function renderFilterBar() {
  const bar = document.getElementById('filterBar');
  if (!bar) return;
  bar.innerHTML = '';
  const chips = [];
  if (activeFilter.stage) {
    chips.push(el('span', { className:'chip', innerText:`Stage: ${stageLabel(activeFilter.stage)}` }));
    chips.push(el('button', { className:'chip-btn', innerText:'Clear stage', onclick:()=>clearFilter('stage') }));
  }
  if (activeFilter.type) {
    chips.push(el('span', { className:'chip', innerText:`Type: ${activeFilter.type}` }));
    chips.push(el('button', { className:'chip-btn', innerText:'Clear type', onclick:()=>clearFilter('type') }));
  }
  if (activeFilter.sector) {
    chips.push(el('span', { className:'chip', innerText:`Sector: ${activeFilter.sector}` }));
    chips.push(el('button', { className:'chip-btn', innerText:'Clear sector', onclick:()=>clearFilter('sector') }));
  }
  if (searchQuery) {
    chips.push(el('span', { className:'chip', innerText:`Search: “${searchQuery}”` }));
  }
  if (!activeFilter.stage && !activeFilter.type && !activeFilter.sector && !searchQuery) {
    chips.push(el('span', { className:'light', innerText:'No filters' }));
  }
  chips.forEach(c => bar.appendChild(c));
}

// ---------------- UI helpers ----------------
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
function stageLabel(s){ return toTitle(s); }
function metrics(deals){
  return deals.reduce((acc,d)=>{
    acc.byStage[d.stage]=(acc.byStage[d.stage]||0)+1;
    acc.byType[d.deal_type]=(acc.byType[d.deal_type]||0)+1;
    const sec = d.sector || 'Unspecified';
    acc.bySector[sec]=(acc.bySector[sec]||0)+1;
    return acc;
  }, { byStage:{}, byType:{}, bySector:{} });
}
function attachEditHandlers(container){
  container.querySelectorAll('input, select, textarea').forEach(inp => {
    inp.addEventListener('focus', beginEdit);
    inp.addEventListener('input', beginEdit);
    inp.addEventListener('blur', endEditSoon);
  });
}

// ---------------- Attachments (Supabase Storage) ----------------
const STORAGE_BUCKET = 'deal-docs';
let currentAttachDeal = null;
const attachmentCountCache = new Map();

async function listDealAttachments(dealId) {
  if (window.DEMO_MODE || !client) return { items: [], error: null };
  const folder = String(dealId).trim().replace(/\/+$/,'') + '/';
  const { data, error } = await client
    .storage
    .from(STORAGE_BUCKET)
    .list(folder, { limit: 1000, sortBy: { column: 'name', order: 'desc' } });
  if (error) return { items: [], error };
  const items = (data || []).filter(x => x && !x.name.endsWith('/'));
  return { items, error: null };
}
async function ensureAttachmentCount(dealId){
  if (attachmentCountCache.has(dealId)) return attachmentCountCache.get(dealId);
  const { items } = await listDealAttachments(dealId);
  const n = (items||[]).length;
  attachmentCountCache.set(dealId, n);
  return n;
}
function updateClipBadge(dealId){
  const badge = document.getElementById(`clip-badge-${dealId}`);
  if (!badge) return;
  const n = attachmentCountCache.get(dealId) || 0;
  badge.textContent = n;
  badge.style.display = n ? 'flex' : 'none';
}

async function uploadDealAttachments(dealId, fileList) {
  const out = { ok: 0, fail: 0, errors: [] };
  if (window.DEMO_MODE) { alert('Uploads are disabled in DEMO_MODE'); return out; }
  if (!client) { alert('Supabase not initialized'); return out; }
  if (!fileList || !fileList.length) return out;

  const folder = String(dealId).trim().replace(/\/+$/,'');  // e.g., "uuid"
  const ingestErrors = [];

  for (const f of [...fileList]) {
    const safe = f.name.replace(/[^\w.\-]+/g, '_');
    const key = `${folder}/${Date.now()}-${safe}`;

    // 1) Upload to Supabase Storage (exact bucket from config)
    const { data, error } = await client.storage.from(STORAGE_BUCKET).upload(key, f, {
      cacheControl: '3600',
      upsert: false,
      contentType: f.type || 'application/octet-stream'
    });

    if (error) {
      out.fail++; out.errors.push({ file: f.name, key, error });
      console.error('[upload error]', { file: f.name, key, error });
      continue;
    }

    out.ok++;

    // 2) Kick off indexing with the EXACT saved path (data.path)
    try {
      if (typeof window.ingestDealDocs === 'function') {
        await window.ingestDealDocs({
          dealId,
          bucket: STORAGE_BUCKET,
          path: data.path,                 // exact object key as saved in Storage
          filename: f.name,
          mime: f.type || 'application/pdf'
        });
      } else {
        console.warn('ingestDealDocs helper not loaded; skipping indexing');
      }
    } catch (e) {
      ingestErrors.push({ file: f.name, message: e?.message || String(e) });
      console.error('[ingest error]', e);
    }
  }

  // Refresh UI after all uploads
  const { items } = await listDealAttachments(dealId);
  attachmentCountCache.set(dealId, (items||[]).length);
  updateClipBadge(dealId);

  if (out.fail) {
    const first = out.errors[0];
    alert(`Upload failed for ${first.file}: ${first.error?.message || first.error?.status || 'Unknown error'}. Check console for details.`);
  }
  if (ingestErrors.length) {
    console.warn('Some files failed to index', ingestErrors);
  }
  return out;
}
async function openSignedDownload(dealId, name) {
  if (window.DEMO_MODE || !client) return;
  const key = `${String(dealId).trim().replace(/\/+$/,'')}/${name}`;
  const { data, error } = await client.storage.from(STORAGE_BUCKET).createSignedUrl(key, 60 * 15);
  if (error) { console.error('signed url error', error); alert('Download unavailable: ' + error.message); return; }
  window.open(data.signedUrl, '_blank');
}
async function deleteDealAttachment(dealId, name) {
  if (window.DEMO_MODE || !client) return false;
  const key = `${String(dealId).trim().replace(/\/+$/,'')}/${name}`;
  const { error } = await client.storage.from(STORAGE_BUCKET).remove([key]);
  if (error) { console.error('delete error', error); alert('Delete failed: ' + error.message); return false; }
  const { items } = await listDealAttachments(dealId);
  attachmentCountCache.set(dealId, (items||[]).length);
  updateClipBadge(dealId);
  return true;
}
function fmtSize(bytes) {
  if (!Number.isFinite(bytes)) return '';
  const k = 1024, u = ['B','KB','MB','GB','TB'];
  const i = Math.max(0, Math.floor(Math.log(bytes)/Math.log(k)));
  return `${(bytes/Math.pow(k,i)).toFixed(1)} ${u[i]}`;
}

// Modal open/close + render
async function openAttachmentsModal(deal){
  currentAttachDeal = deal;
  const modal = document.getElementById('attachmentModal');
  const title = document.getElementById('attachTitle');
  title.textContent = `Attachments — ${deal.name}`;
  modal.classList.add('open');
  await renderAttachmentList();
}
function closeAttachmentsModal(){
  currentAttachDeal = null;
  document.getElementById('attachmentModal').classList.remove('open');
}
async function renderAttachmentList(){
  const listDiv = document.getElementById('attachmentList');
  if (!currentAttachDeal) return;
  listDiv.innerHTML = 'Loading…';
  const { items, error } = await listDealAttachments(currentAttachDeal.id);
  if (error) {
    listDiv.innerHTML = `<div class="err">Cannot list files: ${error.message || error.status || 'Unknown error'}</div>`;
    return;
  }
  attachmentCountCache.set(currentAttachDeal.id, (items||[]).length);
  updateClipBadge(currentAttachDeal.id);

  if (!items.length){
    listDiv.innerHTML = `<div class="light">No attachments yet.</div>`;
    return;
  }
  listDiv.innerHTML = '';
  items.forEach(x=>{
    const row = el('div', { className:'list-row' }, [
      el('div', {}, [
        el('div', { innerText: x.name }),
        el('div', { className:'meta', innerText: fmtSize(x.size || x.metadata?.size || 0) })
      ]),
      el('div', {}, [
        el('a', { href:'#', className:'ghost-btn', innerText:'Download', onclick: async (e)=>{ e.preventDefault(); await openSignedDownload(currentAttachDeal.id, x.name); } }),
        el('button', { className:'ghost-btn', innerText:'Delete', style:'margin-left:6px;', onclick: async ()=>{
          if (!confirm('Delete this file?')) return;
          const ok = await deleteDealAttachment(currentAttachDeal.id, x.name);
          if (ok) renderAttachmentList();
        }})
      ])
    ]);
    listDiv.appendChild(row);
  });
}

// ---------------- Funds UI ----------------
function FundsPanel({deal, funds, dealFundsMap}){
  const rows = dealFundsMap[deal.id] || [];
  const total = rows.reduce((a,r)=> a + (Number(r.commitment)||0), 0);
  const select = el("select", {}, funds.map(f => el("option", { value:String(f.id), innerText:f.name })));
  const role = el("select", {}, ["Lead","Co-Lead","Participant"].map(r => el("option", { innerText:r })));
  const status = el("select", {}, ["Proposed","SoftCircled","Committed","Closed"].map(s => el("option", { innerText:s })));
  const commitment = el("input", { type:"number", step:"0.01", placeholder:"Commitment (M)" });
  const add = el("button", { innerText:"Add" });
  add.onclick = async () => {
    beginEdit();
    const df = await insertDealFund({ deal_id: deal.id, fund_id: Number(select.value), role: role.value, status: status.value, commitment: parseFloat(commitment.value||"0") });
    editing = false;
    if (df) refresh();
  };

  const list = el("div", {}, rows.map(r => FundRow({ row:r, funds, onChange: async (patch)=>{
      beginEdit();
      const saved = await updateDealFund({ id:r.id, ...patch });
      editing = false;
      if (saved) refresh();
    }, onDelete: async ()=>{
      beginEdit();
      if (confirm("Remove this participation?")) {
        const ok = await deleteDealFund(r.id);
        editing = false;
        if (ok) refresh();
      } else {
        editing = false;
      }
    }})));

  const panel = el("div", { className:"funds" }, [
    el("div", { className:"light", innerText:`Total Committed: $${total.toFixed(2)} M` }),
    el("div", { className:"fund-row", style:"margin:6px 0;" }, [
      el("span", { className:"light", innerText:"Add fund: " }),
      select, role, status, commitment, add
    ]),
    list
  ]);
  attachEditHandlers(panel);
  return panel;
}
function FundRow({row, funds, onChange, onDelete}){
  const fund = funds.find(f=>f.id===row.fund_id);
  const name = fund?fund.name:`Fund ${row.fund_id}`;
  const role = el("select", { value:row.role }, ["Lead","Co-Lead","Participant"].map(r => el("option", { innerText:r })));
  const status = el("select", { value:row.status }, ["Proposed","SoftCircled","Committed","Closed"].map(s => el("option", { innerText:s })));
  const commitment = el("input", { type:"number", step:"0.01", value:String(row.commitment||0), style:"width:110px;" });
  const save = el("button", { innerText:"Save" });
  save.onclick = ()=> onChange({ role: role.value, status: status.value, commitment: parseFloat(commitment.value||"0") });
  const remove = el("button", { innerText:"Remove" });
  remove.onclick = onDelete;
  const rowEl = el("div", { className:"fund-row" }, [
    el("span", { className:"chip", innerText:name }),
    el("span", { className:"chip", innerText:`$${(Number(commitment.value)||0)}M` }),
    role, status, commitment, save, remove
  ]);
  attachEditHandlers(rowEl);
  return rowEl;
}

// ---------------- Deal UI ----------------
function renderStats(deals){
  const { byStage } = metrics(deals);
  const s = qs("#stats"); s.innerHTML = "";
  STAGE_ORDER.forEach((k) => {
    const v = byStage[k] || 0;
    const tile = el("div", {
      className: `stat${activeFilter.stage===k ? ' active':''}`,
      title: "Click to filter by this stage",
      tabIndex: 0,
      role: "button",
      onkeydown: (e)=>{ if(e.key==='Enter'||e.key===' ') { e.preventDefault(); setFilter('stage', k); } }
    }, [
      el("div", { className:"label", innerText: stageLabel(k) }),
      el("div", { className:"value", innerText: v })
    ]);
    tile.addEventListener('click', () => setFilter('stage', k));
    s.appendChild(tile);
  });
}
function DealCard(d, onMove, funds, dealFundsMap){
  const rejectReason = el("input", { id:`reject-${d.id}`, value: d.data?.reject_reason || "", placeholder:"Reject reason..." });
  const docs = el("input", { type:"checkbox", id:`docs-${d.id}`, checked: !!d.data?.docs_executed });
  const fundsSettled = el("input", { type:"checkbox", id:`funds-${d.id}`, checked: !!d.data?.funds_settled });

  // outlined paperclip SVG (pro)
  const clipSVG = '<svg class="clip-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M21.44 11.05l-8.49 8.49a5.5 5.5 0 11-7.78-7.78l9.19-9.19a3.5 3.5 0 014.95 4.95l-9.9 9.9a1.5 1.5 0 11-2.12-2.12l8.49-8.49" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const attachBtn = el("button", { className:"clip-btn", title:"Manage attachments", innerHTML:clipSVG, onclick: ()=> openAttachmentsModal(d) });
  const badge = el("div", { id:`clip-badge-${d.id}`, className:"clip-badge", innerText:"0" });
  attachBtn.appendChild(badge);

  // chat bubble SVG (stroke-only, matching clip style)
  const chatSVG = '<svg class="clip-svg" viewBox="0 0 24 24" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none"><path d="M21 12a8.5 8.5 0 01-8.5 8.5c-1.52 0-2.95-.38-4.2-1.06L3 21l1.63-4.16A8.47 8.47 0 013.5 12 8.5 8.5 0 1112 20.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const chatBtn = el("button", { className:"clip-btn", title:"Chat", innerHTML:chatSVG });
  chatBtn.setAttribute('data-action','chat');
  chatBtn.setAttribute('data-deal-id', d.id);
  chatBtn.setAttribute('data-deal-name', d.name);

  const card = el("div", { className:"card" }, [
    el("div", { className:"card-header" }, [
      el("div", { innerHTML:`<b>${d.name}</b>` }),
      el("div", { style:"display:flex; gap:6px; align-items:center;" }, [attachBtn, chatBtn])
    ]),
    el("div", { innerText:`Source: ${d.source||""}` }),
    el("div", { innerText:`Type: ${d.deal_type||""}` }),
    el("div", { innerText:`${d.currency||"USD"} ${d.size||0}M` }),
    el("div", { innerText:`Sector: ${d.sector||""}` }),
    d.stage===Stages.ACTIVE && rejectReason,
    d.stage===Stages.CLOSING && el("div", { className:"row" }, [
      el("label", {}, [docs, "Docs executed"]),
      el("label", {}, [fundsSettled, "Funds settled"])
    ]),
    FundsPanel({ deal:d, funds, dealFundsMap }),
    el("div", { className:"buttons" }, (Allowed[d.stage]||[]).map(next => {
      return el("button", { onclick:()=>onMove(d, next), innerText:`→ ${stageLabel(next)}` });
    }))
  ]);

  // lazy badge count
  ensureAttachmentCount(d.id).then(()=> updateClipBadge(d.id));

  attachEditHandlers(card);
  return card;
}
function renderBoard(deals, onMove, funds, dealFundsMap){
  const stages = STAGE_ORDER;
  const board = qs("#board"); board.innerHTML = "";
  stages.forEach(stage => {
    const col = el("div", { className:"col" }, el("b", { innerText: stageLabel(stage) }));
    deals.filter(d=>d.stage===stage).forEach(d => col.appendChild(DealCard(d, onMove, funds, dealFundsMap)));
    board.appendChild(col);
  });
}

// ---------------- Charts wiring ----------------
let chartHandlersBound = false;
function canvasPoint(canvas, evt){
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  return { x: (evt.clientX - rect.left) * scaleX, y: (evt.clientY - rect.top) * scaleY };
}
function renderCharts(deals){
  const by = metrics(deals);
  const typeCanvas   = document.getElementById("chartType");
  const sectorCanvas = document.getElementById("chartSector");

  // deal type donut
  areasType = drawDoughnutChart(
    typeCanvas,
    Object.keys(by.byType),
    Object.values(by.byType),
    activeFilter.type
  );
  // sector donut
  areasSector = drawDoughnutChart(
    sectorCanvas,
    Object.keys(by.bySector),
    Object.values(by.bySector),
    activeFilter.sector
  );

  if (!chartHandlersBound) {
    chartHandlersBound = true;

    const hitArc = (areas, canvas, e)=>{
      const p = canvasPoint(canvas, e);
      const hit = areas.find(s => {
        const dx = p.x - s.cx, dy = p.y - s.cy;
        const R = Math.hypot(dx, dy);
        if (R < s.innerR || R > s.r) return false;
        let ang = Math.atan2(dy, dx);
        if (ang < -Math.PI/2) ang += Math.PI*2;
        const within = (ang >= s.start && s.end >= s.start && ang <= s.end) ||
                       (s.end < s.start && (ang >= s.start || ang <= s.end));
        return within;
      });
      return hit;
    };
    const hitLegend = (areas, canvas, e)=>{
      const p = canvasPoint(canvas, e);
      const legends = areas.legends || [];
      return legends.find(r => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h);
    };

    typeCanvas.addEventListener('click', (e)=>{
      const hit = hitArc(areasType, typeCanvas, e) || hitLegend(areasType, typeCanvas, e);
      if (hit) setFilter('type', hit.key); else clearFilter('type');
    });
    sectorCanvas.addEventListener('click', (e)=>{
      const hit = hitArc(areasSector, sectorCanvas, e) || hitLegend(areasSector, sectorCanvas, e);
      if (hit) setFilter('sector', hit.key); else clearFilter('sector');
    });
  }
}

// ---------------- CSV Import/Export (unchanged) ----------------
async function exportCSVs(){
  const [deals, funds, parts] = await Promise.all([loadDeals(), loadFunds(), loadDealFunds()]);
  const fundById = Object.fromEntries(funds.map(f=>[f.id, f]));
  const ts = new Date().toISOString().replace(/[:.]/g,'-');

  const dealsRows = deals.map(d=> ({
    id: d.id, name: d.name, deal_type: d.deal_type || '', stage: d.stage,
    source: d.source || '', currency: d.currency || 'USD', size_m: d.size || 0,
    sector: d.sector || '', created_at: d.created_at || ''
  }));
  downloadFile(`deals-${ts}.csv`, toCSV(dealsRows));

  const partRows = parts.map(p=> ({
    id: p.id, deal_id: p.deal_id, fund_id: p.fund_id,
    fund_name: (fundById[p.fund_id]?.name) || '', role: p.role || '',
    status: p.status || '', commitment_m: p.commitment || 0, created_at: p.created_at || ''
  }));
  downloadFile(`deal_funds-${ts}.csv`, toCSV(partRows));
}
function detectType(rows){
  const keys = new Set(Object.keys(rows[0]||{}).map(k=>k.toLowerCase()));
  const hasDealFunds = keys.has('deal_id') || keys.has('deal_name') || keys.has('fund_id') || keys.has('fund_name');
  return hasDealFunds ? 'deal_funds' : 'deals';
}
function normalizeDeal(r){
  return {
    name: r.name,
    deal_type: r.deal_type || null,
    stage: (r.stage||'preliminary').toLowerCase(),
    source: r.source || null,
    currency: r.currency || 'USD',
    size: r.size_m ? parseFloat(r.size_m) : null,
    sector: r.sector || null,
    data: {}
  };
}
async function normalizeDealFunds(rows){
  const funds = await loadFunds();
  const fundByName = Object.fromEntries(funds.map(f=>[f.name.toLowerCase(), f.id]));
  const deals = await loadDeals();
  const dealByName = Object.fromEntries(deals.map(d=>[d.name.toLowerCase(), d.id]));
  return rows.map(r=>{
    let deal_id = r.deal_id ? Number(r.deal_id) : (dealByName[(r.deal_name||'').toLowerCase()] || null);
    let fund_id = r.fund_id ? Number(r.fund_id) : (fundByName[(r.fund_name||'').toLowerCase()] || null);
    return {
      deal_id,
      fund_id,
      role: r.role || 'Participant',
      status: r.status || 'Proposed',
      commitment: r.commitment_m ? parseFloat(r.commitment_m) : null,
      notes: r.notes || null
    };
  }).filter(r=>r.deal_id && r.fund_id);
}
async function importRows(rows){
  if(!rows.length) throw new Error('No data found in CSV');
  const type = detectType(rows);
  if(type==='deals'){
    const payload = rows.map(normalizeDeal).filter(d=>d.name && d.stage);
    if(!payload.length) throw new Error('No valid deal rows detected.');
    if(!confirm(`Import ${payload.length} deals?`)) return 0;
    return (await Promise.all(payload.map(insertDeal))).length;
  } else {
    const payload = await normalizeDealFunds(rows);
    if(!payload.length) throw new Error('No valid deal_funds rows detected (need deal_id/deal_name and fund_id/fund_name).');
    if(!confirm(`Import ${payload.length} participations?`)) return 0;
    return (await Promise.all(payload.map(insertDealFund))).length;
  }
}

// ---------------- Controller ----------------
let currentDeals = [], currentFunds = [], currentDealFunds = [];
function indexDealFunds(rows){
  return rows.reduce((acc, r)=>{ (acc[r.deal_id] = acc[r.deal_id] || []).push(r); return acc; }, {});
}
async function refresh(opts = { renderBoard: true }){
  const [deals, funds, df] = await Promise.all([loadDeals(), loadFunds(), loadDealFunds()]);
  currentDeals = deals; currentFunds = funds; currentDealFunds = df;

  renderStats(currentDeals);
  if (!editing && opts.renderBoard) {
    renderBoard(filteredDeals(), move, currentFunds, indexDealFunds(currentDealFunds));
  }
  renderCharts(currentDeals);
  renderFilterBar();
}
async function move(deal, to){
  const key = `${deal.stage}->${to}`;
  const guard = Guards[key] || (()=>[]);
  const d = JSON.parse(JSON.stringify(deal));
  const errors = guard(d);
  if (errors.length) { alert(errors.join("\n")); return; }
  beginEdit();
  const saved = await updateDeal({ id: d.id, stage: to, data: d.data });
  editing = false;
  if (saved) refresh();
}

// ---------------- Search wiring ----------------
function wireSearchControls(){
  const sb = document.getElementById('searchBox');
  const cs = document.getElementById('clearSearch');
  const ca = document.getElementById('clearAllFiltersBtn');

  if (sb && !sb._wired) {
    sb._wired = true;
    sb.addEventListener('input', () => {
      searchQuery = sb.value.trim();
      renderFilterBar();
      renderBoard(filteredDeals(), move, currentFunds, indexDealFunds(currentDealFunds));
      renderStats(currentDeals);
      renderCharts(currentDeals);
    });
  }
  if (cs && !cs._wired) {
    cs._wired = true;
    cs.addEventListener('click', () => {
      searchQuery = ''; sb.value = '';
      renderFilterBar();
      renderBoard(filteredDeals(), move, currentFunds, indexDealFunds(currentDealFunds));
      renderStats(currentDeals);
      renderCharts(currentDeals);
    });
  }
  if (ca && !ca._wired) {
    ca._wired = true;
    ca.addEventListener('click', clearAllFilters);
  }
}

// ---------------- Boot ----------------
document.addEventListener('DOMContentLoaded', ()=>{
  wireSearchControls();

  // Modal buttons
  const modal = document.getElementById('attachmentModal');
  const uploadBtn = document.getElementById('attachUploadBtn');
  const refreshBtn = document.getElementById('attachRefreshBtn');
  const closeBtn = document.getElementById('attachCloseBtn');
  const fileInput = document.getElementById('attachFileInput');

  uploadBtn.onclick = ()=> fileInput.click();
  fileInput.onchange = async (e)=>{
    if (currentAttachDeal){
      const res = await uploadDealAttachments(currentAttachDeal.id, e.target.files);
      e.target.value = '';
      if (res.ok) await renderAttachmentList();
    }
  };
  refreshBtn.onclick = ()=> renderAttachmentList();
  closeBtn.onclick = ()=> closeAttachmentsModal();

  // Close on backdrop click + Esc
  modal.addEventListener('click', (e)=>{ if (e.target === modal) closeAttachmentsModal(); });
  document.addEventListener('keydown', (e)=>{ if (e.key === 'Escape') closeAttachmentsModal(); });

  document.getElementById("add").onclick = async () => {
    const name = qs("#name").value.trim(); if(!name) return alert("Deal name required");
    const row = {
      name,
      deal_type: qs("#type").value,
      stage: Stages.PRELIMINARY,
      source: qs("#source").value.trim(),
      currency: qs("#currency").value.trim() || "USD",
      size: parseFloat(qs("#size").value || "0"),
      sector: qs("#sector").value.trim(),
      data: {}
    };
    beginEdit();
    const saved = await insertDeal(row);
    editing = false;
    if (saved) {
      qs("#name").value = ""; qs("#source").value = ""; qs("#size").value = ""; qs("#sector").value = "";
      refresh();
    }
  };

  // Import/Export wiring
  const file = document.getElementById('file');
  const importBtn = document.getElementById('importBtn');
  const drop = document.getElementById('drop');
  const status = document.getElementById('importStatus');
  importBtn.onclick = ()=> file.click();
  file.onchange = async (e)=> handleFiles(e.target.files);
  drop.ondragover = (e)=>{ e.preventDefault(); drop.classList.add('drag'); };
  drop.ondragleave = ()=> drop.classList.remove('drag');
  drop.ondrop = (e)=>{ e.preventDefault(); drop.classList.remove('drag'); handleFiles(e.dataTransfer.files); };
  document.getElementById('export').onclick = exportCSVs;

  async function handleFiles(files){
    const f = files[0]; if(!f) return;
    if(!/\.csv$/i.test(f.name)) { status.innerHTML = '<span class="err">Please drop a .csv file.</span>'; return; }
    const text = await f.text();
    let rows;
    try { rows = parseCSV(text); }
    catch(e){ status.innerHTML = '<span class="err">CSV parse error: '+e.message+'</span>'; return; }
    if(!rows || !rows.length){ status.innerHTML = '<span class="err">No rows found in CSV.</span>'; return; }
    status.innerHTML = 'Parsed '+rows.length+' rows. Detecting type…';
    try {
      const n = await importRows(rows);
      if (n>0) {
        status.innerHTML = '<span class="ok">Imported '+n+' row(s) successfully.</span>';
        refresh();
      } else {
        status.innerHTML = '<span class="light">Import canceled.</span>';
      }
    } catch(e){
      status.innerHTML = '<span class="err">Import error: '+(e.message||e)+'</span>';
    }
  }
});

// Initial load + non-destructive background refresh
refresh();
setInterval(()=>{ if(!editing) refresh({ renderBoard:false }); }, 5000);
// ======================= /Altaris Deal Pipeline — app.js (clickable legends) ==========================
