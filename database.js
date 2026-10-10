const Database = require('better-sqlite3');
const path = require('path');

// Conexión a la base de datos SQLite
const dbPath = path.join(__dirname, 'inventario.db');
const db = new Database(dbPath);

// Optimización y restricciones
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// 1. Tabla de Usuarios
db.exec(`
  CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    rol TEXT DEFAULT 'vendedor',
    activo INTEGER DEFAULT 1,
    creado_en DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Insertar usuarios por defecto si no existen
const countUsers = db.prepare('SELECT COUNT(*) as total FROM usuarios').get();
if (countUsers.total === 0) {
  const insertUser = db.prepare('INSERT INTO usuarios (nombre, username, password, rol) VALUES (?, ?, ?, ?)');
  insertUser.run('Administrador', 'admin', '1234', 'admin');
  insertUser.run('Vendedor', 'vendedor', '1234', 'vendedor');
}

// 2. Tabla de Productos
db.exec(`
  CREATE TABLE IF NOT EXISTS productos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    codigo_barra TEXT UNIQUE,
    codigo_unico TEXT,
    nombre TEXT NOT NULL,
    categoria TEXT,
    marca TEXT,
    talla TEXT,
    color TEXT,
    precio_compra REAL NOT NULL DEFAULT 0,
    precio_venta REAL NOT NULL DEFAULT 0,
    stock INTEGER NOT NULL DEFAULT 0,
    imagen_url TEXT,
    activo INTEGER DEFAULT 1,
    creado_en DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Migración segura: agregar columnas si no existen
const prodCols = db.pragma('table_info(productos)').map(c => c.name);
if (!prodCols.includes('codigo_unico')) {
  try { db.exec('ALTER TABLE productos ADD COLUMN codigo_unico TEXT;'); } catch (_) {}
}
if (!prodCols.includes('marca')) {
  try { db.exec('ALTER TABLE productos ADD COLUMN marca TEXT;'); } catch (_) {}
}

// 3. Tabla de Clientes
db.exec(`
  CREATE TABLE IF NOT EXISTS clientes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    telefono TEXT,
    cedula TEXT,
    limite REAL DEFAULT 0,
    deuda REAL DEFAULT 0,
    creado_en DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// 4. Tabla de Movimientos
db.exec(`
  CREATE TABLE IF NOT EXISTS movimientos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    producto_id INTEGER,
    tipo TEXT CHECK(tipo IN ('ENTRADA', 'SALIDA', 'Entrada', 'Salida')) NOT NULL,
    cantidad INTEGER NOT NULL,
    motivo TEXT NOT NULL,
    fecha DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(producto_id) REFERENCES productos(id)
  );
`);

// 5. Tabla de Finanzas
db.exec(`
  CREATE TABLE IF NOT EXISTS finanzas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tipo TEXT NOT NULL,
    categoria TEXT,
    concepto TEXT,
    monto REAL NOT NULL,
    descripcion TEXT,
    fecha DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// 6. Tabla de Ventas
db.exec(`
  CREATE TABLE IF NOT EXISTS ventas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cliente_nombre TEXT DEFAULT 'Cliente General',
    cliente_id INTEGER DEFAULT 0,
    metodo_pago TEXT NOT NULL,
    subtotal REAL NOT NULL,
    descuento REAL DEFAULT 0,
    itbis REAL DEFAULT 0,
    total REAL NOT NULL,
    fecha DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// 7. Detalle de Ventas
db.exec(`
  CREATE TABLE IF NOT EXISTS detalle_ventas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    venta_id INTEGER NOT NULL,
    producto_id INTEGER NOT NULL,
    cantidad INTEGER NOT NULL,
    precio_unitario REAL NOT NULL,
    subtotal REAL NOT NULL,
    FOREIGN KEY(venta_id) REFERENCES ventas(id),
    FOREIGN KEY(producto_id) REFERENCES productos(id)
  );
`);

module.exports = db;