const router = require('express').Router();
const { query, comTransacao } = require('../db');
const { asyncHandler, ErroNegocio } = require('../middleware/erros');
const { exigirAdmin } = require('../middleware/auth');
const {
  validarCliente,
  validarItens,
  consolidarItens,
  verificarEstoque,
  mensagemEstoque,
  calcularTotal,
  statusValido,
  podeMudarStatus,
  idValido,
} = require('../services/pedidoService');

// POST /pedidos  -> criar pedido (público)
// Corpo: { "cliente": "Maria", "itens": [ { "produtoId": 1, "quantidade": 2 } ] }
// Se algum item não tiver estoque suficiente, o pedido INTEIRO é recusado (409) e nada é gravado.
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const { cliente, itens } = req.body;

    const erro = validarCliente(cliente) || validarItens(itens);
    if (erro) throw new ErroNegocio(erro);

    const consolidados = consolidarItens(itens);
    const nomeCliente = cliente.trim();

    // Tudo dentro de UMA transação: ou o pedido e a baixa de estoque acontecem juntos, ou nada acontece.
    const resultado = await comTransacao(async (conexao) => {
      // FOR UPDATE trava as linhas dos produtos até o fim da transação.
      // Assim, dois clientes comprando a última coxinha ao mesmo tempo NÃO vendem a mesma unidade duas vezes.
      // (ORDER BY id: todos travam na mesma ordem, o que evita deadlock)
      const { rows: produtos } = await conexao.query(
        `SELECT id, nome, preco, disponivel, estoque
           FROM produtos
          WHERE id = ANY($1::int[])
          ORDER BY id
            FOR UPDATE`,
        [consolidados.map((i) => i.produtoId)]
      );
      const porId = new Map(produtos.map((p) => [p.id, p]));

      const problemas = verificarEstoque(consolidados, porId);
      if (problemas.length > 0) {
        const status = problemas.some((p) => p.motivo === 'inexistente') ? 400 : 409;
        throw new ErroNegocio(mensagemEstoque(problemas), status, problemas);
      }

      // O PREÇO vem do banco, nunca do cliente
      const linhas = consolidados.map((item) => {
        const produto = porId.get(item.produtoId);
        return {
          produtoId: produto.id,
          nome: produto.nome,
          preco: Number(produto.preco),
          quantidade: item.quantidade,
          saldoApos: produto.estoque - item.quantidade,
        };
      });
      const total = calcularTotal(linhas);

      const { rows } = await conexao.query(
        'INSERT INTO pedidos (cliente, total) VALUES ($1, $2) RETURNING id, status, criado_em',
        [nomeCliente, total]
      );
      const pedido = rows[0];

      for (const linha of linhas) {
        await conexao.query(
          'INSERT INTO itens_pedido (pedido_id, produto_id, quantidade, preco_unitario) VALUES ($1, $2, $3, $4)',
          [pedido.id, linha.produtoId, linha.quantidade, linha.preco]
        );
        // baixa no estoque (o CHECK estoque >= 0 do banco é a última barreira de segurança)
        await conexao.query('UPDATE produtos SET estoque = estoque - $1 WHERE id = $2', [
          linha.quantidade,
          linha.produtoId,
        ]);
        await conexao.query(
          `INSERT INTO movimentacoes_estoque (produto_id, tipo, quantidade, saldo_apos, pedido_id, motivo)
           VALUES ($1, 'venda', $2, $3, $4, $5)`,
          [linha.produtoId, -linha.quantidade, linha.saldoApos, pedido.id, `Pedido #${pedido.id}`]
        );
      }

      return { pedido, linhas, total };
    });

    res.status(201).json({
      id: resultado.pedido.id,
      cliente: nomeCliente,
      status: resultado.pedido.status,
      total: resultado.total,
      criadoEm: resultado.pedido.criado_em,
      itens: resultado.linhas.map((l) => ({ nome: l.nome, quantidade: l.quantidade, preco: l.preco })),
    });
  })
);

