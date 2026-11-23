// Conexão com o PostgreSQL usando um "pool" (conjunto de conexões reaproveitadas).
// Isso é bem mais rápido e escalável do que abrir uma conexão nova a cada requisição.
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 5432,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  max: Number(process.env.DB_POOL_MAX) || 10,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error(
    JSON.stringify({ hora: new Date().toISOString(), nivel: 'erro', mensagem: `Pool: ${err.message}` })
  );
});

// Sempre usamos parâmetros ($1, $2...) => protege contra SQL Injection
const query = (texto, parametros) => pool.query(texto, parametros);

// TRANSAÇÃO: executa vários comandos como se fossem um só.
// Se qualquer um falhar (ou lançarmos um erro), TUDO é desfeito (ROLLBACK).
async function comTransacao(funcao) {
  const conexao = await pool.connect();
  try {
    await conexao.query('BEGIN');
    const resultado = await funcao(conexao);
    await conexao.query('COMMIT');
    return resultado;
  } catch (err) {
    await conexao.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    conexao.release(); // devolve a conexão para o pool
  }
}

module.exports = { pool, query, comTransacao };
