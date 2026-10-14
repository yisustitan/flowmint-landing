'use strict';

/**
 * Flowmint — función de soporte y feedback (Vercel, Node.js 18+).
 */

const BREVO_API = 'https://api.brevo.com/v3';
const LIST_CLIENT = 8;   // Soporte Cliente Final ($19)
const LIST_RESELLER = 9; // Reseller VIP ($149)
const MAX_MESSAGE = 10000;

const FIELD_ALIASES = {
  name: ['firstname', 'nombre', 'name', 'fullname', 'nombrecompleto'],
  email: ['email', 'correo', 'correoelectronico', 'mail'],
  rating: ['rating', 'valoracion', 'calificacion', 'puntuacion', 'estrellas', 'stars'],
  recommendation: ['recommendation', 'recomendacion', 'recommend', 'recomienda', 'nps', 'recommend_score', 'recomendar'],
  message: ['message', 'mensaje', 'feedback', 'comentario', 'comentarios', 'comment', 'comments', 'suggestion', 'sugerencia', 'consulta'],
  language: ['language', 'idioma', 'lang'],
  source: ['source', 'origen', 'origin', 'audience', 'audiencia', 'plan'],
  timestamp: ['timestamp', 'fecha', 'date'],
};
const ALIAS_TO_FIELD = {};
for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
  for (const a of aliases) ALIAS_TO_FIELD[a] = field;
}

const fold = (s) => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

function coerce(v) {
  if (v === null || v === undefined) return '';
  if (Array.isArray(v)) return v.map(coerce).filter(Boolean).join(', ');
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v).trim();
}

function parseBody(body) {
  if (!body) return {};
  if (Buffer.isBuffer(body)) body = body.toString('utf8');
  if (typeof body === 'string') {
    try { return JSON.parse(body); } catch (_) {}
    return Object.fromEntries(new URLSearchParams(body));
  }
  return typeof body === 'object' ? body : {};
}

function normalizePayload(raw) {
  const out = { name: '', email: '', rating: '', recommendation: '', message: '', language: '', source: '', timestamp: '', extra: {} };
  for (const [key, value] of Object.entries(raw || {})) {
    const v = coerce(value);
    if (v === '') continue;

    const field = ALIAS_TO_FIELD[fold(key)];
    if (field && !out[field]) {
      out[field] = v;
    } else if (fold(key) !== 'tipo') {
      out.extra[key] = v;
    }
  }
  return out;
}

function validate(data) {
  if (!data.email || data.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) return 'invalid_email';
  if (data.message.length > MAX_MESSAGE) return 'message_too_long';
  return null;
}

