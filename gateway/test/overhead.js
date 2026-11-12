'use strict';
// Mide el costo del salto adicional: mismas solicitudes directas al servicio vs a través del Gateway (sin retardo simulado).
const { createGateway } = require('../src/gateway');
const { startMocks } = require('../src/mock-services');
const { signJwt } = require('../src/jwt');
const SECRET = 'clave-de-prueba-foodtrace-2026-minimo-32-caracteres';
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const p95 = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length * 0.95)];
(async () => {
  const m = await startMocks({ secret: SECRET });
  const gw = createGateway({ secret: SECRET, port: 0, silent: true, rateLimit: 1e9, upstreams: { auth: `http://127.0.0.1:${m.auth.port}`, trace: `http://127.0.0.1:${m.trace.port}`, qr: `http://127.0.0.1:${m.qr.port}` } });
  const gp = await gw.start();
  const tok = signJwt({ sub: 'u', role: 'producer', exp: Math.floor(Date.now() / 1000) + 3600 }, SECRET);
  const run = async (url, n = 400) => { const t = []; for (let i = 0; i < n + 50; i++) { const s = performance.now(); const r = await fetch(url, { headers: { authorization: `Bearer ${tok}` } }); await r.text(); if (i >= 50) t.push(performance.now() - s); } return t; };
  const direct = await run(`http://127.0.0.1:${m.trace.port}/api/batches`);
  const viaGw = await run(`http://127.0.0.1:${gp}/api/batches`);
  const out = { requests: direct.length, directMedianMs: +median(direct).toFixed(2), gatewayMedianMs: +median(viaGw).toFixed(2), directP95Ms: +p95(direct).toFixed(2), gatewayP95Ms: +p95(viaGw).toFixed(2) };
  out.overheadMedianMs = +(out.gatewayMedianMs - out.directMedianMs).toFixed(2);
  console.log(JSON.stringify(out, null, 2));
  require('node:fs').writeFileSync(require('node:path').join(__dirname, 'overhead-results.json'), JSON.stringify(out, null, 2));
  await gw.stop(); await Promise.all([m.auth, m.trace, m.qr].map((x) => x.kill()));
})();
