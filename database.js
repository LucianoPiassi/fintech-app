const { Pool } = require('pg');

//A MÁGICA ACONTECE AQUI:
// O código busca a variável "DATABASE_URL" dentro do ambiente (process.env)
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
    console.error("ERRO CRÍTICO: Variável DATABASE_URL não encontrada no .env");
}

const pool = new Pool({
    connectionString,
    // ssl: { rejectUnauthorized: false } // Lembre-se: Descomentar isso só na produção (Render/Railway)
});


// STRING DE CONEXÃO: antiga, usando senha explicita
// Formato: postgres://usuario:senha@host:porta/nome_banco
// Exemplo Local: postgres://postgres:123456@localhost:5432/fintech
// EM PRODUÇÃO (Render/Railway), isso virá automaticamente da variável de ambiente DATABASE_URL
//const connectionString = process.env.DATABASE_URL || 'postgres://postgres:26002124@localhost:5432/fintech';

//const pool = new Pool({
    connectionString,
    // ssl: { rejectUnauthorized: false } // Descomentar essa linha apenas ao subir para PRODUÇÃO (Render/Heroku)
//});

console.log('--- Conectando ao PostgreSQL ---');

const initDb = async () => {
    try {
        const client = await pool.connect();
        
        // 1. Tabela de Usuários (SERIAL substitui AUTOINCREMENT)
        await client.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL
            )
        `);

        // 2. Tabela de Contas
        await client.query(`
            CREATE TABLE IF NOT EXISTS accounts (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                name TEXT NOT NULL,
                bank_name TEXT,
                initial_balance INTEGER DEFAULT 0
            )
        `);

        // 3. Categorias
        await client.query(`
            CREATE TABLE IF NOT EXISTS categories (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                name TEXT NOT NULL,
                type TEXT CHECK(type IN ('INCOME', 'EXPENSE')) NOT NULL
            )
        `);

        // 4. Transações
        await client.query(`
            CREATE TABLE IF NOT EXISTS transactions (
                id SERIAL PRIMARY KEY,
                account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
                description TEXT NOT NULL,
                amount INTEGER NOT NULL,
                type TEXT CHECK(type IN ('INCOME', 'EXPENSE')) NOT NULL,
                category TEXT DEFAULT 'Outros',
                date DATE NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        client.release();
        console.log('Tabelas Verificadas/Criadas com Sucesso!');
    } catch (err) {
        console.error('Erro ao conectar/criar tabelas:', err);
    }
};

initDb();

module.exports = {
    query: (text, params) => pool.query(text, params),
};