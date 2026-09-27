# FlowMint — Backend de Licencias (Supabase + Hotmart)

## Por qué este cambio es necesario

Ahora mismo el navegador llama directo a `/rest/v1/licenses` usando la `anon key`,
que está visible en el código fuente de tu HTML. Con eso, cualquier persona con
DevTools puede:
- Ver la `anon key` y el `license_key` de otro usuario.
- Mandar un `PATCH` manual vaciando el array `devices` de su propia licencia
  para "resetear" el contador y activarla en un tercer, cuarto, quinto equipo.
- Insertar registros falsos.

Moviendo la lógica a una **Edge Function** con la `service_role key` (que nunca
sale del servidor), y cerrando la tabla con RLS sin políticas para `anon`, esto
deja de ser posible: el navegador ya no puede tocar la tabla directamente, solo
puede invocar la función, que es la única que decide.

---

## Paso 1 — Crear la tabla y cerrar RLS

1. Ve a tu proyecto en supabase.com → **SQL Editor**.
2. Pega y ejecuta el contenido de `01_schema_and_rls.sql`.
3. Ve a **Database → Policies → licenses**. Si ves alguna policy existente que
   permita `SELECT`/`INSERT`/`UPDATE` para `anon` (de la implementación
   anterior), bórrala. Al terminar, la tabla debe mostrar "RLS enabled" y
   **cero policies** — eso es lo correcto (acceso denegado por defecto).

## Paso 2 — Instalar el CLI de Supabase (si no lo tienes)

```bash
npm install -g supabase
supabase login
supabase link --project-ref <tu-project-ref>
```

(El `project-ref` es el subdominio de tu URL: `https://<project-ref>.supabase.co`)

## Paso 3 — Desplegar las dos Edge Functions

Copia las carpetas `functions/validate-license` y `functions/hotmart-webhook`
dentro de tu carpeta `supabase/functions/` local, luego:

```bash
supabase functions deploy validate-license
supabase functions deploy hotmart-webhook --no-verify-jwt
```

## Paso 4 — Configurar los secrets (nunca van en el código ni en el HTML)

```bash
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=<tu-service-role-key>
supabase secrets set HOTMART_HOTTOK=<el-hottok-de-tu-webhook-en-hotmart>
```

La `service_role key` la encuentras en **Project Settings → API → service_role**.
Es secreta — jamás debe pegarse en el HTML ni subirse a un repo público.

## Paso 5 — Configurar el Webhook en Hotmart

1. Panel de Hotmart → **Ferramentas → Webhook** → Nueva URL.
2. URL: `https://<tu-project-ref>.functions.supabase.co/hotmart-webhook`
3. Eventos a marcar: **Compra Aprovada**, **Compra Cancelada**, **Reembolso**,
   **Chargeback**.
4. Hotmart te muestra un **Hottok** — es el mismo valor que configuraste en
   el Paso 4. Si no coinciden, la función rechaza el webhook con 401.

## Paso 6 — Actualizar el frontend (flowmint_v11_animation.html)

Reemplaza la función `validateDeviceLimit` para que llame a la Edge Function
en vez de a `/rest/v1/licenses` directamente:

```javascript
const VALIDATE_LICENSE_URL = `${SUPABASE_URL}/functions/v1/validate-license`;

async function validateDeviceLimit(licenseKey) {
  const device_id = getOrCreateDeviceId();
  try {
    const res = await fetch(VALIDATE_LICENSE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
      },
      body: JSON.stringify({ license_key: licenseKey, device_id })
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      // Fail-closed: cualquier status fuera de 2xx deniega el acceso.
      return { success: false, reason: data.reason || 'api_error', httpStatus: res.status };
    }
    return { success: true, httpStatus: res.status };

  } catch (error) {
    return { success: false, reason: 'network_error', httpStatus: null };
  }
}
```

Dime cuando hayas desplegado los pasos 1-5 y te aplico este cambio directo
sobre tu archivo `.html` para que quede 100% conectado.

## Paso 7 — Probar con curl (tú, desde tu terminal — mi sandbox no alcanza tu Supabase)

```bash
# Simula una compra aprobada (crea la licencia)
curl -i -X POST "https://<tu-project-ref>.functions.supabase.co/hotmart-webhook" \
  -H "Content-Type: application/json" \
  -H "x-hotmart-hottok: <tu-hottok>" \
  -d '{
    "event": "PURCHASE_APPROVED",
    "data": {
      "purchase": { "transaction": "HP-TEST-001", "offer": { "code": "default" } },
      "buyer": { "email": "test@example.com" }
    }
  }'

# Dispositivo 1 se activa (debe responder success:true)
curl -i -X POST "https://<tu-project-ref>.functions.supabase.co/validate-license" \
  -H "Content-Type: application/json" \
  -H "apikey: <tu-anon-key>" \
  -d '{ "license_key": "HP-TEST-001", "device_id": "device_A" }'

# Dispositivo 2 se activa (debe responder success:true)
curl -i -X POST "https://<tu-project-ref>.functions.supabase.co/validate-license" \
  -H "Content-Type: application/json" \
  -H "apikey: <tu-anon-key>" \
  -d '{ "license_key": "HP-TEST-001", "device_id": "device_B" }'

# Dispositivo 3 debe ser RECHAZADO (success:false, reason:"limit_reached", HTTP 403)
curl -i -X POST "https://<tu-project-ref>.functions.supabase.co/validate-license" \
  -H "Content-Type: application/json" \
  -H "apikey: <tu-anon-key>" \
  -d '{ "license_key": "HP-TEST-001", "device_id": "device_C" }'
```
