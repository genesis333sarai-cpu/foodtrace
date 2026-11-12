'use strict';
// Pruebas de los escenarios de calidad QG-01, QG-02 y QG-03 (más CORS, auditoría, límite de solicitudes y modificabilidad).
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { createGateway } = require('../src/gateway');
const { startMocks } = require('../src/mock-services');
const { signJwt } = require('../src/jwt');
const defaultRoutes = require('../src/routes');

const SECRET = 'clave-de-prueba-foodtrace-2026-minimo-32-caracteres';
const results = []; const metrics = {};
let uncaught = 0;
process.on('uncaughtException', (e) => { uncaught += 1; console.error(e); });
process.on('unhandledRejection', (e) => { uncaught += 1; console.error(e); });
const check = (id, desc, ok, detail = '') => { results.push({ id, desc, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} [${id}] ${desc}${detail ? '  -> ' + detail : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => Math.floor(Date.now() / 1000);
const token = (role) => signJwt({ sub: `user-${role}`, role, exp: now() + 3600 }, SECRET);
const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

async function boot(over = {}, mockOpts = {}) {
  const mocks = await startMocks({ secret: SECRET, ...mockOpts });
  const audit = [];
  const gw = createGateway({
    secret: SECRET, port: 0, silent: true, onAudit: (e) => audit.push(e), ...over,
    upstreams: { auth: `http://127.0.0.1:${mocks.auth.port}`, trace: `http://127.0.0.1:${mocks.trace.port}`, qr: `http://127.0.0.1:${mocks.qr.port}`, ...(over.upstreams || {}) },
  });
  const port = await gw.start();
  return { mocks, gw, audit, base: `http://127.0.0.1:${port}`, async stop() { await gw.stop(); await Promise.all([mocks.auth, mocks.trace, mocks.qr].map((m) => m.kill())); } };
}
async function call(base, method, p, { tok, headers = {}, body } = {}) {
  const t0 = performance.now();
  const r = await fetch(base + p, { method, headers: { ...(tok ? { authorization: `Bearer ${tok}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch { /* no JSON */ }
  return { status: r.status, headers: r.headers, json, ms: performance.now() - t0 };
}
const totalHits = (m) => m.auth.hits + m.trace.hits + m.qr.hits;

async function qg01() {
  const env = await boot(); const { base, mocks } = env;
  const protectedCalls = [['POST', '/api/batches'], ['GET', '/api/batches'], ['GET', '/api/users'], ['POST', '/api/batches/1/transport'], ['GET', '/api/alerts'], ['GET', '/api/batches/1/qr'], ['POST', '/api/products'], ['DELETE', '/api/products/1'], ['PATCH', '/api/alerts/1'], ['GET', '/api/dashboard']];
  const noneTok = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: 'x', role: 'admin', exp: now() + 3600 })).toString('base64url')}.`;
  const reqs = [];
  const add = (label, n, tokFn, expect) => { for (let i = 0; i < n; i++) { const [m, p] = protectedCalls[i % protectedCalls.length]; reqs.push({ label, m, p, tok: tokFn(), expect }); } };
  add('sin token', 80, () => undefined, 401);
  add('firma inválida', 40, () => signJwt({ sub: 'x', role: 'admin', exp: now() + 3600 }, 'otra-clave'), 401);
  add('token vencido', 20, () => signJwt({ sub: 'x', role: 'admin', exp: now() - 60 }, SECRET), 401);
  add('alg none', 20, () => noneTok, 401);
  add('token basura', 20, () => 'abc.def', 401);
  const wrong = [['transporter', 'POST', '/api/batches'], ['producer', 'POST', '/api/batches/1/transport'], ['establishment', 'POST', '/api/batches/1/processing'], ['processor', 'GET', '/api/users'], ['producer', 'GET', '/api/alerts'], ['transporter', 'POST', '/api/products'], ['establishment', 'DELETE', '/api/products/1'], ['processor', 'POST', '/api/batches/1/reception'], ['producer', 'POST', '/api/categories'], ['transporter', 'PATCH', '/api/users/1']];
  for (let i = 0; i < 40; i++) { const [role, m, p] = wrong[i % wrong.length]; reqs.push({ label: 'rol sin permiso', m, p, tok: token(role), expect: 403 }); }
  let ok = 0; const byLabel = {};
  for (const q of reqs) {
    const r = await call(base, q.m, q.p, { tok: q.tok, body: q.m === 'POST' ? { x: 1 } : undefined });
    const good = r.status === q.expect; if (good) ok += 1;
    byLabel[q.label] = byLabel[q.label] || { total: 0, ok: 0 }; byLabel[q.label].total += 1; if (good) byLabel[q.label].ok += 1;
  }
  const reached = totalHits(mocks);
  metrics.qg01 = { total: reqs.length, rejectedCorrectly: ok, rate: ok / reqs.length, reachedServices: reached, byLabel };
  check('QG-01', `Solicitudes no autorizadas rechazadas en el Gateway (${ok}/${reqs.length})`, ok === reqs.length, `${(100 * ok / reqs.length).toFixed(1)} %`);
  check('QG-01', 'Ninguna solicitud rechazada llegó a un servicio interno', reached === 0, `solicitudes recibidas por servicios: ${reached}`);

  const created = await call(base, 'POST', '/api/batches', { tok: token('producer'), body: { batchCode: 'X' } });
  check('QG-01', 'Rol permitido (productor) crea lote y el servicio recibe x-user / x-role', created.status === 201 && mocks.trace.last.headers['x-role'] === 'producer' && mocks.trace.last.headers['x-user'] === 'user-producer', `status ${created.status}`);
  await call(base, 'GET', '/api/batches', { tok: token('producer'), headers: { 'x-role': 'admin', 'x-user': 'intruso' } });
  check('QG-01', 'Cabeceras x-role / x-user enviadas por el cliente son descartadas', mocks.trace.last.headers['x-role'] === 'producer' && mocks.trace.last.headers['x-user'] === 'user-producer');
  const pub = await call(base, 'GET', '/api/public/trace/BATCH-2026-001');
  check('QG-01', 'Consulta pública por QR no exige token', pub.status === 200, `status ${pub.status}`);
  const login = await call(base, 'POST', '/api/auth/login', { body: { email: 'productor@foodtrace.bo', password: 'Demo1234!' } });
  const me = await call(base, 'GET', '/api/auth/me', { tok: login.json && login.json.token });
  check('QG-01', 'Login sin token y /auth/me con el token emitido por el servicio', login.status === 200 && me.status === 200 && me.json.user.role === 'producer', `login ${login.status}, me ${me.status}`);
  check('CORS', 'El Gateway reemplaza el CORS del servicio interno por su origen permitido', login.headers.get('access-control-allow-origin') === 'http://localhost:5173', String(login.headers.get('access-control-allow-origin')));
  const pre = await fetch(base + '/api/batches', { method: 'OPTIONS', headers: { origin: 'http://localhost:5173', 'access-control-request-method': 'POST' } });
  check('CORS', 'Preflight OPTIONS responde 204 sin consultar servicios', pre.status === 204);
  await sleep(80);
  check('TA-04', 'Auditoría: una entrada por cada solicitud atendida', env.audit.length === env.gw.stats.requests, `${env.audit.length} entradas / ${env.gw.stats.requests} solicitudes`);
  const rejected = env.audit.find((e) => e.status === 403);
  check('TA-04', 'La auditoría registra usuario, rol, servicio y estado', !!rejected && !!rejected.user && !!rejected.role && !!rejected.service, JSON.stringify(rejected));
  metrics.audit = { entries: env.audit.length, requests: env.gw.stats.requests };
  await env.stop();
}

async function qg02() {
  const env = await boot({}, { delayMs: 25 }); const { base, mocks } = env;
  const N = 100; const tags = []; const miss = []; const hit = [];
  for (let i = 0; i < N; i++) {
    const r = await call(base, 'GET', '/api/public/trace/BATCH-2026-777');
    const tag = r.headers.get('x-cache'); tags.push(tag); (tag === 'HIT' ? hit : miss).push(r.ms);
  }
  const hits = tags.filter((t) => t === 'HIT').length;
  metrics.qg02 = { requests: N, hits, hitRate: hits / N, upstreamQueries: mocks.trace.hits, avgMissMs: avg(miss), avgHitMs: avg(hit) };
  check('QG-02', `Aciertos de caché sobre un mismo lote (${hits}/${N})`, hits / N >= 0.95, `${(100 * hits / N).toFixed(1)} % (meta: 95 %)`);
  check('QG-02', 'El Servicio de Trazabilidad recibió una sola consulta', mocks.trace.hits === 1, `consultas al servicio: ${mocks.trace.hits}`);
  check('QG-02', 'Respuesta desde caché más rápida que desde el servicio', avg(hit) < avg(miss), `MISS ${avg(miss).toFixed(1)} ms, HIT ${avg(hit).toFixed(1)} ms`);
  const nf = await call(base, 'GET', '/api/public/trace/NO-EXISTE');
  const nf2 = await call(base, 'GET', '/api/public/trace/NO-EXISTE');
  check('QG-02', 'Las respuestas de error (404) no se guardan en caché', nf.status === 404 && nf2.status === 404 && nf2.headers.get('x-cache') === 'MISS');
  await env.stop();

  const e2 = await boot({ cacheTtlMs: 150 });
  await call(e2.base, 'GET', '/api/public/trace/BATCH-2026-001');
  await sleep(250);
  const again = await call(e2.base, 'GET', '/api/public/trace/BATCH-2026-001');
  check('QG-02', 'Pasado el TTL la caché se renueva consultando al servicio', again.headers.get('x-cache') === 'MISS' && e2.mocks.trace.hits === 2, `consultas al servicio: ${e2.mocks.trace.hits}`);
  await e2.stop();
}

async function qg03() {
  const env = await boot({ cacheTtlMs: 150, staleMs: 60000 }); const { base, mocks } = env; const tok = token('producer');
  await call(base, 'GET', '/api/public/trace/BATCH-2026-001');
  await mocks.trace.kill();
  const down = await call(base, 'GET', '/api/batches', { tok });
  check('QG-03', 'Servicio de Trazabilidad caído: el Gateway responde 503 controlado', down.status === 503 && down.json && down.json.service === 'trace', `status ${down.status}, ${down.ms.toFixed(0)} ms`);
  const login = await call(base, 'POST', '/api/auth/login', { body: { email: 'admin@foodtrace.bo', password: 'Demo1234!' } });
  const qr = await call(base, 'GET', '/api/batches/1/qr', { tok });
  const health = await call(base, 'GET', '/api/health');
  await sleep(250);
  const stale = await call(base, 'GET', '/api/public/trace/BATCH-2026-001');
  const others = [login.status === 200, qr.status === 200, health.status === 200, stale.status === 200 && stale.headers.get('x-cache') === 'STALE'];
  const unknown = await call(base, 'GET', '/api/public/trace/BATCH-2026-999');
  check('QG-03', 'Login, QR y salud siguen respondiendo', others[0] && others[1] && others[2], `login ${login.status}, qr ${qr.status}, health ${health.status}`);
  check('QG-03', 'Lote ya consultado se sirve desde caché (STALE) con el servicio caído', others[3], `status ${stale.status}, x-cache ${stale.headers.get('x-cache')}`);
  check('QG-03', 'Lote no cacheado devuelve 503 controlado', unknown.status === 503, `status ${unknown.status}`);
  metrics.qg03 = { failingRouteStatus: down.status, failFastMs: down.ms, otherRoutesOk: others.filter(Boolean).length, otherRoutesTotal: others.length };
  await env.stop();

  const hang = http.createServer(() => { /* nunca responde */ }); await new Promise((r) => hang.listen(0, '127.0.0.1', r));
  const e3 = await boot({ timeoutMs: 300, upstreams: { trace: `http://127.0.0.1:${hang.address().port}` } });
  const slow = await call(e3.base, 'GET', '/api/batches', { tok });
  check('QG-03', 'Servicio que no responde: 503 al agotarse el tiempo de espera (300 ms)', slow.status === 503 && slow.ms < 1500, `status ${slow.status}, ${slow.ms.toFixed(0)} ms`);
  metrics.qg03.timeoutMs = slow.ms;
  await e3.stop(); hang.closeAllConnections(); hang.close();
}

async function extras() {
  const env = await boot({ rateLimit: 30 });
  const st = []; let retry = null;
  for (let i = 0; i < 35; i++) { const r = await call(env.base, 'GET', '/api/health'); st.push(r.status); if (r.status === 429) retry = r.headers.get('retry-after'); }
  check('TA-04', 'Límite de solicitudes por IP: 30 atendidas y 5 rechazadas con 429 y Retry-After', st.filter((s) => s === 200).length === 30 && st.filter((s) => s === 429).length === 5 && !!retry, `retry-after ${retry} s`);
  await env.stop();

  const plain = await boot();
  const before = await call(plain.base, 'GET', '/api/reports/summary', { tok: token('producer') });
  await plain.stop();
  const ext = await boot({ routes: [...defaultRoutes, { method: 'GET', path: /^\/api\/reports\/summary$/, service: 'trace', access: 'any', cache: false }] });
  const after = await call(ext.base, 'GET', '/api/reports/summary', { tok: token('producer') });
  check('AQ-05', 'Ruta nueva expuesta agregando una sola regla al Gateway (sin cambiar el cliente)', before.status === 404 && after.status === 200, `antes ${before.status}, después ${after.status}`);
  await ext.stop();
}

(async () => {
  console.log('=== Pruebas del API Gateway de FoodTrace ===\n');
  await qg01(); await qg02(); await qg03(); await extras();
  check('QG-03', 'El proceso del Gateway no sufrió excepciones sin capturar durante toda la prueba', uncaught === 0, `excepciones: ${uncaught}`);
  const failed = results.filter((r) => !r.ok);
  console.log(`\nResumen: ${results.length - failed.length}/${results.length} comprobaciones superadas`);
  fs.writeFileSync(path.join(__dirname, 'test-results.json'), JSON.stringify({ date: new Date().toISOString(), node: process.version, results, metrics }, null, 2));
  process.exit(failed.length ? 1 : 0);
})();
