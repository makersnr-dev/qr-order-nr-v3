
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import bodyParser from 'body-parser';
import cookieParser from 'cookie-parser';
import { getIronSession } from 'iron-session';
import fs from 'fs';
import multer from 'multer';
import * as XLSX from 'xlsx';
import { EventEmitter } from 'events';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(bodyParser.json());
app.use(cookieParser());

const sessionOptions = {
  cookieName: 'qrnr_sess',
  password: process.env.SESSION_PASSWORD || 'change-me-32-characters-min-secret!!!!',
  cookieOptions: { secure: true, httpOnly: true, sameSite: 'lax' }
};
app.use(async (req, res, next) => {
  try {
    req.session = await getIronSession(req, res, sessionOptions);
    req.session.save ??= async () => {};
    req.session.destroy ??= async () => { req.session = {}; res.clearCookie(sessionOptions.cookieName, { path: '/' }); };
    next();
  } catch(e){ next(e); }
});

function requireAdmin(req, res, next){
  const u = req.session?.user;
  if (u && u.role === 'admin') return next();
  return res.status(401).json({ ok:false, message:'Unauthorized' });
}

app.use('/static/admin', express.static(path.join(__dirname, '..', 'public', 'admin')));
app.use('/static/app', express.static(path.join(__dirname, '..', 'public', 'app')));

app.post('/api/admin/login', async (req, res)=>{
  const { username, password } = req.body || {};
  const ADMIN_USER = process.env.ADMIN_USER || 'admin';
  const ADMIN_PASS = process.env.ADMIN_PASS || 'admin1234';
  if (username === ADMIN_USER && password === ADMIN_PASS){
    req.session.user = { id:'1', role:'admin', name:'Administrator' };
    await req.session.save();
    return res.json({ ok:true });
  }
  return res.status(401).json({ ok:false, message:'Invalid credentials' });
});
app.post('/api/admin/logout', async (req, res)=>{ await req.session.destroy(); res.json({ ok:true }); });
app.get('/api/admin/me', (req, res)=> res.json({ ok:true, user: req.session?.user || null }));

app.get('/', (_req, res)=> res.sendFile(path.join(__dirname, '..', 'public', 'app', 'index.html')));
app.get('/store', (_req, res)=> res.sendFile(path.join(__dirname, '..', 'public', 'app', 'store.html')));
app.get('/delivery', (_req, res)=> res.sendFile(path.join(__dirname, '..', 'public', 'app', 'delivery-login.html')));
app.get('/delivery/home', (_req, res)=> res.sendFile(path.join(__dirname, '..', 'public', 'app', 'delivery-home.html')));
app.get('/payment/success', (_req, res)=> res.sendFile(path.join(__dirname, '..', 'public', 'app', 'success.html')));
app.get('/payment/fail', (_req, res)=> res.sendFile(path.join(__dirname, '..', 'public', 'app', 'fail.html')));
app.get('/admin', requireAdmin, (_req, res)=> res.sendFile(path.join(__dirname, '..', 'public', 'admin', 'index.html')));
app.get('/login', (_req, res)=> res.sendFile(path.join(__dirname, '..', 'public', 'admin', 'login.html')));

app.get('/healthz', (_req, res)=> res.json({ ok:true }));

let MENU = [];
try { MENU = JSON.parse(fs.readFileSync(path.join(__dirname, 'menu.json'), 'utf-8')); } catch {}

let ORDERS = [];

app.get('/menu', (_req, res)=> res.json(MENU));

app.post('/menu', requireAdmin, (req, res)=>{
  const { id, name, price, cat, active = true } = req.body || {};
  if (!id || !name || typeof price === 'undefined') return res.status(400).send('id,name,price required');
  if (MENU.find((m)=>m.id===id)) return res.status(409).send('duplicate id');
  MENU.push({ id, name, price, cat, active });
  res.json({ ok:true });
});
app.put('/menu/:id', requireAdmin, (req, res)=>{
  const id = req.params.id;
  const i = MENU.findIndex(m=>m.id===id);
  if (i<0) return res.status(404).send('not found');
  MENU[i] = { ...MENU[i], ...req.body };
  res.json({ ok:true });
});
app.delete('/menu/:id', requireAdmin, (req, res)=>{
  const id = req.params.id;
  MENU = MENU.filter(m=>m.id!==id);
  res.json({ ok:true });
});

