import zlib from 'zlib';
import { db } from '../db/database.js';

// Precomputed CRC32 table
const crcTable = new Int32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  }
  crcTable[n] = c;
}

function calculateCrc32(buf) {
  let crc = 0 ^ (-1);
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ buf[i]) & 0xFF];
  }
  return (crc ^ (-1)) >>> 0;
}

function createZip(files) {
  const localHeaders = [];
  const centralHeaders = [];
  let offset = 0;

  for (const file of files) {
    const filenameBuf = Buffer.from(file.name, 'utf8');
    const contentBuf = Buffer.isBuffer(file.content) ? file.content : Buffer.from(file.content, 'utf8');
    const compressed = zlib.deflateRawSync(contentBuf);
    const crc = calculateCrc32(contentBuf);

    // Local Header (30 bytes + name)
    const lh = Buffer.alloc(30 + filenameBuf.length);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0, 6);
    lh.writeUInt16LE(8, 8);
    lh.writeUInt16LE(0, 10);
    lh.writeUInt16LE(0, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(compressed.length, 18);
    lh.writeUInt32LE(contentBuf.length, 22);
    lh.writeUInt16LE(filenameBuf.length, 26);
    lh.writeUInt16LE(0, 28);
    filenameBuf.copy(lh, 30);

    localHeaders.push(lh, compressed);

    // Central Dir Header (46 bytes + name)
    const ch = Buffer.alloc(46 + filenameBuf.length);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0, 8);
    ch.writeUInt16LE(8, 10);
    ch.writeUInt16LE(0, 12);
    ch.writeUInt16LE(0, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(compressed.length, 20);
    ch.writeUInt32LE(contentBuf.length, 24);
    ch.writeUInt16LE(filenameBuf.length, 28);
    ch.writeUInt16LE(0, 30);
    ch.writeUInt16LE(0, 32);
    ch.writeUInt16LE(0, 34);
    ch.writeUInt16LE(0, 36);
    ch.writeUInt32LE(0, 38);
    ch.writeUInt32LE(offset, 42);
    filenameBuf.copy(ch, 46);

    centralHeaders.push(ch);
    offset += lh.length + compressed.length;
  }

  const centralDirOffset = offset;
  let centralDirSize = 0;
  for (const ch of centralHeaders) centralDirSize += ch.length;

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralDirSize, 12);
  eocd.writeUInt32LE(centralDirOffset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localHeaders, ...centralHeaders, eocd]);
}

function escapeXml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function colLetter(colIdx) {
  let letter = '';
  let temp = colIdx;
  while (temp >= 0) {
    letter = String.fromCharCode((temp % 26) + 65) + letter;
    temp = Math.floor(temp / 26) - 1;
  }
  return letter;
}

