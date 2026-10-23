import { db } from '../db/database.js';

export class InventoryService {
  /**
   * Deduct ingredients for an order atomically
   * @param {Object} order - Full order object with items
   * @param {string} userId - User confirming the order
   * @param {Object} tx - Active database instance or transaction context
   */
  static processOrderDeduction(order, userId, tx = db) {
    const movements = [];
    const settings = tx.getAll('settings');
    const allowNegative = settings.allow_negative_stock || false;

    // 1. Calculate total ingredient requirements for all items in order
    const requiredIngredients = new Map(); // ingredientId -> { ingredient, totalNeeded, unit, unitCost, details: [] }

    for (const item of order.items) {
      // Find recipe for product & variant
      let recipe = null;
      if (item.variant_id) {
        recipe = tx.find('recipes', r => r.product_id === item.product_id && r.variant_id === item.variant_id);
      }
      if (!recipe) {
        recipe = tx.find('recipes', r => r.product_id === item.product_id);
      }

      if (!recipe || !recipe.items || recipe.items.length === 0) {
        // Product might not have a configured recipe (or is non-inventoriable)
        continue;
      }

      for (const recipeItem of recipe.items) {
        const ingredient = tx.find('ingredients', i => i.id === recipeItem.ingredient_id);
        if (!ingredient) {
          throw new Error(`Ingrediente no encontrado con ID: ${recipeItem.ingredient_id}`);
        }

        const quantityNeeded = Number(recipeItem.quantity) * Number(item.quantity);

        if (!requiredIngredients.has(ingredient.id)) {
          requiredIngredients.set(ingredient.id, {
            ingredient,
            totalNeeded: 0,
            unit: recipeItem.unit || ingredient.unit,
            unitCost: ingredient.cost_unit,
            itemAllocations: []
          });
        }

        const entry = requiredIngredients.get(ingredient.id);
        entry.totalNeeded += quantityNeeded;
        entry.itemAllocations.push({
          orderItemId: item.id,
          productName: item.name || item.product_id,
          quantity: item.quantity,
          perUnitQty: recipeItem.quantity
        });
      }
    }

    // 2. Validate stock availability if negative stock is not allowed
    if (!allowNegative) {
      for (const [ingredientId, req] of requiredIngredients.entries()) {
        const currentStock = Number(req.ingredient.stock_current);
        if (currentStock < req.totalNeeded) {
          throw new Error(
            `Stock insuficiente para "${req.ingredient.name}". Disponible: ${currentStock.toLocaleString('es-CO')} ${req.ingredient.unit}, Requerido: ${req.totalNeeded.toLocaleString('es-CO')} ${req.ingredient.unit}.`
          );
        }
      }
    }

    // 3. Perform atomic deduction and create movement records
    const now = new Date().toISOString();
    let totalCostEstimated = 0;

    for (const [ingredientId, req] of requiredIngredients.entries()) {
      const prevStock = Number(req.ingredient.stock_current);
      const newStock = prevStock - req.totalNeeded;
      const moveCost = req.totalNeeded * req.unitCost;
      totalCostEstimated += moveCost;

      // Update ingredient stock
      tx.update('ingredients', ingredientId, {
        stock_current: Number(newStock.toFixed(4)),
        updated_at: now
      });

      // Register inventory movement (Kárdex)
      const movement = {
        id: tx.nextCode('MOV', 'inventory_movements'),
        ingredient_id: ingredientId,
        ingredient_name: req.ingredient.name,
        type: 'VENTA_DESCUENTO',
        quantity: -Number(req.totalNeeded.toFixed(4)),
        unit: req.unit,
        previous_stock: Number(prevStock.toFixed(4)),
        new_stock: Number(newStock.toFixed(4)),
        unit_cost: req.unitCost,
        total_cost: Number(moveCost.toFixed(2)),
        order_id: order.id,
        reason: `Venta pedido ${order.id}`,
        user_id: userId,
        created_at: now
      };

      tx.insert('inventory_movements', movement);
      movements.push(movement);
    }

    return { movements, totalCostEstimated };
  }