// GET /pedidos  -> listar pedidos (admin). Filtro opcional: ?status=recebido
router.get(
  '/',
  exigirAdmin,
  asyncHandler(async (req, res) => {
    const { status } = req.query;
    if (status !== undefined && !statusValido(status)) {
      throw new ErroNegocio('status inválido');
    }

    const filtro = status ? 'WHERE status = $1' : '';
    const params = status ? [status] : [];
    const { rows } = await query(
      `SELECT id, cliente, status, total, criado_em FROM pedidos ${filtro} ORDER BY criado_em DESC LIMIT 50`,
      params
    );
    res.json(
      rows.map((p) => ({
        id: p.id,
        cliente: p.cliente,
        status: p.status,
        total: Number(p.total),
        criadoEm: p.criado_em,
      }))
    );
  })
);

// GET /pedidos/:id  -> acompanhar pedido (público). Não devolve o nome do cliente (privacidade).
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = idValido(req.params.id);
    if (!id) throw new ErroNegocio('id inválido');

    const { rows } = await query('SELECT id, status, total, criado_em FROM pedidos WHERE id = $1', [id]);
    if (rows.length === 0) throw new ErroNegocio('Pedido não encontrado', 404);

    const { rows: itens } = await query(
      `SELECT pr.nome, ip.quantidade, ip.preco_unitario
         FROM itens_pedido ip
         JOIN produtos pr ON pr.id = ip.produto_id
        WHERE ip.pedido_id = $1
        ORDER BY ip.id`,
      [id]
    );

    res.json({
      id: rows[0].id,
      status: rows[0].status,
      total: Number(rows[0].total),
      criadoEm: rows[0].criado_em,
      itens: itens.map((i) => ({
        nome: i.nome,
        quantidade: i.quantidade,
        preco: Number(i.preco_unitario),
      })),
    });
  })
);

// PATCH /pedidos/:id/status  -> avançar o pedido (admin). Corpo: { "status": "preparando" }
// Ao CANCELAR, os itens voltam para o estoque automaticamente.
router.patch(
  '/:id/status',
  exigirAdmin,
  asyncHandler(async (req, res) => {
    const id = idValido(req.params.id);
    if (!id) throw new ErroNegocio('id inválido');

    const novo = req.body.status;
    if (!statusValido(novo)) throw new ErroNegocio('status inválido');

    const atualizado = await comTransacao(async (conexao) => {
      // trava o pedido: duas pessoas mexendo ao mesmo tempo não conseguem cancelar (e devolver estoque) duas vezes
      const { rows } = await conexao.query('SELECT status FROM pedidos WHERE id = $1 FOR UPDATE', [id]);
      if (rows.length === 0) throw new ErroNegocio('Pedido não encontrado', 404);

      const atual = rows[0].status;
      if (!podeMudarStatus(atual, novo)) {
        throw new ErroNegocio(`Não é possível mudar de "${atual}" para "${novo}"`, 409);
      }

      const { rows: resultado } = await conexao.query(
        'UPDATE pedidos SET status = $1 WHERE id = $2 RETURNING id, status',
        [novo, id]
      );

      if (novo === 'cancelado') {
        const { rows: itens } = await conexao.query(
          'SELECT produto_id, quantidade FROM itens_pedido WHERE pedido_id = $1 ORDER BY produto_id',
          [id]
        );
        for (const item of itens) {
          const { rows: produto } = await conexao.query(
            'UPDATE produtos SET estoque = estoque + $1 WHERE id = $2 RETURNING estoque',
            [item.quantidade, item.produto_id]
          );
          await conexao.query(
            `INSERT INTO movimentacoes_estoque (produto_id, tipo, quantidade, saldo_apos, pedido_id, motivo)
             VALUES ($1, 'cancelamento', $2, $3, $4, $5)`,
            [item.produto_id, item.quantidade, produto[0].estoque, id, `Pedido #${id} cancelado`]
          );
        }
      }

      return resultado[0];
    });

    res.json(atualizado);
  })
);

module.exports = router;