export class ExcelService {
  /**
   * Generates a complete 8-sheet XLSX buffer complying with all specifications
   * @param {Object} options - { registerId, startDate, endDate }
   */
  static generateClosureExcel(options = {}) {
    const { registerId, startDate, endDate } = options;

    let orders = db.getAll('orders');
    let orderItems = db.getAll('order_items');
    let payments = db.getAll('order_payments');
    let movements = db.getAll('inventory_movements');
    let registers = db.getAll('cash_registers');
    let expenses = db.getAll('expenses');
    let products = db.getAll('products');
    let users = db.getAll('users');

    let activeRegister = null;
    if (registerId) {
      activeRegister = registers.find(r => r.id === registerId);
      if (activeRegister) {
        orders = orders.filter(o => o.cash_register_id === registerId);
      }
    } else {
      activeRegister = registers[registers.length - 1] || null;
    }

    if (startDate && endDate) {
      const start = new Date(startDate).getTime();
      const end = new Date(endDate).getTime();
      orders = orders.filter(o => {
        const t = new Date(o.created_at).getTime();
        return t >= start && t <= end;
      });
    }

    const orderIds = new Set(orders.map(o => o.id));
    orderItems = orderItems.filter(i => orderIds.has(i.order_id));
    payments = payments.filter(p => orderIds.has(p.order_id));
    movements = movements.filter(m => m.order_id && orderIds.has(m.order_id));

    // Shared Strings Pool
    const sharedStrings = [];
    const stringMap = new Map();

    function getSstId(text) {
      const s = String(text ?? '');
      if (stringMap.has(s)) return stringMap.get(s);
      const id = sharedStrings.length;
      sharedStrings.push(s);
      stringMap.set(s, id);
      return id;
    }

    function buildSheetXml(sheetTitle, rows) {
      let sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n`;
      sheetXml += `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">\n`;
      sheetXml += `  <sheetViews><sheetView tabSelected="1" workbookViewId="0"/></sheetViews>\n`;
      sheetXml += `  <sheetFormatPr defaultRowHeight="18"/>\n`;
      sheetXml += `  <sheetData>\n`;

      rows.forEach((row, rIdx) => {
        const rowNumber = rIdx + 1;
        sheetXml += `    <row r="${rowNumber}">\n`;
        row.forEach((cell, cIdx) => {
          const cellRef = `${colLetter(cIdx)}${rowNumber}`;
          if (cell === null || cell === undefined || cell === '') {
            return;
          }
          if (typeof cell === 'number') {
            sheetXml += `      <c r="${cellRef}"><v>${cell}</v></c>\n`;
          } else {
            const sstId = getSstId(cell);
            sheetXml += `      <c r="${cellRef}" t="s"><v>${sstId}</v></c>\n`;
          }
        });
        sheetXml += `    </row>\n`;
      });

      sheetXml += `  </sheetData>\n`;
      sheetXml += `</worksheet>`;
      return sheetXml;
    }

    // =========================================================================
    // HOJA 1: RESUMEN DEL CIERRE
    // =========================================================================
    const validOrders = orders.filter(o => o.status !== 'CANCELADO');
    const cancelledOrders = orders.filter(o => o.status === 'CANCELADO');

    const totalOrdersCount = validOrders.length;
    const unitsSold = orderItems
      .filter(i => validOrders.some(vo => vo.id === i.order_id))
      .reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);

    const grossSales = validOrders.reduce((sum, o) => sum + (Number(o.subtotal) || 0), 0);
    const totalDiscounts = validOrders.reduce((sum, o) => sum + (Number(o.discount) || 0), 0);
    const totalTax = validOrders.reduce((sum, o) => sum + (Number(o.tax) || 0), 0);
    const netSales = validOrders.reduce((sum, o) => sum + (Number(o.total) || 0), 0);
    const paymentsReceived = payments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
    const pendingBalance = Math.max(0, netSales - paymentsReceived);

    const totalCogs = validOrders.reduce((sum, o) => sum + (Number(o.total_cost_estimated) || 0), 0);
    const grossMargin = netSales - totalCogs;
    const grossMarginPercent = netSales > 0 ? ((grossMargin / netSales) * 100).toFixed(1) + '%' : '0%';

    // Cash register metrics
    const initialFund = activeRegister ? Number(activeRegister.initial_fund || 0) : 0;
    const cashEntries = activeRegister ? Number(activeRegister.cash_entries || 0) : 0;
    const cashWithdrawals = activeRegister ? Number(activeRegister.cash_withdrawals || 0) : 0;
    const cashExpenses = activeRegister ? Number(activeRegister.cash_expenses || 0) : 0;
    const cashRefunds = activeRegister ? Number(activeRegister.cash_refunds || 0) : 0;
    const expectedCash = activeRegister ? Number(activeRegister.expected_cash || 0) : 0;
    const countedCash = activeRegister ? (activeRegister.counted_cash ?? expectedCash) : expectedCash;
    const cashDiff = countedCash - expectedCash;

    // Payments by method
    const paymentMethodsSummary = {};
    for (const p of payments) {
      const m = p.method || 'OTRO';
      paymentMethodsSummary[m] = (paymentMethodsSummary[m] || 0) + Number(p.amount || 0);
    }