  /**
   * Process receiving of a purchase order
   */
  static processPurchaseReceipt(purchaseOrder, receivedItems, userId, tx = db) {
    const movements = [];
    const now = new Date().toISOString();

    for (const item of receivedItems) {
      const ingredient = tx.find('ingredients', i => i.id === item.ingredient_id);
      if (!ingredient) continue;

      const prevStock = Number(ingredient.stock_current);
      const qtyReceived = Number(item.quantity_received);
      const newStock = prevStock + qtyReceived;
      const unitCost = item.unit_price || ingredient.cost_unit;

      tx.update('ingredients', ingredient.id, {
        stock_current: Number(newStock.toFixed(4)),
        cost_unit: unitCost,
        updated_at: now
      });

      const movement = {
        id: tx.nextCode('MOV', 'inventory_movements'),
        ingredient_id: ingredient.id,
        ingredient_name: ingredient.name,
        type: 'COMPRA_RECEPCION',
        quantity: Number(qtyReceived.toFixed(4)),
        unit: ingredient.unit,
        previous_stock: Number(prevStock.toFixed(4)),
        new_stock: Number(newStock.toFixed(4)),
        unit_cost: unitCost,
        total_cost: Number((qtyReceived * unitCost).toFixed(2)),
        reference_id: purchaseOrder.id,
        reason: `Recepción Orden de Compra ${purchaseOrder.id} - Fac: ${purchaseOrder.invoice_number || 'S/N'}`,
        user_id: userId,
        created_at: now
      };

      tx.insert('inventory_movements', movement);
      movements.push(movement);
    }

    return movements;
  }

  /**
   * Process waste / mermas
   */
  static processWaste(wasteRecord, userId, tx = db) {
    const ingredient = tx.find('ingredients', i => i.id === wasteRecord.ingredient_id);
    if (!ingredient) {
      throw new Error(`Ingrediente no encontrado con ID: ${wasteRecord.ingredient_id}`);
    }

    const prevStock = Number(ingredient.stock_current);
    const qtyWaste = Number(wasteRecord.quantity);
    const newStock = prevStock - qtyWaste;
    const costUnit = ingredient.cost_unit;
    const totalCost = qtyWaste * costUnit;
    const now = new Date().toISOString();

    tx.update('ingredients', ingredient.id, {
      stock_current: Number(newStock.toFixed(4)),
      updated_at: now
    });

    const wasteId = tx.nextCode('WST', 'waste_records');
    const record = {
      id: wasteId,
      ingredient_id: ingredient.id,
      ingredient_name: ingredient.name,
      quantity: qtyWaste,
      unit: ingredient.unit,
      cost_unit: costUnit,
      total_cost: totalCost,
      reason: wasteRecord.reason || 'DANO',
      notes: wasteRecord.notes || '',
      user_id: userId,
      created_at: now
    };
    tx.insert('waste_records', record);

    const movement = {
      id: tx.nextCode('MOV', 'inventory_movements'),
      ingredient_id: ingredient.id,
      ingredient_name: ingredient.name,
      type: 'DESPERDICIO',
      quantity: -qtyWaste,
      unit: ingredient.unit,
      previous_stock: prevStock,
      new_stock: newStock,
      unit_cost: costUnit,
      total_cost: totalCost,
      reason: `Desperdicio: ${wasteRecord.reason} - ${wasteRecord.notes || ''}`,
      user_id: userId,
      created_at: now
    };
    tx.insert('inventory_movements', movement);

    return { wasteRecord: record, movement };
  }

  /**
   * Physical inventory adjustment
   */
  static processAdjustment(adjustment, userId, tx = db) {
    const ingredient = tx.find('ingredients', i => i.id === adjustment.ingredient_id);
    if (!ingredient) {
      throw new Error('Ingrediente no encontrado');
    }

    const prevStock = Number(ingredient.stock_current);
    const countedStock = Number(adjustment.counted_stock);
    const diff = countedStock - prevStock;
    const now = new Date().toISOString();

    tx.update('ingredients', ingredient.id, {
      stock_current: Number(countedStock.toFixed(4)),
      updated_at: now
    });

    const movement = {
      id: tx.nextCode('MOV', 'inventory_movements'),
      ingredient_id: ingredient.id,
      ingredient_name: ingredient.name,
      type: 'AJUSTE_FISICO',
      quantity: Number(diff.toFixed(4)),
      unit: ingredient.unit,
      previous_stock: prevStock,
      new_stock: countedStock,
      unit_cost: ingredient.cost_unit,
      total_cost: Math.abs(diff) * ingredient.cost_unit,
      reason: `Ajuste Conteo Físico: ${adjustment.reason || 'Diferencia de inventario'}`,
      user_id: userId,
      created_at: now
    };
    tx.insert('inventory_movements', movement);

    return movement;
  }
}

export default InventoryService;
