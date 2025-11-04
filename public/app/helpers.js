export async function apiGet(url){
  const res = await fetch(url, { credentials: 'same-origin', headers: { 'Accept': 'application/json' } });
  if (res.status === 401){ location.href = '/login'; throw new Error('401 Unauthorized'); }
  if (!res.ok) throw new Error(`GET ${url} ${res.status}`);
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('application/json')) {
    const t = await res.text(); throw new Error('Expected JSON, got: ' + t.slice(0,120));
  }
  return res.json();
}
export async function apiPost(url, data){
  const res = await fetch(url, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify(data || {})
  });
  if (res.status === 401){ location.href = '/login'; throw new Error('401 Unauthorized'); }
  if (!res.ok){
    const ct = res.headers.get('content-type')||'';
    if (ct.includes('application/json')) {
      const j = await res.json(); throw new Error(`POST ${url} ${res.status}: ${JSON.stringify(j)}`);
    }
    const t = await res.text(); throw new Error(`POST ${url} ${res.status}: ${t.slice(0,120)}`);
  }
  const ct = res.headers.get('content-type')||'';
  return ct.includes('application/json') ? res.json() : { ok:true };
}
// simple helper for forms
export function qs(sel, el=document){ return el.querySelector(sel); }
