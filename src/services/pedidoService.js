// Regras de negócio do EstuLanches.
// São funções "puras": recebem dados e devolvem resultado, sem acessar banco.
// Por isso são fáceis de testar (testes unitários).

const STATUS_VALIDOS = ['recebido', 'preparando', 'pronto', 'entregue', 'cancelado'];

// De qual status pode ir para qual (fluxo do pedido na cantina)
const TRANSICOES = {
  recebido: ['preparando', 'cancelado'],
  preparando: ['pronto', 'cancelado'],
  pronto: ['entregue'],
  entregue: [],
  cancelado: [],
};

const MAX_ITENS = 20;
const MAX_QUANTIDADE = 20;
const MAX_INT_POSTGRES = 2147483647;
const MAX_ESTOQUE = 10000;

// Os validadores devolvem null (tudo certo) ou uma mensagem de erro.

function validarCliente(cliente) {
  if (typeof cliente !== 'string') return 'O nome do cliente é obrigatório';
  const nome = cliente.trim();
  if (nome.length < 2 || nome.length > 80) {
    return 'O nome do cliente deve ter entre 2 e 80 caracteres';
  }
  return null;
}

function validarItens(itens) {
  if (!Array.isArray(itens) || itens.length === 0) {
    return 'O pedido precisa ter pelo menos 1 item';
  }
  if (itens.length > MAX_ITENS) {
    return `O pedido pode ter no máximo ${MAX_ITENS} itens`;
  }
  const somas = new Map(); // soma por produto (o mesmo produto pode aparecer em 2 linhas)
  for (const item of itens) {
    const idOk =
      item && Number.isInteger(item.produtoId) && item.produtoId > 0 && item.produtoId <= MAX_INT_POSTGRES;
    if (!idOk) return 'produtoId inválido';
    if (!Number.isInteger(item.quantidade) || item.quantidade < 1 || item.quantidade > MAX_QUANTIDADE) {
      return `A quantidade deve ser um número inteiro entre 1 e ${MAX_QUANTIDADE}`;
    }
    somas.set(item.produtoId, (somas.get(item.produtoId) || 0) + item.quantidade);
    if (somas.get(item.produtoId) > MAX_QUANTIDADE) {
      return `O máximo é ${MAX_QUANTIDADE} unidades de cada produto por pedido`;
    }
  }
  return null;
}

// Junta linhas repetidas do mesmo produto e ordena por id.
// (ordenar evita "deadlock" quando dois pedidos travam os mesmos produtos ao mesmo tempo)
function consolidarItens(itens) {
  const soma = new Map();
  for (const { produtoId, quantidade } of itens) {
    soma.set(produtoId, (soma.get(produtoId) || 0) + quantidade);
  }
  return [...soma]
    .map(([produtoId, quantidade]) => ({ produtoId, quantidade }))
    .sort((a, b) => a.produtoId - b.produtoId);
}

function validarProduto(produto) {
  const { nome, preco, categoria } = produto || {};
  if (typeof nome !== 'string' || nome.trim().length < 2 || nome.trim().length > 80) {
    return 'O nome do produto deve ter entre 2 e 80 caracteres';
  }
  if (typeof categoria !== 'string' || categoria.trim().length < 2 || categoria.trim().length > 40) {
    return 'A categoria deve ter entre 2 e 40 caracteres';
  }
  if (typeof preco !== 'number' || !Number.isFinite(preco) || preco <= 0 || preco > 1000) {
    return 'O preço deve ser um número maior que 0 e até 1000';
  }
  if (Math.abs(preco * 100 - Math.round(preco * 100)) > 1e-6) {
    return 'O preço pode ter no máximo 2 casas decimais';
  }
  const { estoque } = produto;
  if (estoque !== undefined && (!Number.isInteger(estoque) || estoque < 0 || estoque > MAX_ESTOQUE)) {
    return `O estoque inicial deve ser um número inteiro entre 0 e ${MAX_ESTOQUE}`;
  }
  return null;
}

// ---------- ESTOQUE ----------

// 'esgotado' (0), 'baixo' (até o mínimo) ou 'ok'
function classificarEstoque(estoque, minimo) {
  if (estoque <= 0) return 'esgotado';
  if (estoque <= minimo) return 'baixo';
  return 'ok';
}

