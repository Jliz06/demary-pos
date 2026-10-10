const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

// ==========================================
// MIDDLEWARES
// ==========================================
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Servir archivos estáticos del frontend y raíz
app.use(express.static(path.join(__dirname, 'frontend')));
app.use(express.static(__dirname));

// ==========================================
// PREFIJOS DE CATEGORÍA
// ==========================================
const prefijosCategoria = {
  'Polos': 'POL',
  'Camisas': 'CAM',
  'Tenis/Calzado': 'TEN',
  'Gorras': 'GOR',
  'Perfumes': 'PER',
  'Pantalones': 'PAN',
  'Vestidos': 'VES',
  'Blusas': 'BLU',
  'ROP': 'ROP',
  'CAL': 'CAL',
  'Otros': 'ART'
};

// ==========================================
// RUTAS DE LA API
// ==========================================

// 1. AUTENTICACIÓN / LOGIN
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'Usuario y contraseña requeridos' });
  }

  try {
    const user = db.prepare('SELECT id, nombre, username, rol FROM usuarios WHERE username = ? AND password = ? AND activo = 1').get(username.trim().toLowerCase(), password.trim());

    if (user) {
      return res.json({
        success: true,
        message: 'Autenticación exitosa',
        rol: user.rol,
        user: { id: user.id, nombre: user.nombre, username: user.username, rol: user.rol }
      });
    }

    // Fallbacks de acceso administrativo conocidos
    const u = username.trim().toLowerCase();
    const p = password.trim();
    if ((u === 'admin' && (p === 'admin123' || p === '1234')) || (u === 'vendedor' && p === '1234')) {
      const rol = (u === 'admin') ? 'admin' : 'vendedor';
      return res.json({
        success: true,
        message: 'Autenticación exitosa',
        rol,
        user: { id: 0, nombre: u.toUpperCase(), username: u, rol }
      });
    }

    return res.status(401).json({ success: false, message: 'Usuario o contraseña incorrectos' });
  } catch (err) {
    console.error('Error en /api/login:', err);
    res.status(500).json({ success: false, message: 'Error interno del servidor' });
  }
});

