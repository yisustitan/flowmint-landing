import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

serve(async (req) => {
  // Manejo de preflight CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-hotmart-hottok',
      }
    })
  }

  try {
    const rawBody = await req.text()
    if (!rawBody) {
      return new Response(JSON.stringify({ error: 'Empty body' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    const body = JSON.parse(rawBody)
    console.log("Hotmart Webhook recibido:", JSON.stringify(body))

    // Verificación de HOTMART_HOTTOK (si está configurado como secreto)
    const hottokHeader = req.headers.get('x-hotmart-hottok')
    const expectedHottok = Deno.env.get('HOTMART_HOTTOK')
    const hottokBody = body?.hottok

    if (expectedHottok && hottokHeader !== expectedHottok && hottokBody !== expectedHottok) {
      console.warn("Unauthorized: Hottok de Hotmart no coincide")
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    // 1. Mapeo flexible del Evento
    const event = body.event || body.data?.event

    // 2. Mapeo flexible de la Transacción (license_key)
    const transaction =
      body.data?.purchase?.transaction ||
      body.purchase?.transaction ||
      body.data?.transaction ||
      body.transaction

    // 3. Mapeo flexible del Email del comprador (req.body.data?.buyer?.email o req.body.buyer?.email)
    const email =
      body.data?.buyer?.email ||
      body.buyer?.email ||
      body.data?.email ||
      body.email

    console.log(`Evento: ${event} | Transacción: ${transaction} | Comprador: ${email}`)

    if (!transaction) {
      console.warn("No se encontró transacción en el payload recibido")
      return new Response(JSON.stringify({ error: 'Missing transaction' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    // 4. Cliente Supabase con Service Role Key (Admin Rights para saltarse RLS)
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey)

    // Eventos de aprobación de compra
    const isApproved =
      event === 'PURCHASE_APPROVED' ||
      event === 'PURCHASE_COMPLETE' ||
      body.data?.purchase?.status === 'APPROVED'

    // Eventos de cancelación o reembolso
    const isRevoked = [
      'PURCHASE_CANCELED',
      'PURCHASE_REFUNDED',
      'PURCHASE_CHARGEBACK',
      'PURCHASE_EXPIRED',
      'PURCHASE_PROTEST'
    ].includes(event) || ['CANCELED', 'REFUNDED', 'CHARGEBACK', 'EXPIRED'].includes(body.data?.purchase?.status)

    if (isApproved) {
      // Esquema de la tabla 'licenses': customer_email, license_key, status, is_active
      const licensePayload = {
        license_key: transaction,
        customer_email: email || '',
        status: 'active',
        is_active: true
      }

      console.log("Insertando/Actualizando en licenses:", JSON.stringify(licensePayload))

      const { data, error } = await supabaseAdmin
        .from('licenses')
        .upsert(licensePayload, { onConflict: 'license_key' })
        .select()

      if (error) {
        console.error("Error al insertar licencia:", error)
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        })
      }

      console.log("Licencia guardada exitosamente:", JSON.stringify(data))

    } else if (isRevoked) {
      console.log(`Revocando licencia: ${transaction}`)

      const { data, error } = await supabaseAdmin
        .from('licenses')
        .update({
          status: 'revoked',
          is_active: false
        })
        .eq('license_key', transaction)
        .select()

      if (error) {
        console.error("Error al revocar licencia:", error)
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        })
      }

      console.log("Licencia revocada exitosamente:", JSON.stringify(data))
    } else {
      console.log(`Evento secundario recibido (${event}), sin modificación de licencia.`)
    }

    return new Response(JSON.stringify({ received: true, event, transaction }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })

  } catch (err) {
    console.error("Error inesperado en hotmart-webhook:", err)
    return new Response(JSON.stringify({ error: 'Internal Error', message: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }
})
