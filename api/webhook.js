'use strict';

/**
 * Flowmint — función de soporte y feedback (Vercel, Node.js 18+).
 *
 * UN solo POST desde el frontend; aquí se hacen las dos cosas en paralelo:
 *   1) Correo de notificación a hola@centraliaportal.com con TODOS los campos recibidos
 *      (Brevo transaccional: POST /v3/smtp/email).
 *   2) Alta/actualización del contacto (Brevo: POST /v3/contacts, updateEnabled: true)
 *      en la lista 8 (Cliente Final $19) o 9 (Reseller VIP $149).
 *
 * Variables de entorno:
 *   BREVO_API_KEY       (obligatoria)
 *   SUPPORT_EMAIL       (opcional, por defecto hola@centraliaportal.com)
 *   BREVO_SENDER_EMAIL  (opcional, por defecto SUPPORT_EMAIL; debe ser un remitente validado en Brevo)
 *   BREVO_SENDER_NAME   (opcional, por defecto "Flowmint")
 *   ALLOWED_ORIGINS     (opcional, separados por coma; por defecto https://flowmint.centraliaportal.com)
 *
 * Payload: JSON (o x-www-form-urlencoded). Los nombres de campo se reconocen en español e inglés,
 * sin importar mayúsculas ni acentos: Nombre/FIRSTNAME/Name, Email/Correo, Valoración/Rating,
 * Recomendación/Recommendation, Mensaje/Message/Feedback, Idioma/Language, Origen/Source.
 * Cualquier campo no reconocido NO se pierde: se añade al correo en "Otros campos".
 */

const BREVO_API = 'https://api.brevo.com/v3';
const LIST_CLIENT = 8;   // Soporte Cliente Final ($19)
const LIST_RESELLER = 9; // Reseller VIP ($149)
const MAX_MESSAGE = 10000;

const FIELD_ALIASES = {
  name: ['firstname', 'nombre', 'name', 'fullname', 'nombrecompleto'],
  email: ['email', 'correo', 'correoelectronico', 'mail'],
  rating: ['rating', 'valoracion', 'calificacion', 'puntuacion', 'estrellas', 'stars'],
  recommendation: ['recommendation', 'recomendacion', 'recommend', 'recomienda'],
  message: ['message', 'mensaje', 'feedback', 'comentario', 'comentarios', 'comment', 'comments', 'suggestion', 'sugerencia', 'consulta'],
  language: ['language', 'idioma', 'lang'],
  source: ['source', 'origen', 'origin', 'audience', 'audiencia', 'plan'],
  timestamp: ['timestamp', 'fecha', 'date'],
};
const ALIAS_TO_FIELD = {};
for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
  for (const a of aliases) ALIAS_TO_FIELD[a] = field;
}

// "Valoración" -> "valoracion", "first_name" -> "firstname", "E-mail" -> "email"
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
    try { return JSON.parse(body); } catch (_) { /* no es JSON */ }
    return Object.fromEntries(new URLSearchParams(body));
  }
  return typeof body === 'object' ? body : {};
}

/** Convierte cualquier payload (ES/EN) a campos canónicos + "extra" con lo no reconocido. */
function normalizePayload(raw) {
  const out = { name: '', email: '', rating: '', recommendation: '', message: '', language: '', source: '', timestamp: '', extra: {} };
  for (const [key, value] of Object.entries(raw || {})) {
    const v = coerce(value);
    if (v === '') continue;
    const field = ALIAS_TO_FIELD[fold(key)];
    if (field && !out[field]) out[field] = v;
    else out.extra[key] = v; // desconocido o duplicado: no se pierde
  }
  return out;
}

function validate(data) {
  if (!data.email || data.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) return 'invalid_email';
  if (data.message.length > MAX_MESSAGE) return 'message_too_long';
  return null;
}

/** lista 9 = Reseller VIP, lista 8 = Cliente Final (por defecto). */
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
  if (['yes', 'si', 'true', '1'].includes(f)) return 'Sí / Yes';
  if (['no', 'false', '0'].includes(f)) return 'No';
  return v;
}
const ratingDisplay = (v) => (!v ? '—' : /^\d+(\.\d+)?$/.test(v) ? `${v} / 5` : v);

