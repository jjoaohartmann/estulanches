// Tratamento centralizado de erros: o cliente recebe uma mensagem limpa,
// e os detalhes técnicos ficam só no log do servidor (não vazam informações).

class ErroNegocio extends Error {
  constructor(mensagem, status = 400, detalhes) {
    super(mensagem);
    this.status = status;
    this.detalhes = detalhes; // opcional: lista com o que deu errado (ex.: itens sem estoque)
  }
}

// Express 4 não captura erros de funções async sozinho; este "embrulho" resolve.
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function rotaNaoEncontrada(req, res) {
  res.status(404).json({ erro: 'Rota não encontrada' });
}

// eslint-disable-next-line no-unused-vars
function tratarErros(err, req, res, next) {
  if (err instanceof ErroNegocio) {
    const corpo = err.detalhes ? { erro: err.message, detalhes: err.detalhes } : { erro: err.message };
    return res.status(err.status).json(corpo);
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ erro: 'JSON inválido' });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ erro: 'Corpo da requisição muito grande' });
  }
  console.error(
    JSON.stringify({
      hora: new Date().toISOString(),
      nivel: 'erro',
      mensagem: err.message,
      rota: req.originalUrl,
    })
  );
  return res.status(500).json({ erro: 'Erro interno do servidor' });
}

module.exports = { ErroNegocio, asyncHandler, rotaNaoEncontrada, tratarErros };
