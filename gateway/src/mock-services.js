'use strict';
// Servicios internos simulados (Autenticación, Trazabilidad y QR) para probar el Gateway sin base de datos.
const http = require('node:http');
const { signJwt } = require('./jwt');

const USERS = {
  'admin@foodtrace.bo': 'admin', 'productor@foodtrace.bo': 'producer', 'procesador@foodtrace.bo': 'processor',
  'transportista@foodtrace.bo': 'transporter', 'tienda@foodtrace.bo': 'establishment',
};

function createMock(name, handler, delayMs = 0) {
  const state = { name, hits: 0, last: null, sockets: new Set(), port: 0 };
  const server = http.createServer((req, res) => {
    state.hits += 1;
    state.last = { method: req.method, url: req.url, headers: req.headers };
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      let body = {};
      try { body = JSON.parse(Buffer.concat(chunks).toString() || '{}'); } catch { /* cuerpo no JSON */ }
      const reply = (status, obj) => {
        const b = Buffer.from(JSON.stringify(obj));
        setTimeout(() => {
          // el servicio interno también responde con CORS abierto: el Gateway debe quitarlo
          res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': b.length, 'access-control-allow-origin': '*' });
          res.end(b);
        }, delayMs);
      };
      handler(req, body, reply, state);
    });
  });
  server.on('connection', (s) => { state.sockets.add(s); s.on('close', () => state.sockets.delete(s)); });
  state.listen = (port = 0) => new Promise((r) => server.listen(port, '127.0.0.1', () => { state.port = server.address().port; r(state.port); }));
  state.kill = () => new Promise((r) => { state.sockets.forEach((s) => s.destroy()); server.close(() => r()); });
  return state;
}

async function startMocks({ secret, delayMs = 0, ports = {} } = {}) {
  const seen = (req) => ({ 'x-user': req.headers['x-user'] || null, 'x-role': req.headers['x-role'] || null });
  const auth = createMock('auth', (req, body, reply) => {
    if (req.method === 'POST' && req.url === '/api/auth/login') {
      const role = USERS[String(body.email || '').toLowerCase()];
      if (!role || body.password !== 'Demo1234!') return reply(401, { message: 'Correo o contraseña incorrectos.' });
      const token = signJwt({ sub: `user-${role}`, role, exp: Math.floor(Date.now() / 1000) + 3600 }, secret);
      return reply(200, { token, user: { id: `user-${role}`, role, email: body.email } });
    }
    if (req.method === 'POST' && req.url === '/api/auth/register') return reply(201, { message: 'Cuenta creada.' });
    return reply(200, { user: { id: req.headers['x-user'], role: req.headers['x-role'] } });
  });
  const trace = createMock('trace', (req, body, reply) => {
    const m = /^\/api\/public\/trace\/(BATCH-\d{4}-\d{3})$/.exec(req.url.split('?')[0]);
    if (req.method === 'GET' && req.url.startsWith('/api/public/trace/')) {
      if (!m) return reply(404, { message: 'No encontramos ese lote.' });
      return reply(200, { batch: { batchCode: m[1] }, events: new Array(5).fill({ stage: 'x' }), integrity: { valid: true, eventCount: 5 } });
    }
    if (req.method === 'POST') return reply(201, { ok: true, path: req.url, received: seen(req) });
    return reply(200, { ok: true, path: req.url, received: seen(req) });
  }, delayMs);
  const qr = createMock('qr', (req, body, reply) => reply(200, { qrCodeUrl: 'data:image/png;base64,AAAA', url: 'http://localhost:5173/trace/BATCH-2026-001', batchCode: 'BATCH-2026-001', received: seen(req) }));
  await Promise.all([auth.listen(ports.auth), trace.listen(ports.trace), qr.listen(ports.qr)]);
  return { auth, trace, qr, reset() { [auth, trace, qr].forEach((m) => { m.hits = 0; m.last = null; }); } };
}

if (require.main === module) {
  const secret = process.env.JWT_SECRET || 'clave-de-demostracion-foodtrace-minimo-32-caracteres';
  startMocks({ secret, ports: { auth: 6001, trace: 6002, qr: 6003 } }).then((m) => {
    console.log(`Servicios simulados: auth=${m.auth.port} trace=${m.trace.port} qr=${m.qr.port}`);
    console.log(`Gateway: JWT_SECRET=${secret} AUTH_URL=http://127.0.0.1:6001 TRACE_URL=http://127.0.0.1:6002 QR_URL=http://127.0.0.1:6003 npm start`);
  });
}
module.exports = { startMocks };
