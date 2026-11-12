'use strict';
/**
 * API Gateway de FoodTrace (patrón API Gateway).
 * Único punto de entrada: enruta, verifica JWT, autoriza por rol, cachea consultas públicas,
 * limita solicitudes por IP, audita y responde 503 controlado si un servicio interno falla.
 * Solo usa módulos nativos de Node.js.
 */
const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const { verifyJwt } = require('./jwt');
const defaultRoutes = require('./routes');

const PUBLIC = defaultRoutes.PUBLIC;
const HOP = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'host', 'content-length']);
const SPOOFABLE = new Set(['x-user', 'x-role', 'x-request-id', 'x-forwarded-for']);

function loadConfig(env = process.env, overrides = {}) {
  const up = (k) => env[k] || 'http://127.0.0.1:5000';
  return {
    port: Number(env.GATEWAY_PORT || 8080),
    secret: env.JWT_SECRET,
    corsOrigin: env.CLIENT_URL || 'http://localhost:5173',
    cacheTtlMs: Number(env.CACHE_TTL_MS || 30000),   // TTL de la caché (TA-05)
    staleMs: Number(env.CACHE_STALE_MS || 600000),   // ventana para servir datos vencidos si el servicio falla
    cacheMax: 1000,
    rateLimit: Number(env.RATE_LIMIT || 1000),       // solicitudes por IP por ventana
    rateWindowMs: 60000,
    timeoutMs: Number(env.UPSTREAM_TIMEOUT_MS || 5000),
    maxBody: 2 * 1024 * 1024,
    auditFile: env.AUDIT_FILE || '',
    silent: false,
    routes: defaultRoutes,
    ...overrides,
    upstreams: { auth: up('AUTH_URL'), trace: up('TRACE_URL'), qr: up('QR_URL'), ...(overrides.upstreams || {}) },
  };
}

function readBody(req, max) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0; let tooLarge = false;
    req.on('data', (c) => { size += c.length; if (size > max) tooLarge = true; else chunks.push(c); });
    req.on('end', () => (tooLarge ? reject(Object.assign(new Error('too large'), { status: 413 })) : resolve(Buffer.concat(chunks))));
    req.on('error', reject);
  });
}

function send(res, status, obj, extra = {}) {
  const b = Buffer.from(JSON.stringify(obj));
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': b.length, ...extra });
  res.end(b);
}