function resolveListId(source, headers) {
  const s = fold(source || '');
  if (/reseller|revendedor|vip/.test(s) || s === '149') return LIST_RESELLER;
  if (/cliente|client|customer|usuario|user|final/.test(s) || s === '19') return LIST_CLIENT;
  const ref = String((headers && (headers.referer || headers.referrer)) || '').toLowerCase();
  return /recursos-vip|reseller/.test(ref) ? LIST_RESELLER : LIST_CLIENT;
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function recommendationDisplay(v) {
  if (!v) return '—';
  const f = fold(v);
  if (['yes', 'si', 'true', '1', 'sisinduda', 'yesdefinitely'].includes(f)) return 'Sí / Yes';
  if (['no', 'false', '0', 'noporahora', 'notrightnow'].includes(f)) return 'No';
  if (['maybe', 'talvez', 'tal_vez', 'quizas', '2'].includes(f)) return 'Tal vez / Maybe';
  return v;
}

const ratingDisplay = (v) => (!v ? '—' : /^\d+(\.\d+)?$/.test(v) ? `${v} / 5` : v);

function buildEmail(data, isVipSetup) {
  const kind = isVipSetup ? 'Configuración VIP ($29) - Insumos' : 'Soporte / Feedback';
  const subject = `⚙️ [MONTAJE VIP $29] Nuevos Accesos Recibidos: ${data.name || data.email}`.replace(/[\r\n]+/g, ' ');

  const rows = [
    ['Nombre / Name', data.name || '—'],
    ['Email', data.email],
    ['Idioma / Language', data.language || '—'],
    ['Fecha / Date', data.timestamp || new Date().toISOString()],
  ];
  
  const extras = Object.entries(data.extra);

  const rowsHtml = rows.map(([k, v]) =>
    `<tr><td style="padding:6px 12px 6px 0;color:#555;white-space:nowrap;vertical-align:top"><b>${esc(k)}</b></td><td style="padding:6px 0">${esc(v)}</td></tr>`).join('');
  
  const extraHtml = extras.length
    ? `<h3 style="margin:20px 0 6px;color:#00AA55;">Credenciales y Datos Recolectados</h3><table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse">${extras.map(([k, v]) =>
        `<tr><td style="padding:6px 12px 6px 0;color:#333;vertical-align:top;border-bottom:1px solid #eee;"><b>${esc(k)}</b></td><td style="padding:6px 0;border-bottom:1px solid #eee;font-family:monospace;">${esc(v)}</td></tr>`).join('')}</table>`
    : '';

  const htmlContent = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:640px;color:#1a1a1a">
<h2 style="margin:0 0 12px;color:#00AA55;">⚙️ NUEVA SOLICITUD DE MONTAJE VIP ($29)</h2>
<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse">${rowsHtml}</table>
${extraHtml}
<p style="color:#888;font-size:12px;margin-top:20px">Este correo fue generado automáticamente por el formulario de incorporación VIP.</p>
</div>`;

  const textContent = [
    `NUEVA SOLICITUD DE MONTAJE VIP ($29)`, '',
    ...rows.map(([k, v]) => `${k}: ${v}`), '',
    ...(extras.length ? ['Credenciales y Datos Recolectados:', ...extras.map(([k, v]) => `${k}: ${v}`)] : []),
  ].join('\n');

  return { subject, htmlContent, textContent };
}

async function brevoPost(path, body, apiKey) {
  const r = await fetch(`${BREVO_API}${path}`, {
    method: 'POST',
    headers: { 'api-key': apiKey, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  const text = await r.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (_) {}
  if (!r.ok) {
    const err = new Error(`Brevo ${path} respondió ${r.status}`);
    err.status = r.status;
    err.detail = json || text;
    throw err;
  }
  return json;
}

function sendNotification(data, isVipSetup, apiKey) {
  const supportEmail = process.env.SUPPORT_EMAIL || 'hola@centraliaportal.com';
  const { subject, htmlContent, textContent } = buildEmail(data, isVipSetup);
  const senderName = 'Flowmint VIP Deployment';

  return brevoPost('/smtp/email', {
    sender: { name: senderName, email: supportEmail },
    to: [{ email: supportEmail }],
    replyTo: { email: data.email, ...(data.name ? { name: data.name.slice(0, 100) } : {}) },
    subject, htmlContent, textContent,
    tags: ['flowmint-vip-setup'],
  }, apiKey);
}

function setCors(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(405).json({ success: false, ok: false, error: 'method_not_allowed' });
  }

  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ success: false, ok: false, error: 'server_not_configured' });
  }

  const rawBody = parseBody(req.body);
  const data = normalizePayload(rawBody);
  const invalid = validate(data);
  if (invalid) return res.status(400).json({ success: false, ok: false, error: invalid });

  // Detectamos si es la solicitud VIP de $29 a través de la fuente o campos extra
  const isVipSetup = fold(data.source).includes('vip') || rawBody.tipo === 'configuracion_vip_completa_accesos';

  // Solo enviamos el correo interno a ti (hola@...), omitiendo la sincronización de listas en Brevo para que el cliente no reciba correos no deseados de la lista de $149.
  try {
    await sendNotification(data, isVipSetup, apiKey);
  } catch (_) {
    return res.status(502).json({ success: false, ok: false, error: 'email_failed' });
  }

  return res.status(200).json({ success: true, ok: true, email: 'sent', contact: 'skipped_brevo_list' });
}

module.exports = handler;
