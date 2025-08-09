// ---- Supabase Init ----
const client = supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);

// ---- Edit-safe refresh ----
let editing=false, editTimer=null;
function beginEdit(){ editing=true; if(editTimer) clearTimeout(editTimer); }
function endEditSoon(){ if(editTimer) clearTimeout(editTimer); editTimer=setTimeout(()=>{ editing=false; refresh(); }, 1200); }

// ---- CSV helpers ----
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
        if(ch==='\r' && text[i+1]==='\n') i+=2; else i++;
        continue;
      }
      cur+=ch; i++; continue;
    }
  }
  if(cur.length||row.length) { row.push(cur); rows.push(row); }
  if(!rows.length) return [];
  const headers = rows[0].map(h=>h.trim().toLowerCase());
  return rows.slice(1).filter(r=>r.length && r.some(x=>String(x).trim().length)).map(r=>{
    const obj={};
    headers.forEach((h,idx)=>obj[h]=r[idx]!==undefined?r[idx].trim():'');
    return obj;
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

// ---- Charts (no deps) ----
function drawBarChart(canvas, labels, data) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0,0,w,h);
  const margin = 28, barGap = 10;
  const max = Math.max(1, ...data);
  const chartW = w - margin*2, chartH = h - margin*2;
  const barW = Math.max(8, (chartW - (labels.length-1)*barGap) / labels.length);
  ctx.strokeStyle = '#555'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(margin, h-margin); ctx.lineTo(w-margin, h-margin); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(margin, margin); ctx.lineTo(margin, h-margin); ctx.stroke();
  let x = margin;
  ctx.fillStyle = '#4ea3ff';
  labels.forEach((lab, i) => {
    const val = data[i]||0;
    const bh = (val / max) * (chartH-10);
    const y = h - margin - bh;
    ctx.fillRect(x, y, barW, bh);
    ctx.fillStyle = '#ccc'; ctx.font = '10px system-ui';
    ctx.textAlign = 'center'; ctx.fillText(lab, x + barW/2, h - margin + 12);
    ctx.fillStyle = '#4ea3ff';
    x += barW + barGap;
  });
}
function drawDoughnutChart(canvas, labels, data) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0,0,w,h);
  const cx = w/2, cy = h/2, r = Math.min(w,h)/2 - 15, innerR = r * 0.6;
  const total = data.reduce((a,b)=>a+b,0) || 1;
  const colors = ['#4ea3ff','#28a745','#ffc107','#dc3545','#6f42c1','#17a2b8','#ff7f50','#9acd32'];
  let start = -Math.PI/2;
  data.forEach((val, i) => {
    const ang = (val/total) * Math.PI*2;
    ctx.beginPath(); ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, start, start+ang); ctx.closePath();
    ctx.fillStyle = colors[i % colors.length]; ctx.fill();
    start += ang;
  });
  ctx.globalCompositeOperation = 'destination-out';
  ctx.beginPath(); ctx.arc(cx, cy, innerR, 0, Math.PI*2); ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
  ctx.font = '11px system-ui'; ctx.fillStyle = '#ddd'; ctx.textAlign='left';
  let y = 16;
  labels.forEach((lab, i)=>{
    ctx.fillStyle = colors[i % colors.length];
    ctx.fillRect(w-120, y-8, 10, 10);
    ctx.fillStyle = '#ddd';
    ctx.fillText(`${lab}: ${data[i]||0}`, w-105, y);
    y += 16;
  });
}

// ---- Model ----
const Stages = {
  PRELIMINARY: "preliminary",
  ACTIVE: "active",
  APPROVAL: "approval",
  CLOSING: "closing",
  ASSET_MGMT: "asset_management",
  REJECTED: "rejected",
};
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

// ---- Data access ----
async function loadDeals(){ const { data } = await client.from('deals').select('*').order('id'); return data||[]; }
async function insertDeals(rows){ const { data, error } = await client.from('deals').insert(rows).select(); if(error){throw error;} return data; }
async function insertDeal(row){ const { data, error } = await client.from('deals').insert(row).select().single(); if(error){alert(error.message);return null;} return data; }
async function updateDeal(row){ const { data, error } = await client.from('deals').update(row).eq('id', row.id).select().single(); if(error){alert(error.message);return null;} return data; }
async function loadFunds(){ const { data } = await client.from('funds').select('*').order('name'); return data||[]; }
async function loadDealFunds(){ const { data } = await client.from('deal_funds').select('*').order('deal_id'); return data||[]; }
async function insertDealFunds(rows){ const { data, error } = await client.from('deal_funds').insert(rows).select(); if(error){throw error;} return data; }
async function insertDealFund(row){ const { data, error } = await client.from('deal_funds').insert(row).select().single(); if(error){alert(error.message);return null;} return data; }
async function updateDealFund(row){ const { data, error } = await client.from('deal_funds').update(row).eq('id', row.id).select().single(); if(error){alert(error.message);return null;} return data; }
async function deleteDealFund(id){ const { error } = await client.from('deal_funds').delete().eq('id', id); if(error){alert(error.message);return false;} return true; }

