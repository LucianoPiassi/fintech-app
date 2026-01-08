require('dotenv').config(); // <--- ADICIONE ISSO NA LINHA 1
const express = require('express');
const bodyParser = require('body-parser');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('./database'); // Agora usa o Pool do PG
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000; // Importante para o Render/Heroku
//const SECRET_KEY = "chave_secreta_v7_postgres";
// Procure onde definimos a SECRET_KEY e mude para:
const SECRET_KEY = process.env.SECRET_KEY;
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// Middleware Auth
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.sendStatus(401);
    jwt.verify(token, SECRET_KEY, (err, user) => {
        if (err) return res.sendStatus(403);
        req.user = user;
        next();
    });
}

// --- AUTH ---
app.post('/auth/register', async (req, res) => {
    const { username, password } = req.body;
    try {
        const hash = await bcrypt.hash(password, 10);
        // Postgres usa RETURNING id para devolver o ID criado
        const result = await db.query(
            'INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id', 
            [username, hash]
        );
        
        // Auto-seed Categorias
        const userId = result.rows[0].id;
        const defaultCats = [
            ['Alimentação', 'EXPENSE'], ['Moradia', 'EXPENSE'], ['Transporte', 'EXPENSE'],
            ['Lazer', 'EXPENSE'], ['Saúde', 'EXPENSE'], ['Mercado', 'EXPENSE'],
            ['Salário', 'INCOME'], ['Investimento', 'INCOME'], ['Outros', 'EXPENSE']
        ];
        
        for (const cat of defaultCats) {
            await db.query('INSERT INTO categories (user_id, name, type) VALUES ($1, $2, $3)', [userId, cat[0], cat[1]]);
        }

        res.json({message: "Criado!"});
    } catch (e) { 
        if(e.code === '23505') return res.status(400).json({error: "Usuário já existe."}); // Erro Unique do PG
        res.status(500).json({error: "Erro servidor: " + e.message}); 
    }
});

app.post('/auth/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const result = await db.query('SELECT * FROM users WHERE username = $1', [username]);
        const user = result.rows[0];

        if (!user) return res.status(400).json({ error: "Usuário não encontrado." });
        
        const valid = await bcrypt.compare(password, user.password_hash);
        if (!valid) return res.status(401).json({ error: "Senha incorreta." });
        
        const token = jwt.sign({ id: user.id, username: user.username }, SECRET_KEY, { expiresIn: '2h' });
        res.json({ token, username: user.username });
    } catch (e) {
        res.status(500).json({ error: "Erro interno" });
    }
});

// --- CORE ---
app.get('/api/user', authenticateToken, async (req, res) => {
    const result = await db.query('SELECT id, username FROM users WHERE id = $1', [req.user.id]);
    res.json(result.rows[0]);
});

app.put('/api/user', authenticateToken, async (req, res) => {
    const { username, newPassword } = req.body;
    try {
        if (newPassword) {
            const hash = await bcrypt.hash(newPassword, 10);
            await db.query('UPDATE users SET username = $1, password_hash = $2 WHERE id = $3', [username, hash, req.user.id]);
        } else {
            await db.query('UPDATE users SET username = $1 WHERE id = $2', [username, req.user.id]);
        }
        res.json({message: "Atualizado!"});
    } catch (e) { res.status(500).json({ error: "Erro interno" }); }
});

app.delete('/api/user', authenticateToken, async (req, res) => {
    await db.query('DELETE FROM users WHERE id = $1', [req.user.id]);
    res.json({message: "Conta excluída."});
});

app.get('/api/accounts', authenticateToken, async (req, res) => {
    // COALESCE lida com NULLs (soma segura)
    // ::numeric garante que o PG trate como número para soma
    const sql = `
        SELECT a.id, a.name, a.bank_name, 
        (a.initial_balance + 
         COALESCE(SUM(CASE WHEN t.type='INCOME' THEN t.amount ELSE 0 END),0) - 
         COALESCE(SUM(CASE WHEN t.type='EXPENSE' THEN t.amount ELSE 0 END),0)
        ) as current_balance 
        FROM accounts a 
        LEFT JOIN transactions t ON a.id = t.account_id 
        WHERE a.user_id = $1 
        GROUP BY a.id`;
    const result = await db.query(sql, [req.user.id]);
    res.json({data: result.rows});
});

app.post('/api/accounts', authenticateToken, async (req, res) => {
    const {name, bank_name, initial_balance} = req.body;
    const result = await db.query(
        'INSERT INTO accounts (user_id, name, bank_name, initial_balance) VALUES ($1, $2, $3, $4) RETURNING id', 
        [req.user.id, name, bank_name, Math.round(initial_balance*100)]
    );
    res.json({id: result.rows[0].id});
});