function createGateway(overrides = {}) {
  const cfg = loadConfig(process.env, overrides);
  if (!cfg.secret) throw new Error('Falta JWT_SECRET: debe ser el mismo que usa el backend de FoodTrace.');
  const cache = new Map();
  const hits = new Map();
  const stats = {
    requests: 0, unauthorized401: 0, forbidden403: 0, rateLimited429: 0,
    cacheHit: 0, cacheMiss: 0, cacheStale: 0,
    forwarded: { auth: 0, trace: 0, qr: 0 }, upstreamErrors: { auth: 0, trace: 0, qr: 0 },
  };

  const rateOk = (ip) => {
    const now = Date.now(); let e = hits.get(ip);
    if (!e || now >= e.reset) { e = { count: 0, reset: now + cfg.rateWindowMs }; hits.set(ip, e); }
    e.count += 1;
    return { ok: e.count <= cfg.rateLimit, retry: Math.max(1, Math.ceil((e.reset - now) / 1000)) };
  };
  const sweeper = setInterval(() => { const n = Date.now(); for (const [k, v] of hits) if (n >= v.reset) hits.delete(k); }, cfg.rateWindowMs);
  sweeper.unref();

  function audit(ctx, req, res) {
    const entry = {
      ts: new Date().toISOString(), id: ctx.id, ip: ctx.ip, method: req.method, path: req.url.split('?')[0],
      status: res.statusCode, user: ctx.user, role: ctx.role, service: ctx.service, cache: ctx.cache, ms: Date.now() - ctx.start,
    };
    if (cfg.onAudit) cfg.onAudit(entry);
    const line = JSON.stringify(entry);
    if (!cfg.silent) console.log(line);
    if (cfg.auditFile) fs.appendFile(cfg.auditFile, line + '\n', () => {});
  }

  function proxy(route, req, body, ctx) {
    return new Promise((resolve, reject) => {
      const base = new URL(cfg.upstreams[route.service]);
      const headers = {};
      for (const [k, v] of Object.entries(req.headers)) {
        const key = k.toLowerCase();
        if (!HOP.has(key) && !SPOOFABLE.has(key)) headers[key] = v; // el cliente no puede inyectar x-user / x-role
      }
      headers['x-request-id'] = ctx.id;
      headers['x-forwarded-for'] = ctx.ip;
      if (ctx.user) { headers['x-user'] = String(ctx.user); headers['x-role'] = String(ctx.role); } // identidad ya verificada
      if (body.length) headers['content-length'] = body.length;
      const up = http.request({ hostname: base.hostname, port: base.port || 80, path: req.url, method: req.method, headers }, (ur) => {
        const chunks = [];
        ur.on('data', (c) => chunks.push(c));
        ur.on('end', () => resolve({ status: ur.statusCode, headers: ur.headers, body: Buffer.concat(chunks) }));
        ur.on('error', reject);
      });
      up.setTimeout(cfg.timeoutMs, () => up.destroy(new Error('timeout')));
      up.on('error', reject);
      if (body.length) up.write(body);
      up.end();
    });
  }

  const sendEntry = (res, e, tag) => {
    res.writeHead(e.status, { 'content-type': e.type, 'content-length': e.body.length, 'x-cache': tag });
    res.end(e.body);
  };

  async function handle(req, res) {
    const ctx = { id: crypto.randomUUID(), ip: (req.socket.remoteAddress || '').replace('::ffff:', ''), start: Date.now(), user: null, role: null, service: 'gateway', cache: '-' };
    stats.requests += 1;
    res.on('finish', () => audit(ctx, req, res));
    res.setHeader('x-request-id', ctx.id);
    res.setHeader('x-gateway', 'foodtrace-gateway');
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('access-control-allow-origin', cfg.corsOrigin);
    res.setHeader('vary', 'Origin');
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS', 'access-control-allow-headers': 'Content-Type, Authorization', 'access-control-max-age': '600' });
      return res.end();
    }
    const rl = rateOk(ctx.ip);
    if (!rl.ok) { stats.rateLimited429 += 1; return send(res, 429, { message: 'Demasiadas solicitudes. Intenta de nuevo en un momento.' }, { 'retry-after': rl.retry }); }

    const path = req.url.split('?')[0];
    if (req.method === 'GET' && path === '/api/health') return send(res, 200, { status: 'ok', service: 'FoodTrace API Gateway' });

    const isStats = req.method === 'GET' && path === '/gateway/stats';
    const route = isStats ? { service: 'gateway', access: ['admin'] } : cfg.routes.find((x) => x.method === req.method && x.path.test(path));
    if (!route) return send(res, 404, { message: 'Ruta no encontrada.' });
    ctx.service = route.service;

    // QG-01: autenticación y autorización antes de llegar a cualquier servicio
    if (route.access !== PUBLIC) {
      const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '');
      const claims = m && verifyJwt(m[1], cfg.secret);
      if (!claims || !claims.sub || !claims.role) { stats.unauthorized401 += 1; return send(res, 401, { message: 'Inicia sesión para continuar.' }); }
      ctx.user = claims.sub; ctx.role = claims.role;
      if (Array.isArray(route.access) && !route.access.includes(claims.role)) { stats.forbidden403 += 1; return send(res, 403, { message: 'No tienes permisos para esta operación.' }); }
    }
    if (isStats) return send(res, 200, { ...stats, cacheEntries: cache.size });

    // QG-02: caché de consultas públicas
    const key = route.cache ? `${req.method} ${req.url}` : null;
    if (key) {
      const e = cache.get(key);
      if (e && Date.now() < e.expires) { stats.cacheHit += 1; ctx.cache = 'HIT'; return sendEntry(res, e, 'HIT'); }
    }
    let body = Buffer.alloc(0);
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      try { body = await readBody(req, cfg.maxBody); } catch (e) { return send(res, e.status || 400, { message: 'Cuerpo de la solicitud demasiado grande.' }); }
    }
    try {
      const up = await proxy(route, req, body, ctx);
      stats.forwarded[route.service] += 1;
      if (key) {
        ctx.cache = 'MISS'; stats.cacheMiss += 1;
        if (up.status === 200) {
          if (cache.size >= cfg.cacheMax) cache.delete(cache.keys().next().value);
          cache.delete(key);
          cache.set(key, { status: 200, type: up.headers['content-type'] || 'application/json', body: up.body, expires: Date.now() + cfg.cacheTtlMs });
        }
      }
      const headers = {};
      for (const [k, v] of Object.entries(up.headers)) if (!HOP.has(k) && !k.startsWith('access-control-')) headers[k] = v;
      headers['content-length'] = up.body.length;
      if (key) headers['x-cache'] = 'MISS';
      res.writeHead(up.status, headers);
      return res.end(up.body);
    } catch {
      // QG-03: servicio caído o lento -> dato conocido desde caché o 503 controlado
      stats.upstreamErrors[route.service] += 1;
      if (key) {
        const e = cache.get(key);
        if (e && Date.now() < e.expires + cfg.staleMs) { stats.cacheStale += 1; ctx.cache = 'STALE'; return sendEntry(res, e, 'STALE'); }
      }
      return send(res, 503, { message: 'El servicio no está disponible temporalmente. Intenta de nuevo en unos minutos.', service: route.service });
    }
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch(() => { if (!res.headersSent) send(res, 500, { message: 'Error interno del Gateway.' }); else res.end(); });
  });
  return {
    server, stats, cache, config: cfg,
    start: (port = cfg.port) => new Promise((resolve) => server.listen(port, () => resolve(server.address().port))),
    stop: () => new Promise((resolve) => { clearInterval(sweeper); server.closeAllConnections(); server.close(() => resolve()); }),
  };
}

function loadDotEnv(file = '.env') {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}

if (require.main === module) {
  loadDotEnv();
  try {
    const gw = createGateway();
    if (gw.config.secret.length < 32) console.warn('Aviso: JWT_SECRET tiene menos de 32 caracteres.');
    gw.start().then((p) => console.log(`FoodTrace API Gateway escuchando en http://localhost:${p}  (servicios: ${JSON.stringify(gw.config.upstreams)})`));
  } catch (e) { console.error(e.message); process.exit(1); }
}
module.exports = { createGateway, loadConfig };
