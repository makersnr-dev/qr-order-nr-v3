// @ts-check
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import bodyParser from 'body-parser';
import cookieParser from 'cookie-parser';
import { getIronSession } from 'iron-session';
import fs from 'fs';

// Node 18+ has global fetch; add minimal guard
if (typeof fetch !== 'function') { global.fetch = (await import('node-fetch')).default; }

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(bodyParser.json());
app.use(cookieParser());

// ===== iron-session setup =====

const sessionPassword = process.env.SESSION_PASSWORD || 'change-me-32-characters-min-secret!!!!';

if (!sessionPassword || sessionPassword.length < 32) {
  console.warn('[WARN] SESSION_PASSWORD is missing or too short; using fallback for dev.');
}

const sessionOptions = {
  cookieName: 'qrnr_sess',
  password: sessionPassword,
  cookieOptions: {
    secure: true, // vercel = https
    httpOnly: true,
    sameSite: 'lax',
  },
};

// ✅ v8에서는 전역 미들웨어가 없으므로, 요청마다 세션을 붙여주는 커스텀 미들웨어 추가 
app.use(async (req, res, next) => { try { req.session = await getIronSession(req, res, sessionOptions); next(); } catch (e) { next(e); } });

function requireAdmin(req, res, next){
  const u = req.session?.user;
  if (u && u.role === 'admin') return next();
  return res.status(401).json({ ok:false, message:'Unauthorized' });
}

// ===== Static files (namespaced) =====
app.use('/static/admin', express.static(path.join(__dirname, '..', 'public', 'admin')));
app.use('/static/app', express.static(path.join(__dirname, '..', 'public', 'app')));

// ===== Auth (iron-session) =====
app.post('/api/admin/login', async (req, res) => {
  const { username, password } = req.body || {};
  const ADMIN_USER = process.env.ADMIN_USER || 'admin';
  const ADMIN_PASS = process.env.ADMIN_PASS || 'admin1234';
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    req.session.user = { id: '1', role: 'admin', name: 'Administrator' };
    await req.session.save();
    return res.json({ ok:true });
  }
  return res.status(401).json({ ok:false, message:'Invalid credentials' });
});

app.post('/api/admin/logout', async (req,res)=>{
  req.session.destroy();
  return res.json({ ok:true });
});

app.get('/api/admin/me', (req,res)=>{
  const u = req.session?.user || null;
  res.json({ ok:true, user: u });
});

// ===== App pages =====
app.get('/', (_req,res)=> res.sendFile(path.join(__dirname,'..','public','app','index.html')));
app.get('/store', (_req,res)=> res.sendFile(path.join(__dirname,'..','public','app','store.html')));
app.get('/delivery', (_req,res)=> res.sendFile(path.join(__dirname,'..','public','app','delivery-login.html')));
app.get('/delivery/home', (_req,res)=> res.sendFile(path.join(__dirname,'..','public','app','delivery-home.html')));
app.get('/payment/success', (_req,res)=> res.sendFile(path.join(__dirname,'..','public','app','success.html')));
app.get('/payment/fail', (_req,res)=> res.sendFile(path.join(__dirname,'..','public','app','fail.html')));

// ===== Admin pages =====
app.get('/admin', requireAdmin, (_req,res)=> res.sendFile(path.join(__dirname,'..','public','admin','index.html')));
app.get('/login', (_req,res)=> res.sendFile(path.join(__dirname,'..','public','admin','login.html')));

// ===== Health =====
app.get('/healthz', (_req,res)=> res.json({ ok:true }));

// ===== Simple menu & orders (in-memory) =====
let MENU = [];
try {
  const j = fs.readFileSync(path.join(__dirname,'menu.json'),'utf-8');
  MENU = JSON.parse(j);
} catch(e) { MENU = []; }

let ORDERS = [];

// Public menu (no auth)
app.get('/menu', (_req,res)=> res.json(MENU));

// Admin menu CRUD
app.post('/menu', requireAdmin, (req,res)=>{
  const { id, name, price, cat, active=true } = req.body || {};
  if(!id || !name || !price) return res.status(400).send('id, name, price required');
  if (MENU.find(m=>m.id===id)) return res.status(409).send('duplicate id');
  MENU.push({ id, name, price, cat, active });
  return res.json({ ok:true });
});
app.put('/menu/:id', requireAdmin, (req,res)=>{
  const id = req.params.id;
  const idx = MENU.findIndex(m=>m.id===id);
  if (idx<0) return res.status(404).send('not found');
  MENU[idx] = { ...MENU[idx], ...req.body };
  return res.json({ ok:true });
});
app.delete('/menu/:id', requireAdmin, (req,res)=>{
  const id = req.params.id;
  MENU = MENU.filter(m=>m.id!==id);
  return res.json({ ok:true });
});

// Orders
app.get('/orders', requireAdmin, (_req,res)=> res.json(ORDERS));
app.post('/orders', (_req,res)=>{  // allow customer order without auth
  const o = req.body || {};
  o.id = o.id || String(Date.now());
  o.createdAt = new Date().toISOString();
  ORDERS.push(o);
  try { emitOrderEvent('created', o); } catch(e){}
  return res.json({ ok:true, id: o.id });
});
app.post('/api/orders', (_req,res)=>{  // allow customer order without auth
  const o = req.body || {};
  o.id = o.id || String(Date.now());
  o.createdAt = new Date().toISOString();
  ORDERS.push(o);
  try { emitOrderEvent('created', o); } catch(e){}
  return res.json({ ok:true, id: o.id });
});
app.post('/confirm', requireAdmin, (_req,res)=>{ try { emitOrderEvent('confirmed', { ts: Date.now() }); } catch(e){} return res.json({ ok:true }); });



