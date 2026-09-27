// ══════════════════════════════════════════════════════════════════════
// FlowMint — Edge Function: hotmart-webhook
// Recibe los eventos de Hotmart (compra aprobada, reembolso, cancelación,
// contracargo) y crea o revoca la licencia correspondiente en Supabase.
//
// Configuración en Hotmart:
//   Panel Hotmart → Ferramentas → Webhook → Nueva URL
//   URL: https://<tu-proyecto>.functions.supabase.co/hotmart-webhook
//   Eventos a marcar: Compra Aprovada, Compra Cancelada, Reembolso, Chargeback
//   Copia el "Hottok" que te muestra Hotmart y guárdalo como secret abajo.
//
// Deploy:
//   supabase functions new hotmart-webhook
//   supabase functions deploy hotmart-webhook --no-verify-jwt
//   supabase secrets set SUPABASE_SERVICE_ROLE_KEY=<tu-service-role-key>
//   supabase secrets set HOTMART_HOTTOK=<el-hottok-que-te-dio-hotmart>
//
// Nota: --no-verify-jwt es necesario porque Hotmart no envía un JWT de
// Supabase; la seguridad real la da la verificación del Hottok más abajo.
// ══════════════════════════════════════════════════════════════════════
import { serve } from "https://deno.land/std@0.203.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const HOTMART_HOTTOK = Deno.env.get("HOTMART_HOTTOK")!;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// Ajusta esto a tus productos/ofertas reales de Hotmart si algún día
// vendes tiers con distinto límite (ej. la Licencia de Revendedor $149
// podría merecer más de 2 dispositivos). El "código de oferta" lo ves en
// Hotmart → Producto → Ofertas.
const MAX_DEVICES_BY_OFFER: Record<string, number> = {
  default: 2,
  // "codigo_oferta_reseller_149": 10,
};

const EVENTS_THAT_ACTIVATE = ["PURCHASE_APPROVED", "PURCHASE_COMPLETE"];
const EVENTS_THAT_REVOKE = [
  "PURCHASE_CANCELED",
  "PURCHASE_REFUNDED",
  "PURCHASE_CHARGEBACK",
  "PURCHASE_EXPIRED",
  "PURCHASE_PROTEST",
];

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  // ── Verificación de autenticidad: el Hottok debe coincidir ──
  // Hotmart lo manda como header en Webhook v2; si tu versión lo manda en
  // el body como "hottok", el fallback de abajo lo cubre.
  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid_json" }), { status: 400 });
  }

  const hottokHeader = req.headers.get("x-hotmart-hottok");
  const hottokBody = payload?.hottok;
  const receivedHottok = hottokHeader || hottokBody;

  if (!receivedHottok || receivedHottok !== HOTMART_HOTTOK) {
    console.warn("Hottok inválido o ausente — solicitud rechazada.");
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
  }

  const event = payload.event;
  const purchase = payload.data?.purchase;
  const buyer = payload.data?.buyer;
  const offerCode = purchase?.offer?.code || "default";
  const transaction = purchase?.transaction;

  if (!transaction) {
    return new Response(JSON.stringify({ error: "missing_transaction" }), { status: 400 });
  }

  // La clave de licencia = el código de transacción de Hotmart (único
  // garantizado, sin necesidad de generar/gestionar claves aparte).
  // Si prefieres una clave más "bonita" para mostrar al cliente, genérala
  // aquí y guarda ambas (transaction para idempotencia, license_key para
  // mostrar), pero mantenlo simple mientras no sea necesario.
  const licenseKey = transaction;

  if (EVENTS_THAT_ACTIVATE.includes(event)) {
    const maxDevices = MAX_DEVICES_BY_OFFER[offerCode] ?? MAX_DEVICES_BY_OFFER.default;

    const { error } = await supabase.from("licenses").upsert(
      {
        license_key: licenseKey,
        email: buyer?.email ?? null,
        status: "active",
        max_devices: maxDevices,
        offer_code: offerCode,
        // OJO: en un upsert por conflicto de PK, si la licencia YA existía
        // (ej. reintento del webhook) no queremos resetear los devices ya
        // registrados. Por eso este upsert solo toca estos campos —
        // devices se deja con su default '[]' SOLO en el insert inicial;
        // Postgres no reescribe `devices` en un conflicto si no lo listamos
        // explícitamente en el UPDATE del upsert (ver nota abajo).
      },
      { onConflict: "license_key", ignoreDuplicates: false },
    );

    if (error) {
      console.error("Error creando/actualizando licencia:", error);
      return new Response(JSON.stringify({ error: "db_error" }), { status: 500 });
    }

    console.log(`Licencia activada: ${licenseKey} (${buyer?.email}) — max_devices=${maxDevices}`);
  }

  if (EVENTS_THAT_REVOKE.includes(event)) {
    const { error } = await supabase
      .from("licenses")
      .update({ status: "revoked" })
      .eq("license_key", licenseKey);

    if (error) {
      console.error("Error revocando licencia:", error);
      return new Response(JSON.stringify({ error: "db_error" }), { status: 500 });
    }

    console.log(`Licencia revocada: ${licenseKey} (evento: ${event})`);
  }

  // Siempre 200 para eventos que no nos interesan (Hotmart reintenta si no
  // responde 2xx) — solo actuamos sobre los eventos listados arriba.
  return new Response(JSON.stringify({ received: true }), { status: 200 });
});
