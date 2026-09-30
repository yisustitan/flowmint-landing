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

  const BREVO_ENDPOINT = 'https://api.brevo.com/v3/smtp/email';
  const brevoHeaders = {
    'api-key': BREVO_API_KEY,
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  };

  try {
    // ── A) SOPORTE / CONTACTO → Envío doble (Promise.all) ────────────────────
    if (tipo === 'soporte' || tipo === 'contacto') {
      const nombreDisplay = nombre || email;
      const mensajeHtml = (mensaje || '(sin mensaje)').replace(/\n/g, '<br>');

      // 1. Notificación interna de ticket al equipo
      const ticketPayload = {
        sender: { name: 'Soporte FlowMint', email: 'hola@centraliaportal.com' },
        to: [{ email: 'hola@centraliaportal.com' }],
        replyTo: { email: email },
        subject: `[Ticket ${tipo.charAt(0).toUpperCase() + tipo.slice(1)}] Nueva consulta de ${nombreDisplay}`,
        htmlContent: `<p><strong>Nombre:</strong> ${nombreDisplay}</p><p><strong>Email:</strong> ${email}</p><p><strong>Tipo:</strong> ${tipo}</p><hr><p><strong>Mensaje:</strong></p><p>${mensajeHtml}</p>`
      };

      // 2. Auto-confirmación inmediata al cliente
      const autoReplyPayload = {
        sender: { name: 'Soporte FlowMint', email: 'hola@centraliaportal.com' },
        to: [{ email: email }],
        subject: 'Hemos recibido tu consulta - Flowmint',
        htmlContent: `<p>Hola ${nombreDisplay},</p><p>Hemos recibido tu consulta correctamente. Nuestro equipo de soporte te responderá directamente a este correo a la brevedad posible.</p><p>Atentamente,<br>El equipo de Flowmint</p>`
      };

      await Promise.all([
        fetch(BREVO_ENDPOINT, { method: 'POST', headers: brevoHeaders, body: JSON.stringify(ticketPayload) }),
        fetch(BREVO_ENDPOINT, { method: 'POST', headers: brevoHeaders, body: JSON.stringify(autoReplyPayload) })
      ]);

      return res.status(200).json({ success: true, message: 'Consulta recibida. Te hemos enviado una confirmación.' });
    }

    // ── B) FEEDBACK / SUGERENCIA / RATING → Envío único (solo equipo) ────────
    if (tipo === 'feedback' || tipo === 'sugerencia' || tipo === 'rating') {
      const nombreDisplay = nombre || email;
      const mensajeHtml = (mensaje || '(sin comentario)').replace(/\n/g, '<br>');
      const valoracion = estrellas ? `${estrellas} / 5` : 'No especificada';

      const feedbackPayload = {
        sender: { name: 'FlowMint Feedback', email: 'hola@centraliaportal.com' },
        to: [{ email: 'hola@centraliaportal.com' }],
        replyTo: { email: email },
        subject: `[${tipo.charAt(0).toUpperCase() + tipo.slice(1)}] Valoracion de ${nombreDisplay} — ${valoracion}`,
        htmlContent: `<p><strong>Usuario:</strong> ${nombreDisplay} (${email})</p><p><strong>Tipo:</strong> ${tipo}</p><p><strong>Valoracion:</strong> ${valoracion}</p><hr><p><strong>Comentario:</strong></p><p>${mensajeHtml}</p>`
      };

      const response = await fetch(BREVO_ENDPOINT, {
        method: 'POST',
        headers: brevoHeaders,
        body: JSON.stringify(feedbackPayload)
      });

      if (!response.ok) {
        const errorData = await response.text();
        console.error('Brevo Error (feedback):', errorData);
        return res.status(response.status).json({ success: false, message: 'Error enviando feedback por Brevo', error: errorData });
      }

      // NO se envia correo al cliente — HTTP 200 para mostrar agradecimiento en pantalla
      return res.status(200).json({ success: true, message: 'Gracias por tu valoracion!' });
    }

    // ── C) Tipo no reconocido ─────────────────────────────────────────────────
    return res.status(400).json({ success: false, message: `Tipo de formulario no reconocido: "${tipo || 'undefined'}"` });

  } catch (err) {
    console.error('Webhook error:', err);
    return res.status(500).json({ success: false, message: 'Error interno del servidor.' });
  }
}