// ===== Toss Payments =====
app.get('/payment/config', (_req,res)=>{
  // expose only client key
  const TOSS_CLIENT_KEY = process.env.TOSS_CLIENT_KEY || '';
  res.json({ clientKey: TOSS_CLIENT_KEY });
});
app.get('/api/payment/config', (_req,res)=>{
   const TOSS_CLIENT_KEY = process.env.TOSS_CLIENT_KEY || '';
   res.json({ clientKey: TOSS_CLIENT_KEY });
 });


app.post('/payment/confirm', async (req,res)=>{
  try {
    const { paymentKey, orderId, amount } = req.body || {};
    if (!paymentKey || !orderId || !amount) {
      return res.status(400).json({ ok:false, message:'paymentKey, orderId, amount required' });
    }
    const secretKey = process.env.TOSS_SECRET_KEY || '';
    if (!secretKey) return res.status(500).json({ ok:false, message:'TOSS_SECRET_KEY missing' });
    const auth = Buffer.from(`${secretKey}:`).toString('base64');
    const resp = await fetch('https://api.tosspayments.com/v1/payments/confirm', {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + auth,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ paymentKey, orderId, amount })
    });
    const data = await resp.json();
    if (!resp.ok) {
      return res.status(resp.status).json({ ok:false, error:data });
    }
    // you can persist order/payment mapping here
    return res.json({ ok:true, data });
  } catch (e) {
    console.error('toss confirm error', e);
    return res.status(500).json({ ok:false });
  }
});

// ===== Public bank info =====
app.get('/bank-info/public', (_req,res)=>{
  // read from env (or later from DB)
  const bank = process.env.BANK_NAME || '은행';
  const account = process.env.BANK_ACCOUNT || '계좌번호';
  const holder = process.env.BANK_HOLDER || '예금주';
  res.json({ bank, account, holder });
});

// ===== Call staff (stub; extend to push/discord/slack if needed) =====
app.post('/call-staff', async (req,res)=>{
  try {
    // TODO: integrate with your notification provider
    console.log('call-staff:', req.body);
    return res.json({ ok:true });
  } catch(e){
    console.error('call-staff error', e);
    return res.status(500).json({ ok:false });
  }
});

// ===== Admin config (minimal) =====
app.get('/admin-config', requireAdmin, (_req,res)=>{
  const cfg = {
    storeName: process.env.STORE_NAME || 'My Store',
    payment: { provider: 'toss', clientKey: !!process.env.TOSS_CLIENT_KEY }
  };
  res.json(cfg);
});



// ===== Excel export / Menu import / Admin events (SSE) =====
import multer from 'multer';
import * as XLSX from 'xlsx';
import { EventEmitter } from 'events';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const adminEvents = new EventEmitter();

function emitOrderEvent(type, payload){
  adminEvents.emit('order', { type, payload, ts: Date.now() });
}

// Orders export to Excel
app.get('/export/orders.xlsx', requireAdmin, (_req,res)=>{
  try {
    const rows = ORDERS.map(o => ({
      id: o.id,
      createdAt: o.createdAt,
      customer: o.customer || '',
      type: o.type || '',
      items: JSON.stringify(o.items || []),
      total: o.total || 0,
      status: o.status || 'pending',
      paymentKey: o.paymentKey || '',
      orderId: o.orderId || ''
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'orders');
    const buf = XLSX.write(wb, { bookType:'xlsx', type:'buffer' });
    res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition','attachment; filename="orders.xlsx"');
    return res.send(buf);
  } catch(e){
    console.error('export orders error', e);
    return res.status(500).json({ ok:false });
  }
});

// Menu import (CSV/XLSX). Field name: file. Mode: ?mode=replace|append (default: replace)
app.post('/import/menu', requireAdmin, upload.single('file'), (req,res)=>{
  try{
    const mode = (req.query.mode || 'replace').toString();
    if(!req.file) return res.status(400).json({ ok:false, message:'file required' });
    const buf = req.file.buffer;
    // Try to read via XLSX; it supports both CSV and Excel
    const wb = XLSX.read(buf, { type: 'buffer' });
    const sheetName = wb.SheetNames[0];
    const json = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: '' });
    // Expect columns: id, name, price, cat, active
    const parsed = [];
    for(const r of json){
      const id = (r.id || r.ID || r.Id || '').toString().trim();
      const name = (r.name || r.Name || '').toString().trim();
      const price = Number(r.price ?? r.Price ?? 0);
      const cat = (r.cat || r.category || '').toString().trim();
      const active = String(r.active ?? r.Active ?? 'true').toLowerCase() !== 'false';
      if(!id || !name || !price) continue;
      parsed.push({ id, name, price, cat, active });
    }
    if(parsed.length === 0) return res.status(400).json({ ok:false, message:'no valid rows' });
    if(mode === 'replace'){
      MENU = parsed;
    }else{ // append
      const existingIds = new Set(MENU.map(m=>m.id));
      for(const m of parsed){
        if(existingIds.has(m.id)) continue;
        MENU.push(m);
      }
    }
    return res.json({ ok:true, count: parsed.length, mode });
  }catch(e){
    console.error('import menu error', e);
    return res.status(500).json({ ok:false });
  }
});

// Admin events stream (Server-Sent Events)
app.get('/events/orders', requireAdmin, (req,res)=>{
  res.setHeader('Content-Type','text/event-stream');
  res.setHeader('Cache-Control','no-cache');
  res.setHeader('Connection','keep-alive');
  res.flushHeaders?.();
  const onEvent = (evt)=>{
    res.write(`event: ${evt.type}\n`);
    res.write(`data: ${JSON.stringify(evt)}\n\n`);
  };
  adminEvents.on('order', onEvent);
  req.on('close', ()=>{
    adminEvents.off('order', onEvent);
  });
});


export default app;
