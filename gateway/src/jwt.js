'use strict';
// JWT HS256 mínimo con el módulo crypto de Node (compatible con jsonwebtoken, que usa HS256 por defecto).
const crypto = require('node:crypto');
const b64u = (buf) => Buffer.from(buf).toString('base64url');

function signJwt(payload, secret) {
  const head = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64u(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}

// Devuelve el payload si la firma y la vigencia son válidas; si no, null.
function verifyJwt(token, secret) {
  const parts = String(token).split('.');
  if (parts.length !== 3) return null;
  let header; let payload;
  try { header = JSON.parse(Buffer.from(parts[0], 'base64url').toString()); } catch { return null; }
  if (!header || header.alg !== 'HS256') return null; // rechaza alg:none y otros algoritmos
  const expected = crypto.createHmac('sha256', secret).update(`${parts[0]}.${parts[1]}`).digest();
  const got = Buffer.from(parts[2], 'base64url');
  if (got.length !== expected.length || !crypto.timingSafeEqual(got, expected)) return null;
  try { payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString()); } catch { return null; }
  if (!payload || (payload.exp && Date.now() / 1000 >= payload.exp)) return null;
  return payload;
}
module.exports = { signJwt, verifyJwt };
