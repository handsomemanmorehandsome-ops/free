// ตัวรับคอมเมนต์/ไลก์/ของขวัญจากไลฟ์ TikTok แล้วส่งเข้าเกมผ่าน WebSocket
// ตั้งชื่อไลฟ์ผ่านตัวแปร TIKTOK_USER (ไม่ต้องมี @) หรือรัน: node server.js ชื่อไลฟ์
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const lib = require('tiktok-live-connector');
const Conn = lib.TikTokLiveConnection || lib.WebcastPushConnection;

const USERNAME = (process.env.TIKTOK_USER || process.argv[2] || '').replace('@', '');
const PORT = process.env.PORT || 3000;
if (!USERNAME) { console.log('ยังไม่ได้ตั้งชื่อไลฟ์ (TIKTOK_USER)'); process.exit(1); }

const server = http.createServer((req, res) => {
  // เปิดหน้าแรกแล้วเติม ?ws= ให้เอง เพื่อให้เกมต่อกับเซิร์ฟเวอร์นี้
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

const who = (d) => {
  const u = d.user || d;               // รองรับไลบรารีหลายรุ่น
  const id = u.uniqueId || d.uniqueId;
  return { id, name: u.nickname || d.nickname || id };
};

function start() {
  const live = new Conn(USERNAME);
  live.connect()
    .then(() => console.log('เชื่อมไลฟ์แล้ว @' + USERNAME))
    .catch((e) => { console.log('เชื่อมไม่ได้ (ต้องกำลังไลฟ์อยู่):', e.message || e); setTimeout(start, 10000); });

  live.on('member', (d) => send({ type: 'join', ...who(d) }));
  live.on('like', (d) => send({ type: 'like', count: d.likeCount || 1, ...who(d) }));
  live.on('follow', (d) => send({ type: 'follow', ...who(d) }));
  live.on('social', (d) => { if (/follow/i.test(d.displayType || '')) send({ type: 'follow', ...who(d) }); });
  live.on('gift', (d) => {
    if (d.giftType === 1 && !d.repeatEnd) return;   // รอให้ของขวัญรัวจบก่อนค่อยนับ
    send({ type: 'gift', diamonds: (d.diamondCount || 1) * (d.repeatCount || 1), ...who(d) });
  });
  live.on('disconnected', () => setTimeout(start, 5000));
}
start();
server.listen(PORT, () => console.log('เกมพร้อมที่พอร์ต ' + PORT));
