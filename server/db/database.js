import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.resolve(__dirname, '../../data');
const DATA_FILE = path.join(DATA_DIR, 'boca2_db.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Initial default database structure & seed data
const initialData = {
  roles: [
    { id: 'admin', name: 'Administrador', permissions: ['all'] },
    { id: 'cajero', name: 'Cajero', permissions: ['pos', 'cash_register', 'orders_view', 'customers'] },
    { id: 'mesero', name: 'Mesero / Salón', permissions: ['pos', 'orders_view'] },
    { id: 'cocina', name: 'Cocina', permissions: ['kds', 'orders_view'] },
    { id: 'inventario', name: 'Encargado de Inventario', permissions: ['inventory', 'recipes', 'purchases', 'waste'] }
  ],
  users: [
    {
      id: 'USR-001',
      role_id: 'admin',
      name: 'Administrador Boca2',
      email: 'admin@boca2wings.com',
      password: 'admin',
      active: true,
      created_at: '2026-10-23T08:00:00Z'
    },
    {
      id: 'USR-002',
      role_id: 'cajero',
      name: 'Cajero Principal',
      email: 'cajero@boca2wings.com',
      password: 'caja',
      active: true,
      created_at: '2026-10-23T08:00:00Z'
    },
    {
      id: 'USR-005',
      role_id: 'mesero',
      name: 'Mesero de Sala',
      email: 'mesero@boca2wings.com',
      password: 'mesero',
      active: true,
      created_at: '2026-10-23T08:00:00Z'
    },
    {
      id: 'USR-003',
      role_id: 'cocina',
      name: 'Chef de Cocina',
      email: 'cocina@boca2wings.com',
      password: 'cocina',
      active: true,
      created_at: '2026-10-23T08:00:00Z'
    },
    {
      id: 'USR-004',
      role_id: 'inventario',
      name: 'Encargado de Bodega',
      email: 'inventario@boca2wings.com',
      password: 'inv',
      active: true,
      created_at: '2026-10-23T08:00:00Z'
    }
  ],
  categories: [
    { id: 'cat-alitas', name: 'Alitas', slug: 'alitas', icon: 'Flame', sort_order: 1, active: true },
    { id: 'cat-combos', name: 'Combos Boca2', slug: 'combos', icon: 'Sparkles', sort_order: 2, active: true },
    { id: 'cat-papas', name: 'Papas Fritas', slug: 'papas-fritas', icon: 'Utensils', sort_order: 3, active: true },
    { id: 'cat-hamburguesas', name: 'Hamburguesas', slug: 'hamburguesas', icon: 'Beef', sort_order: 4, active: true },
    { id: 'cat-salchipapas', name: 'Salchipapas', slug: 'salchipapas', icon: 'Soup', sort_order: 5, active: true },
    { id: 'cat-perros', name: 'Perros Calientes', slug: 'perros-calientes', icon: 'Sandwich', sort_order: 6, active: true },
    { id: 'cat-bebidas', name: 'Bebidas', slug: 'bebidas', icon: 'CupSoda', sort_order: 7, active: true },
    { id: 'cat-salsas', name: 'Salsas Artesanales', slug: 'salsas', icon: 'Droplet', sort_order: 8, active: true },
    { id: 'cat-adiciones', name: 'Adiciones', slug: 'adiciones', icon: 'PlusCircle', sort_order: 9, active: true }
  ],
  // 8. INVENTARIO INTELIGENTE: Stock inicial configurado con exactitud
  ingredients: [
    {
      id: 'ING-PAPAS',
      code: 'ING-001',
      name: 'Papas a la francesa congeladas (Corte fino)',
      category: 'Tubérculos / Frituras',
      unit: 'g', // Gramos
      stock_current: 20000, // 20.000 g como solicita la Prueba 1
      stock_min: 3000,
      stock_max: 50000,
      cost_unit: 14.5, // $14.5 COP por gramo (~$14.500 el kg)
      supplier_id: 'SUP-001',
      location: 'Congelador 1 - Frituras',
      expiration_date: '2026-12-30',
      active: true
    },
    {
      id: 'ING-ALITAS',
      code: 'ING-002',
      name: 'Alitas de pollo marinadas (Piezas)',
      category: 'Carnes / Pollo',
      unit: 'und', // Unidades / Piezas
      stock_current: 400,
      stock_min: 50,
      stock_max: 1000,
      cost_unit: 1350, // $1.350 COP por pieza de alita
      supplier_id: 'SUP-002',
      location: 'Refrigerador Carnes',
      expiration_date: '2026-11-05',
      active: true
    },
    {
      id: 'ING-CARNE-HMB',
      code: 'ING-003',
      name: 'Carne para hamburguesa artesanal 150g',
      category: 'Carnes',
      unit: 'und',
      stock_current: 60,
      stock_min: 15,
      stock_max: 150,
      cost_unit: 4600, // $4.600 COP por porción
      supplier_id: 'SUP-002',
      location: 'Refrigerador Carnes',
      expiration_date: '2026-11-04',
      active: true
    },
    {
      id: 'ING-PAN-BRIOCHE',
      code: 'ING-004',
      name: 'Pan Brioche artesanal sellado con mantequilla',
      category: 'Panadería',
      unit: 'und',
      stock_current: 70,
      stock_min: 20,
      stock_max: 150,
      cost_unit: 1800, // $1.800 COP por unidad
      supplier_id: 'SUP-003',
      location: 'Estantería Panadería',
      expiration_date: '2026-10-30',
      active: true
    },
    {
      id: 'ING-SALCHICHA',
      code: 'ING-005',
      name: 'Salchicha Manguera Americana Especial',
      category: 'Embutidos',
      unit: 'und',
      stock_current: 50,
      stock_min: 15,
      stock_max: 120,
      cost_unit: 2600, // $2.600 COP por salchicha
      supplier_id: 'SUP-002',
      location: 'Refrigerador Carnes',
      expiration_date: '2026-11-15',
      active: true
    },
    {
      id: 'ING-QUESO',
      code: 'ING-006',
      name: 'Queso Mozzarella tajado gourmet',
      category: 'Lácteos',
      unit: 'g',
      stock_current: 4000, // 4.000 g
      stock_min: 800,
      stock_max: 10000,
      cost_unit: 28, // $28 COP por gramo
      supplier_id: 'SUP-003',
      location: 'Refrigerador Lácteos',
      expiration_date: '2026-11-20',
      active: true
    },
    {
      id: 'ING-TOCINETA',
      code: 'ING-007',
      name: 'Tocineta ahumada premium crocante',
      category: 'Embutidos',
      unit: 'g',
      stock_current: 3000, // 3.000 g
      stock_min: 500,
      stock_max: 8000,
      cost_unit: 45, // $45 COP por gramo
      supplier_id: 'SUP-002',
      location: 'Refrigerador Carnes',
      expiration_date: '2026-11-18',
      active: true
    },
    {
      id: 'ING-SALSA-BBQ',
      code: 'ING-008',
      name: 'Salsa BBQ Ahumada Boca2',
      category: 'Salsas',
      unit: 'ml', // Mililitros
      stock_current: 6000, // 6.000 ml
      stock_min: 1000,
      stock_max: 15000,
      cost_unit: 16, // $16 COP por ml
      supplier_id: 'SUP-004',
      location: 'Estantería Salsas',
      expiration_date: '2026-12-15',
      active: true
    },
    {
      id: 'ING-SALSA-BUFFALO',
      code: 'ING-009',
      name: 'Salsa Buffalo Picante Boca2',
      category: 'Salsas',
      unit: 'ml',
      stock_current: 5000,
      stock_min: 1000,
      cost_unit: 20,
      supplier_id: 'SUP-004',
      location: 'Estantería Salsas',
      expiration_date: '2026-12-15',
      active: true
    },
    {
      id: 'ING-SALSA-MIELMOSTAZA',
      code: 'ING-010',
      name: 'Salsa Honey Mustard Especial',
      category: 'Salsas',
      unit: 'ml',
      stock_current: 4500,
      stock_min: 800,
      cost_unit: 19,
      supplier_id: 'SUP-004',
      location: 'Estantería Salsas',
      expiration_date: '2026-12-15',
      active: true
    },
    {
      id: 'ING-SALSA-AJO',
      code: 'ING-011',
      name: 'Salsa de Ajo Criollo de la Casa',
      category: 'Salsas',
      unit: 'ml',
      stock_current: 4000,
      stock_min: 800,
      cost_unit: 15,
      supplier_id: 'SUP-004',
      location: 'Estantería Salsas',
      expiration_date: '2026-11-28',
      active: true
    },
    {
      id: 'ING-ACEITE',
      code: 'ING-012',
      name: 'Aceite vegetal para freidora de alto rendimiento',
      category: 'Aceites',
      unit: 'ml',
      stock_current: 25000,
      stock_min: 5000,
      cost_unit: 12,
      supplier_id: 'SUP-001',
      location: 'Bodega Principal',
      expiration_date: '2027-02-15',
      active: true
    },
    {
      id: 'ING-COCACOLA',
      code: 'ING-013',
      name: 'Gaseosa Coca-Cola Original 400ml Botella',
      category: 'Bebidas',
      unit: 'und',
      stock_current: 95,
      stock_min: 24,
      cost_unit: 2700,
      supplier_id: 'SUP-005',
      location: 'Nevera Bebidas',
      expiration_date: '2027-04-10',
      active: true
    },
    {
      id: 'ING-CERVEZA',
      code: 'ING-014',
      name: 'Cerveza Club Colombia Dorada 330ml',
      category: 'Bebidas',
      unit: 'und',
      stock_current: 60,
      stock_min: 15,
      cost_unit: 3600,
      supplier_id: 'SUP-005',
      location: 'Nevera Bebidas',
      expiration_date: '2027-03-20',
      active: true
    },
    {
      id: 'ING-EMPAQUE-COMBO',
      code: 'ING-015',
      name: 'Caja térmica de cartón kraft Boca2 Wings',
      category: 'Empaques',
      unit: 'und',
      stock_current: 350,
      stock_min: 50,
      cost_unit: 750,
      supplier_id: 'SUP-006',
      location: 'Estantería Empaques',
      active: true
    }
  ],
  // 7. PRODUCTOS Y VARIANTES
  products: [
    {
      id: 'PROD-PAPAS-BOCA2',
      code: 'PRD-001',
      name: 'Porción de Papas Boca2 Fritas',
      description: 'Papas a la francesa crocantes y doradas, sazonadas con sal de la casa y paprika.',
      category_id: 'cat-papas',
      price: 9000, // Precio base (pequeña)
      cost_estimated: 2175,
      image_url: 'https://images.unsplash.com/photo-1576107232684-1279f3908594?w=500&auto=format&fit=crop&q=60',
      prep_time_minutes: 8,
      prep_station: 'Frituras',
      active: true,
      has_variants: true,
      variants: [
        { id: 'VAR-PAPAS-PEQ', name: 'Porción Pequeña (150g)', price: 9000, cost_estimated: 2175, grammage: 150 },
        { id: 'VAR-PAPAS-MED', name: 'Porción Mediana (200g)', price: 12000, cost_estimated: 2900, grammage: 200 },
        { id: 'VAR-PAPAS-GRA', name: 'Porción Grande (300g)', price: 16000, cost_estimated: 4350, grammage: 300 }
      ]
    },
    {
      id: 'PROD-COMBO-ALITAS',
      code: 'PRD-002',
      name: 'Combo Alitas Boca2 (8 Piezas + Papas Medianas + Bebida)',
      description: '8 deliciosas alitas bañadas en tu salsa favorita, acompañadas de 200g de papas medianas y gaseosa Coca-Cola 400ml.',
      category_id: 'cat-combos',
      price: 29900,
      cost_estimated: 16900,
      image_url: 'https://images.unsplash.com/photo-1527477396000-e27163b481c2?w=500&auto=format&fit=crop&q=60',
      prep_time_minutes: 15,
      prep_station: 'Alitas',
      active: true,
      has_variants: false
    },
    {
      id: 'PROD-ALITAS-TRAD',
      code: 'PRD-003',
      name: 'Alitas Tradicionales Boca2 Wings',
      description: 'Alitas bañadas en salsa BBQ, Buffalo, Miel Mostaza o Ajo Criollo con bastones de apio y salsa ranchera.',
      category_id: 'cat-alitas',
      price: 19000, // 6 piezas
      cost_estimated: 9100,
      image_url: 'https://images.unsplash.com/photo-1567620832903-9fc6debc209f?w=500&auto=format&fit=crop&q=60',
      prep_time_minutes: 14,
      prep_station: 'Alitas',
      active: true,
      has_variants: true,
      variants: [
        { id: 'VAR-ALITAS-6', name: '6 Alitas (1 Salsa)', price: 19000, cost_estimated: 9100, wings_count: 6 },
        { id: 'VAR-ALITAS-12', name: '12 Alitas (Hasta 2 Salsas)', price: 34000, cost_estimated: 17800, wings_count: 12 },
        { id: 'VAR-ALITAS-24', name: '24 Alitas Familiar (Hasta 3 Salsas)', price: 62000, cost_estimated: 34800, wings_count: 24 }
      ]
    },
    {
      id: 'PROD-HMB-ESPECIAL',
      code: 'PRD-004',
      name: 'Hamburguesa Especial Boca2 (Con Papas Pequeñas)',
      description: '150g de carne artesanal de res, pan brioche sellado, queso mozzarella fundido, tocineta ahumada crocante y 150g de papas.',
      category_id: 'cat-hamburguesas',
      price: 24500,
      cost_estimated: 11450,
      image_url: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=500&auto=format&fit=crop&q=60',
      prep_time_minutes: 16,
      prep_station: 'Hamburguesas',
      active: true,
      has_variants: false
    },
    {
      id: 'PROD-SALCHIPAPA-CLASICA',
      code: 'PRD-005',
      name: 'Salchipapa Clásica Boca2',
      description: '250g de papas doradas, 1.5 salchichas manguera en rodajas doradas, queso mozzarella fundido y salsa tártara de la casa.',
      category_id: 'cat-salchipapas',
      price: 18500,
      cost_estimated: 8900,
      image_url: 'https://images.unsplash.com/photo-1627308595229-7830a5c91f9f?w=500&auto=format&fit=crop&q=60',
      prep_time_minutes: 12,
      prep_station: 'Frituras',
      active: true,
      has_variants: false
    },
    {
      id: 'PROD-PERRO-ESPECIAL',
      code: 'PRD-006',
      name: 'Perro Caliente Especial Boca2',
      description: 'Salchicha americana, pan brioche, queso mozzarella derretido, tocineta picada, papitas fósforo y salsa especial.',
      category_id: 'cat-perros',
      price: 17000,
      cost_estimated: 7400,
      image_url: 'https://images.unsplash.com/photo-1619740455993-9e612b1af08a?w=500&auto=format&fit=crop&q=60',
      prep_time_minutes: 10,
      prep_station: 'Hamburguesas',
      active: true,
      has_variants: false
    },
    {
      id: 'PROD-COCACOLA-400',
      code: 'PRD-007',
      name: 'Coca-Cola Original 400ml',
      description: 'Bebida gaseosa helada en botella de 400ml.',
      category_id: 'cat-bebidas',
      price: 5000,
      cost_estimated: 2700,
      image_url: 'https://images.unsplash.com/photo-1622483767028-3f66f32aef97?w=500&auto=format&fit=crop&q=60',
      prep_time_minutes: 2,
      prep_station: 'Bebidas',
      active: true,
      has_variants: false
    },
    {
      id: 'PROD-CERVEZA-CLUB',
      code: 'PRD-008',
      name: 'Cerveza Club Colombia Dorada',
      description: 'Cerveza tipo lager dorada 330ml botella bien fría.',
      category_id: 'cat-bebidas',
      price: 7000,
      cost_estimated: 3600,
      image_url: 'https://images.unsplash.com/photo-1608270586620-248524c67de9?w=500&auto=format&fit=crop&q=60',
      prep_time_minutes: 2,
      prep_station: 'Bebidas',
      active: true,
      has_variants: false
    },
    {
      id: 'PROD-SALSA-EXTRA-BBQ',
      code: 'PRD-009',
      name: 'Salsa Extra BBQ Boca2 (50ml)',
      description: 'Porción extra de salsa BBQ ahumada en vaso térmico.',
      category_id: 'cat-salsas',
      price: 2500,
      cost_estimated: 800,
      image_url: 'https://images.unsplash.com/photo-1472476443507-c7a5948772fc?w=500&auto=format&fit=crop&q=60',
      prep_time_minutes: 1,
      prep_station: 'Alitas',
      active: true,
      has_variants: false
    }
  ],
  // 9. RECETAS Y FICHAS TÉCNICAS (Descuentos exactos por ingrediente)
  recipes: [
    // Receta Papas Pequeñas: 150g papas
    {
      id: 'REC-PAPAS-PEQ',
      product_id: 'PROD-PAPAS-BOCA2',
      variant_id: 'VAR-PAPAS-PEQ',
      name: 'Ficha Técnica: Papas Pequeñas (150g)',
      version: 1,
      yield_portions: 1,
      portion_size: '150 gramos',
      prep_time_minutes: 8,
      items: [
        { ingredient_id: 'ING-PAPAS', quantity: 150, unit: 'g', cost_unit: 14.5 },
        { ingredient_id: 'ING-ACEITE', quantity: 20, unit: 'ml', cost_unit: 12 }
      ]
    },
    // Receta Papas Medianas: 200g papas (como en Prueba 1)
    {
      id: 'REC-PAPAS-MED',
      product_id: 'PROD-PAPAS-BOCA2',
      variant_id: 'VAR-PAPAS-MED',
      name: 'Ficha Técnica: Papas Medianas (200g)',
      version: 1,
      yield_portions: 1,
      portion_size: '200 gramos',
      prep_time_minutes: 8,
      items: [
        { ingredient_id: 'ING-PAPAS', quantity: 200, unit: 'g', cost_unit: 14.5 },
        { ingredient_id: 'ING-ACEITE', quantity: 25, unit: 'ml', cost_unit: 12 }
      ]
    },
    // Receta Papas Grandes: 300g papas
    {
      id: 'REC-PAPAS-GRA',
      product_id: 'PROD-PAPAS-BOCA2',
      variant_id: 'VAR-PAPAS-GRA',
      name: 'Ficha Técnica: Papas Grandes (300g)',
      version: 1,
      yield_portions: 1,
      portion_size: '300 gramos',
      prep_time_minutes: 9,
      items: [
        { ingredient_id: 'ING-PAPAS', quantity: 300, unit: 'g', cost_unit: 14.5 },
        { ingredient_id: 'ING-ACEITE', quantity: 35, unit: 'ml', cost_unit: 12 }
      ]
    },
    // Receta Combo Alitas: 8 alitas + 200g papas medianas + salsa BBQ + gaseosa + empaque (Prueba 3)
    {
      id: 'REC-COMBO-ALITAS',
      product_id: 'PROD-COMBO-ALITAS',
      variant_id: null,
      name: 'Ficha Técnica: Combo Alitas Boca2 (8 Pcs + 200g Papas)',
      version: 1,
      yield_portions: 1,
      portion_size: '1 combo completo',
      prep_time_minutes: 15,
      items: [
        { ingredient_id: 'ING-ALITAS', quantity: 8, unit: 'und', cost_unit: 1350 },
        { ingredient_id: 'ING-PAPAS', quantity: 200, unit: 'g', cost_unit: 14.5 }, // 200g papas
        { ingredient_id: 'ING-SALSA-BBQ', quantity: 50, unit: 'ml', cost_unit: 16 },
        { ingredient_id: 'ING-ACEITE', quantity: 40, unit: 'ml', cost_unit: 12 },
        { ingredient_id: 'ING-COCACOLA', quantity: 1, unit: 'und', cost_unit: 2700 },
        { ingredient_id: 'ING-EMPAQUE-COMBO', quantity: 1, unit: 'und', cost_unit: 750 }
      ]
    },
    // Receta Hamburguesa Especial: 150g carne + pan + queso + tocineta + 150g papas
    {
      id: 'REC-HMB-ESPECIAL',
      product_id: 'PROD-HMB-ESPECIAL',
      variant_id: null,
      name: 'Ficha Técnica: Hamburguesa Especial Boca2 (Con 150g Papas)',
      version: 1,
      yield_portions: 1,
      portion_size: '1 hamburguesa + 150g papas',
      prep_time_minutes: 16,
      items: [
        { ingredient_id: 'ING-CARNE-HMB', quantity: 1, unit: 'und', cost_unit: 4600 },
        { ingredient_id: 'ING-PAN-BRIOCHE', quantity: 1, unit: 'und', cost_unit: 1800 },
        { ingredient_id: 'ING-QUESO', quantity: 30, unit: 'g', cost_unit: 28 },
        { ingredient_id: 'ING-TOCINETA', quantity: 25, unit: 'g', cost_unit: 45 },
        { ingredient_id: 'ING-PAPAS', quantity: 150, unit: 'g', cost_unit: 14.5 }, // 150g papas
        { ingredient_id: 'ING-SALSA-AJO', quantity: 20, unit: 'ml', cost_unit: 15 },
        { ingredient_id: 'ING-EMPAQUE-COMBO', quantity: 1, unit: 'und', cost_unit: 750 }
      ]
    },
    // Receta Salchipapa Clásica: 200g papas + 1.5 salchichas + 30g queso
    {
      id: 'REC-SALCHIPAPA-CLASICA',
      product_id: 'PROD-SALCHIPAPA-CLASICA',
      variant_id: null,
      name: 'Ficha Técnica: Salchipapa Clásica Boca2',
      version: 1,
      yield_portions: 1,
      portion_size: '1 plato',
      prep_time_minutes: 12,
      items: [
        { ingredient_id: 'ING-PAPAS', quantity: 200, unit: 'g', cost_unit: 14.5 },
        { ingredient_id: 'ING-SALCHICHA', quantity: 1.5, unit: 'und', cost_unit: 2600 },
        { ingredient_id: 'ING-QUESO', quantity: 30, unit: 'g', cost_unit: 28 },
        { ingredient_id: 'ING-ACEITE', quantity: 25, unit: 'ml', cost_unit: 12 },
        { ingredient_id: 'ING-SALSA-AJO', quantity: 20, unit: 'ml', cost_unit: 15 },
        { ingredient_id: 'ING-EMPAQUE-COMBO', quantity: 1, unit: 'und', cost_unit: 750 }
      ]
    },
    // Receta Alitas 6 Pcs
    {
      id: 'REC-ALITAS-6',
      product_id: 'PROD-ALITAS-TRAD',
      variant_id: 'VAR-ALITAS-6',
      name: 'Ficha Técnica: 6 Alitas Tradicionales',
      version: 1,
      yield_portions: 1,
      portion_size: '6 alitas',
      prep_time_minutes: 14,
      items: [
        { ingredient_id: 'ING-ALITAS', quantity: 6, unit: 'und', cost_unit: 1350 },
        { ingredient_id: 'ING-SALSA-BBQ', quantity: 40, unit: 'ml', cost_unit: 16 },
        { ingredient_id: 'ING-ACEITE', quantity: 30, unit: 'ml', cost_unit: 12 },
        { ingredient_id: 'ING-EMPAQUE-COMBO', quantity: 1, unit: 'und', cost_unit: 750 }
      ]
    },
    // Receta Alitas 12 Pcs
    {
      id: 'REC-ALITAS-12',
      product_id: 'PROD-ALITAS-TRAD',
      variant_id: 'VAR-ALITAS-12',
      name: 'Ficha Técnica: 12 Alitas Tradicionales',
      version: 1,
      yield_portions: 1,
      portion_size: '12 alitas',
      prep_time_minutes: 16,
      items: [
        { ingredient_id: 'ING-ALITAS', quantity: 12, unit: 'und', cost_unit: 1350 },
        { ingredient_id: 'ING-SALSA-BBQ', quantity: 70, unit: 'ml', cost_unit: 16 },
        { ingredient_id: 'ING-ACEITE', quantity: 50, unit: 'ml', cost_unit: 12 },
        { ingredient_id: 'ING-EMPAQUE-COMBO', quantity: 1, unit: 'und', cost_unit: 750 }
      ]
    },
    // Bebida Coca-Cola
    {
      id: 'REC-COCACOLA-400',
      product_id: 'PROD-COCACOLA-400',
      variant_id: null,
      name: 'Ficha Técnica: Coca-Cola 400ml',
      version: 1,
      yield_portions: 1,
      portion_size: '1 botella',
      prep_time_minutes: 1,
      items: [
        { ingredient_id: 'ING-COCACOLA', quantity: 1, unit: 'und', cost_unit: 2700 }
      ]
    },
    // Cerveza Club Colombia
    {
      id: 'REC-CERVEZA-CLUB',
      product_id: 'PROD-CERVEZA-CLUB',
      variant_id: null,
      name: 'Ficha Técnica: Cerveza Club Colombia',
      version: 1,
      yield_portions: 1,
      portion_size: '1 botella',
      prep_time_minutes: 1,
      items: [
        { ingredient_id: 'ING-CERVEZA', quantity: 1, unit: 'und', cost_unit: 3600 }
      ]
    },
    // Adición Salsa BBQ
    {
      id: 'REC-SALSA-EXTRA-BBQ',
      product_id: 'PROD-SALSA-EXTRA-BBQ',
      variant_id: null,
      name: 'Ficha Técnica: Salsa Extra BBQ',
      version: 1,
      yield_portions: 1,
      portion_size: '50ml',
      prep_time_minutes: 1,
      items: [
        { ingredient_id: 'ING-SALSA-BBQ', quantity: 50, unit: 'ml', cost_unit: 16 }
      ]
    }
  ],
  customers: [
    {
      id: 'CUST-001',
      name: 'Juan Carlos Rodríguez',
      phone: '3104567890',
      email: 'juan.rodriguez@email.com',
      address: 'Calle 45 # 22 - 15, Apto 302',
      notes: 'Cliente frecuente, prefiere alitas extra picantes.',
      order_count: 5,
      total_spent: 145000,
      created_at: '2026-10-01T12:00:00Z'
    },
    {
      id: 'CUST-002',
      name: 'María Fernanda Gómez',
      phone: '3157891234',
      email: 'mariaj.gomez@email.com',
      address: 'Carrera 15 # 85 - 40',
      notes: 'Sin cebolla en hamburguesas.',
      order_count: 3,
      total_spent: 89000,
      created_at: '2026-10-10T14:30:00Z'
    }
  ],
  suppliers: [
    {
      id: 'SUP-001',
      name: 'Distribuidora Avícola & Congelados El Galpón',
      contact_name: 'Carlos Mendoza',
      phone: '3201234567',
      email: 'ventas@elgalpon.com',
      address: 'Central de Abastos Bodega 14',
      active: true
    },
    {
      id: 'SUP-002',
      name: 'Carnes & Embutidos La Sabana S.A.S.',
      contact_name: 'Martha Lucia Ríos',
      phone: '3119876543',
      email: 'pedidos@carneslasabana.com',
      address: 'Zona Industrial Calle 19 # 32-10',
      active: true
    },
    {
      id: 'SUP-003',
      name: 'Panadería & Lácteos Artesanales del Campo',
      contact_name: 'Héctor Fabio Ortiz',
      phone: '3004561234',
      email: 'hector@lacteosdelcampo.com',
      address: 'Carrera 7 # 45-20',
      active: true
    },
    {
      id: 'SUP-004',
      name: 'Salsas Gourmet & Especias del Fuego',
      contact_name: 'Laura Restrepo',
      phone: '3187654321',
      email: 'laura@salsasgourmet.co',
      address: 'Diagonal 40 # 12-05',
      active: true
    },
    {
      id: 'SUP-005',
      name: 'Embotelladora Nacional de Bebidas',
      contact_name: 'Andrés Suárez',
      phone: '3145678901',
      email: 'distribucion@embotelladora.com',
      address: 'Avenida El Dorado # 68-90',
      active: true
    },
    {
      id: 'SUP-006',
      name: 'Empaques Ecológicos & Cajas Kraft',
      contact_name: 'Patricia Morales',
      phone: '3123456789',
      email: 'ventas@empaqueskraft.com',
      address: 'Calle 13 # 40-50',
      active: true
    }
  ],
  restaurant_tables: [
    { id: 'T-01', name: 'Mesa 1', capacity: 4, area: 'Salón Principal', active: true },
    { id: 'T-02', name: 'Mesa 2', capacity: 4, area: 'Salón Principal', active: true },
    { id: 'T-03', name: 'Mesa 3', capacity: 2, area: 'Salón Principal', active: true },
    { id: 'T-04', name: 'Mesa 4', capacity: 6, area: 'Salón Principal', active: true },
    { id: 'T-05', name: 'Mesa 5', capacity: 4, area: 'Salón Principal', active: true },
    { id: 'T-06', name: 'Mesa 6', capacity: 4, area: 'Salón Principal', active: true },
    { id: 'T-07', name: 'Mesa 7', capacity: 8, area: 'Salón Principal', active: true },
    { id: 'T-08', name: 'Mesa 8', capacity: 2, area: 'Salón Principal', active: true },
    { id: 'T-B1', name: 'Barra 1', capacity: 1, area: 'Barra', active: true },
    { id: 'T-B2', name: 'Barra 2', capacity: 1, area: 'Barra', active: true },
    { id: 'T-TZ1', name: 'Terraza 1', capacity: 4, area: 'Terraza', active: true },
    { id: 'T-TZ2', name: 'Terraza 2', capacity: 4, area: 'Terraza', active: true }
  ],
  orders: [],
  order_items: [],
  order_payments: [],
  inventory_movements: [],
  cash_registers: [],
  cash_register_movements: [],
  purchase_orders: [],
  purchase_order_items: [],
  waste_records: [],
  expenses: [],
  audit_logs: [],
  settings: {
    restaurant_name: 'Boca2 Wings',
    nit: '901.458.712-4',
    address: 'Calle Principal Gourmet # 24 - 10',
    phone: '(+57) 310 987 6543',
    city: 'Bogotá D.C., Colombia',
    currency: 'COP',
    currency_symbol: '$',
    tax_rate: 0, // Régimen simple / impoconsumo 8% opcional
    allow_negative_stock: false, // Regla estricta: política configurable
    sound_alerts: true,
    kitchen_stations: ['Alitas', 'Frituras', 'Hamburguesas', 'Bebidas', 'Empaque'],
    order_counter: 0,
    theme: 'dark'
  }
};

class Database {
  constructor() {
    this.data = null;
    this.isLoaded = false;
    this.transactionLock = Promise.resolve();
    this.init();
  }

  init() {
    try {
      if (fs.existsSync(DATA_FILE)) {
        const raw = fs.readFileSync(DATA_FILE, 'utf-8').trim();
        if (raw) {
          this.data = JSON.parse(raw);
          // Ensure all collections exist
          for (const key of Object.keys(initialData)) {
            if (!this.data[key]) {
              this.data[key] = initialData[key];
            }
          }
        } else {
          this.data = JSON.parse(JSON.stringify(initialData));
          this.save();
        }
      } else {
        this.data = JSON.parse(JSON.stringify(initialData));
        this.save();
      }
      this.isLoaded = true;
    } catch (err) {
      console.error('Error loading database, resetting to initial seed:', err);
      this.data = JSON.parse(JSON.stringify(initialData));
      this.save();
      this.isLoaded = true;
    }
  }

  save() {
    try {
      const tempPath = `${DATA_FILE}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
      fs.writeFileSync(tempPath, JSON.stringify(this.data, null, 2), 'utf-8');
      try {
        fs.renameSync(tempPath, DATA_FILE);
      } catch (renameErr) {
        fs.writeFileSync(DATA_FILE, JSON.stringify(this.data, null, 2), 'utf-8');
        try { fs.unlinkSync(tempPath); } catch (_) {}
      }
    } catch (err) {
      console.error('Error saving database atomically:', err);
      throw err;
    }
  }

  // Generate sequence-based order IDs: BW-000001, BW-000002...
  nextOrderId() {
    if (!this.data.settings.order_counter) {
      this.data.settings.order_counter = 0;
    }
    this.data.settings.order_counter += 1;
    const num = this.data.settings.order_counter;
    this.save();
    return `BW-${String(num).padStart(6, '0')}`;
  }

  nextCode(prefix, collectionName) {
    const items = this.data[collectionName] || [];
    const count = items.length + 1;
    return `${prefix}-${String(count).padStart(6, '0')}`;
  }

  getAll(collection) {
    return this.data[collection] || [];
  }

  find(collection, predicate) {
    const list = this.data[collection] || [];
    return list.find(predicate);
  }

  filter(collection, predicate) {
    const list = this.data[collection] || [];
    return list.filter(predicate);
  }

  insert(collection, item) {
    if (!this.data[collection]) {
      this.data[collection] = [];
    }
    this.data[collection].push(item);
    this.save();
    return item;
  }

  update(collection, id, updates) {
    const list = this.data[collection] || [];
    const index = list.findIndex(item => item.id === id);
    if (index === -1) return null;
    this.data[collection][index] = { ...this.data[collection][index], ...updates };
    this.save();
    return this.data[collection][index];
  }

  delete(collection, id) {
    const list = this.data[collection] || [];
    const index = list.findIndex(item => item.id === id);
    if (index === -1) return false;
    this.data[collection].splice(index, 1);
    this.save();
    return true;
  }

  // ACID transaction wrapper with rollback
  async transaction(fn) {
    // Acquire transaction lock
    let releaseLock;
    const lockWait = new Promise(resolve => { releaseLock = resolve; });
    const prevLock = this.transactionLock;
    this.transactionLock = lockWait;
    await prevLock;

    // Snapshot state for rollback if anything throws
    const snapshot = JSON.stringify(this.data);

    try {
      const result = await fn(this);
      this.save();
      return result;
    } catch (err) {
      console.error('Transaction failed! Rolling back changes...', err.message);
      this.data = JSON.parse(snapshot);
      throw err;
    } finally {
      releaseLock();
    }
  }

  // Reset database to pristine demo state (useful for test runs)
  resetToSeed() {
    this.data = JSON.parse(JSON.stringify(initialData));
    this.save();
    return true;
  }
}

export const db = new Database();
export default db;
