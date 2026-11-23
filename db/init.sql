-- Criação das tabelas do EstuLanches (executa na primeira vez que o banco sobe)

CREATE TABLE IF NOT EXISTS produtos (
  id              SERIAL PRIMARY KEY,
  nome            VARCHAR(80)   NOT NULL,
  preco           NUMERIC(10,2) NOT NULL CHECK (preco > 0),
  categoria       VARCHAR(40)   NOT NULL,
  disponivel      BOOLEAN       NOT NULL DEFAULT TRUE,   -- "no cardápio" (a cantina pode retirar um item)
  estoque         INTEGER       NOT NULL DEFAULT 0 CHECK (estoque >= 0),  -- nunca fica negativo
  estoque_minimo  INTEGER       NOT NULL DEFAULT 5 CHECK (estoque_minimo >= 0)  -- abaixo disso = "estoque baixo"
);

CREATE TABLE IF NOT EXISTS pedidos (
  id         SERIAL PRIMARY KEY,
  cliente    VARCHAR(80)   NOT NULL,
  status     VARCHAR(20)   NOT NULL DEFAULT 'recebido'
             CHECK (status IN ('recebido','preparando','pronto','entregue','cancelado')),
  total      NUMERIC(10,2) NOT NULL CHECK (total >= 0),
  criado_em  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS itens_pedido (
  id              SERIAL PRIMARY KEY,
  pedido_id       INTEGER       NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  produto_id      INTEGER       NOT NULL REFERENCES produtos(id),
  quantidade      INTEGER       NOT NULL CHECK (quantidade > 0),
  preco_unitario  NUMERIC(10,2) NOT NULL   -- guarda o preço do momento da compra
);

-- Histórico (auditoria) de TODA mudança de estoque: quem vendeu, repôs, ajustou ou cancelou
CREATE TABLE IF NOT EXISTS movimentacoes_estoque (
  id          SERIAL PRIMARY KEY,
  produto_id  INTEGER      NOT NULL REFERENCES produtos(id),
  tipo        VARCHAR(20)  NOT NULL CHECK (tipo IN ('entrada','ajuste','venda','cancelamento')),
  quantidade  INTEGER      NOT NULL,   -- positivo = entrou, negativo = saiu
  saldo_apos  INTEGER      NOT NULL,   -- estoque depois da movimentação
  pedido_id   INTEGER      REFERENCES pedidos(id) ON DELETE SET NULL,
  motivo      VARCHAR(120),
  criado_em   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pedidos_status  ON pedidos(status);
CREATE INDEX IF NOT EXISTS idx_itens_pedido_id ON itens_pedido(pedido_id);
CREATE INDEX IF NOT EXISTS idx_mov_produto     ON movimentacoes_estoque(produto_id, id DESC);

-- Cardápio inicial (com estoque)
INSERT INTO produtos (nome, preco, categoria, estoque, estoque_minimo) VALUES
  ('Coxinha',                  6.50, 'Salgados', 30,  5),
  ('Pão de queijo',            4.00, 'Salgados', 40,  8),
  ('Esfiha de carne',          7.00, 'Salgados', 20,  5),
  ('Misto quente',             8.00, 'Salgados', 15,  5),
  ('Suco natural',             5.50, 'Bebidas',  25,  5),
  ('Água mineral',             3.00, 'Bebidas',  50, 10),
  ('Refrigerante lata',        5.00, 'Bebidas',  40, 10),
  ('Brigadeiro',               3.50, 'Doces',    30,  5),
  ('Bolo de cenoura (fatia)',  6.00, 'Doces',    12,  4),
  ('Fruta da estação',         4.50, 'Doces',    20,  5);

INSERT INTO movimentacoes_estoque (produto_id, tipo, quantidade, saldo_apos, motivo)
  SELECT id, 'entrada', estoque, estoque, 'Estoque inicial' FROM produtos;
