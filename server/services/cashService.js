import { db } from '../db/database.js';

export class CashService {
  /**
   * Get active open cash register
   */
  static getActiveRegister(userId = null, tx = db) {
    const registers = tx.getAll('cash_registers');
    if (userId) {
      return registers.find(r => r.status === 'ABIERTA' && r.opened_by_user_id === userId) ||
             registers.find(r => r.status === 'ABIERTA');
    }
    return registers.find(r => r.status === 'ABIERTA');
  }

  /**
   * Open a new cash register shift
   */
  static openRegister({ userId, initialFund, notes = '' }, tx = db) {
    // Check if an open register already exists for this user/station
    const active = this.getActiveRegister(userId, tx);
    if (active) {
      throw new Error(`Ya existe una caja abierta con código ${active.code} para este usuario.`);
    }

    const now = new Date().toISOString();
    const code = tx.nextCode('CJ', 'cash_registers');

    const newRegister = {
      id: code,
      code,
      opened_by_user_id: userId,
      closed_by_user_id: null,
      opened_at: now,
      closed_at: null,
      status: 'ABIERTA',
      initial_fund: Number(initialFund) || 0,
      cash_sales: 0,
      transfer_sales: 0,
      card_sales: 0,
      other_sales: 0,
      cash_entries: 0,
      cash_withdrawals: 0,
      cash_expenses: 0,
      cash_refunds: 0,
      expected_cash: Number(initialFund) || 0,
      counted_cash: null,
      cash_difference: null,
      notes,
      reopen_reason: null
    };

    tx.insert('cash_registers', newRegister);

    // Register initial fund movement
    tx.insert('cash_register_movements', {
      id: tx.nextCode('CJM', 'cash_register_movements'),
      cash_register_id: newRegister.id,
      user_id: userId,
      type: 'FONDO_INICIAL',
      amount: Number(initialFund) || 0,
      description: 'Apertura de turno con base inicial',
      created_at: now
    });

    return newRegister;
  }

  /**
   * Register a manual cash movement (Ingreso, Retiro, Gasto)
   */
  static registerMovement({ cashRegisterId, userId, type, amount, description, referenceId = null }, tx = db) {
    const register = tx.find('cash_registers', r => r.id === cashRegisterId);
    if (!register || register.status !== 'ABIERTA') {
      throw new Error('La caja especificada no existe o se encuentra cerrada.');
    }

    const val = Number(amount);
    if (val <= 0) {
      throw new Error('El monto del movimiento debe ser superior a cero.');
    }

    const now = new Date().toISOString();
    const updates = {};

    switch (type) {
      case 'INGRESO':
        updates.cash_entries = Number(register.cash_entries || 0) + val;
        break;
      case 'RETIRO':
        updates.cash_withdrawals = Number(register.cash_withdrawals || 0) + val;
        break;
      case 'GASTO':
        updates.cash_expenses = Number(register.cash_expenses || 0) + val;
        break;
      case 'REEMBOLSO':
        updates.cash_refunds = Number(register.cash_refunds || 0) + val;
        break;
      default:
        throw new Error(`Tipo de movimiento no válido: ${type}`);
    }

    // Recalculate expected cash
    const initial = Number(register.initial_fund || 0);
    const cashSales = Number(register.cash_sales || 0);
    const entries = Number(updates.cash_entries ?? register.cash_entries ?? 0);
    const withdrawals = Number(updates.cash_withdrawals ?? register.cash_withdrawals ?? 0);
    const expenses = Number(updates.cash_expenses ?? register.cash_expenses ?? 0);
    const refunds = Number(updates.cash_refunds ?? register.cash_refunds ?? 0);

    updates.expected_cash = initial + cashSales + entries - withdrawals - expenses - refunds;

    tx.update('cash_registers', register.id, updates);

    const movement = {
      id: tx.nextCode('CJM', 'cash_register_movements'),
      cash_register_id: register.id,
      user_id: userId,
      type,
      amount: val,
      description,
      reference_id: referenceId,
      created_at: now
    };

    tx.insert('cash_register_movements', movement);
    return { register: tx.find('cash_registers', r => r.id === register.id), movement };
  }

  /**
   * Apply order payment to cash register
   */
  static applyOrderPayment(cashRegisterId, paymentMethod, amount, userId, orderId, tx = db) {
    if (!cashRegisterId) return;

    const register = tx.find('cash_registers', r => r.id === cashRegisterId);
    if (!register || register.status !== 'ABIERTA') return;

    const val = Number(amount);
    const updates = {};
    const methodUpper = String(paymentMethod).toUpperCase();

    if (methodUpper === 'EFECTIVO') {
      updates.cash_sales = Number(register.cash_sales || 0) + val;
    } else if (methodUpper.includes('TRANSFER') || methodUpper === 'NEQUI' || methodUpper === 'DAVIPLATA') {
      updates.transfer_sales = Number(register.transfer_sales || 0) + val;
    } else if (methodUpper.includes('TARJETA') || methodUpper === 'DATAFONO') {
      updates.card_sales = Number(register.card_sales || 0) + val;
    } else {
      updates.other_sales = Number(register.other_sales || 0) + val;
    }

    // Expected physical cash ONLY sums physical cash! Transfers are NOT added to physical cash drawer.
    const initial = Number(register.initial_fund || 0);
    const cashSales = Number(updates.cash_sales ?? register.cash_sales ?? 0);
    const entries = Number(register.cash_entries || 0);
    const withdrawals = Number(register.cash_withdrawals || 0);
    const expenses = Number(register.cash_expenses || 0);
    const refunds = Number(register.cash_refunds || 0);

    updates.expected_cash = initial + cashSales + entries - withdrawals - expenses - refunds;

    tx.update('cash_registers', register.id, updates);

    // Movement log
    tx.insert('cash_register_movements', {
      id: tx.nextCode('CJM', 'cash_register_movements'),
      cash_register_id: register.id,
      user_id: userId,
      type: methodUpper === 'EFECTIVO' ? 'VENTA_EFECTIVO' : `VENTA_${methodUpper}`,
      amount: val,
      description: `Pago pedido ${orderId} (${paymentMethod})`,
      reference_id: orderId,
      created_at: new Date().toISOString()
    });
  }

  /**
   * Close cash register shift
   */
  static closeRegister({ cashRegisterId, userId, countedCash, notes = '' }, tx = db) {
    const register = tx.find('cash_registers', r => r.id === cashRegisterId);
    if (!register || register.status !== 'ABIERTA') {
      throw new Error('La caja especificada no está abierta.');
    }

    const counted = Number(countedCash);
    const expected = Number(register.expected_cash || 0);
    const diff = counted - expected;
    const now = new Date().toISOString();

    const updates = {
      closed_by_user_id: userId,
      closed_at: now,
      status: 'CERRADA',
      counted_cash: counted,
      cash_difference: diff,
      notes: notes ? `${register.notes ? register.notes + ' | ' : ''}${notes}` : register.notes
    };

    const updated = tx.update('cash_registers', register.id, updates);

    tx.insert('audit_logs', {
      id: tx.nextCode('AUD', 'audit_logs'),
      user_id: userId,
      action: 'CIERRE_CAJA',
      entity: 'cash_registers',
      entity_id: register.id,
      details: {
        expected_cash: expected,
        counted_cash: counted,
        difference: diff,
        closed_at: now
      },
      created_at: now
    });

    return updated;
  }
}

export default CashService;