    const sheet1Rows = [
      ['BOCA2 WINGS — INFORME OFICIAL DE CIERRE Y GESTIÓN', '', ''],
      ['Fecha de Generación:', new Date().toLocaleString('es-CO'), ''],
      ['Identificador de Cierre:', activeRegister ? activeRegister.code : 'CONSOLIDADO', ''],
      ['Responsable:', activeRegister ? (users.find(u => u.id === activeRegister.opened_by_user_id)?.name || 'Cajero') : 'Administración', ''],
      ['', '', ''],
      ['MÉTRICA OPERATIVA', 'VALOR', 'NOTAS'],
      ['Total de Pedidos Realizados', totalOrdersCount, 'Pedidos válidos y confirmados'],
      ['Unidades Vendidas', unitsSold, 'Total de productos despachados'],
      ['Ventas Brutas (COP)', grossSales, 'Subtotal antes de descuentos e impuestos'],
      ['Descuentos Aplicados (COP)', totalDiscounts, 'Promociones autorizadas'],
      ['Impuestos (COP)', totalTax, 'Impoconsumo / IVA'],
      ['Ventas Netas (COP)', netSales, 'Total facturado exigible'],
      ['Pagos Recibidos (COP)', paymentsReceived, 'Recaudado en todos los métodos'],
      ['Saldo Pendiente de Cobro (COP)', pendingBalance, 'Cuentas por cobrar'],
      ['Costo de Productos Vendidos (COGS)', totalCogs, 'Costo teórico según recetas'],
      ['Margen Bruto Estimado (COP)', grossMargin, 'Ventas Netas - COGS'],
      ['Margen Bruto (%)', grossMarginPercent, 'Rentabilidad sobre ventas'],
      ['', '', ''],
      ['CONCILIACIÓN DE CAJA FÍSICA', 'VALOR', 'DETALLE'],
      ['Fondo Inicial (Base)', initialFund, 'Efectivo con el que se abrió caja'],
      ['Ventas Cobradas en Efectivo', activeRegister?.cash_sales || 0, 'Solo dinero físico recibido'],
      ['Entradas Extraordinarias de Efectivo', cashEntries, 'Ingresos manuales de caja'],
      ['Retiros de Efectivo', cashWithdrawals, 'Salidas autorizadas'],
      ['Gastos Pagados en Efectivo', cashExpenses, 'Compras menores y egresos'],
      ['Reembolsos Pagados en Efectivo', cashRefunds, 'Devoluciones en físico'],
      ['Efectivo Físico Esperado (COP)', expectedCash, 'Fórmula: Base + Ventas - Egresos'],
      ['Efectivo Físico Contado (Arqueo)', countedCash, 'Conteo físico real del cajero'],
      ['Diferencia de Caja (COP)', cashDiff, cashDiff === 0 ? 'Caja cuadrada exactamente' : (cashDiff > 0 ? 'Sobrante' : 'Faltante')],
      ['', '', ''],
      ['PAGOS POR MÉTODO', 'TOTAL RECAUDADO (COP)', '']
    ];

    for (const [method, amount] of Object.entries(paymentMethodsSummary)) {
      sheet1Rows.push([`Método: ${method}`, amount, '']);
    }

    // =========================================================================
    // HOJA 2: DETALLE DE PEDIDOS
    // =========================================================================
    const sheet2Rows = [
      [
        'Número de Pedido', 'Fecha', 'Hora', 'Cliente', 'Tipo de Pedido',
        'Mesa / Referencia', 'Cajero', 'Cant. Unidades', 'Subtotal',
        'Descuento', 'Impuestos', 'Total', 'Valor Pagado', 'Saldo Pendiente',
        'Método(s) de Pago', 'Estado Pago', 'Estado Pedido', 'Observaciones'
      ]
    ];

