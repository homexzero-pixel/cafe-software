// Print bridge: lets the café dashboard print on network (LAN / Wi-Fi) thermal printers.
// Browsers can't open raw TCP sockets, so the page POSTs the ESC/POS bytes here and this passes them to the
// printer's port 9100. Run it on any always-on computer in the café (no dependencies):
//   node tools/print-bridge.mjs                 (listens on http://localhost:9180)
//   PORT=9180 HOST=0.0.0.0 node tools/print-bridge.mjs   (to let tablets on the Wi-Fi use it; then set the
//                                                bridge address on the Printers page to http://<this computer's IP>:9180)
// For safety it only forwards to private network addresses (192.168.x.x, 10.x.x.x, 172.16-31.x.x).
import http from 'node:http';
import net from 'node:net';

const PORT = +(process.env.PORT || 9180), HOST = process.env.HOST || '127.0.0.1', MAX = 512 * 1024;
const privateIp = (h) => /^(10\.\d+|192\.168|172\.(1[6-9]|2\d|3[01]))\.\d+\.\d+$/.test(h) || h === '127.0.0.1';

function send(host, port, data) {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host, port }, () => sock.end(data));
    sock.setTimeout(8000, () => { sock.destroy(); reject(new Error('Printer did not answer')); });
    sock.on('close', (err) => (err ? null : resolve()));
    sock.on('error', reject);
  });
}

http.createServer((req, res) => {
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Private-Network', 'true'); // Chrome's private network access check
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  const url = new URL(req.url, 'http://bridge');
  if (req.method === 'GET' && url.pathname === '/health') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{"ok":true}'); }
  if (req.method !== 'POST' || url.pathname !== '/print') { res.writeHead(404); return res.end('Not found'); }
  const host = url.searchParams.get('host') || '', port = +(url.searchParams.get('port') || 9100);
  if (!privateIp(host) || !(port > 0 && port < 65536)) { res.writeHead(400); return res.end('Use the printer’s local IP address, for example 192.168.1.50'); }
  const chunks = []; let size = 0;
  req.on('data', (c) => { size += c.length; if (size > MAX) { res.writeHead(413); res.end('Print job too large'); req.destroy(); } else chunks.push(c); });
  req.on('end', async () => {
    if (res.writableEnded) return;
    try { await send(host, port, Buffer.concat(chunks)); res.writeHead(200); res.end('printed'); console.log(new Date().toLocaleTimeString(), `sent ${size} bytes to ${host}:${port}`); }
    catch (e) { res.writeHead(502); res.end(e.message || 'Could not reach the printer'); console.warn(new Date().toLocaleTimeString(), `${host}:${port}`, e.message); }
  });
}).listen(PORT, HOST, () => console.log(`Print bridge on http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}, forwarding to printers on port 9100`));
