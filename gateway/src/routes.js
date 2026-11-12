'use strict';
// Tabla de enrutamiento del Gateway: método, ruta, servicio interno, acceso y si se cachea.
// Agregar una ruta nueva = agregar una línea aquí; el cliente web no cambia (AQ-05).
const PUBLIC = 'public'; // sin autenticación
const ANY = 'any';       // cualquier usuario autenticado
const r = (method, path, service, access, cache = false) => ({ method, path, service, access, cache });
const PRODUCT_ROLES = ['admin', 'producer', 'processor'];

module.exports = [
  // Servicio de Autenticación
  r('POST', /^\/api\/auth\/(login|register)$/, 'auth', PUBLIC),
  r('GET', /^\/api\/auth\/me$/, 'auth', ANY),
  // Servicio QR
  r('GET', /^\/api\/batches\/[^/]+\/qr$/, 'qr', ANY),
  // Servicio de Trazabilidad: consulta pública (con caché) y lotes
  r('GET', /^\/api\/public\/trace\/[^/]+$/, 'trace', PUBLIC, true),
  r('GET', /^\/api\/batches(\/[^/]+)?$/, 'trace', ANY),
  r('GET', /^\/api\/batches\/[^/]+\/verify$/, 'trace', ANY),
  r('POST', /^\/api\/batches$/, 'trace', ['admin', 'producer']),
  r('POST', /^\/api\/batches\/[^/]+\/processing$/, 'trace', ['admin', 'processor']),
  r('POST', /^\/api\/batches\/[^/]+\/transport$/, 'trace', ['admin', 'transporter']),
  r('POST', /^\/api\/batches\/[^/]+\/(reception|storage)$/, 'trace', ['admin', 'establishment']),
  // Catálogo y panel (los atiende el mismo servicio en el backend actual)
  r('GET', /^\/api\/(categories|products|dashboard)$/, 'trace', ANY),
  r('POST', /^\/api\/products$/, 'trace', PRODUCT_ROLES),
  r('PUT', /^\/api\/products\/[^/]+$/, 'trace', PRODUCT_ROLES),
  r('DELETE', /^\/api\/products\/[^/]+$/, 'trace', ['admin']),
  r('POST', /^\/api\/categories$/, 'trace', ['admin']),
  r('PUT', /^\/api\/categories\/[^/]+$/, 'trace', ['admin']),
  r('DELETE', /^\/api\/categories\/[^/]+$/, 'trace', ['admin']),
  // Administración
  r('GET', /^\/api\/(users|alerts)$/, 'trace', ['admin']),
  r('PATCH', /^\/api\/(users|alerts)\/[^/]+$/, 'trace', ['admin']),
  r('DELETE', /^\/api\/users\/[^/]+$/, 'trace', ['admin']),
];
module.exports.PUBLIC = PUBLIC;
module.exports.ANY = ANY;