    for (const order of orders) {
      const orderDate = new Date(order.created_at);
      const cashier = users.find(u => u.id === order.user_id)?.name || 'Cajero';
      const orderItemsList = orderItems.filter(i => i.order_id === order.id);
      const units = orderItemsList.reduce((acc, i) => acc + (Number(i.quantity) || 0), 0);
      const orderPayments = payments.filter(p => p.order_id === order.id);
      const paid = orderPayments.reduce((acc, p) => acc + (Number(p.amount) || 0), 0);
      const pending = Math.max(0, Number(order.total) - paid);
      const methods = orderPayments.map(p => p.method).join(', ') || 'PENDIENTE';

      sheet2Rows.push([
        order.id,
        orderDate.toLocaleDateString('es-CO'),
        orderDate.toLocaleTimeString('es-CO'),
        order.customer_name || 'Cliente Mostrador',
        order.order_type || 'MESA',
        order.table_number || order.delivery_address || 'Mostrador',
        cashier,
        units,
        Number(order.subtotal) || 0,
        Number(order.discount) || 0,
        Number(order.tax) || 0,
        Number(order.total) || 0,
        paid,
        pending,
        methods,
        order.payment_status || 'PAGADO',
        order.status || 'ENTREGADO',
        order.notes || ''
      ]);
    }

    // =========================================================================
    // HOJA 3: PRODUCTOS VENDIDOS
    // =========================================================================
    const sheet3Rows = [
      [
        'Número de Pedido', 'Fecha', 'Hora', 'Cliente', 'Código Producto',
        'Nombre del Producto', 'Categoría', 'Variante', 'Cantidad',
        'Precio Unitario', 'Descuento', 'Subtotal', 'Impuestos', 'Total Línea',
        'Costo Unit. Estimado', 'Costo Total Estimado', 'Margen Bruto Línea', 'Cajero'
      ]
    ];

    for (const item of orderItems) {
      const order = orders.find(o => o.id === item.order_id);
      if (!order) continue;
      const orderDate = new Date(order.created_at);
      const prod = products.find(p => p.id === item.product_id);
      const cashier = users.find(u => u.id === order.user_id)?.name || 'Cajero';
      const qty = Number(item.quantity) || 1;
      const unitPrice = Number(item.unit_price) || 0;
      const lineSubtotal = Number(item.subtotal) || (unitPrice * qty);
      const lineTotal = Number(item.total) || lineSubtotal;
      const unitCost = Number(item.unit_cost) || (prod ? Number(prod.cost_estimated) : 0);
      const totalCost = unitCost * qty;
      const lineMargin = lineTotal - totalCost;

      sheet3Rows.push([
        order.id,
        orderDate.toLocaleDateString('es-CO'),
        orderDate.toLocaleTimeString('es-CO'),
        order.customer_name || 'Cliente Mostrador',
        prod?.code || item.product_id,
        item.name || prod?.name || 'Producto',
        prod?.category_id || 'Comidas Rápidas',
        item.variant_name || '-',
        qty,
        unitPrice,
        Number(item.discount) || 0,
        lineSubtotal,
        Number(item.tax) || 0,
        lineTotal,
        unitCost,
        totalCost,
        lineMargin,
        cashier
      ]);
    }

    // =========================================================================
    // HOJA 4: PAGOS
    // =========================================================================
    const sheet4Rows = [
      [
        'Número de Pedido', 'Fecha y Hora', 'Cliente', 'Método de Pago',
        'Referencia / Transacción', 'Valor Pagado (COP)', 'Efectivo Recibido',
        'Cambio Devuelto', 'Estado', 'Cajero', 'Observaciones'
      ]
    ];

    for (const p of payments) {
      const order = orders.find(o => o.id === p.order_id);
      const cashier = users.find(u => u.id === p.user_id)?.name || 'Cajero';
      sheet4Rows.push([
        p.order_id,
        new Date(p.created_at || order?.created_at || Date.now()).toLocaleString('es-CO'),
        order?.customer_name || 'Cliente Mostrador',
        p.method,
        p.reference || 'N/A',
        Number(p.amount) || 0,
        Number(p.cash_tendered) || Number(p.amount) || 0,
        Number(p.cash_change) || 0,
        'APROBADO',
        cashier,
        p.notes || ''
      ]);
    }

    // =========================================================================
    // HOJA 5: INVENTARIO Y CONSUMO
    // =========================================================================
    const sheet5Rows = [
      [
        'ID Movimiento', 'Número de Pedido', 'Fecha y Hora', 'Ingrediente Consumido',
        'Cantidad Consumida', 'Unidad de Medida', 'Stock Anterior', 'Stock Posterior',
        'Costo Unitario (COP)', 'Costo Total Consumo (COP)', 'Motivo / Referencia'
      ]
    ];

