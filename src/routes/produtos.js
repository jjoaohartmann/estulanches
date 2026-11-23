const router = require('express').Router();
const { query, comTransacao } = require('../db');
const { asyncHandler, ErroNegocio } = require('../middleware/erros');
const { exigirAdmin } = require('../middleware/auth');
const {
  validarProduto,
  validarMovimentacao,
  calcularSaldo,
  classificarEstoque,
  idValido,
  MAX_ESTOQUE,
} = require('../services/pedidoService');

const COLUNAS = 'id, nome, preco, categoria, disponivel, estoque, estoque_minimo';

const formatar = (p) => ({
  id: p.id,
  nome: p.nome,
  preco: Number(p.preco), // o Postgres devolve NUMERIC como texto; convertemos para número
  categoria: p.categoria,
  disponivel: p.disponivel,
  estoque: p.estoque,
  estoqueMinimo: p.estoque_minimo,
  situacaoEstoque: classificarEstoque(p.estoque, p.estoque_minimo),
});

// GET /produtos  -> cardápio (público). Itens esgotados continuam aparecendo, marcados como "Esgotado".
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `SELECT ${COLUNAS} FROM produtos WHERE disponivel = TRUE ORDER BY categoria, nome`
    );
    res.json(rows.map(formatar));
  })
);

// GET /produtos/estoque  -> posição de estoque de TODOS os produtos (admin)
router.get(
  '/estoque',
  exigirAdmin,
  asyncHandler(async (req, res) => {
    const { rows } = await query(`SELECT ${COLUNAS} FROM produtos ORDER BY categoria, nome`);
    res.json(rows.map(formatar));
  })
);

// GET /produtos/movimentacoes  -> últimas 20 movimentações de estoque (admin)
router.get(
  '/movimentacoes',
  exigirAdmin,
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `SELECT m.id, p.nome, m.tipo, m.quantidade, m.saldo_apos, m.pedido_id, m.motivo, m.criado_em
         FROM movimentacoes_estoque m
         JOIN produtos p ON p.id = m.produto_id
        ORDER BY m.id DESC
        LIMIT 20`
    );
    res.json(
      rows.map((m) => ({
        id: m.id,
        produto: m.nome,
        tipo: m.tipo,
        quantidade: m.quantidade,
        saldoApos: m.saldo_apos,
        pedidoId: m.pedido_id,
        motivo: m.motivo,
        criadoEm: m.criado_em,
      }))
    );
  })
);

// POST /produtos  -> cadastrar item no cardápio (admin). "estoque" inicial é opcional.
router.post(
  '/',
  exigirAdmin,
  asyncHandler(async (req, res) => {
    const erro = validarProduto(req.body);
    if (erro) throw new ErroNegocio(erro);

    const { nome, preco, categoria } = req.body;
    const estoque = req.body.estoque === undefined ? 0 : req.body.estoque;

    const produto = await comTransacao(async (conexao) => {
      const { rows } = await conexao.query(
        `INSERT INTO produtos (nome, preco, categoria, estoque) VALUES ($1, $2, $3, $4) RETURNING ${COLUNAS}`,
        [nome.trim(), preco, categoria.trim(), estoque]
      );
      if (estoque > 0) {
        await conexao.query(
          `INSERT INTO movimentacoes_estoque (produto_id, tipo, quantidade, saldo_apos, motivo)
           VALUES ($1, 'entrada', $2, $2, 'Estoque inicial')`,
          [rows[0].id, estoque]
        );
      }
      return rows[0];
    });

    res.status(201).json(formatar(produto));
  })
);

// POST /produtos/:id/estoque  -> reposição ou ajuste de contagem (admin)
// Corpo: { "tipo": "entrada", "quantidade": 20, "motivo": "Compra do fornecedor" }
//    ou  { "tipo": "ajuste",  "quantidade": 12, "motivo": "Contagem do fim do dia" }
router.post(
  '/:id/estoque',
  exigirAdmin,
  asyncHandler(async (req, res) => {
    const id = idValido(req.params.id);
    if (!id) throw new ErroNegocio('id inválido');
    const erro = validarMovimentacao(req.body);
    if (erro) throw new ErroNegocio(erro);

    const { tipo, quantidade } = req.body;
    const motivo =
      typeof req.body.motivo === 'string' && req.body.motivo.trim()
        ? req.body.motivo.trim()
        : 'Reposição de estoque';

    const produto = await comTransacao(async (conexao) => {
      // FOR UPDATE trava a linha: ninguém vende este produto enquanto ajustamos o estoque
      const { rows } = await conexao.query('SELECT estoque FROM produtos WHERE id = $1 FOR UPDATE', [id]);
      if (rows.length === 0) throw new ErroNegocio('Produto não encontrado', 404);

      const atual = rows[0].estoque;
      const saldo = calcularSaldo(tipo, atual, quantidade);
      if (saldo > MAX_ESTOQUE) {
        throw new ErroNegocio(`O estoque não pode passar de ${MAX_ESTOQUE} unidades`);
      }

      await conexao.query('UPDATE produtos SET estoque = $1 WHERE id = $2', [saldo, id]);
      await conexao.query(
        `INSERT INTO movimentacoes_estoque (produto_id, tipo, quantidade, saldo_apos, motivo)
         VALUES ($1, $2, $3, $4, $5)`,
        [id, tipo, saldo - atual, saldo, motivo]
      );
      const { rows: atualizado } = await conexao.query(`SELECT ${COLUNAS} FROM produtos WHERE id = $1`, [id]);
      return atualizado[0];
    });

    res.json(formatar(produto));
  })
);

// PATCH /produtos/:id/disponibilidade  -> tirar/colocar item no cardápio (admin)
router.patch(
  '/:id/disponibilidade',
  exigirAdmin,
  asyncHandler(async (req, res) => {
    const id = idValido(req.params.id);
    if (!id) throw new ErroNegocio('id inválido');
    if (typeof req.body.disponivel !== 'boolean') {
      throw new ErroNegocio('O campo "disponivel" deve ser true ou false');
    }

    const { rows } = await query(
      `UPDATE produtos SET disponivel = $1 WHERE id = $2 RETURNING ${COLUNAS}`,
      [req.body.disponivel, id]
    );
    if (rows.length === 0) throw new ErroNegocio('Produto não encontrado', 404);
    res.json(formatar(rows[0]));
  })
);

module.exports = router;
