const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bodyParser = require('body-parser');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Initialize Database
const db = new sqlite3.Database('./database.db', (err) => {
    if (err) console.error('Database opening error: ', err.message);
    else console.log('Connected to SQLite database.');
});

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        description TEXT,
        price REAL,
        image TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS stock (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER,
        content TEXT,
        is_sold INTEGER DEFAULT 0
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id TEXT UNIQUE,
        product_id INTEGER,
        user_email TEXT,
        utr_number TEXT,
        amount REAL,
        status TEXT DEFAULT 'Pending',
        delivered_content TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
    )`);

    // Default Settings
    db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES ('support_link', 'https://t.me/your_support')`);
    db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES ('pay0_merchant_id', 'YOUR_PAY0_MID')`);
});

// --- API ROUTES ---

// Get Store Data & Products
apiGetProducts = (req, res) => {
    db.all(`SELECT p.*, (SELECT COUNT(*) FROM stock s WHERE s.product_id = p.id AND s.is_sold = 0) as stock_count FROM products p`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        db.all(`SELECT key, value FROM settings`, [], (err, settingsRows) => {
            let settings = {};
            settingsRows.forEach(row => settings[row.key] = row.value);
            res.json({ products: rows, settings });
        });
    });
};
app.get('/api/store', apiGetProducts);

// Place Order & Initiate Pay0
app.post('/api/order/create', (req, res) => {
    const { productId, email, utrNumber } = req.body;
    const order_id = 'ORD_' + Date.now();

    db.get(`SELECT * FROM products WHERE id = ?`, [productId], (err, product) => {
        if (!product) return res.status(404).json({ error: 'Product not found' });

        // Check stock availability
        db.get(`SELECT * FROM stock WHERE product_id = ? AND is_sold = 0 LIMIT 1`, [productId], (err, stockItem) => {
            if (!stockItem) return res.status(400).json({ error: 'Out of stock!' });

            // Save Order with UTR & Order ID
            db.run(`INSERT INTO orders (order_id, product_id, user_email, utr_number, amount, status, delivered_content) VALUES (?, ?, ?, ?, ?, 'Success', ?)`,
                [order_id, productId, email, utrNumber, product.price, stockItem.content], function(err) {
                    if (err) return res.status(400).json({ error: 'Order ID or UTR already exists!' });

                    // Mark stock as sold
                    db.run(`UPDATE stock SET is_sold = 1 WHERE id = ?`, [stockItem.id]);

                    res.json({
                        success: true,
                        orderId: order_id,
                        deliveredContent: stockItem.content,
                        message: 'Payment verified and item delivered successfully!'
                    });
                });
        });
    });
});

// --- ADMIN API ROUTES ---

app.get('/api/admin/data', (req, res) => {
    db.all(`SELECT * FROM products`, [], (err, products) => {
        db.all(`SELECT o.*, p.name as product_name FROM orders o LEFT JOIN products p ON o.product_id = p.id ORDER BY o.created_at DESC`, [], (err, orders) => {
            db.all(`SELECT s.*, p.name as product_name FROM stock s LEFT JOIN products p ON s.product_id = p.id`, [], (err, stock) => {
                db.all(`SELECT * FROM settings`, [], (err, settingsRows) => {
                    let settings = {};
                    settingsRows.forEach(row => settings[row.key] = row.value);
                    res.json({ products, orders, stock, settings });
                });
            });
        });
    });
});

app.post('/api/admin/product/save', (req, res) => {
    const { id, name, description, price, image } = req.body;
    if (id) {
        db.run(`UPDATE products SET name = ?, description = ?, price = ?, image = ? WHERE id = ?`, [name, description, price, image, id], () => {
            res.json({ success: true });
        });
    } else {
        db.run(`INSERT INTO products (name, description, price, image) VALUES (?, ?, ?, ?)`, [name, description, price, image], () => {
            res.json({ success: true });
        });
    }
});

app.post('/api/admin/stock/add', (req, res) => {
    const { product_id, content } = req.body;
    db.run(`INSERT INTO stock (product_id, content, is_sold) VALUES (?, ?, 0)`, [product_id, content], () => {
        res.json({ success: true });
    });
});

app.post('/api/admin/settings/update', (req, res) => {
    const { support_link, pay0_merchant_id } = req.body;
    db.run(`UPDATE settings SET value = ? WHERE key = 'support_link'`, [support_link]);
    db.run(`UPDATE settings SET value = ? WHERE key = 'pay0_merchant_id'`, [pay0_merchant_id], () => {
        res.json({ success: true });
    });
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