    for (const m of movements) {
      sheet5Rows.push([
        m.id,
        m.order_id || 'N/A',
        new Date(m.created_at).toLocaleString('es-CO'),
        m.ingredient_name || m.ingredient_id,
        Math.abs(Number(m.quantity)),
        m.unit,
        Number(m.previous_stock),
        Number(m.new_stock),
        Number(m.unit_cost),
        Number(m.total_cost),
        m.reason || 'Descuento automático por venta'
      ]);
    }

    // =========================================================================
    // HOJA 6: PRODUCTOS MÁS VENDIDOS
    // =========================================================================
    const productStats = new Map();
    for (const item of orderItems) {
      const order = orders.find(o => o.id === item.order_id);
      if (!order || order.status === 'CANCELADO') continue;

      const pId = item.product_id;
      if (!productStats.has(pId)) {
        productStats.set(pId, {
          productId: pId,
          name: item.name || pId,
          category: item.category || 'General',
          unitsSold: 0,
          ordersCount: 0,
          netRevenue: 0,
          totalCost: 0
        });
      }
      const st = productStats.get(pId);
      const qty = Number(item.quantity) || 1;
      st.unitsSold += qty;
      st.ordersCount += 1;
      st.netRevenue += Number(item.total) || 0;
      st.totalCost += (Number(item.unit_cost) || 0) * qty;
    }

    const sortedStats = Array.from(productStats.values()).sort((a, b) => b.unitsSold - a.unitsSold);
    const totalRevenueAll = sortedStats.reduce((acc, s) => acc + s.netRevenue, 0);

    const sheet6Rows = [
      [
        'Código / ID', 'Producto', 'Categoría', 'Unidades Vendidas',
        'Número de Pedidos', 'Ingresos Netos (COP)', 'Costo Total Estimado',
        'Margen Bruto (COP)', 'Participación (%)'
      ]
    ];

    for (const s of sortedStats) {
      const margin = s.netRevenue - s.totalCost;
      const share = totalRevenueAll > 0 ? ((s.netRevenue / totalRevenueAll) * 100).toFixed(1) + '%' : '0%';
      sheet6Rows.push([
        s.productId,
        s.name,
        s.category,
        s.unitsSold,
        s.ordersCount,
        s.netRevenue,
        s.totalCost,
        margin,
        share
      ]);
    }

    // =========================================================================
    // HOJA 7: CIERRE DE CAJA
    // =========================================================================
    const sheet7Rows = [
      [
        'ID Turno / Caja', 'Fecha y Hora Apertura', 'Fecha y Hora Cierre', 'Cajero Responsable',
        'Fondo Inicial', 'Ventas en Efectivo', 'Entradas de Efectivo', 'Retiros de Efectivo',
        'Gastos en Efectivo', 'Reembolsos', 'Efectivo Esperado', 'Efectivo Contado',
        'Diferencia', 'Transferencias', 'Tarjetas / Otros', 'Estado Turno', 'Observaciones'
      ]
    ];

    for (const r of registers) {
      const cashier = users.find(u => u.id === r.opened_by_user_id)?.name || 'Cajero';
      sheet7Rows.push([
        r.code || r.id,
        new Date(r.opened_at).toLocaleString('es-CO'),
        r.closed_at ? new Date(r.closed_at).toLocaleString('es-CO') : 'EN CURSO',
        cashier,
        Number(r.initial_fund) || 0,
        Number(r.cash_sales) || 0,
        Number(r.cash_entries) || 0,
        Number(r.cash_withdrawals) || 0,
        Number(r.cash_expenses) || 0,
        Number(r.cash_refunds) || 0,
        Number(r.expected_cash) || 0,
        r.counted_cash !== null ? Number(r.counted_cash) : '-',
        r.cash_difference !== null ? Number(r.cash_difference) : '-',
        Number(r.transfer_sales) || 0,
        Number(r.card_sales || 0) + Number(r.other_sales || 0),
        r.status,
        r.notes || ''
      ]);
    }

