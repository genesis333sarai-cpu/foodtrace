# FoodTrace

Sistema web de trazabilidad alimentaria basado en el documento del Proyecto Integrador.

## Tecnologías
- Frontend: React + Vite
- Backend: Node.js + Express
- Persistencia: MongoDB (local o MongoDB Atlas)
- Seguridad: JWT, bcryptjs, Helmet, CORS
- Integridad: cadena de evidencias SHA-256 (registro encadenado; no es una blockchain pública)
- QR: qrcode
- API: Swagger UI en `/api-docs`

## Requisitos
- Node.js 18 o superior
- npm 9 o superior
- MongoDB local o cuenta MongoDB Atlas

## Instalación
git clone https://github.com/genesis333sarai-cpu/foodtrace.git 
cd foodtrace

## Instalación en Windows (PowerShell)
1. Extrae el ZIP.
2. Abre la carpeta `FoodTrace` en VS Code.
3. Inicia MongoDB local o crea una base de datos en MongoDB Atlas.
4. En una terminal:

```powershell
cd backend
npm install
copy .env.example .env   
```

5. Edita `backend/.env` y coloca tu `MONGO_URI` y un `JWT_SECRET` propio (mínimo 32 caracteres).
6. Inicia el backend:

```powershell
npm run dev
```

7. Abre otra terminal:

```powershell
cd frontend
npm install
copy .env.example .env
npm run dev
```

8. Abre la dirección que muestra Vite, normalmente `http://localhost:5173`.

## Documentación de la API
http://localhost:5000/api-docs

## Primer administrador
Por seguridad, el registro público crea usuarios con rol `producer`; no permite autoproclamarse administrador.
Para crear el primer administrador, ejecuta en `backend`:

```powershell
npm run create-admin
```

Completa los datos solicitados en la terminal. Después inicia sesión desde la aplicación.

## Roles
- `admin`: administración completa.
- `producer`: productos y lotes/producción.
- `processor`: procesamiento.
- `transporter`: transporte.
- `establishment`: recepción y almacenamiento.

## Usuarios de prueba

Para probar el sistema, usa estas cuentas (o regístralas desde la pantalla de registro):

| Nombre | Correo | Rol | Contraseña |
| --- | --- | --- | --- |
| Juan Carlos Jimenez Santos | juan.carlos@empresa.com | admin | juanCarlos123 |
| Carla Andrea Quispe Galarte | carla.quispe@empresa.com | producer | carla.quispe333 |


## Prueba rápida
1. Crea el administrador con el script.
2. Inicia sesión.
3. Registra una categoría y un producto.
4. Crea un lote.
5. Registra las etapas desde las cuentas con el rol correspondiente (o desde admin).
6. Abre la consulta pública escaneando el QR o visitando `/trace/CODIGO-DEL-LOTE`.
7. Verifica la integridad desde el detalle del lote.

## Notas importantes
- La temperatura y la ubicación se registran manualmente, tal como delimita el documento.
- Los hashes SHA-256 permiten detectar cambios posteriores en los eventos. No certifican que el dato original introducido sea verdadero ni equivalen a una red blockchain descentralizada.
- Las categorías iniciales se limitan a frutas y verduras, productos lácteos y alimentos procesados.
- No se implementan ventas, pagos, facturación, GPS ni sensores IoT.
- Para producción configura HTTPS, CORS con el dominio real, secretos fuertes y copias de seguridad de MongoDB.