function buildEmail(data, listId) {
  const isFeedback = Boolean(data.rating || data.recommendation);
  const kind = isFeedback ? 'Feedback' : 'Soporte / Support';
  const origin = listId === LIST_RESELLER ? 'Reseller VIP ($149)' : 'Cliente Final / End Customer ($19)';
  const lang = data.language ? data.language.toUpperCase().slice(0, 2) : '--';
  const subject = `[Flowmint][${lang}] ${kind}: ${data.name || data.email}`.replace(/[\r\n]+/g, ' ');

  const rows = [
    ['Nombre / Name', data.name || '— (no proporcionado / not provided)'],
    ['Email', data.email],
    ['Valoración / Rating', ratingDisplay(data.rating)],
    ['Recomendación / Recommendation', recommendationDisplay(data.recommendation)],
    ['Idioma / Language', data.language || '—'],
    ['Origen / Source', origin],
    ['Fecha / Date', data.timestamp || new Date().toISOString()],
  ];
  const message = data.message || '(sin mensaje / no message)';
  const extras = Object.entries(data.extra);

  const rowsHtml = rows.map(([k, v]) =>
    `<tr><td style="padding:6px 12px 6px 0;color:#555;white-space:nowrap;vertical-align:top"><b>${esc(k)}</b></td><td style="padding:6px 0">${esc(v)}</td></tr>`).join('');
  const extraHtml = extras.length
    ? `<h3 style="margin:20px 0 6px">Otros campos / Other fields</h3><table role="presentation" cellpadding="0" cellspacing="0">${extras.map(([k, v]) =>
        `<tr><td style="padding:4px 12px 4px 0;color:#555;vertical-align:top"><b>${esc(k)}</b></td><td style="padding:4px 0">${esc(v)}</td></tr>`).join('')}</table>`
    : '';

  const htmlContent = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:640px;color:#1a1a1a">
<h2 style="margin:0 0 12px">${esc(kind)} — Flowmint</h2>
<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse">${rowsHtml}</table>
<h3 style="margin:20px 0 6px">Mensaje / Message</h3>
<div style="white-space:pre-wrap;border:1px solid #ddd;border-radius:6px;padding:12px;background:#fafafa">${esc(message)}</div>
${extraHtml}
<p style="color:#888;font-size:12px;margin-top:20px">Responde a este correo para contestar al usuario (Reply-To). / Reply to this email to answer the user.</p>
</div>`;

  const textContent = [
    `${kind} — Flowmint`, '',
    ...rows.map(([k, v]) => `${k}: ${v}`), '',
    'Mensaje / Message:', message,
    ...(extras.length ? ['', 'Otros campos / Other fields:', ...extras.map(([k, v]) => `${k}: ${v}`)] : []),
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
  try { json = text ? JSON.parse(text) : null; } catch (_) { /* respuesta no JSON */ }
  if (!r.ok) {
    const err = new Error(`Brevo ${path} respondió ${r.status}`);
    err.status = r.status;
    err.detail = json || text;
    throw err;
  }
  return json;
}

function sendNotification(data, listId, apiKey) {
  const supportEmail = process.env.SUPPORT_EMAIL || 'hola@centraliaportal.com';
  const { subject, htmlContent, textContent } = buildEmail(data, listId);
  return brevoPost('/smtp/email', {
    sender: { name: process.env.BREVO_SENDER_NAME || 'Flowmint', email: process.env.BREVO_SENDER_EMAIL || supportEmail },
    to: [{ email: supportEmail }],
    replyTo: { email: data.email, ...(data.name ? { name: data.name.slice(0, 100) } : {}) },
    subject, htmlContent, textContent,
    tags: ['flowmint-support'],
  }, apiKey);
}

function syncContact(data, listId, apiKey) {
  // Solo atributos con valor: con updateEnabled no queremos borrar un nombre existente con un vacío.
  const attributes = {};
  if (data.name) attributes.FIRSTNAME = data.name.slice(0, 100);
  if (data.recommendation) attributes.RECOMMENDATION = data.recommendation;
  return brevoPost('/contacts', {
    email: data.email,
    ...(Object.keys(attributes).length ? { attributes } : {}),
    listIds: [listId],
    updateEnabled: true,
  }, apiKey);
}

function setCors(req, res) {
  const allowed = (process.env.ALLOWED_ORIGINS || 'https://flowmint.centraliaportal.com').split(',').map((s) => s.trim()).filter(Boolean);
  const origin = req.headers && req.headers.origin;
  if (origin && allowed.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    console.error('[support] Falta la variable de entorno BREVO_API_KEY');
    return res.status(500).json({ ok: false, error: 'server_not_configured' });
  }

  const data = normalizePayload(parseBody(req.body));
  const invalid = validate(data);
  if (invalid) return res.status(400).json({ ok: false, error: invalid });

  const listId = resolveListId(data.source, req.headers);
  const [email, contact] = await Promise.allSettled([
    sendNotification(data, listId, apiKey),
    syncContact(data, listId, apiKey),
  ]);

  if (contact.status === 'rejected') {
    console.error('[support] Falló la sincronización del contacto:', contact.reason.status, JSON.stringify(contact.reason.detail));
  }
  if (email.status === 'rejected') {
    // Si el correo no salió, el mensaje no llegó a soporte: el frontend debe poder mostrar un fallback.
    console.error('[support] Falló el correo de notificación:', email.reason.status, JSON.stringify(email.reason.detail));
    return res.status(502).json({ ok: false, error: 'email_failed', contact: contact.status === 'fulfilled' ? 'synced' : 'failed' });
  }

  return res.status(200).json({ ok: true, email: 'sent', contact: contact.status === 'fulfilled' ? 'synced' : 'failed', listId });
}

module.exports = handler;
module.exports.normalizePayload = normalizePayload;
module.exports.resolveListId = resolveListId;
module.exports.buildEmail = buildEmail;