    // =========================================================================
    // HOJA 8: ANULACIONES Y DEVOLUCIONES
    // =========================================================================
    const sheet8Rows = [
      [
        'Pedido Original', 'Fecha de Venta', 'Fecha de Anulación / Devolución',
        'Total Pedido (COP)', 'Motivo de Cancelación', 'Responsable',
        'Tratamiento de Inventario', 'Estado Reembolso', 'Observaciones'
      ]
    ];

    for (const co of cancelledOrders) {
      const cashier = users.find(u => u.id === co.user_id)?.name || 'Cajero';
      sheet8Rows.push([
        co.id,
        new Date(co.created_at).toLocaleString('es-CO'),
        new Date(co.updated_at || co.created_at).toLocaleString('es-CO'),
        Number(co.total) || 0,
        co.cancellation_reason || 'Cancelación solicitada por cliente',
        cashier,
        'Ingredientes no consumidos revertidos / merma registrada',
        'REEMBOLSADO',
        co.notes || ''
      ]);
    }

    // Generate XML for each of the 8 sheets
    const sheetsData = [
      { name: 'Resumen Cierre', rows: sheet1Rows },
      { name: 'Detalle Pedidos', rows: sheet2Rows },
      { name: 'Productos Vendidos', rows: sheet3Rows },
      { name: 'Pagos', rows: sheet4Rows },
      { name: 'Inventario y Consumo', rows: sheet5Rows },
      { name: 'Top Productos', rows: sheet6Rows },
      { name: 'Cierre de Caja', rows: sheet7Rows },
      { name: 'Anulaciones', rows: sheet8Rows }
    ];

    const xmlSheets = sheetsData.map((s, idx) => ({
      name: `xl/worksheets/sheet${idx + 1}.xml`,
      content: buildSheetXml(s.name, s.rows)
    }));

    // Shared Strings Table XML
    let sstXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n`;
    sstXml += `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${sharedStrings.length}" uniqueCount="${sharedStrings.length}">\n`;
    for (const s of sharedStrings) {
      sstXml += `  <si><t xml:space="preserve">${escapeXml(s)}</t></si>\n`;
    }
    sstXml += `</sst>`;

    // Workbook XML
    let wbXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n`;
    wbXml += `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">\n`;
    wbXml += `  <sheets>\n`;
    sheetsData.forEach((s, idx) => {
      wbXml += `    <sheet name="${escapeXml(s.name)}" sheetId="${idx + 1}" r:id="rId${idx + 1}"/>\n`;
    });
    wbXml += `  </sheets>\n`;
    wbXml += `</workbook>`;

    // Workbook Rels
    let wbRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n`;
    wbRelsXml += `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n`;
    sheetsData.forEach((s, idx) => {
      wbRelsXml += `  <Relationship Id="rId${idx + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${idx + 1}.xml"/>\n`;
    });
    wbRelsXml += `  <Relationship Id="rIdSst" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>\n`;
    wbRelsXml += `</Relationships>`;

    // Content Types
    let ctXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n`;
    ctXml += `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n`;
    ctXml += `  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n`;
    ctXml += `  <Default Extension="xml" ContentType="application/xml"/>\n`;
    ctXml += `  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>\n`;
    ctXml += `  <Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>\n`;
    sheetsData.forEach((s, idx) => {
      ctXml += `  <Override PartName="/xl/worksheets/sheet${idx + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>\n`;
    });
    ctXml += `</Types>`;

    // Root Rels
    const relsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>\n</Relationships>`;

    const zipFiles = [
      { name: '[Content_Types].xml', content: ctXml },
      { name: '_rels/.rels', content: relsXml },
      { name: 'xl/workbook.xml', content: wbXml },
      { name: 'xl/_rels/workbook.xml.rels', content: wbRelsXml },
      { name: 'xl/sharedStrings.xml', content: sstXml },
      ...xmlSheets
    ];

    return createZip(zipFiles);
  }
}

export default ExcelService;