// Confere cada item do pedido com o estoque atual. Devolve a lista de problemas
// (lista vazia = pode vender). Mostra TODOS os problemas de uma vez, não só o primeiro.
function verificarEstoque(itens, produtosPorId) {
  const problemas = [];
  for (const item of itens) {
    const p = produtosPorId.get(item.produtoId);
    if (!p) {
      problemas.push({ produtoId: item.produtoId, motivo: 'inexistente' });
    } else if (!p.disponivel) {
      problemas.push({ produtoId: p.id, nome: p.nome, motivo: 'indisponivel' });
    } else if (p.estoque <= 0) {
      problemas.push({ produtoId: p.id, nome: p.nome, motivo: 'esgotado' });
    } else if (p.estoque < item.quantidade) {
      problemas.push({
        produtoId: p.id,
        nome: p.nome,
        motivo: 'insuficiente',
        pedido: item.quantidade,
        restam: p.estoque,
      });
    }
  }
  return problemas;
}

// Mensagem clara para o cliente
function mensagemEstoque(problemas) {
  return problemas
    .map((p) => {
      if (p.motivo === 'inexistente') return `Produto ${p.produtoId} não existe`;
      if (p.motivo === 'indisponivel') return `${p.nome} não está disponível no momento`;
      if (p.motivo === 'esgotado') return `${p.nome} está esgotado`;
      return `${p.nome}: você pediu ${p.pedido}, mas restam apenas ${p.restam}`;
    })
    .join('; ');
}

// Reposição ("entrada") soma ao estoque; ajuste de contagem define o valor exato.
function validarMovimentacao(movimentacao) {
  const { tipo, quantidade, motivo } = movimentacao || {};
  if (tipo !== 'entrada' && tipo !== 'ajuste') return 'O tipo deve ser "entrada" ou "ajuste"';
  if (!Number.isInteger(quantidade)) return 'A quantidade deve ser um número inteiro';
  if (tipo === 'entrada' && (quantidade < 1 || quantidade > MAX_ESTOQUE)) {
    return `A reposição deve ser de 1 a ${MAX_ESTOQUE} unidades`;
  }
  if (tipo === 'ajuste' && (quantidade < 0 || quantidade > MAX_ESTOQUE)) {
    return `O estoque contado deve estar entre 0 e ${MAX_ESTOQUE}`;
  }
  if (motivo !== undefined && (typeof motivo !== 'string' || motivo.trim().length > 120)) {
    return 'O motivo deve ter até 120 caracteres';
  }
  if (tipo === 'ajuste' && (typeof motivo !== 'string' || motivo.trim().length < 3)) {
    return 'Informe o motivo do ajuste (mínimo de 3 caracteres)';
  }
  return null;
}

function calcularSaldo(tipo, atual, quantidade) {
  return tipo === 'entrada' ? atual + quantidade : quantidade;
}

// Calcula o total em CENTAVOS para evitar erro de ponto flutuante (0.1 + 0.2 !== 0.3)
function calcularTotal(linhas) {
  const centavos = linhas.reduce(
    (soma, linha) => soma + Math.round(linha.preco * 100) * linha.quantidade,
    0
  );
  return centavos / 100;
}

function statusValido(status) {
  return STATUS_VALIDOS.includes(status);
}

function podeMudarStatus(atual, novo) {
  return (TRANSICOES[atual] || []).includes(novo);
}

// Converte o :id da URL em número seguro. Devolve null se for inválido.
function idValido(valor) {
  if (!/^\d+$/.test(String(valor))) return null;
  const numero = Number(valor);
  return numero > 0 && numero <= MAX_INT_POSTGRES ? numero : null;
}

module.exports = {
  STATUS_VALIDOS,
  TRANSICOES,
  validarCliente,
  validarItens,
  validarProduto,
  consolidarItens,
  classificarEstoque,
  verificarEstoque,
  mensagemEstoque,
  validarMovimentacao,
  calcularSaldo,
  MAX_ESTOQUE,
  calcularTotal,
  statusValido,
  podeMudarStatus,
  idValido,
};