// 2. PRODUCTOS
app.get('/api/productos', (req, res) => {
  try {
    const productos = db.prepare('SELECT * FROM productos WHERE activo = 1 ORDER BY id DESC').all();
    res.json(productos);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/productos', (req, res) => {
  const { nombre, categoria, marca, color, talla, precio_compra, precio_venta, pCompra, pVenta, stock, codigo, codigo_barra, codigo_unico, imagen_url } = req.body;

  try {
    const pComp = Number(precio_compra ?? pCompra ?? 0);
    const pVent = Number(precio_venta ?? pVenta ?? 0);
    const stk = parseInt(stock) || 0;

    let cod = codigo || codigo_barra || codigo_unico;
    if (!cod) {
      const prefijo = prefijosCategoria[categoria] || 'ART';
      const count = db.prepare('SELECT COUNT(*) as total FROM productos WHERE categoria = ?').get(categoria || '');
      const secuencial = String((count ? count.total : 0) + 1).padStart(4, '0');
      cod = `${prefijo}-${secuencial}`;
    }

    const stmt = db.prepare(`
      INSERT INTO productos (codigo_barra, codigo_unico, nombre, categoria, marca, color, talla, precio_compra, precio_venta, stock, imagen_url) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const info = stmt.run(cod, cod, nombre || 'Sin nombre', categoria || 'General', marca || '', color || '', talla || 'N/A', pComp, pVent, stk, imagen_url || '');

    res.json({ id: info.lastInsertRowid, codigo: cod, codigo_unico: cod, message: 'Producto registrado con éxito' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/productos/:id', (req, res) => {
  const { id } = req.params;
  const { nombre, categoria, marca, color, talla, precio_compra, precio_venta, pCompra, pVenta, stock } = req.body;

  try {
    const pComp = Number(precio_compra ?? pCompra ?? 0);
    const pVent = Number(precio_venta ?? pVenta ?? 0);
    const stk = parseInt(stock) || 0;

    const stmt = db.prepare(`
      UPDATE productos 
      SET nombre = COALESCE(?, nombre),
          categoria = COALESCE(?, categoria),
          marca = COALESCE(?, marca),
          color = COALESCE(?, color),
          talla = COALESCE(?, talla),
          precio_compra = ?,
          precio_venta = ?,
          stock = ?
      WHERE id = ?
    `);

    stmt.run(nombre, categoria, marca, color, talla, pComp, pVent, stk, id);
    res.json({ message: 'Producto actualizado con éxito' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/productos/:id', (req, res) => {
  const { id } = req.params;
  try {
    db.prepare('UPDATE productos SET activo = 0 WHERE id = ?').run(id);
    res.json({ message: 'Producto eliminado correctamente' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. MOVIMIENTOS DE INVENTARIO
app.post('/api/movimientos', (req, res) => {
  const { producto_id, tipo, cantidad, motivo } = req.body;
  const cant = Number(cantidad);

  if (cant <= 0) return res.status(400).json({ error: 'La cantidad debe ser mayor a 0' });

  try {
    const tipoNormalizado = (tipo || '').toUpperCase().includes('ENTRADA') ? 'ENTRADA' : 'SALIDA';

    const transaction = db.transaction(() => {
      const prod = db.prepare('SELECT stock, nombre FROM productos WHERE id = ?').get(producto_id);
      if (!prod) throw new Error('Producto no encontrado');

      if (tipoNormalizado === 'SALIDA' && prod.stock < cant) {
        throw new Error(`Stock insuficiente para "${prod.nombre}". Disponible: ${prod.stock}`);
      }

      const stmtMov = db.prepare('INSERT INTO movimientos (producto_id, tipo, cantidad, motivo) VALUES (?, ?, ?, ?)');
      stmtMov.run(producto_id, tipoNormalizado, cant, motivo || 'Ajuste');

      if (tipoNormalizado === 'ENTRADA') {
        db.prepare('UPDATE productos SET stock = stock + ? WHERE id = ?').run(cant, producto_id);
      } else {
        db.prepare('UPDATE productos SET stock = stock - ? WHERE id = ?').run(cant, producto_id);
      }
    });

    transaction();
    res.json({ message: 'Movimiento de inventario registrado con éxito' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/movimientos', (req, res) => {
  try {
    const historial = db.prepare(`
      SELECT m.*, COALESCE(p.codigo_barra, p.codigo_unico, 'N/A') as codigo, p.nombre as producto_nombre, p.marca, p.color, p.talla 
      FROM movimientos m
      LEFT JOIN productos p ON m.producto_id = p.id
      ORDER BY m.id DESC LIMIT 100
    `).all();
    res.json(historial);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. FINANZAS
app.post('/api/finanzas', (req, res) => {
  const { tipo, categoria, concepto, monto, descripcion } = req.body;
  try {
    const stmt = db.prepare('INSERT INTO finanzas (tipo, categoria, concepto, monto, descripcion) VALUES (?, ?, ?, ?, ?)');
    stmt.run(tipo || 'GASTO', categoria || 'General', concepto || descripcion || 'Operación', Number(monto), descripcion || '');
    res.json({ message: 'Registro financiero guardado correctamente' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/finanzas', (req, res) => {
  try {
    const registros = db.prepare('SELECT * FROM finanzas ORDER BY id DESC LIMIT 100').all();
    const resumen = db.prepare(`
      SELECT 
        SUM(CASE WHEN UPPER(tipo) LIKE '%INGRESO%' THEN monto ELSE 0 END) as total_ingresos,
        SUM(CASE WHEN UPPER(tipo) LIKE '%GASTO%' THEN monto ELSE 0 END) as total_gastos
      FROM finanzas
    `).get();

    res.json({ registros, resumen });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. VENTAS (POS)
app.post('/api/ventas', (req, res) => {
  const { cliente_nombre, cliente_id, metodo_pago, subtotal, descuento, itbis, total, items } = req.body;

  if (!items || items.length === 0) {
    return res.status(400).json({ error: 'El carrito de venta está vacío' });
  }

  try {
    const realizarVenta = db.transaction(() => {
      // Verificar stock de cada item
      for (const item of items) {
        if (item.producto_id) {
          const prod = db.prepare('SELECT stock, nombre FROM productos WHERE id = ?').get(item.producto_id);
          if (prod && prod.stock < item.cantidad) {
            throw new Error(`Stock insuficiente para "${prod.nombre}". Disponible: ${prod.stock}`);
          }
        }
      }

      const stmtVenta = db.prepare(`
        INSERT INTO ventas (cliente_nombre, cliente_id, metodo_pago, subtotal, descuento, itbis, total)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      const infoVenta = stmtVenta.run(
        cliente_nombre || 'Cliente General',
        cliente_id || 0,
        metodo_pago || 'Efectivo',
        Number(subtotal || total),
        Number(descuento || 0),
        Number(itbis || 0),
        Number(total)
      );
      const ventaId = infoVenta.lastInsertRowid;

      const stmtDetalle = db.prepare(`
        INSERT INTO detalle_ventas (venta_id, producto_id, cantidad, precio_unitario, subtotal)
        VALUES (?, ?, ?, ?, ?)
      `);
      const stmtUpdateStock = db.prepare(`
        UPDATE productos SET stock = stock - ? WHERE id = ?
      `);

      for (const item of items) {
        if (item.producto_id) {
          stmtDetalle.run(ventaId, item.producto_id, item.cantidad, item.precio_unitario || item.pVenta || 0, item.subtotal || (item.cantidad * (item.precio_unitario || item.pVenta || 0)));
          stmtUpdateStock.run(item.cantidad, item.producto_id);
        }
      }

      return ventaId;
    });

    const ventaId = realizarVenta();
    res.json({ message: 'Venta realizada con éxito', venta_id: ventaId });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/ventas', (req, res) => {
  try {
    const ventas = db.prepare('SELECT * FROM ventas ORDER BY id DESC LIMIT 100').all();
    res.json(ventas);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6. CLIENTES
app.get('/api/clientes', (req, res) => {
  try {
    const clientes = db.prepare('SELECT * FROM clientes ORDER BY nombre ASC').all();
    res.json(clientes);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/clientes', (req, res) => {
  const { nombre, telefono, cedula, limite } = req.body;
  try {
    const stmt = db.prepare('INSERT INTO clientes (nombre, telefono, cedula, limite) VALUES (?, ?, ?, ?)');
    const info = stmt.run(nombre, telefono || '', cedula || '', Number(limite || 0));
    res.json({ id: info.lastInsertRowid, message: 'Cliente registrado con éxito' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 7. ESTADO DEL SISTEMA
app.get('/api/status', (req, res) => {
  res.json({
    status: 'online',
    sistema: 'DE MARY EXCLUSIVIDADES - Sistema de Gestión',
    servidor: 'Node.js Express + SQLite (better-sqlite3)',
    timestamp: new Date().toISOString()
  });
});

// RUTA PRINCIPAL
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend', 'index.html'));
});

// ==========================================
// INICIAR SERVIDOR
// ==========================================
app.listen(PORT, () => {
  console.log('\n================================================================');
  console.log('  🏬 DE MARY EXCLUSIVIDADES - Sistema de Gestión Integrado');
  console.log(`  🚀 Servidor ejecutándose correctamente en el puerto ${PORT}`);
  console.log(`  🌐 Abre en tu navegador: http://localhost:${PORT}`);
  console.log('================================================================\n');
});