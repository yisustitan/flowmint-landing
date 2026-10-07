export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Método no permitido' });
  }

  // ── 1. Webhook de Hotmart (token propio) ──────────────────────────────────
  const hottokHeader = req.headers['x-hotmart-hottok'] || (req.body && req.body.hottok);
  const MY_HOTTOK = process.env.HOTMART_HOTTOK;

  if (hottokHeader) {
    if (MY_HOTTOK && hottokHeader !== MY_HOTTOK) {
      return res.status(401).json({ message: 'No autorizado: Hottok no coincide' });
    }
    return res.status(200).json({ success: true, message: 'Webhook de FlowMint recibido con éxito' });
  }

  // ── 2. Formularios del frontend ───────────────────────────────────────────
  const { nombre, email, mensaje, tipo, estrellas } = req.body || {};

  // Validación mínima
  if (!email) {
    return res.status(400).json({ success: false, message: 'Falta el campo email.' });
  }

  const BREVO_API_KEY = process.env.BREVO_API_KEY;
  if (!BREVO_API_KEY) {
    return res.status(500).json({ success: false, message: 'Falta configurar BREVO_API_KEY en el servidor.' });
  }

  const BREVO_EMAIL_ENDPOINT = 'https://api.brevo.com/v3/smtp/email';
  const BREVO_CONTACTS_ENDPOINT = 'https://api.brevo.com/v3/contacts';
  const brevoHeaders = {
    'api-key': BREVO_API_KEY,
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  };

  try {
    const nombreDisplay = nombre || email;
    const mensajeHtml = (mensaje || '(sin mensaje)').replace(/\n/g, '<br>');
    const valoracion = estrellas ? `${estrellas} / 5` : '';

    // ── 1. Registro en Brevo Contacts ──────────────────────────────────────
    let origen = 'Contacto_General';
    if (tipo === 'soporte') origen = 'Soporte_VIP';
    else if (tipo === 'feedback' || tipo === 'rating' || tipo === 'sugerencia') origen = 'Feedback_App';

    let attributes = {
      NOMBRE: nombre || '',
      ORIGEN: origen
    };
    if (estrellas) attributes.RATING = estrellas.toString();

    const contactPayload = {
      email: email,
      attributes: attributes,
      updateEnabled: true
    };

    // ── 2. Notificación Interna ─────────────────────────────────────────────
    let subjectInterno = `[Ticket ${tipo.charAt(0).toUpperCase() + tipo.slice(1)}] Nueva consulta de ${nombreDisplay}`;
    let htmlInterno = `<p><strong>Nombre:</strong> ${nombreDisplay}</p><p><strong>Email:</strong> ${email}</p><p><strong>Tipo:</strong> ${tipo}</p>`;
    if (valoracion) htmlInterno += `<p><strong>Valoracion:</strong> ${valoracion}</p>`;
    htmlInterno += `<hr><p><strong>Mensaje:</strong></p><p>${mensajeHtml}</p>`;

    const ticketPayload = {
      sender: { name: 'Sistema FlowMint', email: 'hola@centraliaportal.com' },
      to: [{ email: 'hola@centraliaportal.com' }],
      replyTo: { email: email },
      subject: subjectInterno,
      htmlContent: htmlInterno
    };

    // ── 3. Autorrespuesta al Usuario ─────────────────────────────────────────
    let subjectAuto = 'Hemos recibido tu solicitud - Flowmint';
    let htmlAuto = `<p>Hola ${nombreDisplay},</p><p>Hemos recibido tu mensaje correctamente.</p>`;
    
    if (origen === 'Soporte_VIP' || origen === 'Contacto_General') {
      htmlAuto += `<p>Nuestro equipo de soporte te responderá directamente a este correo a la brevedad posible.</p>`;
    } else {
      htmlAuto += `<p>Agradecemos mucho tus comentarios y valoración. Tu opinión nos ayuda a construir la mejor herramienta para ti.</p>`;
    }
    htmlAuto += `<p>Atentamente,<br>El equipo de Flowmint</p>`;

    const autoReplyPayload = {
      sender: { name: 'Soporte FlowMint', email: 'hola@centraliaportal.com' },
      to: [{ email: email }],
      subject: subjectAuto,
      htmlContent: htmlAuto
    };

    // Ejecutar las 3 peticiones en paralelo
    await Promise.all([
      fetch(BREVO_CONTACTS_ENDPOINT, { method: 'POST', headers: brevoHeaders, body: JSON.stringify(contactPayload) }).catch(e => console.error('Error creando contacto', e)),
      fetch(BREVO_EMAIL_ENDPOINT, { method: 'POST', headers: brevoHeaders, body: JSON.stringify(ticketPayload) }).catch(e => console.error('Error ticket interno', e)),
      fetch(BREVO_EMAIL_ENDPOINT, { method: 'POST', headers: brevoHeaders, body: JSON.stringify(autoReplyPayload) }).catch(e => console.error('Error autorespuesta', e))
    ]);

    return res.status(200).json({ success: true, message: 'Solicitud procesada correctamente.' });

  } catch (err) {
    console.error('Webhook error:', err);
    return res.status(500).json({ success: false, message: 'Error interno del servidor.' });
  }
}