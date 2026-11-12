# FoodTrace API Gateway (prototipo – Arquitectura de Software)

Único punto de entrada del sistema FoodTrace. Se coloca **delante** de la API de FoodTrace
(la del proyecto de Tecnologías en Internet) y aplica: verificación JWT, autorización por rol,
caché de consultas públicas (TTL 30 s), límite de solicitudes por IP, auditoría y error 503 controlado.
No tiene dependencias externas (solo Node.js ≥ 18.2).

## Pruebas automáticas (sin base de datos)
    npm test      # escenarios QG-01, QG-02 y QG-03 con servicios simulados -> test/test-results.json
    npm run bench # sobrecosto del salto adicional

## Ejecutar delante del backend real de FoodTrace
1. Levantar MongoDB y el backend de FoodTrace (puerto 5000).
2. Copiar `.env.example` a `.env` y poner **el mismo JWT_SECRET** del backend.
3. `npm start` (Gateway en http://localhost:8080).
4. En `frontend/.env`: `VITE_API_BASE_URL=http://localhost:8080/api` y reiniciar el frontend.
5. En el backend, agregar `app.set('trust proxy', 1);` antes del limitador de solicitudes
   (para que cuente la IP real del cliente y no la del Gateway).

## Ejecutar con servicios simulados
    npm run mocks   # imprime el comando para iniciar el Gateway apuntando a los simulados

## Archivos
- `src/gateway.js` – Gateway (enrutamiento, JWT, RBAC, caché, rate limit, auditoría, 503).
- `src/routes.js` – tabla de rutas (método, ruta, servicio, acceso, caché).
- `src/jwt.js` – firma y verificación HS256 con `crypto`.
- `src/mock-services.js` – servicios simulados de Autenticación, Trazabilidad y QR.
- `test/run-tests.js` y `test/overhead.js` – pruebas y medición.
