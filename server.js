// ตัวรับคอมเมนต์/ไลก์/ของขวัญจากไลฟ์ TikTok แล้วส่งเข้าเกมผ่าน WebSocket
// ตั้งชื่อไลฟ์ผ่านตัวแปร TIKTOK_USER (ไม่ต้องมี @)
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const lib = require('tiktok-live-connector');
const Conn = lib.TikTokLiveConnection || lib.WebcastPushConnection;

const USERNAME = (process.env.TIKTOK_USER || process.argv[2] || '').replace('@', '');
const PORT = process.env.PORT || 3000;
if (!USERNAME) { console.log('ยังไม่ได้ตั้งชื่อไลฟ์ (TIKTOK_USER)'); process.exit(1); }

const OPTIONS = { processInitialData: false };
if (process.env.SIGN_API_KEY) OPTIONS.signApiKey = process.env.SIGN_API_KEY;

const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '') {
    const proto = req.headers['x-forwarded-proto'] === 'https' ? 'wss' : 'ws';
    res.writeHead(302, { Location: '/?ws=' + encodeURIComponent(proto + '://' + req.headers.host) });
    return res.end();
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(fs.readFileSync(path.join(__dirname, 'index.html')));
});
const wss = new WebSocketServer({ server });
const send = (o) => wss.clients.forEach((c) => c.readyState === 1 && c.send(JSON.stringify(o)));

let status = 'กำลังต่อ TikTok...';
const setStatus = (t) => { status = t; console.log(t); send({ type: 'status', text: t }); };
wss.on('connection', (ws) => ws.send(JSON.stringify({ type: 'status', text: status })));

// ดึงรหัส/ชื่อคนดูให้ได้ ไม่ว่าไลบรารีรุ่นไหนจะส่งข้อมูลมาหน้าตาแบบใด
const who = (d) => {
  const u = d.user || d;
  const id = u.uniqueId || d.uniqueId || u.userId || d.userId || u.id || u.nickname || d.nickname || 'viewer';
  return { id: String(id), name: u.nickname || d.nickname || u.uniqueId || d.uniqueId || String(id) };
};

const shown = {};   // จดตัวอย่างข้อมูลของแต่ละอีเวนต์ไว้ใน Logs ครั้งแรกครั้งเดียว
const out = (type, d, extra) => {
  if (!shown[type]) { shown[type] = 1; try { console.log('ตัวอย่างข้อมูล ' + type + ':', JSON.stringify(d).slice(0, 400)); } catch (e) {} }
  const o = Object.assign({ type }, who(d), extra || {});
  console.log('ส่งเข้าเกม:', type, o.name);
  send(o);
};

let timer = null;
function retry(sec) {
  if (timer) return;
  timer = setTimeout(() => { timer = null; start(); }, (sec || 10) * 1000);
}
process.on('uncaughtException', (e) => { console.log('ข้อผิดพลาด:', (e && e.message) || e); retry(15); });
process.on('unhandledRejection', (e) => { console.log('ข้อผิดพลาด:', (e && e.message) || e); retry(15); });

function start() {
  let live;
  try { live = new Conn(USERNAME, OPTIONS); } catch (e) { setStatus('สร้างการเชื่อมต่อไม่ได้: ' + ((e && e.message) || e)); return retry(15); }
  live.on('error', (e) => console.log('ไลบรารีแจ้ง error:', (e && e.message) || e));

  live.connect()
    .then(() => setStatus('เชื่อมไลฟ์แล้ว @' + USERNAME))
    .catch((e) => { setStatus('เชื่อมไม่ได้ (ต้องกำลังไลฟ์อยู่): ' + ((e && e.message) || e)); retry(10); });

  live.on('member', (d) => out('join', d));
  live.on('like', (d) => out('like', d, { count: d.likeCount || 1 }));
  live.on('follow', (d) => out('follow', d));
  live.on('social', (d) => { if (/follow/i.test(d.displayType || '')) out('follow', d); });
  live.on('gift', (d) => {
    if (d.giftType === 1 && !d.repeatEnd) return;   // รอให้ของขวัญรัวจบก่อนค่อยนับ
    out('gift', d, { diamonds: (d.diamondCount || 1) * (d.repeatCount || 1) });
  });
  live.on('disconnected', () => { setStatus('หลุดจาก TikTok กำลังต่อใหม่...'); retry(5); });

  // นับอีเวนต์อื่น ๆ ที่ไลบรารีส่งมา เพื่อดูว่าข้อมูลเข้ามาจริงไหม
  try {
    const skip = ['member', 'like', 'follow', 'social', 'gift', 'error', 'disconnected', 'connected', 'rawData', 'decodedData', 'websocketConnected'];
    const counts = {};
    Object.values(lib.WebcastEvent || {}).forEach((name) => {
      if (typeof name !== 'string' || skip.includes(name)) return;
      live.on(name, () => { counts[name] = (counts[name] || 0) + 1; });
    });
    setInterval(() => { if (Object.keys(counts).length) console.log('อีเวนต์อื่นที่รับได้:', JSON.stringify(counts)); }, 30000);
  } catch (e) {}
}
start();
server.listen(PORT, () => console.log('เกมพร้อมที่พอร์ต ' + PORT));
