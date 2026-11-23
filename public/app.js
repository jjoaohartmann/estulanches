'use strict';
// Tela do aluno: ver cardápio (com estoque), montar o pedido, enviar e acompanhar.
// Obs.: usamos textContent (e não innerHTML) para evitar XSS.

const MAX_POR_PRODUTO = 20;
const reais = (v) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const ROTULOS = {
  recebido: 'Recebido',
  preparando: 'Em preparo',
  pronto: 'Pronto para retirar!',
  entregue: 'Entregue',
  cancelado: 'Cancelado',
};

const carrinho = new Map(); // id do produto -> { produto, quantidade }
const linhasTela = new Map(); // id do produto -> { produto, contador, menos, mais }

function criar(tag, texto, classe) {
  const elemento = document.createElement(tag);
  if (texto !== undefined) elemento.textContent = texto;
  if (classe) elemento.className = classe;
  return elemento;
}

function mostrar(id, texto, erro) {
  const el = document.getElementById(id);
  el.textContent = texto;
  el.className = erro ? 'erro' : 'ok';
}

// Quantidade máxima que o cliente pode pedir deste produto (estoque ou limite por pedido)
const limiteDe = (produto) => Math.min(MAX_POR_PRODUTO, produto.estoque);

function alterarQuantidade(produto, delta) {
  const atual = carrinho.has(produto.id) ? carrinho.get(produto.id).quantidade : 0;
  const nova = Math.min(limiteDe(produto), Math.max(0, atual + delta));
  if (nova === 0) carrinho.delete(produto.id);
  else carrinho.set(produto.id, { produto, quantidade: nova });
  atualizarTela();
}

function atualizarTela() {
  // quantidade e botões de cada item do cardápio
  for (const [id, linha] of linhasTela) {
    const quantidade = carrinho.has(id) ? carrinho.get(id).quantidade : 0;
    linha.contador.textContent = quantidade;
    linha.menos.disabled = quantidade === 0;
    linha.mais.disabled = quantidade >= limiteDe(linha.produto); // chegou no estoque: não deixa passar
  }
  // resumo do pedido
  const lista = document.getElementById('resumo');
  lista.replaceChildren();
  let total = 0;
  for (const { produto, quantidade } of carrinho.values()) {
    total += produto.preco * quantidade;
    lista.append(criar('li', `${quantidade}x ${produto.nome} — ${reais(produto.preco * quantidade)}`));
  }
  document.getElementById('total').textContent = reais(total);
  document.getElementById('total-mini').textContent = reais(total);
}

function criarItem(produto) {
  const esgotado = produto.estoque <= 0;
  const item = criar('li', undefined, esgotado ? 'item esgotado' : 'item');

  // nome [etiqueta] ........ preço
  const linha = criar('div', undefined, 'linha');
  linha.append(criar('span', produto.nome, 'nome'));
  if (esgotado) {
    linha.append(criar('span', 'Esgotado', 'etiqueta esgotado'));
  } else if (produto.estoque <= produto.estoqueMinimo) {
    linha.append(criar('span', `Restam ${produto.estoque}`, 'etiqueta baixo'));
  }
  const pontilhado = criar('span', undefined, 'pontilhado');
  pontilhado.setAttribute('aria-hidden', 'true');
  linha.append(pontilhado, criar('span', reais(produto.preco), 'preco'));

  // botões − 0 +
  const controles = criar('div', undefined, 'controles');
  const menos = criar('button', '−');
  const mais = criar('button', '+');
  const contador = criar('span', '0');
  menos.type = mais.type = 'button';
  menos.setAttribute('aria-label', `Remover ${produto.nome}`);
  mais.setAttribute('aria-label', `Adicionar ${produto.nome}`);
  menos.addEventListener('click', () => alterarQuantidade(produto, -1));
  mais.addEventListener('click', () => alterarQuantidade(produto, +1));
  controles.append(menos, contador, mais);

  linhasTela.set(produto.id, { produto, contador, menos, mais });
  item.append(linha, controles);
  return item;
}

async function carregarCardapio() {
  const area = document.getElementById('cardapio');
  try {
    const resp = await fetch('/produtos');
    const produtos = await resp.json();

    // O estoque pode ter mudado: ajusta o pedido em andamento ao que existe agora
    for (const [id, linha] of [...carrinho]) {
      const atual = produtos.find((p) => p.id === id);
      if (!atual || atual.estoque <= 0) carrinho.delete(id);
      else carrinho.set(id, { produto: atual, quantidade: Math.min(linha.quantidade, limiteDe(atual)) });
    }

    area.replaceChildren();
    linhasTela.clear();
    const categorias = [...new Set(produtos.map((p) => p.categoria))];
    for (const categoria of categorias) {
      area.append(criar('h3', categoria));
      const lista = criar('ul', undefined, 'lista');
      for (const produto of produtos.filter((p) => p.categoria === categoria)) {
        lista.append(criarItem(produto));
      }
      area.append(lista);
    }
    atualizarTela();
  } catch {
    area.textContent = 'Não foi possível carregar o cardápio. Atualize a página.';
  }
}

async function enviarPedido() {
  const cliente = document.getElementById('cliente').value.trim();
  if (carrinho.size === 0) return mostrar('mensagem', 'Escolha pelo menos um item.', true);
  if (cliente.length < 2) return mostrar('mensagem', 'Informe o seu nome.', true);

  const itens = [...carrinho.values()].map(({ produto, quantidade }) => ({
    produtoId: produto.id,
    quantidade,
  }));

  try {
    const resp = await fetch('/pedidos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cliente, itens }),
    });
    const dados = await resp.json();

    if (!resp.ok) {
      if (resp.status === 409) {
        // Sem estoque: o pedido NÃO foi registrado. Atualiza o cardápio e avisa o cliente.
        await carregarCardapio();
        return mostrar('mensagem', `Pedido não enviado. ${dados.erro}. Ajustamos seu pedido ao estoque atual.`, true);
      }
      return mostrar('mensagem', dados.erro || 'Erro ao enviar o pedido.', true);
    }

    carrinho.clear();
    document.getElementById('numero').value = dados.id;
    await carregarCardapio(); // o estoque mudou
    return mostrar('mensagem', `Pedido #${dados.id} enviado! Total: ${reais(dados.total)}`, false);
  } catch {
    return mostrar('mensagem', 'Sem conexão com o servidor.', true);
  }
}

async function consultarPedido() {
  const numero = document.getElementById('numero').value.trim();
  if (!/^\d+$/.test(numero)) return mostrar('status-pedido', 'Digite o número do pedido.', true);
  try {
    const resp = await fetch(`/pedidos/${numero}`);
    const dados = await resp.json();
    if (!resp.ok) return mostrar('status-pedido', dados.erro || 'Pedido não encontrado.', true);
    return mostrar(
      'status-pedido',
      `Pedido #${dados.id}: ${ROTULOS[dados.status] || dados.status} (${reais(dados.total)})`,
      false
    );
  } catch {
    return mostrar('status-pedido', 'Sem conexão com o servidor.', true);
  }
}

document.getElementById('enviar').addEventListener('click', enviarPedido);
document.getElementById('consultar').addEventListener('click', consultarPedido);
carregarCardapio();
