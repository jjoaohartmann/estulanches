// Testes de INTEGRAÇÃO: sobem tudo junto (API + banco PostgreSQL reais) e
// fazem requisições HTTP de verdade. Rodam com o sistema no ar:
//   docker compose up -d --build
//   docker compose exec app npm run test:integration
const { test, before } = require('node:test');
const assert = require('node:assert/strict');

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const CHAVE = process.env.ADMIN_API_KEY;

// Função auxiliar: faz a requisição e devolve { status, json }
async function chamar(caminho, { metodo = 'GET', corpo, admin = false } = {}) {
  const headers = {};
  if (corpo !== undefined) headers['Content-Type'] = 'application/json';
  if (admin) headers['x-api-key'] = CHAVE;
  const resp = await fetch(BASE + caminho, {
    method: metodo,
    headers,
    body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
  });
  const json = await resp.json().catch(() => null);
  return { status: resp.status, json };
}

let produtos = [];
let pedidoId;

before(async () => {
  assert.ok(CHAVE, 'Defina ADMIN_API_KEY no ambiente (dentro do container ela já existe)');
  const { status } = await chamar('/health').catch(() => ({ status: 0 }));
  assert.equal(status, 200, `A API não respondeu em ${BASE}. Rode "docker compose up -d --build" antes.`);
});

test('GET /health: API e banco estão ok', async () => {
  const { status, json } = await chamar('/health');
  assert.equal(status, 200);
  assert.equal(json.status, 'ok');
  assert.equal(json.banco, 'ok');
});

test('GET /produtos: devolve o cardápio inicial', async () => {
  const { status, json } = await chamar('/produtos');
  assert.equal(status, 200);
  assert.ok(Array.isArray(json) && json.length >= 1);
  assert.equal(typeof json[0].preco, 'number');
  produtos = json;
});

test('POST /pedidos: cria pedido e calcula o total no servidor', async () => {
  const [p1, p2] = produtos;
  const esperado = Math.round((p1.preco * 2 + p2.preco * 1) * 100) / 100;

  const { status, json } = await chamar('/pedidos', {
    metodo: 'POST',
    corpo: {
      cliente: 'Teste Integração',
      itens: [
        { produtoId: p1.id, quantidade: 2 },
        { produtoId: p2.id, quantidade: 1 },
      ],
    },
  });
  assert.equal(status, 201);
  assert.equal(json.status, 'recebido');
  assert.equal(json.total, esperado);
  assert.equal(json.itens.length, 2);
  pedidoId = json.id;
});

test('GET /pedidos/:id: consulta o pedido criado (sem expor o nome do cliente)', async () => {
  const { status, json } = await chamar(`/pedidos/${pedidoId}`);
  assert.equal(status, 200);
  assert.equal(json.id, pedidoId);
  assert.equal(json.cliente, undefined);
  assert.equal(json.itens.length, 2);
});

test('POST /pedidos: rejeita quantidade inválida (400)', async () => {
  const { status, json } = await chamar('/pedidos', {
    metodo: 'POST',
    corpo: { cliente: 'Teste', itens: [{ produtoId: produtos[0].id, quantidade: 0 }] },
  });
  assert.equal(status, 400);
  assert.ok(json.erro);
});

test('POST /pedidos: rejeita produto que não existe (400)', async () => {
  const { status } = await chamar('/pedidos', {
    metodo: 'POST',
    corpo: { cliente: 'Teste', itens: [{ produtoId: 999999, quantidade: 1 }] },
  });
  assert.equal(status, 400);
});

test('GET /pedidos/abc: id inválido é barrado (400)', async () => {
  const { status } = await chamar('/pedidos/abc');
  assert.equal(status, 400);
});

