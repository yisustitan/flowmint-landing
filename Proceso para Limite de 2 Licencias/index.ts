// ══════════════════════════════════════════════════════════════════════
// FlowMint — Edge Function: validate-license
// Reemplaza las llamadas directas del navegador a /rest/v1/licenses.
// Toda la lógica de conteo y límite de dispositivos vive AQUÍ, en el
// servidor, usando la SERVICE_ROLE_KEY (nunca visible para el cliente).
//
// Deploy:
//   supabase functions new validate-license   (ya viene con esta carpeta)
//   supabase functions deploy validate-license
//   supabase secrets set SUPABASE_SERVICE_ROLE_KEY=<tu-service-role-key>
// ══════════════════════════════════════════════════════════════════════
import { serve } from "https://deno.land/std@0.203.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DEFAULT_MAX_DEVICES = 2;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// En producción, cambia "*" por tu dominio real (ej. "https://tusitio.com")
// para que solo tu propia app pueda invocar esta función desde el navegador.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function logAttempt(
  license_key: string,
  device_id: string,
  result: string,
  req: Request,
) {
  try {
    await supabase.from("license_activation_log").insert({
      license_key,
      device_id,
      result,
      ip_address: req.headers.get("x-forwarded-for") ?? null,
      user_agent: req.headers.get("user-agent") ?? null,
    });
  } catch (_e) {
    // El log nunca debe tumbar la validación real si falla.
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ success: false, reason: "method_not_allowed" }, 405);

  let body: { license_key?: string; device_id?: string };
  try {
    body = await req.json();
  } catch {
    return json({ success: false, reason: "invalid_json" }, 400);
  }

  const license_key = (body.license_key || "").trim();
  const device_id = (body.device_id || "").trim();

  if (!license_key || !device_id) {
    return json({ success: false, reason: "missing_params" }, 400);
  }

  // ── Buscar la licencia (creada por el webhook de Hotmart al aprobar la compra) ──
  const { data: license, error: selectError } = await supabase
    .from("licenses")
    .select("*")
    .eq("license_key", license_key)
    .maybeSingle();

  if (selectError) {
    console.error("Error consultando licencia:", selectError);
    await logAttempt(license_key, device_id, "error", req);
    return json({ success: false, reason: "db_error" }, 500);
  }

  if (!license) {
    // La clave no existe en la base — nunca llegó vía webhook de Hotmart,
    // o el comprador escribió mal su clave.
    await logAttempt(license_key, device_id, "invalid_license", req);
    return json({ success: false, reason: "invalid_license" }, 404);
  }

  if (license.status !== "active") {
    // Licencia reembolsada / cancelada / con contracargo (ver hotmart-webhook).
    await logAttempt(license_key, device_id, "license_revoked", req);
    return json({ success: false, reason: "license_revoked" }, 403);
  }

  const devices: string[] = Array.isArray(license.devices) ? license.devices : [];
  const maxDevices = license.max_devices ?? DEFAULT_MAX_DEVICES;

  // Este dispositivo ya estaba registrado: acceso permitido, sin gastar slot nuevo.
  if (devices.includes(device_id)) {
    await logAttempt(license_key, device_id, "already_registered", req);
    return json({ success: true, devices, maxDevices, alreadyRegistered: true });
  }

  // Dispositivo nuevo pero ya se alcanzó el límite: RECHAZAR.
  if (devices.length >= maxDevices) {
    await logAttempt(license_key, device_id, "limit_reached", req);
    return json({ success: false, reason: "limit_reached", devices, maxDevices }, 403);
  }

  // Dispositivo nuevo y hay cupo: registrarlo.
  const updatedDevices = [...devices, device_id];
  const { error: updateError } = await supabase
    .from("licenses")
    .update({ devices: updatedDevices })
    .eq("license_key", license_key);

  if (updateError) {
    console.error("Error actualizando dispositivos:", updateError);
    await logAttempt(license_key, device_id, "error", req);
    return json({ success: false, reason: "db_error" }, 500);
  }

  await logAttempt(license_key, device_id, "granted", req);
  return json({ success: true, devices: updatedDevices, maxDevices });
});
