export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Método no permitido' });
  }

  // 1. Validar si es un Webhook de Hotmart (por el token)
  const hottokHeader = req.headers['x-hotmart-hottok'] || (req.body && req.body.hottok);
  const MY_HOTTOK = process.env.HOTMART_HOTTOK;

  if (hottokHeader) {
    if (MY_HOTTOK && hottokHeader !== MY_HOTTOK) {
      return res.status(401).json({ message: 'No autorizado: Hottok no coincide' });
    }
    return res.status(200).json({ success: true, message: 'Webhook de FlowMint recibido con éxito' });
  }

  // 2. Si no es de Hotmart, validar que sea del formulario de soporte
  const { email, subject, message } = req.body || {};

  if (email && message) {
    try {
      const BREVO_API_KEY = process.env.BREVO_API_KEY;
      if (!BREVO_API_KEY) {
        return res.status(500).json({ success: false, message: 'Falta configurar BREVO_API_KEY en el servidor.' });
      }

      const brevoPayload = {
        sender: { name: "Soporte FlowMint", email: "hola@centraliaportal.com" },
        to: [{ email: "hola@centraliaportal.com" }],
        replyTo: { email: email },
        subject: subject || "Consulta Soporte Reseller VIP",
        htmlContent: <p><strong>Email del cliente:</strong> +email+</p><p><strong>Mensaje:</strong></p><p>+message.replace(/\n/g, '<br>')+</p>
      };

      const response = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'api-key': BREVO_API_KEY,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(brevoPayload)
      });

      if (!response.ok) {
        const errorData = await response.text();
        console.error('Brevo Error:', errorData);
        return res.status(response.status).json({ success: false, message: 'Error enviando correo por Brevo', error: errorData });
      }

      // Enviar template al cliente como respuesta automática
      const autoReplyPayload = {
        sender: { name: "Soporte FlowMint", email: "hola@centraliaportal.com" },
        to: [{ email: email }],
        subject: "Hemos recibido tu solicitud de soporte",
        htmlContent: <p>Hola,</p><p>Hemos recibido tu consulta de soporte: <strong>+subject+</strong>.</p><p>Nuestro equipo lo revisará y te contactará a la brevedad posible a través de este correo.</p><p>Mensaje enviado:<br/><em>+message.replace(/\n/g, '<br>')+</em></p><p>Saludos,<br/>El equipo de FlowMint</p>
      };
      
      await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'api-key': BREVO_API_KEY,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(autoReplyPayload)
      });

      return res.status(200).json({ success: true, message: 'Correo de soporte enviado con éxito por Brevo' });
    } catch (err) {
      console.error('Webhook error:', err);
      return res.status(500).json({ success: false, message: 'Error interno del servidor.' });
    }
  }

  // 3. Fallback
  return res.status(400).json({ success: false, message: 'Petición no reconocida' });
}