app.get('/orders', requireAdmin, (_req, res)=> res.json(ORDERS));
app.post('/orders', (req, res)=>{
  const o = req.body || {};
  o.id = o.id || String(Date.now());
  o.createdAt = new Date().toISOString();
  ORDERS.push(o);
  emitOrderEvent('created', o);
  res.json({ ok:true, id:o.id });
});

app.get('/payment/config', (_req, res)=>{
  res.json({ clientKey: process.env.TOSS_CLIENT_KEY || '' });
});
app.post('/payment/confirm', async (req, res)=>{
  try{
    const { paymentKey, orderId, amount } = req.body || {};
    if (!paymentKey || !orderId || !amount) return res.status(400).json({ ok:false, message:'paymentKey, orderId, amount required' });
    const secret = process.env.TOSS_SECRET_KEY || '';
    if (!secret) return res.status(500).json({ ok:false, message:'TOSS_SECRET_KEY missing' });
    const auth = Buffer.from(`${secret}:`).toString('base64');
    const resp = await fetch('https://api.tosspayments.com/v1/payments/confirm', {
      method:'POST',
      headers:{ Authorization:'Basic '+auth, 'Content-Type':'application/json' },
      body: JSON.stringify({ paymentKey, orderId, amount })
    });
    const data = await resp.json();
    if (!resp.ok) return res.status(resp.status).json({ ok:false, error:data });
    res.json({ ok:true, data });
  }catch(e){
    console.error('toss confirm error', e);
    res.status(500).json({ ok:false });
  }
});

app.get('/bank-info/public', (_req, res)=>{
  res.json({
    bank: process.env.BANK_NAME || '은행',
    account: process.env.BANK_ACCOUNT || '계좌번호',
    holder: process.env.BANK_HOLDER || '예금주'
  });
});

const adminEvents = new EventEmitter();
function emitOrderEvent(type, payload){ adminEvents.emit('order', { type, payload, ts: Date.now() }); }
app.get('/events/orders', requireAdmin, (req, res)=>{
  res.setHeader('Content-Type','text/event-stream');
  res.setHeader('Cache-Control','no-cache');
  res.setHeader('Connection','keep-alive');
  res.flushHeaders?.();
  const onEvent = evt => {
    res.write(`event: ${evt.type}
`);
    res.write(`data: ${JSON.stringify(evt)}

`);
  };
  adminEvents.on('order', onEvent);
  req.on('close', ()=> adminEvents.off('order', onEvent));
});

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5*1024*1024 } });

app.get('/export/orders.xlsx', requireAdmin, (_req, res)=>{
  try{
    const rows = ORDERS.map(o => ({
      id:o.id, createdAt:o.createdAt, customer:o.customer||'', type:o.type||'',
      items: JSON.stringify(o.items||[]), total:o.total||0, status:o.status||'pending',
      paymentKey:o.paymentKey||'', orderId:o.orderId||''
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'orders');
    const buf = XLSX.write(wb, { bookType:'xlsx', type:'buffer' });
    res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition','attachment; filename="orders.xlsx"');
    res.send(buf);
  }catch(e){
    console.error('export error', e);
    res.status(500).json({ ok:false });
  }
});

app.post('/import/menu', requireAdmin, upload.single('file'), (req, res)=>{
  try{
    if (!req.file) return res.status(400).json({ ok:false, message:'file required' });
    const wb = XLSX.read(req.file.buffer, { type:'buffer' });
    const sheet = wb.SheetNames[0];
    const json = XLSX.utils.sheet_to_json(wb.Sheets[sheet], { defval: '' });
    const parsed = json.map(r => ({
      id: String(r.id || r.ID || ''),
      name: String(r.name || r.Name || ''),
      price: Number(r.price ?? r.Price ?? 0),
      cat: String(r.cat || r.category || ''),
      active: String(r.active ?? r.Active ?? 'true').toLowerCase() !== 'false'
    })).filter(m => m.id && m.name && m.price);
    if (!parsed.length) return res.status(400).json({ ok:false, message:'no valid rows' });
    MENU = parsed;
    res.json({ ok:true, count: parsed.length });
  }catch(e){
    console.error('import error', e);
    res.status(500).json({ ok:false });
  }
});

export default app;
