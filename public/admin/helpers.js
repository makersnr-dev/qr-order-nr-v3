
async function apiGet(url){
  const res = await fetch(url, { credentials: 'same-origin' });
  if (res.status === 401){ location.href='/login'; throw new Error('401'); }
  if (!res.ok) throw new Error('GET '+url+' '+res.status);
  const ct = res.headers.get('content-type')||'';
  if (!ct.includes('application/json')){
    const t = await res.text(); throw new Error('Expected JSON, got: '+t.slice(0,120));
  }
  return res.json();
}
async function apiPost(url, data){
  const res = await fetch(url, { method:'POST', credentials:'same-origin', headers:{'Content-Type':'application/json'}, body: JSON.stringify(data||{}) });
  if (res.status === 401){ location.href='/login'; throw new Error('401'); }
  if (!res.ok) throw new Error('POST '+url+' '+res.status);
  return res.json();
}
