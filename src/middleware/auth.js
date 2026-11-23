// Proteção das rotas de administrador (painel da cantina).
// O cliente precisa enviar o cabeçalho:  x-api-key: <ADMIN_API_KEY>
const crypto = require('crypto');

function exigirAdmin(req, res, next) {
  const esperado = process.env.ADMIN_API_KEY || '';
  const recebido = req.get('x-api-key') || '';

  const a = Buffer.from(recebido);
  const b = Buffer.from(esperado);

  // timingSafeEqual compara em tempo constante (evita descobrir a chave por tempo de resposta)
  const ok = esperado.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);

  if (!ok) {
    return res.status(401).json({ erro: 'Não autorizado' });
  }
  return next();
}

module.exports = { exigirAdmin };