// Transações (Filtro Adaptado para PG)
app.get('/api/transactions', authenticateToken, async (req, res) => {
    const { month, category } = req.query;
    let sql = `SELECT t.*, a.name as account_name FROM transactions t JOIN accounts a ON t.account_id = a.id WHERE a.user_id = $1`;
    let params = [req.user.id];
    let counter = 2; // PG usa $1, $2, $3...

    if (month) { 
        // TO_CHAR é o equivalente PG ao strftime do SQLite
        sql += ` AND TO_CHAR(t.date, 'YYYY-MM') = $${counter}`; 
        params.push(month);
        counter++;
    }
    if (category && category !== 'Todas') { 
        sql += ` AND t.category = $${counter}`; 
        params.push(category);
        counter++;
    }
    
    sql += ` ORDER BY t.date DESC, t.id DESC`;
    const result = await db.query(sql, params);
    res.json({data: result.rows});
});

app.post('/api/transactions', authenticateToken, async (req, res) => {
    const {description, amount, type, category, date, account_id} = req.body;
    
    // Validar propriedade da conta
    const accCheck = await db.query("SELECT id FROM accounts WHERE id=$1 AND user_id=$2", [account_id, req.user.id]);
    if(accCheck.rows.length === 0) return res.status(403).json({error:"Conta inválida"});

    const result = await db.query(
        `INSERT INTO transactions (description, amount, type, category, date, account_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`, 
        [description, parseInt(amount), type, category, date, account_id]
    );
    res.json({id: result.rows[0].id});
});

app.get('/api/global-balance', authenticateToken, async (req, res) => {
    const sql = `
        SELECT SUM(current_balance) as total FROM (
            SELECT (a.initial_balance + 
                COALESCE(SUM(CASE WHEN t.type='INCOME' THEN t.amount ELSE 0 END),0) - 
                COALESCE(SUM(CASE WHEN t.type='EXPENSE' THEN t.amount ELSE 0 END),0)
            ) as current_balance 
            FROM accounts a 
            LEFT JOIN transactions t ON a.id=t.account_id 
            WHERE a.user_id=$1 
            GROUP BY a.id
        ) as subquery`; // PG exige alias em subqueries
    const result = await db.query(sql, [req.user.id]);
    res.json({total: result.rows[0]?.total || 0});
});

// Categories & Analytics
app.get('/api/categories', authenticateToken, async (req, res) => {
    // Autocorreção: se não tiver, cria (A lógica de seed do registro já cuida disso, mas mantemos o fallback seguro)
    let result = await db.query('SELECT * FROM categories WHERE user_id = $1 ORDER BY name', [req.user.id]);
    if (result.rows.length === 0) {
        // Fallback seed (opcional, já que o register faz isso)
        const defaultCats = [['Alimentação', 'EXPENSE'], ['Salário', 'INCOME']];
        for (const cat of defaultCats) await db.query('INSERT INTO categories (user_id, name, type) VALUES ($1, $2, $3)', [req.user.id, cat[0], cat[1]]);
        result = await db.query('SELECT * FROM categories WHERE user_id = $1 ORDER BY name', [req.user.id]);
    }
    res.json({data: result.rows});
});

app.post('/api/categories', authenticateToken, async (req, res) => {
    const { name, type } = req.body;
    const result = await db.query('INSERT INTO categories (user_id, name, type) VALUES ($1, $2, $3) RETURNING id', [req.user.id, name, type]);
    res.json({id: result.rows[0].id});
});

app.delete('/api/categories/:id', authenticateToken, async (req, res) => {
    await db.query('DELETE FROM categories WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    res.json({message: "Deletado"});
});

// Gráficos
app.get('/api/reports/category', authenticateToken, async (req, res) => {
    const sql = `SELECT category, SUM(amount) as total FROM transactions t JOIN accounts a ON t.account_id = a.id WHERE a.user_id = $1 AND t.type = 'EXPENSE' GROUP BY category`;
    const result = await db.query(sql, [req.user.id]);
    res.json({data: result.rows});
});

app.get('/api/reports/monthly', authenticateToken, async (req, res) => {
    const sql = `
        SELECT TO_CHAR(date, 'YYYY-MM') as month, 
               SUM(CASE WHEN type='INCOME' THEN amount ELSE 0 END) as income,
               SUM(CASE WHEN type='EXPENSE' THEN amount ELSE 0 END) as expense
        FROM transactions t JOIN accounts a ON t.account_id = a.id
        WHERE a.user_id = $1
        GROUP BY month ORDER BY month ASC LIMIT 12`;
    const result = await db.query(sql, [req.user.id]);
    res.json({data: result.rows});
});

app.listen(PORT, () => console.log(`FinTech (PostgreSQL) rodando na porta ${PORT}`));