test('Rotas de admin exigem a chave (401 sem chave, 200 com chave)', async () => {
  const sem = await chamar('/pedidos');
  assert.equal(sem.status, 401);

  const semProduto = await chamar('/produtos', {
    metodo: 'POST',
    corpo: { nome: 'Hacker', preco: 1, categoria: 'X' },
  });
  assert.equal(semProduto.status, 401);

  const com = await chamar('/pedidos', { admin: true });
  assert.equal(com.status, 200);
  assert.ok(com.json.some((p) => p.id === pedidoId));
});

test('PATCH /pedidos/:id/status: segue o fluxo e bloqueia pulos de etapa', async () => {
  const ok = await chamar(`/pedidos/${pedidoId}/status`, {
    metodo: 'PATCH',
    admin: true,
    corpo: { status: 'preparando' },
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.status, 'preparando');

  const pulo = await chamar(`/pedidos/${pedidoId}/status`, {
    metodo: 'PATCH',
    admin: true,
    corpo: { status: 'entregue' },
  });
  assert.equal(pulo.status, 409);

  const invalido = await chamar(`/pedidos/${pedidoId}/status`, {
    metodo: 'PATCH',
    admin: true,
    corpo: { status: 'voando' },
  });
  assert.equal(invalido.status, 400);

  // limpeza: cancela o pedido de teste para não aparecer na fila da cantina
  const cancelado = await chamar(`/pedidos/${pedidoId}/status`, {
    metodo: 'PATCH',
    admin: true,
    corpo: { status: 'cancelado' },
  });
  assert.equal(cancelado.status, 200);
});

// ---------------- ESTOQUE ----------------
// Estes testes criam um produto próprio (não mexem no estoque do cardápio real)
// e o retiram do cardápio no final.

let produtoTeste;

test('Estoque: rotas de estoque exigem a chave de administrador', async () => {
  assert.equal((await chamar('/produtos/estoque')).status, 401);
  assert.equal((await chamar('/produtos/movimentacoes')).status, 401);
  const semChave = await chamar('/produtos/1/estoque', { metodo: 'POST', corpo: { tipo: 'entrada', quantidade: 5 } });
  assert.equal(semChave.status, 401);
});

test('Estoque: cardápio mostra a quantidade e o produto novo nasce com o estoque informado', async () => {
  const criado = await chamar('/produtos', {
    metodo: 'POST',
    admin: true,
    corpo: { nome: 'Produto Teste Estoque', preco: 2.5, categoria: 'Testes', estoque: 3 },
  });
  assert.equal(criado.status, 201);
  assert.equal(criado.json.estoque, 3);
  produtoTeste = criado.json;

  const cardapio = await chamar('/produtos');
  const item = cardapio.json.find((p) => p.id === produtoTeste.id);
  assert.equal(item.estoque, 3);
});

test('Estoque: pedir 10 com 3 em estoque recusa o pedido e não mexe no estoque', async () => {
  const r = await chamar('/pedidos', {
    metodo: 'POST',
    corpo: { cliente: 'Teste Estoque', itens: [{ produtoId: produtoTeste.id, quantidade: 10 }] },
  });
  assert.equal(r.status, 409);
  assert.match(r.json.erro, /restam apenas 3/);

  const posicao = await chamar('/produtos/estoque', { admin: true });
  assert.equal(posicao.json.find((p) => p.id === produtoTeste.id).estoque, 3);
});

test('Estoque: venda dá baixa e cancelamento devolve ao estoque', async () => {
  const pedido = await chamar('/pedidos', {
    metodo: 'POST',
    corpo: { cliente: 'Teste Estoque', itens: [{ produtoId: produtoTeste.id, quantidade: 2 }] },
  });
  assert.equal(pedido.status, 201);

  let posicao = await chamar('/produtos/estoque', { admin: true });
  assert.equal(posicao.json.find((p) => p.id === produtoTeste.id).estoque, 1);

  const cancelado = await chamar(`/pedidos/${pedido.json.id}/status`, {
    metodo: 'PATCH',
    admin: true,
    corpo: { status: 'cancelado' },
  });
  assert.equal(cancelado.status, 200);

  posicao = await chamar('/produtos/estoque', { admin: true });
  assert.equal(posicao.json.find((p) => p.id === produtoTeste.id).estoque, 3);
});

test('Estoque: 5 clientes disputando 3 unidades ao mesmo tempo (sem vender a mais)', async () => {
  const corpo = { cliente: 'Concorrente', itens: [{ produtoId: produtoTeste.id, quantidade: 1 }] };
  const respostas = await Promise.all(
    Array.from({ length: 5 }, () => chamar('/pedidos', { metodo: 'POST', corpo }))
  );

  const aprovados = respostas.filter((r) => r.status === 201);
  const recusados = respostas.filter((r) => r.status === 409);
  assert.equal(aprovados.length, 3);
  assert.equal(recusados.length, 2);

  let posicao = await chamar('/produtos/estoque', { admin: true });
  const item = posicao.json.find((p) => p.id === produtoTeste.id);
  assert.equal(item.estoque, 0);
  assert.equal(item.situacaoEstoque, 'esgotado');

  // limpeza: cancela os pedidos de teste (o estoque volta)
  for (const a of aprovados) {
    await chamar(`/pedidos/${a.json.id}/status`, { metodo: 'PATCH', admin: true, corpo: { status: 'cancelado' } });
  }
  posicao = await chamar('/produtos/estoque', { admin: true });
  assert.equal(posicao.json.find((p) => p.id === produtoTeste.id).estoque, 3);
});

test('Estoque: reposição soma, ajuste exige motivo e tudo entra no histórico', async () => {
  const reposicao = await chamar(`/produtos/${produtoTeste.id}/estoque`, {
    metodo: 'POST',
    admin: true,
    corpo: { tipo: 'entrada', quantidade: 7, motivo: 'Compra de teste' },
  });
  assert.equal(reposicao.status, 200);
  assert.equal(reposicao.json.estoque, 10);

  const semMotivo = await chamar(`/produtos/${produtoTeste.id}/estoque`, {
    metodo: 'POST',
    admin: true,
    corpo: { tipo: 'ajuste', quantidade: 4 },
  });
  assert.equal(semMotivo.status, 400);

  const ajuste = await chamar(`/produtos/${produtoTeste.id}/estoque`, {
    metodo: 'POST',
    admin: true,
    corpo: { tipo: 'ajuste', quantidade: 4, motivo: 'Contagem de teste' },
  });
  assert.equal(ajuste.status, 200);
  assert.equal(ajuste.json.estoque, 4);
  assert.equal(ajuste.json.situacaoEstoque, 'baixo');

  const historico = await chamar('/produtos/movimentacoes', { admin: true });
  assert.equal(historico.status, 200);
  const tipos = historico.json.filter((m) => m.produto === 'Produto Teste Estoque').map((m) => m.tipo);
  assert.ok(tipos.includes('ajuste') && tipos.includes('entrada'));
});

test('Estoque: produto esgotado é recusado e produto fora do cardápio some da lista pública', async () => {
  await chamar(`/produtos/${produtoTeste.id}/estoque`, {
    metodo: 'POST',
    admin: true,
    corpo: { tipo: 'ajuste', quantidade: 0, motivo: 'Fim do teste' },
  });
  const esgotado = await chamar('/pedidos', {
    metodo: 'POST',
    corpo: { cliente: 'Teste', itens: [{ produtoId: produtoTeste.id, quantidade: 1 }] },
  });
  assert.equal(esgotado.status, 409);
  assert.match(esgotado.json.erro, /esgotado/);

  // limpeza: retira o produto de teste do cardápio
  const oculto = await chamar(`/produtos/${produtoTeste.id}/disponibilidade`, {
    metodo: 'PATCH',
    admin: true,
    corpo: { disponivel: false },
  });
  assert.equal(oculto.status, 200);
  const cardapio = await chamar('/produtos');
  assert.equal(cardapio.json.some((p) => p.id === produtoTeste.id), false);
});
