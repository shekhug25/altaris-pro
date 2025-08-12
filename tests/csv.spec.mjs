import assert from 'node:assert/strict';

function parseCSV(text){
  const rows = []; let i=0, cur='', inq=false, row=[];
  while(i<text.length){
    const ch=text[i];
    if(inq){
      if(ch === '"' && text[i+1] === '"'){ cur+='"'; i+=2; continue; }
      if(ch === '"'){ inq=false; i++; continue; }
      cur+=ch; i++; continue;
    } else {
      if(ch === '"'){ inq=true; i++; continue; }
      if(ch === ','){ row.push(cur); cur=''; i++; continue; }
      if(ch === '\n' || ch === '\r'){
        if(cur.length || row.length){ row.push(cur); rows.push(row); row=[]; cur=''; }
        if(ch==='\r' && text[i+1]==='\n') i+=2; else i++;
        continue;
      }
      cur+=ch; i++; continue;
    }
  }
  if(cur.length || row.length){ row.push(cur); rows.push(row); }
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
    return /[",\n]/.test(s) ? `"${s}"` : s;
  };
  const lines = [headers.join(',')];
  for (const r of rows) lines.push(headers.map(h=>esc(r[h])).join(','));
  return lines.join('\n');
}

// Tests
{
  const csv = 'name,deal_type,stage\n"Project Alpha",DirectLending,preliminary\n';
  const rows = parseCSV(csv);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'Project Alpha');
  assert.equal(rows[0].stage, 'preliminary');
}

{
  const original = [
    { name: 'Comma, Co', note: 'He said "hello"', stage: 'active' },
    { name: 'New\nLine', note: 'line1\nline2', stage: 'closing' }
  ];
  const csv = toCSV(original);
  const back = parseCSV('name,note,stage\n' + csv.split('\n').slice(1).join('\n'));
  assert.equal(back.length, 2);
  assert.equal(back[0].name, 'Comma, Co');
  assert.equal(back[0].note, 'He said "hello"');
  assert.equal(back[1].name, 'New\nLine');
}

console.log('CSV tests passed');
