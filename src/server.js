// Ponto de entrada: valida a configuração, liga o servidor e trata o desligamento.
const { version } = require('../package.json');

const obrigatorias = ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME', 'ADMIN_API_KEY'];
const faltando = obrigatorias.filter((nome) => !process.env[nome]);
const log = (nivel, mensagem) =>
  console.log(JSON.stringify({ hora: new Date().toISOString(), nivel, mensagem }));

// "Falhar rápido": se faltar configuração, nem sobe (melhor do que subir quebrado)
if (faltando.length > 0) {
  log('erro', `Variáveis de ambiente faltando: ${faltando.join(', ')}`);
  process.exit(1);
}
if (process.env.ADMIN_API_KEY.length < 16) {
  log('erro', 'ADMIN_API_KEY precisa ter pelo menos 16 caracteres');
  process.exit(1);
}

const app = require('./app');
const { pool } = require('./db');

const PORT = Number(process.env.PORT) || 3000;
const servidor = app.listen(PORT, () => log('info', `EstuLanches v${version} rodando na porta ${PORT}`));

// Desligamento gracioso: o "docker stop" envia SIGTERM; terminamos os pedidos em andamento
function encerrar(sinal) {
  log('info', `${sinal} recebido. Encerrando...`);
  servidor.close(async () => {
    await pool.end();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref(); // se travar, força a saída em 10s
}
process.on('SIGTERM', () => encerrar('SIGTERM'));
process.on('SIGINT', () => encerrar('SIGINT'));
