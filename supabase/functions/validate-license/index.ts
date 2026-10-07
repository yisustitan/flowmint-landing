import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { license_key, device_id } = await req.json()
    if (!license_key || !device_id) {
      return new Response(JSON.stringify({ success: false, reason: 'missing_params' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { data: license, error } = await supabaseAdmin
      .from('licenses')
      .select('*')
      .eq('license_key', license_key)
      .single()

    if (error || !license) {
      return new Response(JSON.stringify({ success: false, reason: 'invalid_license' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    if (license.status !== 'active') {
      return new Response(JSON.stringify({ success: false, reason: 'license_revoked' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const devices = license.devices || []
    if (devices.includes(device_id)) {
      return new Response(JSON.stringify({ success: true, reason: 'already_registered' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    if (devices.length >= (license.max_devices || 2)) {
      return new Response(JSON.stringify({ success: false, reason: 'limit_reached' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const newDevices = [...devices, device_id]
    await supabaseAdmin
      .from('licenses')
      .update({ devices: newDevices })
      .eq('license_key', license_key)

    return new Response(JSON.stringify({ success: true, reason: 'activated' }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (err) {
    return new Response(JSON.stringify({ success: false, reason: 'server_error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
