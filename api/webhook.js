export default async function handler(req, res) {
  // Permitir solicitudes POST desde Hotmart
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Método no permitido' });
  }

  // Validar la firma de seguridad (Hottok)
  const hottokHeader = req.headers['x-hotmart-hottok'] || (req.body && req.body.hottok);
  const MY_HOTTOK = process.env.HOTMART_HOTTOK;

  if (MY_HOTTOK && hottokHeader !== MY_HOTTOK) {
    return res.status(401).json({ message: 'No autorizado: Hottok no coincide' });
  }

  // Responder a Hotmart con éxito (200 OK)
  return res.status(200).json({ 
    success: true, 
    message: 'Webhook de FlowMint recibido con éxito' 
  });
}
