import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './db/database.js';
import { InventoryService } from './services/inventoryService.js';
import { CashService } from './services/cashService.js';
import { ExcelService } from './services/excelService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.resolve(__dirname, '../public');

const PORT = process.env.PORT || 3001;

// Server-Sent Events (SSE) Client Connections for Realtime KDS
const sseClients = new Set();

export function broadcastEvent(eventType, payload) {
  const data = JSON.stringify({ type: eventType, data: payload, timestamp: new Date().toISOString() });
  for (const client of sseClients) {
    try {
      client.write(`data: ${data}\n\n`);
    } catch (err) {
      sseClients.delete(client);
    }
  }
}

// Helpers
function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With'
  });
  res.end(JSON.stringify(data));
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 10 * 1024 * 1024) { // 10MB limit
        reject(new Error('Payload Too Large'));
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
};

function serveStatic(req, res, pathname) {
  let relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\//, '');
  let filePath = path.join(PUBLIC_DIR, relativePath);

  // Security check
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Access Denied');
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(PUBLIC_DIR, 'index.html');
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  try {
    const content = fs.readFileSync(filePath);
    res.writeHead(200, {
      'Content-Type': contentType,
      'Access-Control-Allow-Origin': '*'
    });
    res.end(content);
  } catch (err) {
    res.writeHead(404);
    res.end('File Not Found');
  }
}

// Helper to get authenticated user and verify permissions
function getAuthUser(req) {
  const userId = req.headers['x-user-id'] || (new URL(req.url, 'http://localhost')).searchParams.get('userId') || 'USR-001';
  const user = db.find('users', u => u.id === userId);
  if (!user) return null;
  const role = db.find('roles', r => r.id === user.role_id);
  return { ...user, role };
}

function checkPermission(req, res, requiredPerm) {
  const user = getAuthUser(req);
  if (!user) {
    sendJson(res, 401, { error: 'No autorizado. Se requiere iniciar sesión.' });
    return null;
  }
  const perms = user.role?.permissions || [];
  if (!perms.includes('all') && !perms.includes(requiredPerm)) {
    sendJson(res, 403, {
      error: `Acceso Denegado: El rol "${user.role?.name || user.role_id}" no tiene permisos para realizar esta acción administrativa.`
    });
    return null;
  }
  return user;
}