// ---- UI helpers ----
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
function stageLabel(s){ return s.replace("_", " "); }
function metrics(deals){
  return deals.reduce((acc,d)=>{
    acc.byStage[d.stage]=(acc.byStage[d.stage]||0)+1;
    acc.byType[d.deal_type]=(acc.byType[d.deal_type]||0)+1;
    return acc;
  }, { byStage:{}, byType:{} });
}
function attachEditHandlers(container){
  container.querySelectorAll('input, select, textarea').forEach(inp => {
    inp.addEventListener('focus', beginEdit);
    inp.addEventListener('input', beginEdit);
    inp.addEventListener('blur', endEditSoon);
  });
}

// ---- Funds UI ----
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

// ---- Deal UI ----
function renderStats(deals){
  const { byStage } = metrics(deals);
  const s = qs("#stats"); s.innerHTML = "";
  Object.entries(byStage).forEach(([k,v]) => {
    s.appendChild(el("div", { className:"stat" }, [
      el("div", { className:"label", innerText: stageLabel(k) }),
      el("div", { className:"value", innerText: v })
    ]));
  });
}

function DealCard(d, onMove, funds, dealFundsMap){
  const rejectReason = el("input", { id:`reject-${d.id}`, value: d.data?.reject_reason || "", placeholder:"Reject reason..." });
  const docs = el("input", { type:"checkbox", id:`docs-${d.id}`, checked: !!d.data?.docs_executed });
  const fundsSettled = el("input", { type:"checkbox", id:`funds-${d.id}`, checked: !!d.data?.funds_settled });

  const card = el("div", { className:"card" }, [
    el("div", { innerHTML:`<b>${d.name}</b>` }),
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
  attachEditHandlers(card);
  return card;
}

function renderBoard(deals, onMove, funds, dealFundsMap){
  const stages = [Stages.PRELIMINARY, Stages.ACTIVE, Stages.APPROVAL, Stages.CLOSING, Stages.ASSET_MGMT, Stages.REJECTED];
  const board = qs("#board"); board.innerHTML = "";
  stages.forEach(stage => {
    const col = el("div", { className:"col" }, el("b", { innerText: stageLabel(stage) }));
    deals.filter(d=>d.stage===stage).forEach(d => col.appendChild(DealCard(d, onMove, funds, dealFundsMap)));
    board.appendChild(col);
  });
}

function renderCharts(deals){
  const by = metrics(deals);
  drawBarChart(document.getElementById("chartStage"), Object.keys(by.byStage), Object.values(by.byStage));
  drawDoughnutChart(document.getElementById("chartType"), Object.keys(by.byType), Object.values(by.byType));
}

// ---- Import logic ----
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
    const chunks = []; for(let i=0;i<payload.length;i+=200) chunks.push(payload.slice(i,i+200));
    let total=0;
    for(const ch of chunks){ const res = await insertDeals(ch); total+=res.length; }
    return total;
  } else {
    const payload = await normalizeDealFunds(rows);
    if(!payload.length) throw new Error('No valid deal_funds rows detected (need deal_id/deal_name and fund_id/fund_name).');
    if(!confirm(`Import ${payload.length} participations?`)) return 0;
    const chunks = []; for(let i=0;i<payload.length;i+=200) chunks.push(payload.slice(i,i+200));
    let total=0;
    for(const ch of chunks){ const res = await insertDealFunds(ch); total+=res.length; }
    return total;
  }
}

// ---- Export ----
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

// ---- Controller ----
let currentDeals = [], currentFunds = [], currentDealFunds = [];
function indexDealFunds(rows){
  return rows.reduce((acc, r)=>{ (acc[r.deal_id] = acc[r.deal_id] || []).push(r); return acc; }, {});
}
async function refresh(){
  const [deals, funds, df] = await Promise.all([loadDeals(), loadFunds(), loadDealFunds()]);
  currentDeals = deals; currentFunds = funds; currentDealFunds = df;
  renderStats(currentDeals);
  if (!editing) {
    renderBoard(currentDeals, move, currentFunds, indexDealFunds(currentDealFunds));
  }
  renderCharts(currentDeals);
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

// Add deal + Import/Export bindings
document.addEventListener('DOMContentLoaded', ()=>{
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

  const fileInput = document.getElementById('file');
  const importBtn = document.getElementById('importBtn');
  const drop = document.getElementById('drop');
  const status = document.getElementById('importStatus');
  importBtn.onclick = ()=> fileInput.click();
  fileInput.onchange = async (e)=> handleFiles(e.target.files);
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

// Initial load + polling
refresh();
setInterval(()=>{ if(!editing) refresh(); }, 5000);
