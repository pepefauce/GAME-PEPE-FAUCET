-- Tabla de Usuarios
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    wallet TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    referred_by TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Tabla de Balances
CREATE TABLE IF NOT EXISTS balances (
    wallet TEXT PRIMARY KEY,
    pepe_balance REAL DEFAULT 100.0,
    last_claim_at DATETIME,
    FOREIGN KEY(wallet) REFERENCES users(wallet)
);

-- Tabla de Boosts y Depósitos
CREATE TABLE IF NOT EXISTS boosts (
    wallet TEXT PRIMARY KEY,
    total_usdt_deposited REAL DEFAULT 0.0,
    daily_boost_pepe REAL DEFAULT 0.0,
    FOREIGN KEY(wallet) REFERENCES users(wallet)
);

-- Tabla de Registro de Depósitos
CREATE TABLE IF NOT EXISTS deposits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tx_hash TEXT UNIQUE NOT NULL,
    wallet TEXT NOT NULL,
    amount_usdt REAL NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(wallet) REFERENCES users(wallet)
);

-- Tabla de Referidos y Comisiones (5%)
CREATE TABLE IF NOT EXISTS referrals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    referrer_wallet TEXT NOT NULL,
    referred_wallet TEXT NOT NULL,
    commission_usdt REAL DEFAULT 0.0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Tabla de Retiros
CREATE TABLE IF NOT EXISTS withdrawals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    wallet TEXT NOT NULL,
    amount_pepe REAL NOT NULL,
    tx_hash TEXT,
    status TEXT DEFAULT 'PENDING',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