// Request Handler
const server = http.createServer(async (req, res) => {
  // CORS Preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With'
    });
    return res.end();
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;
  const method = req.method;

  try {
    // =========================================================================
    // SSE REALTIME ENDPOINT (Kitchen Display System & Live Updates)
    // =========================================================================
    if (pathname === '/api/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*'
      });
      res.write(': connected\n\n');
      sseClients.add(res);

      req.on('close', () => {
        sseClients.delete(res);
      });
      return;
    }

    // =========================================================================
    // AUTHENTICATION
    // =========================================================================
    if (pathname === '/api/auth/login' && method === 'POST') {
      const { email, password } = await parseJsonBody(req);
      const user = db.find('users', u => u.email === email && u.password === password && u.active);
      if (!user) {
        return sendJson(res, 401, { error: 'Credenciales inválidas o usuario inactivo.' });
      }
      const role = db.find('roles', r => r.id === user.role_id);
      return sendJson(res, 200, {
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role_id: user.role_id,
          role_name: role ? role.name : 'Usuario',
          permissions: role ? role.permissions : []
        }
      });
    }

    if (pathname === '/api/auth/users' && method === 'GET') {
      const users = db.getAll('users').map(u => ({
        id: u.id,
        name: u.name,
        email: u.email,
        role_id: u.role_id,
        active: u.active
      }));
      return sendJson(res, 200, users);
    }

    // =========================================================================
    // GESTIÓN DE USUARIOS Y CLAVES DE ACCESO (ADMINISTRADOR ONLY)
    // =========================================================================
    if (pathname === '/api/users' && method === 'GET') {
      if (!checkPermission(req, res, 'all')) return;
      const roles = db.getAll('roles');
      const users = db.getAll('users').map(u => {
        const r = roles.find(role => role.id === u.role_id);
        return {
          id: u.id,
          name: u.name,
          email: u.email,
          role_id: u.role_id,
          role_name: r ? r.name : u.role_id,
          password: u.password,
          active: u.active,
          created_at: u.created_at
        };
      });
      return sendJson(res, 200, users);
    }

    if (pathname === '/api/users' && method === 'POST') {
      if (!checkPermission(req, res, 'all')) return;
      const body = await parseJsonBody(req);
      if (!body.name || !body.email || !body.password) {
        return sendJson(res, 400, { error: 'Nombre, correo y clave de acceso son obligatorios.' });
      }

      const existing = db.find('users', u => u.email === body.email);
      if (existing) {
        return sendJson(res, 400, { error: 'Ya existe un usuario con este correo electrónico.' });
      }

      const newId = db.nextCode('USR', 'users');
      const newUser = {
        id: newId,
        name: body.name.trim(),
        email: body.email.trim().toLowerCase(),
        password: String(body.password).trim(),
        role_id: body.role_id || 'mesero',
        active: body.active !== false,
        created_at: new Date().toISOString()
      };
      db.insert('users', newUser);
      return sendJson(res, 201, newUser);
    }

    if (pathname.startsWith('/api/users/') && method === 'PUT') {
      if (!checkPermission(req, res, 'all')) return;
      const userId = pathname.replace('/api/users/', '');
      const body = await parseJsonBody(req);

      const updates = {};
      if (body.name) updates.name = body.name.trim();
      if (body.email) updates.email = body.email.trim().toLowerCase();
      if (body.password) updates.password = String(body.password).trim();
      if (body.role_id) updates.role_id = body.role_id;
      if (body.active !== undefined) updates.active = !!body.active;
      updates.updated_at = new Date().toISOString();

      const updated = db.update('users', userId, updates);
      if (!updated) {
        return sendJson(res, 404, { error: 'Usuario no encontrado.' });
      }
      return sendJson(res, 200, updated);
    }

    if (pathname.startsWith('/api/users/') && method === 'DELETE') {
      if (!checkPermission(req, res, 'all')) return;
      const userId = pathname.replace('/api/users/', '');
      const updated = db.update('users', userId, { active: false, updated_at: new Date().toISOString() });
      return sendJson(res, 200, { success: true, user: updated });
    }

    // =========================================================================
    // CATEGORIES & PRODUCTS
    // =========================================================================
    if (pathname === '/api/categories' && method === 'GET') {
      return sendJson(res, 200, db.getAll('categories'));
    }

    if (pathname === '/api/products' && method === 'GET') {
      const products = db.getAll('products').filter(p => !p.is_deleted);
      return sendJson(res, 200, products);
    }

    if (pathname === '/api/products' && method === 'POST') {
      const body = await parseJsonBody(req);
      const code = body.code || db.nextCode('PRD', 'products');
      const newProd = {
        id: `PROD-${code}`,
        code,
        name: body.name,
        description: body.description || '',
        category_id: body.category_id,
        price: Number(body.price) || 0,
        cost_estimated: Number(body.cost_estimated) || 0,
        image_url: body.image_url || '',
        prep_time_minutes: Number(body.prep_time_minutes) || 15,
        prep_station: body.prep_station || 'Frituras',
        active: true,
        has_variants: !!body.has_variants,
        variants: body.variants || []
      };
      db.insert('products', newProd);
      return sendJson(res, 201, newProd);
    }

    if (pathname.startsWith('/api/products/') && method === 'PUT') {
      const id = pathname.replace('/api/products/', '');
      const body = await parseJsonBody(req);
      const updated = db.update('products', id, body);
      return sendJson(res, 200, updated);
    }

    if (pathname.startsWith('/api/products/') && method === 'DELETE') {
      const id = pathname.replace('/api/products/', '');
      const hasSales = db.getAll('order_items').some(it => it.product_id === id);
      if (hasSales) {
        const updated = db.update('products', id, { active: false, is_deleted: true, updated_at: new Date().toISOString() });
        return sendJson(res, 200, { success: true, message: 'Plato retirado de la carta (se conserva en auditoría contable por ventas históricas asociadas).', product: updated });
      } else {
        db.delete('products', id);
        return sendJson(res, 200, { success: true, message: 'Plato eliminado definitivamente del sistema.' });
      }
    }

    // =========================================================================
    // INGREDIENTS & RECIPES
    // =========================================================================
    if (pathname === '/api/ingredients' && method === 'GET') {
      const ingredients = db.getAll('ingredients').filter(i => !i.is_deleted);
      return sendJson(res, 200, ingredients);
    }

    if (pathname === '/api/ingredients' && method === 'POST') {
      const body = await parseJsonBody(req);
      const code = body.code || db.nextCode('ING', 'ingredients');
      const newIng = {
        id: `ING-${code}`,
        code,
        name: body.name,
        category: body.category || 'Varios',
        unit: body.unit || 'g',
        stock_current: Number(body.stock_current) || 0,
        stock_min: Number(body.stock_min) || 0,
        stock_max: Number(body.stock_max) || 0,
        cost_unit: Number(body.cost_unit) || 0,
        supplier_id: body.supplier_id || null,
        location: body.location || 'Bodega',
        active: true
      };
      db.insert('ingredients', newIng);
      return sendJson(res, 201, newIng);
    }

    if (pathname.startsWith('/api/ingredients/') && method === 'PUT') {
      const id = pathname.replace('/api/ingredients/', '');
      const body = await parseJsonBody(req);
      const updated = db.update('ingredients', id, body);
      broadcastEvent('STOCK_UPDATED', { ingredient: updated });
      return sendJson(res, 200, updated);
    }

    if (pathname.startsWith('/api/ingredients/') && method === 'DELETE') {
      const id = pathname.replace('/api/ingredients/', '');
      const hasMovements = db.getAll('inventory_movements').some(m => m.ingredient_id === id);
      if (hasMovements) {
        const updated = db.update('ingredients', id, { active: false, is_deleted: true, updated_at: new Date().toISOString() });
        broadcastEvent('STOCK_UPDATED', { ingredient: updated });
        return sendJson(res, 200, { success: true, message: 'Insumo retirado de inventario (se conserva en auditoría histórica por movimientos previos).', ingredient: updated });
      } else {
        db.delete('ingredients', id);
        broadcastEvent('STOCK_UPDATED', { deletedId: id });
        return sendJson(res, 200, { success: true, message: 'Insumo eliminado definitivamente del sistema.' });
      }
    }

    if (pathname === '/api/ingredients/adjust' && method === 'POST') {
      const body = await parseJsonBody(req);
      const movement = InventoryService.processAdjustment(body, body.user_id || 'USR-001');
      broadcastEvent('STOCK_UPDATED', { movement });
      return sendJson(res, 200, movement);
    }

    if (pathname === '/api/recipes' && method === 'GET') {
      return sendJson(res, 200, db.getAll('recipes'));
    }

    if (pathname === '/api/recipes' && method === 'POST') {
      const body = await parseJsonBody(req);
      const newRec = {
        id: db.nextCode('REC', 'recipes'),
        product_id: body.product_id,
        variant_id: body.variant_id || null,
        name: body.name,
        version: 1,
        portion_size: body.portion_size || '1 porción',
        prep_time_minutes: Number(body.prep_time_minutes) || 15,
        items: body.items || []
      };
      db.insert('recipes', newRec);
      return sendJson(res, 201, newRec);
    }

    if (pathname.startsWith('/api/recipes/') && method === 'PUT') {
      const id = pathname.replace('/api/recipes/', '');
      const body = await parseJsonBody(req);
      const updated = db.update('recipes', id, body);
      return sendJson(res, 200, updated);
    }

    // =========================================================================
    // ORDERS & POS (Punto de Venta)
    // =========================================================================
    if (pathname === '/api/orders' && method === 'GET') {
      const status = url.searchParams.get('status');
      let orders = db.getAll('orders');
      if (status) {
        orders = orders.filter(o => o.status === status);
      }
      return sendJson(res, 200, orders);
    }

    if (pathname === '/api/orders' && method === 'POST') {
      const body = await parseJsonBody(req);

      // 1. Idempotency Check (Prueba 5)
      if (body.idempotency_key) {
        const existing = db.find('orders', o => o.idempotency_key === body.idempotency_key);
        if (existing) {
          return sendJson(res, 200, { order: existing, duplicatePrevented: true });
        }
      }

      // Execute order creation + inventory deduction + payments inside ACID transaction
      const order = await db.transaction(async (tx) => {
        const orderId = tx.nextOrderId(); // BW-000001
        const now = new Date().toISOString();

        const newOrder = {
          id: orderId,
          idempotency_key: body.idempotency_key || null,
          cash_register_id: body.cash_register_id || null,
          user_id: body.user_id || 'USR-002',
          customer_id: body.customer_id || null,
          customer_name: body.customer_name || 'Cliente Mostrador',
          order_type: body.order_type || 'MESA', // MESA, LLEVAR, RECOGER, DOMICILIO
          table_number: body.table_number || null,
          delivery_address: body.delivery_address || null,
          delivery_fee: Number(body.delivery_fee) || 0,
          status: 'PENDIENTE', // PENDIENTE para cocina
          payment_status: body.payment_status || 'PAGADO',
          subtotal: Number(body.subtotal) || 0,
          discount: Number(body.discount) || 0,
          tax: Number(body.tax) || 0,
          total: Number(body.total) || 0,
          total_cost_estimated: 0,
          notes: body.notes || '',
          items: body.items || [],
          created_at: now,
          updated_at: now
        };

        // Attach order_id to order items
        newOrder.items = newOrder.items.map((it, idx) => ({
          ...it,
          id: `${orderId}-ITM-${idx + 1}`,
          order_id: orderId
        }));

        // 2. Atomic Inventory Deduction by Recipe (Pruebas 1, 2, 3, 4, 15)
        const deductionResult = InventoryService.processOrderDeduction(newOrder, newOrder.user_id, tx);
        newOrder.total_cost_estimated = deductionResult.totalCostEstimated;

        // 3. Save Order and Order Items
        tx.insert('orders', newOrder);
        for (const item of newOrder.items) {
          tx.insert('order_items', item);
        }

        // 4. Process Payments & Update Cash Register (Prueba 6)
        if (body.payments && body.payments.length > 0) {
          for (const pay of body.payments) {
            const payRecord = {
              id: tx.nextCode('PAY', 'order_payments'),
              order_id: orderId,
              method: pay.method,
              amount: Number(pay.amount),
              reference: pay.reference || null,
              cash_tendered: Number(pay.cash_tendered) || Number(pay.amount),
              cash_change: Number(pay.cash_change) || 0,
              user_id: newOrder.user_id,
              created_at: now
            };
            tx.insert('order_payments', payRecord);

            // Apply payment to active cash register
            if (newOrder.cash_register_id) {
              CashService.applyOrderPayment(
                newOrder.cash_register_id,
                pay.method,
                pay.amount,
                newOrder.user_id,
                orderId,
                tx
              );
            }
          }
        }

        return newOrder;
      });

      // 5. Broadcast to Kitchen Screens & Cashiers in Realtime (Prueba 11)
      broadcastEvent('ORDER_CREATED', order);

      return sendJson(res, 201, { success: true, order });
    }

    // Update order status (KDS Kitchen Display System: PENDIENTE -> EN_PREPARACION -> LISTO -> ENTREGADO)
    if (pathname.startsWith('/api/orders/') && pathname.endsWith('/status') && method === 'PUT') {
      const orderId = pathname.split('/')[3];
      const { status, cancellation_reason } = await parseJsonBody(req);
      const now = new Date().toISOString();

      const existing = db.find('orders', o => o.id === orderId);
      if (!existing) {
        return sendJson(res, 404, { error: 'Pedido no encontrado' });
      }

      const updates = { status, updated_at: now };
      if (status === 'EN_PREPARACION' && !existing.prep_started_at) {
        updates.prep_started_at = now;
      } else if (status === 'LISTO' && !existing.prep_finished_at) {
        updates.prep_finished_at = now;
      } else if (status === 'ENTREGADO' && !existing.delivered_at) {
        updates.delivered_at = now;
      } else if (status === 'CANCELADO') {
        updates.cancellation_reason = cancellation_reason || 'Cancelado por usuario';
      }

      const updated = db.update('orders', orderId, updates);
      broadcastEvent('ORDER_STATUS_CHANGED', updated);
      broadcastEvent('TABLE_STATUS_CHANGED', { orderId, status });
      return sendJson(res, 200, updated);
    }

    // =========================================================================
    // MESAS & CUENTAS ABIERTAS (Table Management & Open Accounts)
    // =========================================================================
    if (pathname === '/api/tables' && method === 'GET') {
      const tables = db.getAll('restaurant_tables') || [];
      const openOrders = db.getAll('orders').filter(o => 
        o.order_type === 'MESA' && 
        o.payment_status === 'PENDIENTE' && 
        o.status !== 'CANCELADO'
      );

      const result = tables.map(t => {
        const order = openOrders.find(o => o.table_number === t.name || o.table_id === t.id);
        if (order) {
          return {
            ...t,
            status: 'OCUPADA',
            active_order: {
              id: order.id,
              customer_name: order.customer_name || 'Cliente Mesa',
              created_at: order.created_at,
              kitchen_status: order.status,
              items: order.items || [],
              subtotal: order.subtotal || 0,
              discount: order.discount || 0,
              tax: order.tax || 0,
              total: order.total || 0,
              notes: order.notes || ''
            }
          };
        } else {
          return {
            ...t,
            status: 'LIBRE',
            active_order: null
          };
        }
      });
      return sendJson(res, 200, result);
    }

    if (pathname === '/api/tables' && method === 'POST') {
      const body = await parseJsonBody(req);
      const tables = db.getAll('restaurant_tables') || [];
      const newTable = {
        id: `T-${String(tables.length + 1).padStart(2, '0')}`,
        name: body.name || `Mesa ${tables.length + 1}`,
        capacity: Number(body.capacity) || 4,
        area: body.area || 'Salón Principal',
        active: true
      };
      db.insert('restaurant_tables', newTable);
      broadcastEvent('TABLE_STATUS_CHANGED', { action: 'CREATED', table: newTable });
      return sendJson(res, 201, newTable);
    }

    if (pathname.startsWith('/api/tables/') && method === 'PUT') {
      const id = pathname.replace('/api/tables/', '');
      const body = await parseJsonBody(req);
      const updated = db.update('restaurant_tables', id, body);
      broadcastEvent('TABLE_STATUS_CHANGED', { action: 'UPDATED', table: updated });
      return sendJson(res, 200, updated);
    }

    // Agregar nuevos platos/bebidas a una mesa con cuenta abierta (Nueva Ronda)
    if (pathname.startsWith('/api/orders/') && pathname.endsWith('/add-items') && method === 'POST') {
      const orderId = pathname.split('/')[3];
      const body = await parseJsonBody(req);
      const newItems = body.items || [];

      if (!newItems.length) {
        return sendJson(res, 400, { error: 'Debe incluir al menos un producto para agregar a la mesa.' });
      }

      const order = await db.transaction(async (tx) => {
        const existing = tx.find('orders', o => o.id === orderId);
        if (!existing) {
          throw new Error('Pedido o mesa no encontrados.');
        }
        if (existing.payment_status === 'PAGADO') {
          throw new Error('Esta cuenta ya ha sido pagada y cerrada.');
        }

        const now = new Date().toISOString();
        const startIdx = existing.items ? existing.items.length : 0;
        const currentRound = (existing.round_count || 1) + 1;

        const formattedItems = newItems.map((it, idx) => ({
          ...it,
          id: `${orderId}-ITM-${startIdx + idx + 1}`,
          order_id: orderId,
          round: currentRound,
          added_at: now
        }));

        // Deducción atómica de inventario por receta de los nuevos productos
        const deductionResult = InventoryService.processOrderDeduction(
          { id: orderId, items: formattedItems },
          body.user_id || existing.user_id || 'USR-002',
          tx
        );

        // Guardar items en order_items
        for (const it of formattedItems) {
          tx.insert('order_items', it);
        }

        const addedSubtotal = formattedItems.reduce((sum, it) => sum + (Number(it.total) || 0), 0);
        const updatedItems = [...(existing.items || []), ...formattedItems];
        const newSubtotal = (Number(existing.subtotal) || 0) + addedSubtotal;
        const newTotal = (Number(existing.total) || 0) + addedSubtotal;
        const newCogs = (Number(existing.total_cost_estimated) || 0) + deductionResult.totalCostEstimated;

        const updatedOrder = tx.update('orders', orderId, {
          items: updatedItems,
          subtotal: newSubtotal,
          total: newTotal,
          total_cost_estimated: newCogs,
          round_count: currentRound,
          status: 'PENDIENTE', // Vuelve a PENDIENTE en cocina para que vean la nueva ronda
          updated_at: now
        });

        return { order: updatedOrder, newItems: formattedItems };
      });

      // Notificar a cocina (KDS) y al salón de mesas en tiempo real
      broadcastEvent('ORDER_ITEMS_ADDED', { order: order.order, newItems: order.newItems });
      broadcastEvent('ORDER_STATUS_CHANGED', order.order);
      broadcastEvent('TABLE_STATUS_CHANGED', { orderId, status: 'UPDATED' });

      return sendJson(res, 200, { success: true, order: order.order, addedItems: order.newItems });
    }

    // Cierre de Mesa y Cobro de Cuenta (Pagar cuenta abierta)
    if (pathname.startsWith('/api/orders/') && pathname.endsWith('/checkout') && method === 'POST') {
      const orderId = pathname.split('/')[3];
      const body = await parseJsonBody(req);
      const payments = body.payments || [];

      if (!payments.length) {
        return sendJson(res, 400, { error: 'Debe especificar al menos un método de pago para cerrar la mesa.' });
      }

      const result = await db.transaction(async (tx) => {
        const order = tx.find('orders', o => o.id === orderId);
        if (!order) {
          throw new Error('Pedido no encontrado');
        }
        if (order.payment_status === 'PAGADO') {
          throw new Error('Este pedido ya se encuentra pagado.');
        }

        const now = new Date().toISOString();
        const discount = body.discount !== undefined ? Number(body.discount) : (order.discount || 0);
        const finalTotal = (order.subtotal || order.total) - discount;

        // Registrar cada pago en order_payments y acreditar en caja activa
        for (const pay of payments) {
          const payRecord = {
            id: tx.nextCode('PAY', 'order_payments'),
            order_id: orderId,
            method: pay.method,
            amount: Number(pay.amount),
            reference: pay.reference || null,
            cash_tendered: Number(pay.cash_tendered) || Number(pay.amount),
            cash_change: Number(pay.cash_change) || 0,
            user_id: body.user_id || order.user_id || 'USR-002',
            created_at: now
          };
          tx.insert('order_payments', payRecord);

          // Si hay caja abierta, registrar el movimiento
          const cashRegId = body.cash_register_id || order.cash_register_id;
          if (cashRegId) {
            CashService.applyOrderPayment(
              cashRegId,
              pay.method,
              pay.amount,
              body.user_id || order.user_id || 'USR-002',
              orderId,
              tx
            );
          }
        }

        const updatedOrder = tx.update('orders', orderId, {
          payment_status: 'PAGADO',
          discount: discount,
          total: finalTotal,
          paid_at: now,
          updated_at: now
        });

        return updatedOrder;
      });

      broadcastEvent('ORDER_STATUS_CHANGED', result);
      broadcastEvent('TABLE_STATUS_CHANGED', { orderId, status: 'LIBRE' });

      return sendJson(res, 200, { success: true, order: result, message: 'Mesa cerrada y cobrada exitosamente.' });
    }

    // Cancelar orden de mesa
    if (pathname.startsWith('/api/orders/') && pathname.endsWith('/cancel') && method === 'POST') {
      const orderId = pathname.split('/')[3];
      const body = await parseJsonBody(req);
      const now = new Date().toISOString();

      const updated = db.update('orders', orderId, {
        status: 'CANCELADO',
        payment_status: 'CANCELADO',
        cancellation_reason: body.reason || 'Cancelado por el salón',
        updated_at: now
      });

      broadcastEvent('ORDER_STATUS_CHANGED', updated);
      broadcastEvent('TABLE_STATUS_CHANGED', { orderId, status: 'LIBRE' });
      return sendJson(res, 200, { success: true, order: updated });
    }

    // =========================================================================
    // CASH REGISTER & SHIFTS (Caja y Cierres)
    // =========================================================================
    if (pathname === '/api/cash-registers/active' && method === 'GET') {
      const active = CashService.getActiveRegister(null, db);
      return sendJson(res, 200, active || null);
    }

    if (pathname === '/api/cash-registers' && method === 'GET') {
      return sendJson(res, 200, db.getAll('cash_registers'));
    }

    if (pathname === '/api/cash-registers/open' && method === 'POST') {
      if (!checkPermission(req, res, 'cash_register')) return;
      const body = await parseJsonBody(req);
      const reg = CashService.openRegister(body, db);
      broadcastEvent('CASH_REGISTER_CHANGED', reg);
      return sendJson(res, 201, reg);
    }

    if (pathname === '/api/cash-registers/movements' && method === 'POST') {
      if (!checkPermission(req, res, 'cash_register')) return;
      const body = await parseJsonBody(req);
      const result = CashService.registerMovement(body, db);
      broadcastEvent('CASH_REGISTER_CHANGED', result.register);
      return sendJson(res, 200, result);
    }

    if (pathname === '/api/cash-registers/close' && method === 'POST') {
      if (!checkPermission(req, res, 'cash_register')) return;
      const body = await parseJsonBody(req);
      const closed = CashService.closeRegister(body, db);
      broadcastEvent('CASH_REGISTER_CHANGED', closed);
      return sendJson(res, 200, closed);
    }

    // =========================================================================
    // EXCEL EXPORT (Section 15: 8 sheets closure XLSX)
    // =========================================================================
    if (pathname === '/api/export/excel/closure' && method === 'GET') {
      if (!checkPermission(req, res, 'all')) return;
      const registerId = url.searchParams.get('registerId');
      const startDate = url.searchParams.get('startDate');
      const endDate = url.searchParams.get('endDate');

      const xlsxBuffer = ExcelService.generateClosureExcel({ registerId, startDate, endDate });
      const filename = `Boca2Wings_Cierre_${new Date().toISOString().split('T')[0]}.xlsx`;

      res.writeHead(200, {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': xlsxBuffer.length,
        'Access-Control-Allow-Origin': '*'
      });
      return res.end(xlsxBuffer);
    }

    // =========================================================================
    // SUPPLIERS & PURCHASES
    // =========================================================================
    if (pathname === '/api/suppliers' && method === 'GET') {
      return sendJson(res, 200, db.getAll('suppliers'));
    }

    if (pathname === '/api/suppliers' && method === 'POST') {
      const body = await parseJsonBody(req);
      const newSup = {
        id: db.nextCode('SUP', 'suppliers'),
        name: body.name,
        contact_name: body.contact_name || '',
        phone: body.phone || '',
        email: body.email || '',
        address: body.address || '',
        active: true
      };
      db.insert('suppliers', newSup);
      return sendJson(res, 201, newSup);
    }

    if (pathname === '/api/purchases' && method === 'GET') {
      return sendJson(res, 200, db.getAll('purchase_orders'));
    }

    if (pathname === '/api/purchases' && method === 'POST') {
      const body = await parseJsonBody(req);
      const newPo = {
        id: db.nextCode('OC', 'purchase_orders'),
        supplier_id: body.supplier_id,
        user_id: body.user_id || 'USR-004',
        status: 'SOLICITADA',
        invoice_number: body.invoice_number || '',
        total: Number(body.total) || 0,
        notes: body.notes || '',
        items: body.items || [],
        ordered_at: new Date().toISOString(),
        received_at: null
      };
      db.insert('purchase_orders', newPo);
      return sendJson(res, 201, newPo);
    }

    if (pathname.startsWith('/api/purchases/') && pathname.endsWith('/receive') && method === 'POST') {
      const poId = pathname.split('/')[3];
      const body = await parseJsonBody(req);
      const po = db.find('purchase_orders', p => p.id === poId);
      if (!po) {
        return sendJson(res, 404, { error: 'Orden de compra no encontrada' });
      }

      const receivedItems = body.items || po.items || [];
      const movements = InventoryService.processPurchaseReceipt(po, receivedItems, body.user_id || 'USR-004', db);

      db.update('purchase_orders', po.id, {
        status: 'RECIBIDA',
        received_at: new Date().toISOString()
      });

      broadcastEvent('STOCK_UPDATED', { movements });
      return sendJson(res, 200, { success: true, movements });
    }

    // =========================================================================
    // WASTE (Desperdicios) & EXPENSES (Gastos)
    // =========================================================================
    if (pathname === '/api/waste' && method === 'GET') {
      return sendJson(res, 200, db.getAll('waste_records'));
    }

    if (pathname === '/api/waste' && method === 'POST') {
      const body = await parseJsonBody(req);
      const result = InventoryService.processWaste(body, body.user_id || 'USR-001', db);
      broadcastEvent('STOCK_UPDATED', { waste: result });
      return sendJson(res, 201, result);
    }

    if (pathname === '/api/expenses' && method === 'GET') {
      if (!checkPermission(req, res, 'all')) return;
      return sendJson(res, 200, db.getAll('expenses'));
    }

    if (pathname === '/api/expenses' && method === 'POST') {
      if (!checkPermission(req, res, 'all')) return;
      const body = await parseJsonBody(req);
      const newExp = {
        id: db.nextCode('EXP', 'expenses'),
        category: body.category || 'OTROS',
        description: body.description,
        amount: Number(body.amount) || 0,
        payment_method: body.payment_method || 'EFECTIVO',
        paid_from_cash_register_id: body.paid_from_cash_register_id || null,
        user_id: body.user_id || 'USR-001',
        date: body.date || new Date().toISOString().split('T')[0],
        created_at: new Date().toISOString()
      };
      db.insert('expenses', newExp);
      return sendJson(res, 201, newExp);
    }

    // =========================================================================
    // CUSTOMERS (Clientes)
    // =========================================================================
    if (pathname === '/api/customers' && method === 'GET') {
      return sendJson(res, 200, db.getAll('customers'));
    }

    if (pathname === '/api/customers' && method === 'POST') {
      const body = await parseJsonBody(req);
      const newCust = {
        id: db.nextCode('CUST', 'customers'),
        name: body.name,
        phone: body.phone || '',
        email: body.email || '',
        address: body.address || '',
        notes: body.notes || '',
        order_count: 0,
        total_spent: 0,
        created_at: new Date().toISOString()
      };
      db.insert('customers', newCust);
      return sendJson(res, 201, newCust);
    }

    // =========================================================================
    // DASHBOARD KPI & REPORTS
    // =========================================================================
    if (pathname === '/api/reports/dashboard' && method === 'GET') {
      if (!checkPermission(req, res, 'all')) return;
      const orders = db.getAll('orders').filter(o => o.status !== 'CANCELADO');
      const orderItems = db.getAll('order_items');
      const ingredients = db.getAll('ingredients');
      const expenses = db.getAll('expenses');
      const registers = db.getAll('cash_registers');

      const todayStr = new Date().toISOString().split('T')[0];
      const todayOrders = orders.filter(o => o.created_at.startsWith(todayStr));

      const todaySales = todayOrders.reduce((sum, o) => sum + (Number(o.total) || 0), 0);
      const totalSales = orders.reduce((sum, o) => sum + (Number(o.total) || 0), 0);
      const totalCogs = orders.reduce((sum, o) => sum + (Number(o.total_cost_estimated) || 0), 0);
      const totalExpenses = expenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
      const grossMargin = totalSales - totalCogs;
      const operatingResult = grossMargin - totalExpenses;

      // Low stock & out of stock ingredients
      const lowStock = ingredients.filter(i => i.stock_current <= i.stock_min && i.stock_current > 0);
      const outOfStock = ingredients.filter(i => i.stock_current <= 0);

      // Pending kitchen orders
      const pendingKitchen = db.getAll('orders').filter(o => o.status === 'PENDIENTE' || o.status === 'EN_PREPARACION');

      return sendJson(res, 200, {
        todaySales,
        todayOrdersCount: todayOrders.length,
        totalSales,
        totalOrdersCount: orders.length,
        totalCogs,
        grossMargin,
        totalExpenses,
        operatingResult,
        lowStockCount: lowStock.length,
        lowStockItems: lowStock,
        outOfStockCount: outOfStock.length,
        outOfStockItems: outOfStock,
        pendingKitchenCount: pendingKitchen.length,
        pendingKitchenOrders: pendingKitchen,
        activeRegister: CashService.getActiveRegister(null, db)
      });
    }

    // =========================================================================
    // STATIC ASSETS & SPA SERVING
    // =========================================================================
    serveStatic(req, res, pathname);

  } catch (err) {
    console.error('API Error:', err);
    sendJson(res, 500, { error: err.message || 'Error interno del servidor' });
  }
});

server.listen(PORT, () => {
  console.log(`=================================================================`);
  console.log(`🍗 BOCA2 WINGS POS — Servidor activo en http://localhost:${PORT}`);
  console.log(`📊 API REST & KDS Realtime SSE disponibles`);
  console.log(`📁 Logo oficial cargado en /logo.png`);
  console.log(`=================================================================`);
});
