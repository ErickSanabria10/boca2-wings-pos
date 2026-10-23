// ==============================================================================
// BOCA2 WINGS POS — APLICACIÓN PRINCIPAL FULL-STACK CLIENTE
// ==============================================================================

(function() {
  'use strict';

  // --- AUDIO SYNTHESIZER (Web Audio API) ---
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  let audioCtx = null;
  let soundEnabled = true;

  function initAudio() {
    if (!audioCtx) {
      audioCtx = new AudioContext();
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
  }

  function playTone(freq, duration, type = 'sine') {
    if (!soundEnabled) return;
    try {
      initAudio();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
      gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + duration);
    } catch (e) {
      // Audio autoplay policy
    }
  }

  // Restaurant Kitchen Bell (Ding-Dong) for new orders
  function playNewOrderSound() {
    if (!soundEnabled) return;
    playTone(587.33, 0.3, 'triangle'); // D5
    setTimeout(() => playTone(880, 0.6, 'sine'), 150); // A5
  }

  function playSuccessSound() {
    if (!soundEnabled) return;
    playTone(523.25, 0.15, 'sine'); // C5
    setTimeout(() => playTone(659.25, 0.15, 'sine'), 100); // E5
    setTimeout(() => playTone(783.99, 0.3, 'sine'), 200); // G5
  }

  // Currency & Date formatting (Colombia COP)
  const formatCOP = (num) => {
    const val = Math.round(Number(num) || 0);
    return '$ ' + val.toLocaleString('es-CO');
  };

  const formatDate = (isoStr) => {
    if (!isoStr) return '-';
    const d = new Date(isoStr);
    return d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  };

  // --- STATE ---
  const savedUser = (() => {
    try {
      const u = localStorage.getItem('boca2_active_user');
      return u ? JSON.parse(u) : null;
    } catch (e) {
      return null;
    }
  })();

  const state = {
    user: null,
    activeTab: 'pos', // Default to POS for quick operation
    categories: [],
    products: [],
    ingredients: [],
    recipes: [],
    orders: [],
    activeRegister: null,
    registers: [],
    suppliers: [],
    purchases: [],
    wasteRecords: [],
    expenses: [],
    dashboard: null,
    // POS State
    posCategory: 'all',
    posSearch: '',
    cart: [],
    orderType: 'MESA', // MESA, LLEVAR, RECOGER, DOMICILIO
    tableNumber: 'Mesa 1',
    customerName: '',
    customerPhone: '',
    deliveryAddress: '',
    deliveryFee: 0,
    orderNotes: '',
    // KDS State
    kdsStation: 'TODAS',
    // Modals
    activeModal: null, // 'checkout', 'variant_select', 'ticket', 'open_cash', 'close_cash', 'cash_move', 'adjust_stock', 'new_purchase', 'receive_purchase', 'new_waste', 'new_expense'
    modalData: null,
    isOnline: true,
    theme: 'dark'
  };

  // API Client
  async function api(path, options = {}) {
    try {
      const headers = {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      };
      if (state.user && state.user.id) {
        headers['x-user-id'] = state.user.id;
      }
      const res = await fetch(`/api${path}`, {
        ...options,
        headers
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Error de servidor' }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      return await res.json();
    } catch (err) {
      console.error(`API Error on ${path}:`, err);
      if (err.message && (err.message.includes('fetch') || err.message.includes('NetworkError') || err.name === 'TypeError')) {
        throw new Error('El servidor de Boca2 Wings no está encendido o se cerró la consola. Por favor ejecuta "iniciar_boca2_wings.bat" y mantén abierta la ventana negra.');
      }
      throw err;
    }
  }

  // --- REALTIME SSE CONNECTION ---
  function connectSSE() {
    try {
      const es = new EventSource('/api/events');
      es.onopen = () => {
        state.isOnline = true;
        renderHeader();
      };
      es.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          handleRealtimeEvent(payload);
        } catch (e) {}
      };
      es.onerror = () => {
        state.isOnline = false;
        renderHeader();
      };
    } catch (e) {
      state.isOnline = false;
    }
  }

  function handleRealtimeEvent(payload) {
    const { type, data } = payload;
    if (type === 'ORDER_CREATED') {
      playNewOrderSound();
      state.orders.unshift(data);
      if (state.activeTab === 'kds' || state.activeTab === 'pos') {
        render();
      }
    } else if (type === 'ORDER_STATUS_CHANGED') {
      const idx = state.orders.findIndex(o => o.id === data.id);
      if (idx !== -1) {
        state.orders[idx] = data;
        if (state.activeTab === 'kds' || state.activeTab === 'pos') {
          render();
        }
      }
    } else if (type === 'STOCK_UPDATED') {
      loadData();
    } else if (type === 'CASH_REGISTER_CHANGED') {
      state.activeRegister = data.status === 'ABIERTA' ? data : null;
      renderHeader();
      if (state.activeTab === 'cash') render();
    } else if (type === 'TABLE_STATUS_CHANGED') {
      api('/tables').then(tbls => {
        state.tables = tbls;
        if (state.activeTab === 'tables' || state.activeTab === 'pos') render();
      }).catch(() => {});
    }
  }

  // --- DATA LOADING ---
  async function loadData() {
    try {
      const [cats, prods, ings, recs, ords, reg, tbls] = await Promise.all([
        api('/categories').catch(() => []),
        api('/products').catch(() => []),
        api('/ingredients').catch(() => []),
        api('/recipes').catch(() => []),
        api('/orders').catch(() => []),
        api('/cash-registers/active').catch(() => null),
        api('/tables').catch(() => [])
      ]);

      state.categories = cats || [];
      state.products = prods || [];
      state.ingredients = ings || [];
      state.recipes = recs || [];
      state.orders = ords || [];
      state.activeRegister = reg || null;
      state.tables = tbls || [];

      // Admin-only endpoints
      if (state.user?.permissions?.includes('all')) {
        const [dash, sups, purs, wst, exps, users] = await Promise.all([
          api('/reports/dashboard').catch(() => null),
          api('/suppliers').catch(() => []),
          api('/purchases').catch(() => []),
          api('/waste').catch(() => []),
          api('/expenses').catch(() => []),
          api('/users').catch(() => [])
        ]);
        state.dashboard = dash;
        state.suppliers = sups || [];
        state.purchases = purs || [];
        state.wasteRecords = wst || [];
        state.expenses = exps || [];
        state.usersList = users || [];
      }

      render();
    } catch (err) {
      console.error('Error loading initial data:', err);
    }
  }

  // --- POS CART OPERATIONS ---
  function addToCart(product, variant = null) {
    const price = variant ? variant.price : product.price;
    const name = variant ? `${product.name} (${variant.name})` : product.name;
    const itemKey = variant ? `${product.id}-${variant.id}` : product.id;

    const existing = state.cart.find(it => it.key === itemKey);
    if (existing) {
      existing.quantity += 1;
      existing.total = existing.quantity * existing.unit_price;
    } else {
      state.cart.push({
        key: itemKey,
        product_id: product.id,
        variant_id: variant ? variant.id : null,
        name: name,
        variant_name: variant ? variant.name : null,
        quantity: 1,
        unit_price: price,
        total: price,
        notes: '',
        station: product.prep_station || 'Frituras'
      });
    }
    playTone(600, 0.08, 'sine');
    renderPOSCart();
  }

  function updateCartQty(key, delta) {
    const item = state.cart.find(it => it.key === key);
    if (!item) return;
    item.quantity += delta;
    if (item.quantity <= 0) {
      state.cart = state.cart.filter(it => it.key !== key);
    } else {
      item.total = item.quantity * item.unit_price;
    }
    renderPOSCart();
  }

  function clearCart() {
    state.cart = [];
    state.orderNotes = '';
    state.customerName = '';
    state.customerPhone = '';
    state.deliveryAddress = '';
    renderPOSCart();
  }

  function getCartSubtotal() {
    return state.cart.reduce((sum, it) => sum + it.total, 0);
  }

  function getCartTotal() {
    const sub = getCartSubtotal();
    const fee = state.orderType === 'DOMICILIO' ? Number(state.deliveryFee || 0) : 0;
    return sub + fee;
  }

  // Open Checkout Modal
  function openCheckout() {
    if (state.cart.length === 0) {
      alert('Agrega productos al carrito antes de cobrar.');
      return;
    }
    const total = getCartTotal();
    state.modalData = {
      total,
      payments: [
        { method: 'EFECTIVO', amount: total, cash_tendered: total, cash_change: 0 }
      ],
      selectedMethod: 'EFECTIVO'
    };
    state.activeModal = 'checkout';
    renderModal();
  }

  // Confirm Sale (Pruebas 1, 2, 3, 4, 5, 6)
  async function confirmSale() {
    const m = state.modalData;
    const total = m.total;
    const totalPaid = m.payments.reduce((sum, p) => sum + Number(p.amount), 0);

    if (totalPaid < total) {
      alert(`El total de los pagos (${formatCOP(totalPaid)}) no cubre el total de la orden (${formatCOP(total)}).`);
      return;
    }

    // Generate unique idempotency key
    const idempotencyKey = `BW-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

    const orderPayload = {
      idempotency_key: idempotencyKey,
      cash_register_id: state.activeRegister ? state.activeRegister.id : null,
      user_id: state.user.id,
      customer_name: state.customerName.trim() || 'Cliente Mostrador',
      order_type: state.orderType,
      table_number: state.orderType === 'MESA' ? state.tableNumber : null,
      delivery_address: state.orderType === 'DOMICILIO' ? state.deliveryAddress : null,
      delivery_fee: state.orderType === 'DOMICILIO' ? Number(state.deliveryFee || 0) : 0,
      subtotal: getCartSubtotal(),
      discount: 0,
      tax: 0,
      total: total,
      notes: state.orderNotes,
      items: state.cart.map(it => ({
        product_id: it.product_id,
        variant_id: it.variant_id,
        name: it.name,
        variant_name: it.variant_name,
        quantity: it.quantity,
        unit_price: it.unit_price,
        subtotal: it.total,
        total: it.total,
        notes: it.notes,
        station: it.station
      })),
      payments: m.payments
    };

    try {
      const res = await api('/orders', {
        method: 'POST',
        body: JSON.stringify(orderPayload)
      });

      playSuccessSound();
      const confirmedOrder = res.order;

      // Close checkout modal, clear cart and show receipt
      state.activeModal = 'ticket';
      state.modalData = confirmedOrder;
      clearCart();
      loadData();
      renderModal();
    } catch (err) {
      alert(`Error al confirmar venta: ${err.message}`);
    }
  }

  // --- KDS OPERATIONS (Pantalla de Cocina) ---
  async function updateOrderStatus(orderId, newStatus) {
    try {
      const res = await api(`/orders/${orderId}/status`, {
        method: 'PUT',
        body: JSON.stringify({ status: newStatus })
      });
      playTone(700, 0.1, 'triangle');
      const idx = state.orders.findIndex(o => o.id === orderId);
      if (idx !== -1) state.orders[idx] = res;
      render();
    } catch (err) {
      alert(`Error al actualizar estado: ${err.message}`);
    }
  }

  // --- RENDER FUNCTIONS ---

  function render() {
    const app = document.getElementById('app');
    if (!app) return;

    if (!state.user) {
      app.innerHTML = renderLoginScreen();
      if (window.lucide) window.lucide.createIcons();
      return;
    }

    app.innerHTML = `
      ${renderNavbar()}
      <div class="flex-1 flex overflow-hidden">
        ${renderSidebar()}
        <main class="flex-1 overflow-y-auto bg-boca-black p-4 md:p-6">
          ${renderTabContent()}
        </main>
      </div>
      <div id="modal-container"></div>
    `;

    renderModal();
    // Initialize Lucide icons
    if (window.lucide) {
      window.lucide.createIcons();
    }
  }

  function renderLoginScreen() {
    return `
      <div class="min-h-screen bg-boca-black flex items-center justify-center p-4">
        <div class="max-w-md w-full bg-boca-card border border-boca-border rounded-3xl p-8 space-y-6 shadow-2xl relative overflow-hidden">
          <div class="absolute -top-12 -right-12 w-40 h-40 bg-boca-gold/10 rounded-full blur-2xl"></div>

          <div class="text-center space-y-2">
            <img src="/logo.png" alt="Boca2 Wings" class="w-20 h-20 mx-auto object-contain rounded-full border border-boca-gold/40 shadow-lg" />
            <h1 class="text-2xl font-display font-black text-boca-cream tracking-wider">BOCA2 WINGS POS</h1>
            <p class="text-xs text-boca-muted">Inicia sesión con tu cuenta institucional para comenzar</p>
          </div>

          <form onsubmit="event.preventDefault(); window.BocaApp.login();" class="space-y-4 text-xs">
            <div>
              <label class="block text-neutral-400 mb-1 font-semibold">Correo Electrónico:</label>
              <div class="relative">
                <i data-lucide="mail" class="w-4 h-4 text-neutral-500 absolute left-3 top-1/2 -translate-y-1/2"></i>
                <input type="email" id="login-email" value="admin@boca2wings.com" required
                  class="w-full bg-neutral-900 border border-neutral-800 rounded-xl pl-9 pr-3 py-2.5 text-neutral-100 focus:outline-none focus:border-boca-gold" />
              </div>
            </div>

            <div>
              <label class="block text-neutral-400 mb-1 font-semibold">Contraseña / PIN:</label>
              <div class="relative">
                <i data-lucide="lock" class="w-4 h-4 text-neutral-500 absolute left-3 top-1/2 -translate-y-1/2"></i>
                <input type="password" id="login-password" value="admin" required
                  class="w-full bg-neutral-900 border border-neutral-800 rounded-xl pl-9 pr-3 py-2.5 text-neutral-100 focus:outline-none focus:border-boca-gold" />
              </div>
            </div>

            <button type="submit"
              class="w-full bg-gradient-to-r from-boca-cream to-boca-creamHover hover:from-boca-creamHover hover:to-boca-creamDark text-boca-black font-display font-black py-3 rounded-xl text-xs transition shadow-lg flex items-center justify-center space-x-2">
              <i data-lucide="log-in" class="w-4 h-4"></i>
              <span>INGRESAR AL SISTEMA</span>
            </button>
          </form>

          <!-- Quick access demo roles -->
          <div class="pt-2 border-t border-neutral-800/80">
            <p class="text-[11px] text-neutral-500 text-center mb-2 font-medium">Accesos Rápidos de Demostración:</p>
            <div class="grid grid-cols-2 gap-2 text-[10px]">
              <button onclick="window.BocaApp.quickLogin('admin@boca2wings.com', 'admin')" class="p-2 rounded-lg bg-neutral-900 border border-neutral-800 hover:border-boca-gold text-neutral-300 text-left transition">
                <strong class="text-boca-gold">Administrador</strong><br><span class="text-neutral-500">Acceso Total</span>
              </button>
              <button onclick="window.BocaApp.quickLogin('cajero@boca2wings.com', 'caja')" class="p-2 rounded-lg bg-neutral-900 border border-neutral-800 hover:border-boca-gold text-neutral-300 text-left transition">
                <strong class="text-emerald-400">Cajero</strong><br><span class="text-neutral-500">POS & Caja</span>
              </button>
              <button onclick="window.BocaApp.quickLogin('mesero@boca2wings.com', 'mesero')" class="p-2 rounded-lg bg-neutral-900 border border-neutral-800 hover:border-boca-gold text-neutral-300 text-left transition">
                <strong class="text-blue-400">Mesero</strong><br><span class="text-neutral-500">Solo Pedidos</span>
              </button>
              <button onclick="window.BocaApp.quickLogin('cocina@boca2wings.com', 'cocina')" class="p-2 rounded-lg bg-neutral-900 border border-neutral-800 hover:border-boca-gold text-neutral-300 text-left transition">
                <strong class="text-amber-400">Cocina</strong><br><span class="text-neutral-500">Comandas KDS</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function renderNavbar() {
    return `
      <header class="bg-boca-dark border-b border-boca-border px-4 py-2.5 flex items-center justify-between z-20">
        <div class="flex items-center space-x-3">
          <img src="/logo.png" alt="Boca2 Wings" class="w-10 h-10 object-contain rounded-full border border-boca-gold/40 shadow-sm" />
          <div>
            <div class="flex items-center space-x-2">
              <span class="font-display font-black text-lg tracking-wider text-boca-cream">BOCA2 WINGS</span>
              <span class="bg-boca-gold/20 text-boca-gold text-[10px] font-bold px-2 py-0.5 rounded border border-boca-gold/30">POS PRO</span>
            </div>
            <p class="text-[11px] text-boca-muted">Sistema Integral de Gestión & Cocina</p>
          </div>
        </div>

        <div class="flex items-center space-x-3">
          <!-- Active Register Status Pill -->
          ${state.activeRegister ? `
            <div class="hidden sm:flex items-center space-x-2 bg-emerald-950/60 border border-emerald-500/40 px-3 py-1.5 rounded-lg text-xs text-emerald-400">
              <span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              <span>Caja: <strong>${state.activeRegister.code}</strong> (${formatCOP(state.activeRegister.expected_cash)})</span>
            </div>
          ` : `
            ${(state.user.permissions.includes('all') || state.user.permissions.includes('cash_register')) ? `
              <button onclick="window.BocaApp.openOpenCashModal()" class="hidden sm:flex items-center space-x-2 bg-amber-950/60 border border-amber-500/40 px-3 py-1.5 rounded-lg text-xs text-amber-300 hover:bg-amber-900/60 transition">
                <i data-lucide="lock" class="w-3.5 h-3.5"></i>
                <span>Abrir Turno de Caja</span>
              </button>
            ` : ''}
          `}

          <!-- Realtime Connection Status -->
          <div class="flex items-center space-x-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium ${state.isOnline ? 'bg-emerald-900/40 text-emerald-400 border border-emerald-500/30' : 'bg-red-900/40 text-red-400 border border-red-500/30'}">
            <span class="w-1.5 h-1.5 rounded-full ${state.isOnline ? 'bg-emerald-400 animate-ping' : 'bg-red-400'}"></span>
            <span>${state.isOnline ? 'Online' : 'Reconectando'}</span>
          </div>

          <!-- Sound Mute/Unmute Toggle -->
          <button onclick="window.BocaApp.toggleSound()" class="p-2 rounded-lg bg-boca-card hover:bg-neutral-800 border border-boca-border text-boca-cream transition" title="${soundEnabled ? 'Sonido Activado' : 'Silenciado'}">
            <i data-lucide="${soundEnabled ? 'volume-2' : 'volume-x'}" class="w-4 h-4 text-boca-gold"></i>
          </button>

          <!-- Current Authenticated User & Logout -->
          <div class="flex items-center space-x-2 bg-boca-card border border-boca-border rounded-xl px-2.5 py-1">
            <div class="w-7 h-7 rounded-full bg-boca-gold/20 text-boca-gold font-bold flex items-center justify-center text-xs border border-boca-gold/40">
              ${state.user.name.charAt(0)}
            </div>
            <div class="text-left hidden md:block">
              <div class="text-xs font-semibold text-neutral-200 leading-tight">${state.user.name}</div>
              <div class="text-[10px] text-boca-gold font-bold leading-tight uppercase tracking-wider">${state.user.role_name}</div>
            </div>
            <button onclick="window.BocaApp.logout()" class="ml-2 p-1.5 rounded-lg bg-neutral-900 hover:bg-red-950 hover:text-red-400 text-neutral-400 border border-neutral-800 transition" title="Cerrar Sesión">
              <i data-lucide="log-out" class="w-3.5 h-3.5"></i>
            </button>
          </div>
        </div>
      </header>
    `;
  }

  function renderSidebar() {
    const navItems = [
      { id: 'dashboard', label: 'Dashboard', icon: 'layout-dashboard', perm: 'all' },
      { id: 'tables', label: 'Mesas / Salón', icon: 'layout-grid', perm: 'pos', badge: state.tables?.filter(t => t.status === 'OCUPADA').length },
      { id: 'pos', label: 'Punto de Venta', icon: 'shopping-cart', perm: 'pos' },
      { id: 'kds', label: 'Pantalla Cocina', icon: 'utensils-crossed', perm: 'kds', badge: state.orders.filter(o => o.status === 'PENDIENTE' || o.status === 'EN_PREPARACION').length },
      { id: 'menu', label: 'Menú & Platos', icon: 'coffee', perm: 'all' },
      { id: 'inventory', label: 'Inventario Materias', icon: 'boxes', perm: 'inventory' },
      { id: 'recipes', label: 'Recetas & Fichas', icon: 'book-open', perm: 'inventory' },
      { id: 'cash', label: 'Caja & Turnos', icon: 'wallet', perm: 'cash_register' },
      { id: 'purchases', label: 'Compras & Proveedores', icon: 'truck', perm: 'inventory' },
      { id: 'waste', label: 'Desperdicios & Gastos', icon: 'trash-2', perm: 'inventory' },
      { id: 'reports', label: 'Reportes & Cierre', icon: 'bar-chart-3', perm: 'all' },
      { id: 'users', label: 'Usuarios & Claves', icon: 'shield-check', perm: 'all' },
      { id: 'settings', label: 'Configuración', icon: 'settings', perm: 'all' }
    ];

    const userPerms = state.user.permissions || [];
    const isAllowed = (perm) => userPerms.includes('all') || userPerms.includes(perm);

    return `
      <aside class="w-16 md:w-60 bg-boca-dark border-r border-boca-border flex flex-col justify-between select-none">
        <nav class="p-2 md:p-3 space-y-1">
          ${navItems.map(item => {
            if (!isAllowed(item.perm)) return '';
            const isActive = state.activeTab === item.id;
            return `
              <button onclick="window.BocaApp.switchTab('${item.id}')"
                class="w-full flex items-center space-x-3 px-3 py-2.5 rounded-xl font-medium text-xs transition duration-150 ${
                  isActive
                    ? 'bg-gradient-to-r from-boca-cream to-boca-creamHover text-boca-black font-bold shadow-md'
                    : 'text-neutral-400 hover:text-boca-cream hover:bg-neutral-800/60'
                }">
                <i data-lucide="${item.icon}" class="w-4 h-4 ${isActive ? 'text-boca-black' : 'text-neutral-400'}"></i>
                <span class="hidden md:inline truncate">${item.label}</span>
                ${item.badge ? `
                  <span class="hidden md:inline-flex ml-auto bg-boca-gold text-boca-black text-[10px] font-black px-1.5 py-0.5 rounded-full">
                    ${item.badge}
                  </span>
                ` : ''}
              </button>
            `;
          }).join('')}
        </nav>

        <!-- Quick Excel Export Banner at bottom of sidebar (ADMIN ONLY) -->
        ${isAllowed('all') ? `
          <div class="p-3 hidden md:block">
            <div class="bg-gradient-to-br from-boca-card to-neutral-900 border border-boca-gold/30 rounded-xl p-3 text-center">
              <i data-lucide="file-spreadsheet" class="w-6 h-6 text-boca-gold mx-auto mb-1"></i>
              <h4 class="text-xs font-bold text-boca-cream">Cierre de Ventas</h4>
              <p class="text-[10px] text-boca-muted mb-2">Exporta las 8 hojas en formato XLSX</p>
              <a href="/api/export/excel/closure?userId=${state.user.id}" download="Boca2Wings_Cierre.xlsx" class="block w-full bg-boca-gold hover:bg-boca-goldLight text-boca-black text-xs font-bold py-1.5 px-2 rounded-lg transition shadow">
                Exportar a Excel
              </a>
            </div>
          </div>
        ` : ''}
      </aside>
    `;
  }

  function renderTabContent() {
    const userPerms = state.user?.permissions || [];
    const isAllowed = (perm) => userPerms.includes('all') || userPerms.includes(perm);

    const permMap = {
      dashboard: 'all',
      reports: 'all',
      users: 'all',
      settings: 'all',
      menu: 'all',
      tables: 'pos',
      pos: 'pos',
      kds: 'kds',
      inventory: 'inventory',
      recipes: 'inventory',
      purchases: 'inventory',
      waste: 'inventory',
      cash: 'cash_register'
    };

    const requiredPerm = permMap[state.activeTab];
    if (requiredPerm && !isAllowed(requiredPerm)) {
      return `
        <div class="h-full flex items-center justify-center p-6">
          <div class="bg-boca-card border border-red-500/40 rounded-2xl p-8 max-w-md text-center space-y-4 shadow-2xl">
            <div class="w-16 h-16 rounded-full bg-red-950/60 text-red-400 mx-auto flex items-center justify-center border border-red-800">
              <i data-lucide="shield-alert" class="w-8 h-8"></i>
            </div>
            <h2 class="text-xl font-display font-black text-boca-cream">ACCESO DENEGADO</h2>
            <p class="text-xs text-boca-muted">
              Tu rol actual (<strong class="text-boca-gold">${state.user.role_name}</strong>) no tiene autorización para acceder al módulo administrativo de <strong>${state.activeTab.toUpperCase()}</strong>.
            </p>
            <p class="text-[11px] text-neutral-500">
              Esta sección está restringida únicamente a personal con permisos de Administrador.
            </p>
            <button onclick="window.BocaApp.switchTab('pos')" class="bg-boca-gold text-boca-black font-bold px-4 py-2 rounded-xl text-xs">
              Volver al Punto de Venta
            </button>
          </div>
        </div>
      `;
    }

    switch (state.activeTab) {
      case 'dashboard': return renderDashboard();
      case 'tables': return renderTables();
      case 'pos': return renderPOS();
      case 'kds': return renderKDS();
      case 'menu': return renderMenu();
      case 'inventory': return renderInventory();
      case 'recipes': return renderRecipes();
      case 'cash': return renderCash();
      case 'purchases': return renderPurchases();
      case 'waste': return renderWasteAndExpenses();
      case 'reports': return renderReports();
      case 'users': return renderUsers();
      case 'settings': return renderSettings();
      default: return renderPOS();
    }
  }

  // --- 1. DASHBOARD VIEW ---
  function renderDashboard() {
    const d = state.dashboard || {};
    return `
      <div class="space-y-6">
        <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 class="text-2xl font-display font-black text-boca-cream tracking-wide">DASHBOARD EJECUTIVO</h1>
            <p class="text-xs text-boca-muted">Métricas operativas en tiempo real de Boca2 Wings</p>
          </div>
          <div class="flex items-center space-x-2">
            <a href="/api/export/excel/closure" class="flex items-center space-x-2 bg-boca-gold hover:bg-boca-goldLight text-boca-black px-4 py-2 rounded-xl text-xs font-bold transition shadow-lg">
              <i data-lucide="download" class="w-4 h-4"></i>
              <span>EXPORTAR CIERRE A EXCEL</span>
            </a>
          </div>
        </div>

        <!-- Metric Cards -->
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <!-- Card 1: Ventas Hoy -->
          <div class="bg-boca-card border border-boca-border rounded-2xl p-4 shadow-sm hover:border-boca-gold/40 transition">
            <div class="flex items-center justify-between text-boca-muted mb-2">
              <span class="text-xs font-medium">Ventas de Hoy</span>
              <div class="p-2 rounded-lg bg-emerald-950/60 text-emerald-400">
                <i data-lucide="trending-up" class="w-4 h-4"></i>
              </div>
            </div>
            <div class="text-2xl font-display font-black text-emerald-400">${formatCOP(d.todaySales)}</div>
            <div class="text-[11px] text-boca-muted mt-1">${d.todayOrdersCount || 0} pedidos despachados hoy</div>
          </div>

          <!-- Card 2: Ventas Totales -->
          <div class="bg-boca-card border border-boca-border rounded-2xl p-4 shadow-sm hover:border-boca-gold/40 transition">
            <div class="flex items-center justify-between text-boca-muted mb-2">
              <span class="text-xs font-medium">Ventas Acumuladas</span>
              <div class="p-2 rounded-lg bg-blue-950/60 text-blue-400">
                <i data-lucide="dollar-sign" class="w-4 h-4"></i>
              </div>
            </div>
            <div class="text-2xl font-display font-black text-neutral-100">${formatCOP(d.totalSales)}</div>
            <div class="text-[11px] text-boca-muted mt-1">${d.totalOrdersCount || 0} órdenes en historial</div>
          </div>

          <!-- Card 3: Margen Bruto Estimado -->
          <div class="bg-boca-card border border-boca-border rounded-2xl p-4 shadow-sm hover:border-boca-gold/40 transition">
            <div class="flex items-center justify-between text-boca-muted mb-2">
              <span class="text-xs font-medium">Margen Bruto (COGS)</span>
              <div class="p-2 rounded-lg bg-amber-950/60 text-amber-400">
                <i data-lucide="pie-chart" class="w-4 h-4"></i>
              </div>
            </div>
            <div class="text-2xl font-display font-black text-amber-300">${formatCOP(d.grossMargin)}</div>
            <div class="text-[11px] text-boca-muted mt-1">Costo Recetas: ${formatCOP(d.totalCogs)}</div>
          </div>

          <!-- Card 4: Resultado Operativo -->
          <div class="bg-boca-card border border-boca-border rounded-2xl p-4 shadow-sm hover:border-boca-gold/40 transition">
            <div class="flex items-center justify-between text-boca-muted mb-2">
              <span class="text-xs font-medium">Resultado Operativo</span>
              <div class="p-2 rounded-lg bg-purple-950/60 text-purple-400">
                <i data-lucide="calculator" class="w-4 h-4"></i>
              </div>
            </div>
            <div class="text-2xl font-display font-black ${d.operatingResult >= 0 ? 'text-emerald-400' : 'text-red-400'}">${formatCOP(d.operatingResult)}</div>
            <div class="text-[11px] text-boca-muted mt-1">Gastos Operativos: ${formatCOP(d.totalExpenses)}</div>
          </div>
        </div>

        <!-- Secondary Status Row: Stock Alerts & Kitchen Queue -->
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <!-- Low Stock Ingredients Alert -->
          <div class="bg-boca-card border border-boca-border rounded-2xl p-5">
            <div class="flex items-center justify-between mb-4">
              <div class="flex items-center space-x-2">
                <i data-lucide="alert-triangle" class="w-5 h-5 text-amber-400"></i>
                <h3 class="font-display font-bold text-sm text-boca-cream">Alertas de Inventario Crítico</h3>
              </div>
              <span class="text-xs bg-amber-950 text-amber-400 px-2 py-0.5 rounded border border-amber-800">
                ${(d.lowStockItems?.length || 0) + (d.outOfStockItems?.length || 0)} Insumos
              </span>
            </div>

            <div class="space-y-2 max-h-60 overflow-y-auto pr-1">
              ${[...(d.outOfStockItems || []), ...(d.lowStockItems || [])].length === 0 ? `
                <div class="text-center py-8 text-neutral-500 text-xs">
                  <i data-lucide="check-circle-2" class="w-8 h-8 mx-auto mb-2 text-emerald-500/60"></i>
                  Todos los ingredientes tienen existencias óptimas
                </div>
              ` : [...(d.outOfStockItems || []), ...(d.lowStockItems || [])].map(ing => `
                <div class="flex items-center justify-between p-2.5 rounded-xl bg-neutral-900/60 border border-neutral-800 text-xs">
                  <div>
                    <div class="font-semibold text-neutral-200">${ing.name}</div>
                    <div class="text-[11px] text-neutral-500">Mínimo: ${ing.stock_min} ${ing.unit}</div>
                  </div>
                  <div class="text-right">
                    <span class="px-2 py-0.5 rounded font-bold text-[11px] ${ing.stock_current <= 0 ? 'bg-red-950 text-red-400 border border-red-800' : 'bg-amber-950 text-amber-400 border border-amber-800'}">
                      ${ing.stock_current} ${ing.unit}
                    </span>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>

          <!-- Active Kitchen Queue Summary -->
          <div class="bg-boca-card border border-boca-border rounded-2xl p-5">
            <div class="flex items-center justify-between mb-4">
              <div class="flex items-center space-x-2">
                <i data-lucide="flame" class="w-5 h-5 text-boca-gold"></i>
                <h3 class="font-display font-bold text-sm text-boca-cream">Cola de Preparación Cocina</h3>
              </div>
              <button onclick="window.BocaApp.switchTab('kds')" class="text-xs text-boca-gold hover:underline">
                Abrir KDS &rarr;
              </button>
            </div>

            <div class="space-y-2 max-h-60 overflow-y-auto pr-1">
              ${(d.pendingKitchenOrders || []).length === 0 ? `
                <div class="text-center py-8 text-neutral-500 text-xs">
                  <i data-lucide="utensils" class="w-8 h-8 mx-auto mb-2 text-neutral-600"></i>
                  No hay pedidos pendientes en cocina en este momento
                </div>
              ` : (d.pendingKitchenOrders || []).map(ord => `
                <div class="flex items-center justify-between p-2.5 rounded-xl bg-neutral-900/60 border border-neutral-800 text-xs">
                  <div>
                    <div class="font-bold text-boca-cream">${ord.id} — <span class="text-neutral-300 font-normal">${ord.customer_name || 'Mostrador'}</span></div>
                    <div class="text-[11px] text-neutral-500">${ord.items?.length || 0} artículos &bull; ${formatDate(ord.created_at)}</div>
                  </div>
                  <span class="px-2 py-0.5 rounded text-[10px] font-bold ${ord.status === 'EN_PREPARACION' ? 'bg-amber-950 text-amber-400 border border-amber-700' : 'bg-blue-950 text-blue-400 border border-blue-700'}">
                    ${ord.status}
                  </span>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  // --- MESAS & CUENTAS ABIERTAS VIEW ---
  function renderTables() {
    const tables = state.tables || [];
    const occupied = tables.filter(t => t.status === 'OCUPADA');
    const free = tables.filter(t => t.status === 'LIBRE');
    const totalPendingCOP = occupied.reduce((sum, t) => sum + (t.active_order?.total || 0), 0);

    return `
      <div class="space-y-6">
        <!-- Header -->
        <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 class="text-2xl font-display font-black text-boca-cream tracking-wide">MESAS & CUENTAS ABIERTAS</h1>
            <p class="text-xs text-boca-muted">Gestión visual del salón, comandas activas y cobro de mesas</p>
          </div>
          <div class="flex items-center space-x-3">
            <button onclick="window.BocaApp.openNewTableModal()" class="flex items-center space-x-1.5 bg-neutral-800 hover:bg-neutral-700 text-boca-cream border border-boca-border px-3.5 py-2 rounded-xl text-xs font-bold transition">
              <i data-lucide="plus" class="w-4 h-4 text-boca-gold"></i>
              <span>Nueva Mesa</span>
            </button>
            <button onclick="window.BocaApp.refreshTables()" class="p-2 bg-boca-card hover:bg-neutral-800 border border-boca-border rounded-xl text-neutral-400 hover:text-boca-cream transition" title="Refrescar">
              <i data-lucide="refresh-cw" class="w-4 h-4"></i>
            </button>
          </div>
        </div>

        <!-- Metric Badges -->
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div class="bg-boca-card border border-boca-border rounded-2xl p-3.5">
            <div class="text-[11px] text-boca-muted font-bold">TOTAL MESAS</div>
            <div class="text-xl font-display font-black text-neutral-100 mt-1">${tables.length}</div>
          </div>
          <div class="bg-boca-card border border-emerald-500/30 rounded-2xl p-3.5">
            <div class="text-[11px] text-emerald-400 font-bold">MESAS LIBRES</div>
            <div class="text-xl font-display font-black text-emerald-300 mt-1">${free.length}</div>
          </div>
          <div class="bg-boca-card border border-amber-500/30 rounded-2xl p-3.5">
            <div class="text-[11px] text-amber-400 font-bold">MESAS OCUPADAS</div>
            <div class="text-xl font-display font-black text-amber-300 mt-1">${occupied.length}</div>
          </div>
          <div class="bg-boca-card border border-boca-gold/40 rounded-2xl p-3.5">
            <div class="text-[11px] text-boca-gold font-bold">TOTAL EN CUENTAS</div>
            <div class="text-xl font-display font-black text-boca-cream mt-1">${formatCOP(totalPendingCOP)}</div>
          </div>
        </div>

        <!-- Tables Grid -->
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          ${tables.map(table => {
            const isOcc = table.status === 'OCUPADA';
            const ord = table.active_order;
            const elapsedMin = ord ? Math.max(1, Math.round((Date.now() - new Date(ord.created_at).getTime()) / 60000)) : 0;
            return `
              <div class="rounded-2xl border transition shadow-md flex flex-col justify-between overflow-hidden ${
                isOcc
                  ? 'bg-gradient-to-b from-boca-card to-amber-950/20 border-amber-500/40 hover:border-amber-400'
                  : 'bg-boca-card border-boca-border hover:border-emerald-500/50'
              }">
                <!-- Table Card Header -->
                <div class="p-4 border-b ${isOcc ? 'border-amber-500/20' : 'border-neutral-800'} flex items-start justify-between">
                  <div>
                    <div class="flex items-center space-x-2">
                      <h3 class="font-display font-black text-base text-boca-cream">${table.name}</h3>
                      <span class="text-[10px] text-neutral-400 bg-neutral-900 border border-neutral-800 px-2 py-0.5 rounded-full">
                        ${table.area || 'Salón'} &bull; ${table.capacity || 4} pers.
                      </span>
                    </div>
                    ${isOcc ? `
                      <div class="text-[11px] text-amber-300/90 font-medium mt-1">
                        Orden: <strong>${ord.id}</strong> (${ord.customer_name})
                      </div>
                      <div class="text-[10px] text-neutral-400">
                        Abierta hace ${elapsedMin} min &bull; ${ord.items?.length || 0} platos
                      </div>
                    ` : `
                      <div class="text-[11px] text-emerald-400 font-medium mt-1">
                        Mesa Disponible
                      </div>
                    `}
                  </div>
                  <span class="px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${
                    isOcc
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/50 animate-pulse-subtle'
                      : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                  }">
                    ${isOcc ? 'OCUPADA' : 'LIBRE'}
                  </span>
                </div>

                <!-- Table Card Body (Items preview if occupied) -->
                ${isOcc ? `
                  <div class="p-4 flex-1 space-y-2 bg-neutral-950/40 text-xs">
                    <div class="text-[11px] text-neutral-400 font-semibold mb-1">Consumo actual:</div>
                    <div class="max-h-28 overflow-y-auto space-y-1.5 pr-1">
                      ${ord.items.map(it => `
                        <div class="flex items-center justify-between text-[11px] py-0.5 border-b border-neutral-800/40">
                          <div class="truncate pr-2">
                            <span class="text-boca-gold font-bold">${it.quantity}x</span> ${it.name}
                            ${it.notes ? `<span class="block text-[10px] text-amber-300/80 italic pl-3">&bull; ${it.notes}</span>` : ''}
                          </div>
                          <span class="font-mono text-neutral-300">${formatCOP(it.total)}</span>
                        </div>
                      `).join('')}
                    </div>

                    <div class="pt-2 border-t border-neutral-800 flex justify-between items-baseline">
                      <span class="text-neutral-400 text-xs font-bold">TOTAL ACUMULADO:</span>
                      <span class="font-display font-black text-base text-boca-gold">${formatCOP(ord.total)}</span>
                    </div>
                  </div>
                ` : `
                  <div class="p-8 flex-1 flex flex-col items-center justify-center text-center text-neutral-500">
                    <i data-lucide="utensils" class="w-8 h-8 mb-2 text-neutral-700"></i>
                    <p class="text-xs">Mesa libre para nuevos clientes</p>
                  </div>
                `}

                <!-- Table Card Actions -->
                <div class="p-3 bg-neutral-900/60 border-t ${isOcc ? 'border-amber-500/20' : 'border-neutral-800'} flex items-center gap-2">
                  ${isOcc ? `
                    <button onclick="window.BocaApp.openTableOrderInPOS('${table.name}', '${ord.id}')"
                      class="flex-1 bg-neutral-800 hover:bg-neutral-700 text-boca-cream border border-neutral-700 py-2 rounded-xl text-xs font-bold transition flex items-center justify-center space-x-1" title="Agregar más platos a esta mesa">
                      <i data-lucide="plus-circle" class="w-3.5 h-3.5 text-boca-gold"></i>
                      <span>+ Platos</span>
                    </button>
                    <button onclick="window.BocaApp.printPreCuenta('${ord.id}')"
                      class="p-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 border border-neutral-700 rounded-xl transition" title="Imprimir Pre-cuenta">
                      <i data-lucide="printer" class="w-4 h-4"></i>
                    </button>
                    <button onclick="window.BocaApp.openTableCheckoutModal('${ord.id}')"
                      class="flex-1 bg-gradient-to-r from-boca-gold to-boca-goldLight text-boca-black font-display font-black py-2 rounded-xl text-xs transition shadow flex items-center justify-center space-x-1">
                      <i data-lucide="check" class="w-3.5 h-3.5"></i>
                      <span>Cobrar Mesa</span>
                    </button>
                  ` : `
                    <button onclick="window.BocaApp.startTableOrder('${table.name}')"
                      class="w-full bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 py-2.5 rounded-xl text-xs font-bold transition flex items-center justify-center space-x-2">
                      <i data-lucide="coffee" class="w-4 h-4"></i>
                      <span>Tomar Pedido</span>
                    </button>
                  `}
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }

  // --- 2. POS (PUNTO DE VENTA) VIEW ---
  function renderPOS() {
    const filteredProducts = state.products.filter(p => {
      const matchCat = state.posCategory === 'all' || p.category_id === state.posCategory;
      const matchSearch = !state.posSearch || p.name.toLowerCase().includes(state.posSearch.toLowerCase()) || p.code.toLowerCase().includes(state.posSearch.toLowerCase());
      return matchCat && matchSearch && p.active;
    });

    return `
      <div class="flex flex-col lg:flex-row gap-4 h-full">
        <!-- Catalog & Categories Area (Left) -->
        <div class="flex-1 flex flex-col space-y-4 overflow-hidden">
          <!-- Search & Type of Order Bar -->
          <div class="bg-boca-card border border-boca-border rounded-2xl p-3 flex flex-wrap items-center justify-between gap-3">
            <!-- Search Input -->
            <div class="relative flex-1 min-w-[200px]">
              <i data-lucide="search" class="w-4 h-4 text-neutral-400 absolute left-3 top-1/2 -translate-y-1/2"></i>
              <input type="text"
                placeholder="Buscar por alitas, combos, papas, hamburguesas..."
                value="${state.posSearch}"
                oninput="window.BocaApp.setPosSearch(this.value)"
                class="w-full bg-neutral-900 border border-neutral-800 rounded-xl pl-9 pr-3 py-2 text-xs text-neutral-100 placeholder-neutral-500 focus:outline-none focus:border-boca-gold transition" />
            </div>

            <!-- Order Type Selector -->
            <div class="flex items-center space-x-1 bg-neutral-900 p-1 rounded-xl border border-neutral-800 text-xs">
              ${['MESA', 'LLEVAR', 'RECOGER', 'DOMICILIO'].map(type => `
                <button onclick="window.BocaApp.setOrderType('${type}')"
                  class="px-2.5 py-1.5 rounded-lg font-bold text-[11px] transition ${state.orderType === type ? 'bg-boca-gold text-boca-black shadow' : 'text-neutral-400 hover:text-neutral-200'}">
                  ${type}
                </button>
              `).join('')}
            </div>
          </div>

          <!-- Category Pills -->
          <div class="flex items-center space-x-2 overflow-x-auto pb-1 scrollbar-none">
            <button onclick="window.BocaApp.setPosCategory('all')"
              class="px-3.5 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition ${state.posCategory === 'all' ? 'bg-boca-cream text-boca-black' : 'bg-boca-card text-neutral-400 hover:text-boca-cream border border-boca-border'}">
              Todos los Platos
            </button>
            ${state.categories.map(cat => `
              <button onclick="window.BocaApp.setPosCategory('${cat.id}')"
                class="px-3.5 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition ${state.posCategory === cat.id ? 'bg-boca-cream text-boca-black' : 'bg-boca-card text-neutral-400 hover:text-boca-cream border border-boca-border'}">
                ${cat.name}
              </button>
            `).join('')}
          </div>

          <!-- Product Grid -->
          <div class="flex-1 overflow-y-auto grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3 pr-1">
            ${filteredProducts.length === 0 ? `
              <div class="col-span-full text-center py-12 text-neutral-500 text-sm">
                No se encontraron productos en esta categoría.
              </div>
            ` : filteredProducts.map(p => `
              <div onclick="window.BocaApp.handleProductClick('${p.id}')"
                class="bg-boca-card border border-boca-border hover:border-boca-gold/60 rounded-2xl p-3 flex flex-col justify-between cursor-pointer transition transform hover:-translate-y-0.5 shadow-sm group">
                <div>
                  <div class="relative h-28 w-full rounded-xl overflow-hidden bg-neutral-900 mb-2">
                    <img src="${p.image_url || '/logo.png'}" alt="${p.name}" class="w-full h-full object-cover group-hover:scale-105 transition duration-300" />
                    <span class="absolute top-2 right-2 bg-boca-black/80 backdrop-blur text-boca-gold text-[10px] font-bold px-2 py-0.5 rounded border border-boca-gold/30">
                      ${p.prep_station || 'Frituras'}
                    </span>
                  </div>
                  <h4 class="font-display font-bold text-xs text-neutral-100 group-hover:text-boca-cream line-clamp-2">${p.name}</h4>
                  <p class="text-[10px] text-neutral-500 line-clamp-1 mt-0.5">${p.description || ''}</p>
                </div>
                <div class="flex items-center justify-between mt-3 pt-2 border-t border-neutral-800">
                  <div class="font-display font-black text-xs text-boca-gold">
                    ${formatCOP(p.price)}
                    ${p.has_variants ? '<span class="text-[9px] text-neutral-400 font-normal">desde</span>' : ''}
                  </div>
                  <span class="w-6 h-6 rounded-lg bg-boca-cream/10 text-boca-cream flex items-center justify-center group-hover:bg-boca-cream group-hover:text-boca-black transition">
                    <i data-lucide="plus" class="w-3.5 h-3.5"></i>
                  </span>
                </div>
              </div>
            `).join('')}
          </div>
        </div>

        <!-- POS Cart Area (Right) -->
        <div class="w-full lg:w-96 bg-boca-card border border-boca-border rounded-2xl flex flex-col justify-between overflow-hidden shadow-xl">
          <!-- Cart Header -->
          <div class="p-3.5 border-b border-boca-border bg-boca-dark flex items-center justify-between">
            <div class="flex items-center space-x-2">
              <i data-lucide="shopping-bag" class="w-4 h-4 text-boca-gold"></i>
              <h3 class="font-display font-bold text-xs text-boca-cream">Comanda / Carrito</h3>
            </div>
            <button onclick="window.BocaApp.clearCart()" class="text-[11px] text-neutral-400 hover:text-red-400 transition">
              Limpiar
            </button>
          </div>

          <!-- Order Metadata (Table, Customer, Address) -->
          <div class="p-3 bg-neutral-900/60 border-b border-boca-border space-y-2 text-xs">
            ${state.orderType === 'MESA' ? `
              <div class="flex items-center space-x-2">
                <span class="text-neutral-400 text-[11px] w-14 font-semibold">Mesa:</span>
                <select onchange="window.BocaApp.setTableNumber(this.value)"
                  class="flex-1 bg-boca-dark border border-neutral-800 rounded-lg px-2.5 py-1.5 text-xs text-neutral-100 focus:outline-none focus:border-boca-gold font-bold">
                  ${(state.tables && state.tables.length > 0 ? state.tables : [
                    { name: 'Mesa 1' }, { name: 'Mesa 2' }, { name: 'Mesa 3' }, { name: 'Mesa 4' },
                    { name: 'Mesa 5' }, { name: 'Mesa 6' }, { name: 'Mesa 7' }, { name: 'Mesa 8' },
                    { name: 'Barra 1' }, { name: 'Barra 2' }, { name: 'Terraza 1' }, { name: 'Terraza 2' }
                  ]).map(t => `
                    <option value="${t.name}" ${state.tableNumber === t.name ? 'selected' : ''}>
                      ${t.name} ${t.status === 'OCUPADA' ? `(OCUPADA - ${formatCOP(t.active_order?.total || 0)})` : '(LIBRE)'}
                    </option>
                  `).join('')}
                </select>
                <button onclick="window.BocaApp.switchTab('tables')" class="p-1.5 bg-neutral-800 hover:bg-neutral-700 text-boca-gold rounded-lg" title="Ver plano de mesas">
                  <i data-lucide="layout-grid" class="w-4 h-4"></i>
                </button>
              </div>

              ${(() => {
                const currentTable = (state.tables || []).find(t => t.name === state.tableNumber);
                if (currentTable && currentTable.status === 'OCUPADA' && currentTable.active_order) {
                  const ord = currentTable.active_order;
                  return `
                    <div class="p-2.5 bg-amber-950/40 border border-amber-600/40 rounded-xl space-y-1 text-xs">
                      <div class="flex items-center justify-between text-amber-300 font-bold">
                        <span class="flex items-center space-x-1">
                          <i data-lucide="alert-circle" class="w-3.5 h-3.5 text-amber-400"></i>
                          <span>Cuenta Abierta: ${ord.id}</span>
                        </span>
                        <span class="text-boca-gold font-mono">${formatCOP(ord.total)}</span>
                      </div>
                      <div class="text-[10px] text-neutral-400 flex justify-between items-center pt-0.5">
                        <span>${ord.items.length} platos en mesa</span>
                        <button onclick="window.BocaApp.openTableCheckoutModal('${ord.id}')" class="text-amber-300 hover:text-white font-bold bg-amber-900/60 px-2 py-0.5 rounded border border-amber-700/60 transition">
                          Cobrar Mesa
                        </button>
                      </div>
                    </div>
                  `;
                }
                return '';
              })()}
            ` : ''}

            <div class="flex items-center space-x-2">
              <span class="text-neutral-400 text-[11px] w-14">Cliente:</span>
              <input type="text" value="${state.customerName}" oninput="window.BocaApp.setCustomerName(this.value)"
                class="flex-1 bg-boca-dark border border-neutral-800 rounded-lg px-2.5 py-1 text-xs text-neutral-100 focus:outline-none focus:border-boca-gold" placeholder="Opcional (Cliente Mostrador)" />
            </div>

            ${state.orderType === 'DOMICILIO' ? `
              <div class="space-y-1.5 pt-1">
                <input type="text" value="${state.deliveryAddress}" oninput="window.BocaApp.setDeliveryAddress(this.value)"
                  class="w-full bg-boca-dark border border-neutral-800 rounded-lg px-2.5 py-1 text-xs text-neutral-100 focus:outline-none focus:border-boca-gold" placeholder="Dirección completa y barrio" />
                <div class="flex items-center space-x-2">
                  <span class="text-neutral-400 text-[11px] w-20">Valor Envío:</span>
                  <input type="number" value="${state.deliveryFee}" oninput="window.BocaApp.setDeliveryFee(this.value)"
                    class="w-28 bg-boca-dark border border-neutral-800 rounded-lg px-2.5 py-1 text-xs text-neutral-100 focus:outline-none focus:border-boca-gold" />
                </div>
              </div>
            ` : ''}
          </div>

          <!-- Cart Items List -->
          <div id="pos-cart-items" class="flex-1 overflow-y-auto p-3 space-y-2">
            ${renderPOSCartItems()}
          </div>

          <!-- Cart Footer: Notes & Action Buttons -->
          <div class="p-3.5 border-t border-boca-border bg-boca-dark space-y-3">
            <input type="text" placeholder="Observaciones generales para cocina..."
              value="${state.orderNotes}" oninput="window.BocaApp.setOrderNotes(this.value)"
              class="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-3 py-1.5 text-xs text-neutral-100 placeholder-neutral-500 focus:outline-none focus:border-boca-gold" />

            <div class="space-y-1 text-xs pt-1">
              <div class="flex justify-between text-neutral-400">
                <span>Subtotal Pedido Actual:</span>
                <span>${formatCOP(getCartSubtotal())}</span>
              </div>
              ${state.orderType === 'DOMICILIO' && state.deliveryFee > 0 ? `
                <div class="flex justify-between text-neutral-400">
                  <span>Envío a domicilio:</span>
                  <span>${formatCOP(state.deliveryFee)}</span>
                </div>
              ` : ''}
              <div class="flex justify-between text-boca-cream font-display font-black text-base pt-1 border-t border-neutral-800">
                <span>TOTAL PEDIDO:</span>
                <span class="text-boca-gold">${formatCOP(getCartTotal())}</span>
              </div>
            </div>

            ${state.orderType === 'MESA' ? `
              <div class="grid grid-cols-2 gap-2">
                <button onclick="window.BocaApp.chargeToTable()"
                  ${state.cart.length === 0 ? 'disabled' : ''}
                  class="bg-amber-600 hover:bg-amber-500 text-boca-black font-display font-black py-3 rounded-xl text-xs transition shadow-lg flex items-center justify-center space-x-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
                  title="Envía la comanda a cocina y deja la cuenta cargada a la mesa">
                  <i data-lucide="utensils" class="w-4 h-4"></i>
                  <span>CARGAR A MESA</span>
                </button>
                <button onclick="window.BocaApp.openCheckout()"
                  ${state.cart.length === 0 ? 'disabled' : ''}
                  class="bg-gradient-to-r from-boca-cream to-boca-creamHover hover:from-boca-creamHover hover:to-boca-creamDark text-boca-black font-display font-black py-3 rounded-xl text-xs transition shadow-lg flex items-center justify-center space-x-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
                  title="Cobrar inmediatamente">
                  <i data-lucide="check-circle" class="w-4 h-4"></i>
                  <span>COBRAR DIRECTO</span>
                </button>
              </div>
            ` : `
              <button onclick="window.BocaApp.openCheckout()"
                ${state.cart.length === 0 ? 'disabled' : ''}
                class="w-full bg-gradient-to-r from-boca-cream to-boca-creamHover hover:from-boca-creamHover hover:to-boca-creamDark text-boca-black font-display font-black py-3 rounded-xl text-sm transition shadow-lg flex items-center justify-center space-x-2 disabled:opacity-40 disabled:cursor-not-allowed">
                <i data-lucide="check-circle" class="w-4 h-4"></i>
                <span>CONFIRMAR Y COBRAR (${formatCOP(getCartTotal())})</span>
              </button>
            `}
          </div>
        </div>
      </div>
    `;
  }

  function renderPOSCartItems() {
    if (state.cart.length === 0) {
      return `
        <div class="text-center py-12 text-neutral-500 text-xs">
          <i data-lucide="shopping-cart" class="w-8 h-8 mx-auto mb-2 text-neutral-700"></i>
          El carrito está vacío.<br>Haz clic en los productos para agregarlos.
        </div>
      `;
    }

    return state.cart.map(item => `
      <div class="p-2.5 rounded-xl bg-neutral-900 border border-neutral-800 text-xs space-y-2">
        <div class="flex items-center justify-between">
          <div class="flex-1 pr-2">
            <div class="font-semibold text-neutral-200">${item.name}</div>
            <div class="text-[11px] text-boca-gold font-mono">${formatCOP(item.unit_price)} c/u</div>
          </div>
          <div class="flex items-center space-x-1.5">
            <button onclick="window.BocaApp.updateCartQty('${item.key}', -1)"
              class="w-6 h-6 rounded-lg bg-neutral-800 text-neutral-300 hover:bg-neutral-700 flex items-center justify-center text-xs font-bold transition">
              -
            </button>
            <span class="w-6 text-center font-bold text-neutral-100">${item.quantity}</span>
            <button onclick="window.BocaApp.updateCartQty('${item.key}', 1)"
              class="w-6 h-6 rounded-lg bg-neutral-800 text-neutral-300 hover:bg-neutral-700 flex items-center justify-center text-xs font-bold transition">
              +
            </button>
          </div>
          <div class="w-16 text-right font-display font-bold text-neutral-100 pl-2">
            ${formatCOP(item.total)}
          </div>
        </div>

        <!-- Item-Specific Observations (Sin salsa, sin cebolla, salsas aparte) -->
        <div class="pt-1 border-t border-neutral-800/80 flex flex-wrap items-center justify-between gap-1">
          ${item.notes ? `
            <div class="flex items-center space-x-1.5 bg-amber-950/60 border border-amber-600/50 text-amber-300 px-2 py-0.5 rounded-lg text-[10px]">
              <i data-lucide="message-square" class="w-3 h-3 text-amber-400"></i>
              <span class="font-medium">${item.notes}</span>
              <button onclick="window.BocaApp.clearItemNotes('${item.key}')" class="text-amber-400 hover:text-red-400 font-bold ml-1" title="Eliminar observación">&times;</button>
            </div>
          ` : `
            <button onclick="window.BocaApp.openItemNotesModal('${item.key}')" class="text-[10px] text-neutral-400 hover:text-boca-gold flex items-center space-x-1 py-0.5 transition">
              <i data-lucide="edit-3" class="w-3 h-3 text-boca-gold"></i>
              <span>+ Observación para cocina</span>
            </button>
          `}

          <!-- Quick tag button to edit/open modal -->
          ${item.notes ? `
            <button onclick="window.BocaApp.openItemNotesModal('${item.key}')" class="text-[10px] text-neutral-500 hover:text-neutral-300">
              Editar
            </button>
          ` : ''}
        </div>
      </div>
    `).join('');
  }

  function renderPOSCart() {
    const el = document.getElementById('pos-cart-items');
    if (el) {
      el.innerHTML = renderPOSCartItems();
      if (window.lucide) window.lucide.createIcons();
    }
    // Also re-render pos to update totals
    const pos = document.querySelector('main');
    if (pos && state.activeTab === 'pos') {
      render();
    }
  }

  // --- 3. KDS (PANTALLA DE COCINA EN TIEMPO REAL) VIEW ---
  function renderKDS() {
    const now = Date.now();
    const stations = ['TODAS', 'Alitas', 'Frituras', 'Hamburguesas', 'Bebidas', 'Empaque'];

    // Filter active kitchen orders
    const activeOrders = state.orders.filter(o => o.status !== 'CANCELADO' && o.status !== 'ENTREGADO');

    const colNuevos = activeOrders.filter(o => o.status === 'PENDIENTE');
    const colPreparacion = activeOrders.filter(o => o.status === 'EN_PREPARACION');
    const colListos = activeOrders.filter(o => o.status === 'LISTO');

    return `
      <div class="flex flex-col h-full space-y-4">
        <!-- KDS Header Bar -->
        <div class="bg-boca-card border border-boca-border rounded-2xl p-4 flex flex-wrap items-center justify-between gap-4">
          <div class="flex items-center space-x-3">
            <img src="/logo.png" class="w-10 h-10 object-contain rounded-full border border-boca-gold/40" />
            <div>
              <h1 class="text-lg font-display font-black text-boca-cream tracking-wide">BOCA2 WINGS — PANTALLA DE COCINA (KDS)</h1>
              <p class="text-[11px] text-boca-muted">Actualización automática en tiempo real &bull; Control digital de comandas</p>
            </div>
          </div>

          <!-- Station Filter -->
          <div class="flex items-center space-x-1.5 bg-neutral-900 p-1 rounded-xl border border-neutral-800 text-xs">
            <span class="text-neutral-500 text-[11px] px-2">Estación:</span>
            ${stations.map(st => `
              <button onclick="window.BocaApp.setKdsStation('${st}')"
                class="px-2.5 py-1 rounded-lg font-bold text-[11px] transition ${state.kdsStation === st ? 'bg-boca-gold text-boca-black' : 'text-neutral-400 hover:text-neutral-200'}">
                ${st}
              </button>
            `).join('')}
          </div>
        </div>

        <!-- 3-Column Kanban Board -->
        <div class="flex-1 grid grid-cols-1 md:grid-cols-3 gap-4 overflow-hidden">
          <!-- Column 1: NUEVOS PEDIDOS -->
          <div class="bg-boca-dark/70 border border-blue-500/30 rounded-2xl flex flex-col overflow-hidden">
            <div class="bg-blue-950/60 border-b border-blue-500/30 p-3 flex items-center justify-between">
              <div class="flex items-center space-x-2 text-blue-400 font-bold text-xs uppercase tracking-wider">
                <i data-lucide="inbox" class="w-4 h-4"></i>
                <span>1. PEDIDOS NUEVOS</span>
              </div>
              <span class="bg-blue-500 text-white font-black text-xs px-2 py-0.5 rounded-full">${colNuevos.length}</span>
            </div>
            <div class="flex-1 p-3 overflow-y-auto space-y-3">
              ${colNuevos.length === 0 ? `
                <div class="text-center py-12 text-neutral-600 text-xs">No hay pedidos nuevos por iniciar</div>
              ` : colNuevos.map(o => renderKDSCard(o, 'PENDIENTE')).join('')}
            </div>
          </div>

          <!-- Column 2: EN PREPARACIÓN -->
          <div class="bg-boca-dark/70 border border-amber-500/30 rounded-2xl flex flex-col overflow-hidden">
            <div class="bg-amber-950/60 border-b border-amber-500/30 p-3 flex items-center justify-between">
              <div class="flex items-center space-x-2 text-amber-400 font-bold text-xs uppercase tracking-wider">
                <i data-lucide="chef-hat" class="w-4 h-4"></i>
                <span>2. EN PREPARACIÓN</span>
              </div>
              <span class="bg-amber-500 text-boca-black font-black text-xs px-2 py-0.5 rounded-full">${colPreparacion.length}</span>
            </div>
            <div class="flex-1 p-3 overflow-y-auto space-y-3">
              ${colPreparacion.length === 0 ? `
                <div class="text-center py-12 text-neutral-600 text-xs">No hay pedidos preparándose actualmente</div>
              ` : colPreparacion.map(o => renderKDSCard(o, 'EN_PREPARACION')).join('')}
            </div>
          </div>

          <!-- Column 3: LISTOS PARA ENTREGAR -->
          <div class="bg-boca-dark/70 border border-emerald-500/30 rounded-2xl flex flex-col overflow-hidden">
            <div class="bg-emerald-950/60 border-b border-emerald-500/30 p-3 flex items-center justify-between">
              <div class="flex items-center space-x-2 text-emerald-400 font-bold text-xs uppercase tracking-wider">
                <i data-lucide="check-circle-2" class="w-4 h-4"></i>
                <span>3. LISTOS PARA ENTREGAR</span>
              </div>
              <span class="bg-emerald-500 text-boca-black font-black text-xs px-2 py-0.5 rounded-full">${colListos.length}</span>
            </div>
            <div class="flex-1 p-3 overflow-y-auto space-y-3">
              ${colListos.length === 0 ? `
                <div class="text-center py-12 text-neutral-600 text-xs">No hay pedidos en espera de entrega</div>
              ` : colListos.map(o => renderKDSCard(o, 'LISTO')).join('')}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function renderKDSCard(order, status) {
    const elapsedMinutes = Math.floor((Date.now() - new Date(order.created_at).getTime()) / 60000);
    const isLate = elapsedMinutes >= 15;

    return `
      <div class="bg-boca-card border ${isLate ? 'border-red-500/80 shadow-red-500/20' : 'border-boca-border'} rounded-2xl p-3.5 space-y-3 shadow-md">
        <!-- Order Header -->
        <div class="flex items-start justify-between border-b border-neutral-800 pb-2">
          <div>
            <div class="flex items-center space-x-2">
              <span class="font-display font-black text-sm text-boca-cream">${order.id}</span>
              <span class="bg-neutral-800 text-neutral-300 font-bold text-[10px] px-1.5 py-0.5 rounded">
                ${order.order_type}
              </span>
            </div>
            <div class="text-xs text-neutral-400 mt-0.5">
              ${order.customer_name || 'Cliente'} &bull; ${order.table_number || order.delivery_address || 'Mostrador'}
            </div>
          </div>
          <div class="text-right">
            <div class="text-xs font-mono font-bold ${isLate ? 'text-red-400 animate-pulse' : 'text-neutral-400'}">
              <i data-lucide="clock" class="w-3 h-3 inline mr-1"></i>${elapsedMinutes} min
            </div>
            ${isLate ? '<span class="text-[9px] bg-red-950 text-red-400 px-1.5 py-0.2 rounded font-black border border-red-800">RETRASADO</span>' : ''}
          </div>
        </div>

        <!-- Items Checklist -->
        <div class="space-y-1.5 text-xs">
          ${(order.items || []).map(it => `
            <div class="flex items-start justify-between bg-neutral-900/60 p-2 rounded-lg border border-neutral-800/80">
              <div class="font-semibold text-neutral-100">
                <span class="text-boca-gold font-black">${it.quantity}x</span> ${it.name}
                ${it.notes ? `<div class="text-[11px] text-amber-300 font-normal italic">&bull; Obs: ${it.notes}</div>` : ''}
              </div>
              <span class="text-[9px] text-neutral-500 bg-neutral-800 px-1 rounded">${it.station || 'Cocina'}</span>
            </div>
          `).join('')}
        </div>

        <!-- Special Notes Alert -->
        ${order.notes ? `
          <div class="bg-amber-950/40 border border-amber-600/40 p-2 rounded-lg text-xs text-amber-300">
            <strong>Observación:</strong> ${order.notes}
          </div>
        ` : ''}

        <!-- Action Buttons -->
        <div class="pt-1 flex items-center gap-2">
          ${status === 'PENDIENTE' ? `
            <button onclick="window.BocaApp.updateOrderStatus('${order.id}', 'EN_PREPARACION')"
              class="flex-1 bg-amber-500 hover:bg-amber-400 text-boca-black font-bold text-xs py-2 rounded-xl transition shadow">
              Iniciar Preparación &rarr;
            </button>
          ` : status === 'EN_PREPARACION' ? `
            <button onclick="window.BocaApp.updateOrderStatus('${order.id}', 'LISTO')"
              class="flex-1 bg-emerald-500 hover:bg-emerald-400 text-boca-black font-bold text-xs py-2 rounded-xl transition shadow">
              Marcar como Listo &check;
            </button>
          ` : `
            <button onclick="window.BocaApp.updateOrderStatus('${order.id}', 'ENTREGADO')"
              class="flex-1 bg-neutral-800 hover:bg-neutral-700 text-boca-cream font-bold text-xs py-2 rounded-xl transition border border-neutral-700">
              Despachar / Entregado &check;
            </button>
          `}
        </div>
      </div>
    `;
  }

  // --- ADMINISTRACIÓN DE CARTA Y MENÚ ---
  function renderMenu() {
    const products = state.products || [];
    const categories = state.categories || [];
    const activeCount = products.filter(p => p.active).length;
    const inactiveCount = products.filter(p => !p.active).length;

    const filtered = state.menuSearch
      ? products.filter(p => p.name.toLowerCase().includes(state.menuSearch.toLowerCase()) || p.code?.toLowerCase().includes(state.menuSearch.toLowerCase()))
      : products;

    return `
      <div class="space-y-6">
        <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 class="text-2xl font-display font-black text-boca-cream tracking-wide">CARTA & MENÚ DE PLATOS</h1>
            <p class="text-xs text-boca-muted">Crea platos, modifica precios, costos estimados, estaciones de preparación y activa o desactiva productos</p>
          </div>
          <button onclick="window.BocaApp.openNewProductModal()"
            class="flex items-center space-x-2 bg-gradient-to-r from-boca-cream to-boca-creamHover hover:from-boca-creamHover hover:to-boca-creamDark text-boca-black font-display font-black px-4 py-2 rounded-xl text-xs transition shadow-lg">
            <i data-lucide="plus-circle" class="w-4 h-4"></i>
            <span>CREAR NUEVO PLATO</span>
          </button>
        </div>

        <!-- Metric Badges -->
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div class="bg-boca-card border border-boca-border rounded-2xl p-3.5">
            <div class="text-[11px] text-boca-muted font-bold">TOTAL PLATOS</div>
            <div class="text-xl font-display font-black text-neutral-100 mt-1">${products.length}</div>
          </div>
          <div class="bg-boca-card border border-emerald-500/30 rounded-2xl p-3.5">
            <div class="text-[11px] text-emerald-400 font-bold">PLATOS ACTIVOS</div>
            <div class="text-xl font-display font-black text-emerald-300 mt-1">${activeCount}</div>
          </div>
          <div class="bg-boca-card border border-neutral-700 rounded-2xl p-3.5">
            <div class="text-[11px] text-neutral-400 font-bold">DESACTIVADOS</div>
            <div class="text-xl font-display font-black text-neutral-300 mt-1">${inactiveCount}</div>
          </div>
          <div class="bg-boca-card border border-boca-gold/40 rounded-2xl p-3.5">
            <div class="text-[11px] text-boca-gold font-bold">CATEGORÍAS</div>
            <div class="text-xl font-display font-black text-boca-cream mt-1">${categories.length}</div>
          </div>
        </div>

        <!-- Products Table -->
        <div class="bg-boca-card border border-boca-border rounded-2xl overflow-hidden shadow-lg">
          <div class="p-4 border-b border-boca-border flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div class="flex items-center space-x-2">
              <i data-lucide="coffee" class="w-4 h-4 text-boca-gold"></i>
              <h3 class="font-display font-bold text-sm text-boca-cream">Catálogo de Platos Boca2 Wings</h3>
            </div>
            <input type="text" placeholder="Buscar plato por nombre o código..."
              value="${state.menuSearch || ''}"
              oninput="window.BocaApp.setMenuSearch(this.value)"
              class="bg-boca-dark border border-neutral-800 rounded-xl px-3 py-1.5 text-xs text-neutral-100 placeholder-neutral-500 focus:outline-none focus:border-boca-gold w-64" />
          </div>

          <div class="overflow-x-auto">
            <table class="w-full text-left text-xs">
              <thead class="bg-boca-dark text-neutral-400 font-bold uppercase text-[10px] tracking-wider border-b border-neutral-800">
                <tr>
                  <th class="py-3 px-4">Plato</th>
                  <th class="py-3 px-4">Categoría</th>
                  <th class="py-3 px-4 text-right">Precio Venta</th>
                  <th class="py-3 px-4 text-right">Costo Estimado</th>
                  <th class="py-3 px-4 text-center">Margen %</th>
                  <th class="py-3 px-4">Estación</th>
                  <th class="py-3 px-4 text-center">Estado</th>
                  <th class="py-3 px-4 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-neutral-800/60">
                ${filtered.map(p => {
                  const cat = categories.find(c => c.id === p.category_id);
                  const marginPct = p.price > 0 ? Math.round(((p.price - (p.cost_estimated || 0)) / p.price) * 100) : 0;
                  return `
                    <tr class="hover:bg-neutral-800/40 transition">
                      <td class="py-3 px-4">
                        <div class="flex items-center space-x-3">
                          <img src="${p.image_url || '/logo.png'}" alt="${p.name}" class="w-9 h-9 rounded-lg object-cover bg-neutral-900 border border-neutral-800" />
                          <div>
                            <div class="font-bold text-neutral-100">${p.name}</div>
                            <div class="text-[10px] text-neutral-500 font-mono">${p.code || p.id}</div>
                          </div>
                        </div>
                      </td>
                      <td class="py-3 px-4">
                        <span class="bg-neutral-800 text-neutral-300 text-[10px] font-bold px-2 py-0.5 rounded-full border border-neutral-700">
                          ${cat ? cat.name : 'Varios'}
                        </span>
                      </td>
                      <td class="py-3 px-4 text-right font-display font-bold text-boca-gold">
                        ${formatCOP(p.price)}
                      </td>
                      <td class="py-3 px-4 text-right text-neutral-400 font-mono">
                        ${formatCOP(p.cost_estimated || 0)}
                      </td>
                      <td class="py-3 px-4 text-center">
                        <span class="text-[10px] font-bold px-2 py-0.5 rounded ${marginPct >= 50 ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-300'}">
                          ${marginPct}%
                        </span>
                      </td>
                      <td class="py-3 px-4 text-neutral-300">
                        <span class="text-[10px] text-neutral-400 bg-neutral-900 px-2 py-0.5 rounded border border-neutral-800">${p.prep_station || 'Frituras'}</span>
                      </td>
                      <td class="py-3 px-4 text-center">
                        <button onclick="window.BocaApp.toggleProductActive('${p.id}', ${!p.active})"
                          class="px-2.5 py-1 rounded-full text-[10px] font-bold transition ${
                            p.active
                              ? 'bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 border border-emerald-500/40'
                              : 'bg-neutral-800 text-neutral-500 hover:bg-neutral-700 border border-neutral-700'
                          }">
                          ${p.active ? '● Activo' : '○ Inactivo'}
                        </button>
                      </td>
                      <td class="py-3 px-4 text-right space-x-1.5 whitespace-nowrap">
                        <button onclick="window.BocaApp.openEditProductModal('${p.id}')"
                          class="bg-neutral-800 hover:bg-neutral-700 text-boca-cream border border-neutral-700 px-2.5 py-1 rounded-lg text-[11px] font-bold transition">
                          Editar
                        </button>
                        <button onclick="window.BocaApp.deleteProduct('${p.id}', '${p.name.replace(/'/g, "\\'")}')"
                          class="bg-red-950/60 hover:bg-red-900 text-red-400 border border-red-800/80 px-2.5 py-1 rounded-lg text-[11px] font-bold transition"
                          title="Eliminar plato de la carta">
                          Eliminar
                        </button>
                      </td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;
  }

  // --- 4. INVENTARIO INTELIGENTE VIEW ---
  function renderInventory() {
    return `
      <div class="space-y-6">
        <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 class="text-2xl font-display font-black text-boca-cream tracking-wide">INVENTARIO INTELIGENTE POR INGREDIENTES</h1>
            <p class="text-xs text-boca-muted">Control estricto de materias primas con descuento automático por porciones y recetas</p>
          </div>
          <div class="flex items-center space-x-2">
            <button onclick="window.BocaApp.openNewIngredientModal()" class="flex items-center space-x-2 bg-gradient-to-r from-boca-cream to-boca-creamHover hover:from-boca-creamHover hover:to-boca-creamDark text-boca-black font-display font-black px-3.5 py-2 rounded-xl text-xs transition shadow-lg">
              <i data-lucide="plus-circle" class="w-4 h-4"></i>
              <span>+ Nuevo Insumo</span>
            </button>
            <button onclick="window.BocaApp.openAdjustStockModal()" class="flex items-center space-x-2 bg-boca-card hover:bg-neutral-800 border border-boca-border px-3.5 py-2 rounded-xl text-xs font-bold text-boca-cream transition">
              <i data-lucide="clipboard-check" class="w-4 h-4 text-boca-gold"></i>
              <span>Ajuste Conteo Físico</span>
            </button>
          </div>
        </div>

        <!-- High-Impact Fries & Wings Showcase -->
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          <!-- Papas Fritas Gauge (Prueba 1 & 2) -->
          ${(() => {
            const papas = state.ingredients.find(i => i.id === 'ING-PAPAS') || {};
            const stockGrams = Number(papas.stock_current || 0);
            return `
              <div class="bg-gradient-to-br from-boca-card to-neutral-900 border border-boca-gold/40 rounded-2xl p-4 shadow-lg">
                <div class="flex items-center justify-between mb-2">
                  <span class="text-xs font-bold text-boca-gold uppercase tracking-wider">Stock de Papas Fritas</span>
                  <i data-lucide="utensils" class="w-4 h-4 text-boca-gold"></i>
                </div>
                <div class="text-3xl font-display font-black text-boca-cream">
                  ${stockGrams.toLocaleString('es-CO')} <span class="text-sm font-normal text-boca-muted">gramos</span>
                </div>
                <div class="text-xs text-neutral-400 mt-1">Equivale a ${(stockGrams / 1000).toFixed(1)} kg disponibles</div>
                <div class="mt-3 text-[11px] text-neutral-400 bg-neutral-950/60 p-2 rounded-lg border border-neutral-800">
                  Descuento automático: Pequeña: 150g &bull; Mediana: 200g &bull; Grande: 300g
                </div>
              </div>
            `;
          })()}

          <!-- Alitas Showcase -->
          ${(() => {
            const alitas = state.ingredients.find(i => i.id === 'ING-ALITAS') || {};
            return `
              <div class="bg-gradient-to-br from-boca-card to-neutral-900 border border-boca-border rounded-2xl p-4 shadow-lg">
                <div class="flex items-center justify-between mb-2">
                  <span class="text-xs font-bold text-amber-400 uppercase tracking-wider">Alitas de Pollo Marinadas</span>
                  <i data-lucide="flame" class="w-4 h-4 text-amber-400"></i>
                </div>
                <div class="text-3xl font-display font-black text-boca-cream">
                  ${Number(alitas.stock_current || 0)} <span class="text-sm font-normal text-boca-muted">piezas</span>
                </div>
                <div class="text-xs text-neutral-400 mt-1">Costo Unitario: ${formatCOP(alitas.cost_unit || 0)} / pieza</div>
                <div class="mt-3 text-[11px] text-neutral-400 bg-neutral-950/60 p-2 rounded-lg border border-neutral-800">
                  Control en porciones de 6, 8 (combos), 12 y 24 alitas
                </div>
              </div>
            `;
          })()}

          <!-- Salsas Showcase -->
          ${(() => {
            const salsa = state.ingredients.find(i => i.id === 'ING-SALSA-BBQ') || {};
            return `
              <div class="bg-gradient-to-br from-boca-card to-neutral-900 border border-boca-border rounded-2xl p-4 shadow-lg">
                <div class="flex items-center justify-between mb-2">
                  <span class="text-xs font-bold text-red-400 uppercase tracking-wider">Salsa BBQ Ahumada</span>
                  <i data-lucide="droplet" class="w-4 h-4 text-red-400"></i>
                </div>
                <div class="text-3xl font-display font-black text-boca-cream">
                  ${Number(salsa.stock_current || 0).toLocaleString('es-CO')} <span class="text-sm font-normal text-boca-muted">ml</span>
                </div>
                <div class="text-xs text-neutral-400 mt-1">Costo Unitario: ${formatCOP(salsa.cost_unit || 0)} / ml</div>
                <div class="mt-3 text-[11px] text-neutral-400 bg-neutral-950/60 p-2 rounded-lg border border-neutral-800">
                  Dosificación estándar de 40ml a 70ml según porción
                </div>
              </div>
            `;
          })()}
        </div>

        <!-- Full Ingredients Table -->
        <div class="bg-boca-card border border-boca-border rounded-2xl overflow-hidden shadow">
          <div class="p-4 border-b border-boca-border flex items-center justify-between">
            <h3 class="font-display font-bold text-sm text-boca-cream">Catálogo Completo de Materias Primas</h3>
            <span class="text-xs text-boca-muted">${state.ingredients.length} insumos registrados</span>
          </div>

          <div class="overflow-x-auto">
            <table class="w-full text-left text-xs">
              <thead class="bg-boca-dark text-neutral-400 border-b border-neutral-800">
                <tr>
                  <th class="p-3">Código</th>
                  <th class="p-3">Nombre del Insumo</th>
                  <th class="p-3">Categoría</th>
                  <th class="p-3">Stock Actual</th>
                  <th class="p-3">Stock Mínimo</th>
                  <th class="p-3">Costo Unitario</th>
                  <th class="p-3">Ubicación</th>
                  <th class="p-3">Estado</th>
                  <th class="p-3 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-neutral-800/60">
                ${state.ingredients.map(ing => {
                  const isCrit = ing.stock_current <= ing.stock_min;
                  return `
                    <tr class="hover:bg-neutral-900/40 transition">
                      <td class="p-3 font-mono text-neutral-400">${ing.code}</td>
                      <td class="p-3 font-semibold text-neutral-200">${ing.name}</td>
                      <td class="p-3 text-neutral-400">${ing.category}</td>
                      <td class="p-3 font-display font-black text-sm ${isCrit ? 'text-red-400' : 'text-neutral-100'}">
                        ${Number(ing.stock_current).toLocaleString('es-CO')} <span class="text-xs font-normal text-neutral-400">${ing.unit}</span>
                      </td>
                      <td class="p-3 text-neutral-400">${ing.stock_min} ${ing.unit}</td>
                      <td class="p-3 text-boca-gold font-mono">${formatCOP(ing.cost_unit)} / ${ing.unit}</td>
                      <td class="p-3 text-neutral-400">${ing.location || 'Bodega'}</td>
                      <td class="p-3">
                        <span class="px-2 py-0.5 rounded text-[10px] font-bold ${isCrit ? 'bg-red-950 text-red-400 border border-red-800' : 'bg-emerald-950 text-emerald-400 border border-emerald-800'}">
                          ${isCrit ? 'BAJO' : 'ÓPTIMO'}
                        </span>
                      </td>
                      <td class="p-3 text-right space-x-1.5 whitespace-nowrap">
                        <button onclick="window.BocaApp.openEditIngredientModal('${ing.id}')"
                          class="bg-neutral-800 hover:bg-neutral-700 text-boca-cream border border-neutral-700 px-2.5 py-1 rounded-lg text-[11px] font-bold transition">
                          Editar
                        </button>
                        <button onclick="window.BocaApp.deleteIngredient('${ing.id}', '${ing.name.replace(/'/g, "\\'")}')"
                          class="bg-red-950/60 hover:bg-red-900 text-red-400 border border-red-800/80 px-2.5 py-1 rounded-lg text-[11px] font-bold transition"
                          title="Eliminar insumo del inventario">
                          Eliminar
                        </button>
                      </td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;
  }

  // --- 5. RECETAS Y FICHAS TÉCNICAS VIEW ---
  function renderRecipes() {
    return `
      <div class="space-y-6">
        <div>
          <h1 class="text-2xl font-display font-black text-boca-cream tracking-wide">RECETAS Y FICHAS TÉCNICAS</h1>
          <p class="text-xs text-boca-muted">Ingredientes, gramajes por porción, costos teóricos y rendimiento de cada plato</p>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
          ${state.recipes.map(rec => {
            const prod = state.products.find(p => p.id === rec.product_id);
            const totalRecCost = (rec.items || []).reduce((sum, it) => sum + (Number(it.quantity) * Number(it.cost_unit)), 0);
            const salePrice = prod ? prod.price : 0;
            const margin = salePrice - totalRecCost;
            const marginPercent = salePrice > 0 ? ((margin / salePrice) * 100).toFixed(1) : 0;

            return `
              <div class="bg-boca-card border border-boca-border rounded-2xl p-5 space-y-4 shadow">
                <div class="flex items-start justify-between border-b border-neutral-800 pb-3">
                  <div>
                    <h3 class="font-display font-bold text-sm text-boca-cream">${rec.name}</h3>
                    <p class="text-xs text-boca-gold font-medium mt-0.5">${prod?.name || 'Producto'} &bull; Porción: ${rec.portion_size}</p>
                  </div>
                  <div class="text-right">
                    <div class="text-xs font-semibold text-neutral-400">Costo Estimado:</div>
                    <div class="text-base font-display font-black text-amber-300">${formatCOP(totalRecCost)}</div>
                  </div>
                </div>

                <!-- Recipe Items Breakdown -->
                <div class="space-y-1.5 text-xs">
                  <div class="grid grid-cols-12 text-[11px] font-bold text-neutral-500 px-2 pb-1">
                    <span class="col-span-6">Ingrediente</span>
                    <span class="col-span-3 text-right">Cantidad</span>
                    <span class="col-span-3 text-right">Subtotal</span>
                  </div>
                  ${(rec.items || []).map(it => {
                    const ing = state.ingredients.find(i => i.id === it.ingredient_id);
                    const subCost = Number(it.quantity) * Number(it.cost_unit);
                    return `
                      <div class="grid grid-cols-12 items-center bg-neutral-900/60 p-2 rounded-lg border border-neutral-800 text-xs">
                        <span class="col-span-6 font-medium text-neutral-200 truncate">${ing?.name || it.ingredient_id}</span>
                        <span class="col-span-3 text-right font-mono text-boca-cream font-bold">${it.quantity} ${it.unit}</span>
                        <span class="col-span-3 text-right font-mono text-neutral-400">${formatCOP(subCost)}</span>
                      </div>
                    `;
                  }).join('')}
                </div>

                <!-- Margin Banner -->
                <div class="flex items-center justify-between bg-neutral-900 p-2.5 rounded-xl border border-neutral-800 text-xs">
                  <span class="text-neutral-400">Margen Bruto Estimado:</span>
                  <span class="font-bold text-emerald-400">${formatCOP(margin)} (${marginPercent}%)</span>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }

  // --- 6. CAJA Y CIERRES DE TURNO VIEW ---
  function renderCash() {
    const reg = state.activeRegister;
    return `
      <div class="space-y-6">
        <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 class="text-2xl font-display font-black text-boca-cream tracking-wide">CAJA Y CIERRES DE TURNO</h1>
            <p class="text-xs text-boca-muted">Apertura, arqueos, entradas, retiros, efectivo físico y transferencias separadas</p>
          </div>
          <div class="flex items-center space-x-2">
            ${reg ? `
              <button onclick="window.BocaApp.openCashMoveModal('INGRESO')" class="bg-emerald-950 hover:bg-emerald-900 text-emerald-300 border border-emerald-600 px-3 py-1.5 rounded-xl text-xs font-bold transition">
                + Ingreso Efectivo
              </button>
              <button onclick="window.BocaApp.openCashMoveModal('RETIRO')" class="bg-amber-950 hover:bg-amber-900 text-amber-300 border border-amber-600 px-3 py-1.5 rounded-xl text-xs font-bold transition">
                - Retiro Efectivo
              </button>
              <button onclick="window.BocaApp.openCloseCashModal()" class="bg-red-600 hover:bg-red-500 text-white font-bold px-4 py-1.5 rounded-xl text-xs transition shadow">
                Cerrar Turno de Caja
              </button>
            ` : `
              <button onclick="window.BocaApp.openOpenCashModal()" class="bg-boca-gold hover:bg-boca-goldLight text-boca-black font-bold px-4 py-2 rounded-xl text-xs transition shadow-lg">
                + Abrir Nuevo Turno de Caja
              </button>
            `}
          </div>
        </div>

        <!-- Active Shift Details (Prueba 7) -->
        ${reg ? `
          <div class="bg-boca-card border border-boca-border rounded-2xl p-6 space-y-6 shadow-xl">
            <div class="flex items-center justify-between border-b border-neutral-800 pb-4">
              <div>
                <div class="flex items-center space-x-2">
                  <span class="text-lg font-display font-black text-boca-cream">TURNO ACTIVO: ${reg.code}</span>
                  <span class="bg-emerald-950 text-emerald-400 font-bold text-xs px-2 py-0.5 rounded border border-emerald-700">ABIERTO</span>
                </div>
                <p class="text-xs text-boca-muted mt-0.5">Apertura: ${formatDate(reg.opened_at)}</p>
              </div>
              <div class="text-right">
                <div class="text-xs text-neutral-400">Efectivo Físico Esperado en Cajón:</div>
                <div class="text-3xl font-display font-black text-emerald-400">${formatCOP(reg.expected_cash)}</div>
              </div>
            </div>

            <!-- Mathematical Breakdown (Section 14 & Prueba 7) -->
            <div class="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
              <div class="bg-neutral-900 p-3 rounded-xl border border-neutral-800">
                <span class="text-neutral-400 text-[11px]">Fondo Inicial (Base):</span>
                <div class="text-base font-bold text-neutral-100 mt-1">${formatCOP(reg.initial_fund)}</div>
              </div>
              <div class="bg-neutral-900 p-3 rounded-xl border border-neutral-800">
                <span class="text-neutral-400 text-[11px]">Ventas Físicas en Efectivo:</span>
                <div class="text-base font-bold text-emerald-400 mt-1">${formatCOP(reg.cash_sales)}</div>
              </div>
              <div class="bg-neutral-900 p-3 rounded-xl border border-neutral-800">
                <span class="text-neutral-400 text-[11px]">Ventas por Transferencia:</span>
                <div class="text-base font-bold text-blue-400 mt-1">${formatCOP(reg.transfer_sales)}</div>
                <div class="text-[10px] text-neutral-500">(No suman al efectivo físico)</div>
              </div>
              <div class="bg-neutral-900 p-3 rounded-xl border border-neutral-800">
                <span class="text-neutral-400 text-[11px]">Gastos & Retiros:</span>
                <div class="text-base font-bold text-red-400 mt-1">${formatCOP(Number(reg.cash_withdrawals || 0) + Number(reg.cash_expenses || 0))}</div>
              </div>
            </div>

            <div class="bg-neutral-950 p-4 rounded-xl border border-neutral-800 text-xs text-neutral-400 flex items-center justify-between">
              <span><strong>Fórmula de Efectivo Esperado:</strong> Fondo Inicial + Ventas Efectivo + Entradas - Retiros - Gastos</span>
              <span class="text-boca-cream font-mono font-bold">${formatCOP(reg.expected_cash)}</span>
            </div>
          </div>
        ` : `
          <div class="bg-boca-card border border-amber-500/40 rounded-2xl p-8 text-center space-y-3">
            <i data-lucide="lock" class="w-10 h-10 mx-auto text-amber-400"></i>
            <h3 class="text-lg font-display font-bold text-boca-cream">No hay ninguna caja abierta en este momento</h3>
            <p class="text-xs text-boca-muted max-w-md mx-auto">Para registrar ventas en efectivo y controlar el flujo de dinero, abre un turno de caja ingresando el fondo inicial.</p>
            <button onclick="window.BocaApp.openOpenCashModal()" class="bg-boca-gold hover:bg-boca-goldLight text-boca-black font-bold px-5 py-2.5 rounded-xl text-xs transition shadow-lg">
              Abrir Turno con Base Inicial
            </button>
          </div>
        `}
      </div>
    `;
  }

  // --- 7. COMPRAS Y PROVEEDORES VIEW ---
  function renderPurchases() {
    return `
      <div class="space-y-6">
        <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 class="text-2xl font-display font-black text-boca-cream tracking-wide">COMPRAS Y PROVEEDORES</h1>
            <p class="text-xs text-boca-muted">Órdenes de compra, proveedores y recepción física de mercancía (Prueba 10)</p>
          </div>
          <button onclick="window.BocaApp.openNewPurchaseModal()" class="flex items-center space-x-2 bg-boca-gold hover:bg-boca-goldLight text-boca-black font-bold px-4 py-2 rounded-xl text-xs transition shadow">
            <i data-lucide="plus" class="w-4 h-4"></i>
            <span>Nueva Orden de Compra</span>
          </button>
        </div>

        <div class="bg-boca-card border border-boca-border rounded-2xl overflow-hidden shadow">
          <div class="p-4 border-b border-boca-border flex items-center justify-between">
            <h3 class="font-display font-bold text-sm text-boca-cream">Historial de Órdenes de Compra</h3>
            <span class="text-xs text-boca-muted">${state.purchases.length} registros</span>
          </div>

          <div class="overflow-x-auto">
            <table class="w-full text-left text-xs">
              <thead class="bg-boca-dark text-neutral-400 border-b border-neutral-800">
                <tr>
                  <th class="p-3">ID Orden</th>
                  <th class="p-3">Proveedor</th>
                  <th class="p-3">Fecha Solicitud</th>
                  <th class="p-3">Factura</th>
                  <th class="p-3">Total (COP)</th>
                  <th class="p-3">Estado</th>
                  <th class="p-3 text-right">Acción</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-neutral-800/60">
                ${state.purchases.length === 0 ? `
                  <tr><td colspan="7" class="p-6 text-center text-neutral-500">No hay órdenes de compra registradas.</td></tr>
                ` : state.purchases.map(po => {
                  const sup = state.suppliers.find(s => s.id === po.supplier_id);
                  return `
                    <tr class="hover:bg-neutral-900/40 transition">
                      <td class="p-3 font-mono font-bold text-boca-cream">${po.id}</td>
                      <td class="p-3 font-semibold text-neutral-200">${sup?.name || po.supplier_id}</td>
                      <td class="p-3 text-neutral-400">${formatDate(po.ordered_at)}</td>
                      <td class="p-3 text-neutral-400">${po.invoice_number || 'S/N'}</td>
                      <td class="p-3 font-mono text-boca-gold font-bold">${formatCOP(po.total)}</td>
                      <td class="p-3">
                        <span class="px-2 py-0.5 rounded text-[10px] font-bold ${po.status === 'RECIBIDA' ? 'bg-emerald-950 text-emerald-400 border border-emerald-700' : 'bg-amber-950 text-amber-400 border border-amber-700'}">
                          ${po.status}
                        </span>
                      </td>
                      <td class="p-3 text-right">
                        ${po.status === 'SOLICITADA' ? `
                          <button onclick="window.BocaApp.receivePurchase('${po.id}')" class="bg-emerald-600 hover:bg-emerald-500 text-white px-2.5 py-1 rounded-lg text-[11px] font-bold transition">
                            Confirmar Recepción &uarr;
                          </button>
                        ` : `
                          <span class="text-[11px] text-neutral-500">Recibido ${formatDate(po.received_at)}</span>
                        `}
                      </td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;
  }

  // --- 8. DESPERDICIOS Y GASTOS OPERATIVOS VIEW ---
  function renderWasteAndExpenses() {
    return `
      <div class="space-y-6">
        <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 class="text-2xl font-display font-black text-boca-cream tracking-wide">DESPERDICIOS Y GASTOS OPERATIVOS</h1>
            <p class="text-xs text-boca-muted">Registro de mermas, productos vencidos, errores de cocina y gastos de arriendo, nómina o servicios</p>
          </div>
          <div class="flex items-center space-x-2">
            <button onclick="window.BocaApp.openNewWasteModal()" class="bg-amber-950 hover:bg-amber-900 text-amber-300 border border-amber-600 px-3.5 py-2 rounded-xl text-xs font-bold transition">
              + Registrar Merma / Desperdicio
            </button>
            <button onclick="window.BocaApp.openNewExpenseModal()" class="bg-boca-card hover:bg-neutral-800 border border-boca-border px-3.5 py-2 rounded-xl text-xs font-bold text-boca-cream transition">
              + Registrar Gasto Operativo
            </button>
          </div>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <!-- Desperdicios / Mermas -->
          <div class="bg-boca-card border border-boca-border rounded-2xl overflow-hidden shadow">
            <div class="p-4 border-b border-boca-border flex items-center justify-between">
              <h3 class="font-display font-bold text-sm text-boca-cream">Mermas y Desperdicios Registrados</h3>
              <span class="text-xs text-boca-muted">${state.wasteRecords.length} eventos</span>
            </div>
            <div class="divide-y divide-neutral-800/60 max-h-80 overflow-y-auto">
              ${state.wasteRecords.length === 0 ? `
                <div class="p-6 text-center text-neutral-500 text-xs">No hay desperdicios registrados</div>
              ` : state.wasteRecords.map(w => `
                <div class="p-3 flex items-center justify-between text-xs hover:bg-neutral-900/40 transition">
                  <div>
                    <div class="font-semibold text-neutral-200">${w.ingredient_name || w.ingredient_id}</div>
                    <div class="text-[11px] text-neutral-500">${w.quantity} ${w.unit} &bull; Motivo: ${w.reason}</div>
                  </div>
                  <div class="text-right">
                    <div class="text-boca-gold font-mono font-bold">${formatCOP(w.total_cost)}</div>
                    <div class="text-[10px] text-neutral-500">${formatDate(w.created_at)}</div>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>

          <!-- Gastos Operativos -->
          <div class="bg-boca-card border border-boca-border rounded-2xl overflow-hidden shadow">
            <div class="p-4 border-b border-boca-border flex items-center justify-between">
              <h3 class="font-display font-bold text-sm text-boca-cream">Gastos Operativos (Arriendo, Servicios, Nómina)</h3>
              <span class="text-xs text-boca-muted">${state.expenses.length} gastos</span>
            </div>
            <div class="divide-y divide-neutral-800/60 max-h-80 overflow-y-auto">
              ${state.expenses.length === 0 ? `
                <div class="p-6 text-center text-neutral-500 text-xs">No hay gastos registrados</div>
              ` : state.expenses.map(e => `
                <div class="p-3 flex items-center justify-between text-xs hover:bg-neutral-900/40 transition">
                  <div>
                    <div class="font-semibold text-neutral-200">${e.description}</div>
                    <div class="text-[11px] text-neutral-500">${e.category} &bull; Pago: ${e.payment_method}</div>
                  </div>
                  <div class="text-right">
                    <div class="text-red-400 font-mono font-bold">${formatCOP(e.amount)}</div>
                    <div class="text-[10px] text-neutral-500">${e.date}</div>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  // --- 9. REPORTES & CIERRE EXCEL VIEW ---
  function renderReports() {
    return `
      <div class="space-y-6">
        <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 class="text-2xl font-display font-black text-boca-cream tracking-wide">REPORTES Y CIERRES DE VENTA</h1>
            <p class="text-xs text-boca-muted">Descarga de informes contables y auditoría integral</p>
          </div>
          <a href="/api/export/excel/closure" class="flex items-center space-x-2 bg-boca-gold hover:bg-boca-goldLight text-boca-black font-bold px-4 py-2.5 rounded-xl text-xs transition shadow-lg">
            <i data-lucide="file-spreadsheet" class="w-4 h-4"></i>
            <span>EXPORTAR CIERRE A EXCEL (8 HOJAS)</span>
          </a>
        </div>

        <div class="bg-boca-card border border-boca-border rounded-2xl p-6 space-y-4">
          <h3 class="font-display font-bold text-sm text-boca-cream">Estructura del Informe Excel Generado (Sección 15)</h3>
          <p class="text-xs text-neutral-400">El archivo generado contiene las 8 hojas completas con fórmulas matemáticas reales y formato COP:</p>
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs pt-2">
            <div class="bg-neutral-900 p-3 rounded-xl border border-neutral-800">
              <span class="font-bold text-boca-gold">Hoja 1: Resumen</span>
              <p class="text-[11px] text-neutral-400 mt-1">Ventas brutas, netas, COGS, márgenes y arqueo de caja</p>
            </div>
            <div class="bg-neutral-900 p-3 rounded-xl border border-neutral-800">
              <span class="font-bold text-boca-gold">Hoja 2: Pedidos</span>
              <p class="text-[11px] text-neutral-400 mt-1">Una fila por pedido con cliente, tipo, mesa y estado</p>
            </div>
            <div class="bg-neutral-900 p-3 rounded-xl border border-neutral-800">
              <span class="font-bold text-boca-gold">Hoja 3: Productos</span>
              <p class="text-[11px] text-neutral-400 mt-1">Detalle de cada artículo vendido, costo unitario y margen</p>
            </div>
            <div class="bg-neutral-900 p-3 rounded-xl border border-neutral-800">
              <span class="font-bold text-boca-gold">Hoja 4: Pagos</span>
              <p class="text-[11px] text-neutral-400 mt-1">Transacciones individuales, pagos divididos y cambio</p>
            </div>
            <div class="bg-neutral-900 p-3 rounded-xl border border-neutral-800">
              <span class="font-bold text-boca-gold">Hoja 5: Inventario</span>
              <p class="text-[11px] text-neutral-400 mt-1">Kárdex de consumo de papas, alitas y salsas por pedido</p>
            </div>
            <div class="bg-neutral-900 p-3 rounded-xl border border-neutral-800">
              <span class="font-bold text-boca-gold">Hoja 6: Más Vendidos</span>
              <p class="text-[11px] text-neutral-400 mt-1">Ranking por volumen de unidades y participación %</p>
            </div>
            <div class="bg-neutral-900 p-3 rounded-xl border border-neutral-800">
              <span class="font-bold text-boca-gold">Hoja 7: Cierre Caja</span>
              <p class="text-[11px] text-neutral-400 mt-1">Fondo inicial, movimientos, efectivo contado y diferencia</p>
            </div>
            <div class="bg-neutral-900 p-3 rounded-xl border border-neutral-800">
              <span class="font-bold text-boca-gold">Hoja 8: Anulaciones</span>
              <p class="text-[11px] text-neutral-400 mt-1">Devoluciones con motivo, responsable e inventario</p>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  // --- 10. CONFIGURACIÓN VIEW ---
  function renderSettings() {
    return `
      <div class="space-y-6 max-w-3xl">
        <div>
          <h1 class="text-2xl font-display font-black text-boca-cream tracking-wide">CONFIGURACIÓN DEL RESTAURANTE</h1>
          <p class="text-xs text-boca-muted">Identidad comercial, parámetros operativos y políticas de inventario</p>
        </div>

        <div class="bg-boca-card border border-boca-border rounded-2xl p-6 space-y-4 text-xs">
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label class="block text-neutral-400 mb-1">Nombre Comercial</label>
              <input type="text" value="Boca2 Wings" class="w-full bg-neutral-900 border border-neutral-800 rounded-xl p-2.5 text-neutral-100" readonly />
            </div>
            <div>
              <label class="block text-neutral-400 mb-1">NIT / Identificación Fiscal</label>
              <input type="text" value="901.458.712-4" class="w-full bg-neutral-900 border border-neutral-800 rounded-xl p-2.5 text-neutral-100" readonly />
            </div>
            <div>
              <label class="block text-neutral-400 mb-1">Moneda Base</label>
              <input type="text" value="COP — Peso Colombiano ($)" class="w-full bg-neutral-900 border border-neutral-800 rounded-xl p-2.5 text-neutral-100" readonly />
            </div>
            <div>
              <label class="block text-neutral-400 mb-1">Política de Stock Negativo</label>
              <select class="w-full bg-neutral-900 border border-neutral-800 rounded-xl p-2.5 text-neutral-100">
                <option value="false" selected>Estricto: Bloquear venta si falta inventario</option>
                <option value="true">Permisivo: Permitir venta bajo supervisión</option>
              </select>
            </div>
          </div>
        </div>

        <!-- Database Persistence & PostgreSQL / Supabase Integration Card -->
        <div class="bg-boca-card border border-boca-gold/40 rounded-2xl p-6 space-y-4 text-xs shadow-xl">
          <div class="flex items-center space-x-3 pb-3 border-b border-neutral-800">
            <div class="p-2.5 rounded-xl bg-boca-gold/20 text-boca-gold">
              <i data-lucide="database" class="w-5 h-5"></i>
            </div>
            <div>
              <h3 class="font-display font-bold text-sm text-boca-cream">Base de Datos y Persistencia Empresarial</h3>
              <p class="text-[11px] text-boca-muted">Estado actual de la persistencia y conexión a PostgreSQL / Supabase</p>
            </div>
            <span class="ml-auto bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 px-3 py-1 rounded-full text-[10px] font-black uppercase">
              ● Persistencia en Disco Activa
            </span>
          </div>

          <div class="space-y-3">
            <div class="p-3 bg-neutral-900/80 rounded-xl border border-neutral-800">
              <div class="font-bold text-neutral-200 mb-1 flex items-center space-x-1.5">
                <i data-lucide="check-circle-2" class="w-3.5 h-3.5 text-emerald-400"></i>
                <span>Almacenamiento Local Transaccional (ACID)</span>
              </div>
              <p class="text-[11px] text-neutral-400">
                La aplicación guarda todas las ventas, mesas, comandas, turnos de caja, inventarios y recetas directamente en el archivo 
                <code class="bg-neutral-950 px-1.5 py-0.5 rounded text-boca-gold font-mono">data/boca2_db.json</code> con control transaccional atómico y mutex. 
                Los datos persisten permanentemente y sobreviven a cualquier reinicio del servidor o de la máquina.
              </p>
            </div>

            <div class="p-3 bg-neutral-900/80 rounded-xl border border-neutral-800 space-y-2">
              <div class="font-bold text-neutral-200 mb-1 flex items-center space-x-1.5">
                <i data-lucide="cloud" class="w-3.5 h-3.5 text-boca-gold"></i>
                <span>¿Cómo conectar Supabase o PostgreSQL en la Nube?</span>
              </div>
              <ol class="list-decimal list-inside space-y-1.5 text-[11px] text-neutral-400">
                <li>El script relacional completo con las 16 tablas y llaves foráneas está listo en <code class="bg-neutral-950 px-1 py-0.5 rounded text-neutral-200">server/db/schema.sql</code>.</li>
                <li>Crea un proyecto en <a href="https://supabase.com" target="_blank" class="text-boca-gold underline font-bold">Supabase</a> o cualquier proveedor PostgreSQL.</li>
                <li>En el <strong>SQL Editor</strong> de Supabase, copia y ejecuta el contenido del archivo <code class="bg-neutral-950 px-1 py-0.5 rounded text-neutral-200">server/db/schema.sql</code>.</li>
                <li>Configura la variable de entorno <code class="bg-neutral-950 px-1 py-0.5 rounded text-boca-gold">DATABASE_URL=postgresql://postgres:[PASSWORD]@[HOST]:5432/postgres</code>.</li>
              </ol>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  // --- 11. GESTIÓN DE USUARIOS Y CLAVES DE ACCESO (ADMIN ONLY) ---
  function renderUsers() {
    return `
      <div class="space-y-6">
        <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 class="text-2xl font-display font-black text-boca-cream tracking-wide">GESTIÓN DE USUARIOS Y CLAVES DE ACCESO</h1>
            <p class="text-xs text-boca-muted">Asignación de contraseñas, PINs y roles para cajeros, meseros, cocina y administradores</p>
          </div>
          <button onclick="window.BocaApp.openNewUserModal()" class="flex items-center space-x-2 bg-boca-gold hover:bg-boca-goldLight text-boca-black font-bold px-4 py-2 rounded-xl text-xs transition shadow-lg">
            <i data-lucide="user-plus" class="w-4 h-4"></i>
            <span>+ Crear Nuevo Empleado</span>
          </button>
        </div>

        <div class="bg-boca-card border border-boca-border rounded-2xl overflow-hidden shadow">
          <div class="p-4 border-b border-boca-border flex items-center justify-between">
            <div class="flex items-center space-x-2">
              <i data-lucide="shield" class="w-4 h-4 text-boca-gold"></i>
              <h3 class="font-display font-bold text-sm text-boca-cream">Personal Autorizado y Credenciales</h3>
            </div>
            <span class="text-xs text-boca-muted">${state.usersList?.length || 0} cuentas registradas</span>
          </div>

          <div class="overflow-x-auto">
            <table class="w-full text-left text-xs">
              <thead class="bg-boca-dark text-neutral-400 border-b border-neutral-800">
                <tr>
                  <th class="p-3">ID Empleado</th>
                  <th class="p-3">Nombre</th>
                  <th class="p-3">Correo Institucional</th>
                  <th class="p-3">Rol / Cargo</th>
                  <th class="p-3">Clave de Acceso Actual</th>
                  <th class="p-3">Estado</th>
                  <th class="p-3 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-neutral-800/60">
                ${(state.usersList || []).map(u => `
                  <tr class="hover:bg-neutral-900/40 transition">
                    <td class="p-3 font-mono text-neutral-400 font-bold">${u.id}</td>
                    <td class="p-3 font-semibold text-neutral-100">${u.name}</td>
                    <td class="p-3 text-neutral-300 font-mono">${u.email}</td>
                    <td class="p-3">
                      <span class="px-2 py-0.5 rounded text-[10px] font-bold ${
                        u.role_id === 'admin' ? 'bg-boca-gold/20 text-boca-gold border border-boca-gold/40' :
                        u.role_id === 'cajero' ? 'bg-emerald-950 text-emerald-400 border border-emerald-800' :
                        u.role_id === 'mesero' ? 'bg-blue-950 text-blue-400 border border-blue-800' :
                        u.role_id === 'cocina' ? 'bg-amber-950 text-amber-400 border border-amber-800' :
                        'bg-purple-950 text-purple-400 border border-purple-800'
                      }">
                        ${u.role_name || u.role_id}
                      </span>
                    </td>
                    <td class="p-3">
                      <div class="flex items-center space-x-2">
                        <span class="font-mono bg-neutral-900 px-2 py-1 rounded text-neutral-200 border border-neutral-800">
                          ${u.password}
                        </span>
                        <button onclick="window.BocaApp.openChangePasswordModal('${u.id}', '${u.name}', '${u.password}')"
                          class="text-[11px] text-boca-gold hover:underline font-semibold" title="Cambiar contraseña">
                          Editar clave
                        </button>
                      </div>
                    </td>
                    <td class="p-3">
                      <span class="px-2 py-0.5 rounded text-[10px] font-bold ${u.active ? 'bg-emerald-950 text-emerald-400 border border-emerald-800' : 'bg-red-950 text-red-400 border border-red-800'}">
                        ${u.active ? 'ACTIVO' : 'INACTIVO'}
                      </span>
                    </td>
                    <td class="p-3 text-right space-x-1">
                      <button onclick="window.BocaApp.toggleUserStatus('${u.id}', ${!u.active})"
                        class="px-2 py-1 rounded-lg text-[11px] font-bold transition ${u.active ? 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700' : 'bg-emerald-950 text-emerald-400 border border-emerald-700'}">
                        ${u.active ? 'Desactivar' : 'Activar'}
                      </button>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;
  }

  // --- MODALS RENDERER ---
  function renderModal() {
    const container = document.getElementById('modal-container');
    if (!container) return;

    if (!state.activeModal) {
      container.innerHTML = '';
      return;
    }

    let modalHtml = '';
    switch (state.activeModal) {
      case 'checkout': modalHtml = renderCheckoutModal(); break;
      case 'variant_select': modalHtml = renderVariantModal(); break;
      case 'ticket': modalHtml = renderTicketModal(); break;
      case 'open_cash': modalHtml = renderOpenCashModal(); break;
      case 'close_cash': modalHtml = renderCloseCashModal(); break;
      case 'cash_move': modalHtml = renderCashMoveModal(); break;
      case 'adjust_stock': modalHtml = renderAdjustStockModal(); break;
      case 'new_waste': modalHtml = renderNewWasteModal(); break;
      case 'new_expense': modalHtml = renderNewExpenseModal(); break;
      case 'new_purchase': modalHtml = renderNewPurchaseModal(); break;
      case 'item_notes': modalHtml = renderItemNotesModal(); break;
      case 'change_password': modalHtml = renderChangePasswordModal(); break;
      case 'new_user': modalHtml = renderNewUserModal(); break;
      case 'edit_product': modalHtml = renderEditProductModal(); break;
      case 'new_product': modalHtml = renderNewProductModal(); break;
      case 'edit_ingredient': modalHtml = renderEditIngredientModal(); break;
      case 'new_ingredient': modalHtml = renderNewIngredientModal(); break;
      case 'table_checkout': modalHtml = renderTableCheckoutModal(); break;
      case 'pre_cuenta': modalHtml = renderPreCuentaModal(); break;
      case 'new_table': modalHtml = renderNewTableModal(); break;
    }

    container.innerHTML = `
      <div class="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
        ${modalHtml}
      </div>
    `;

    if (window.lucide) window.lucide.createIcons();
  }

  function closeModal() {
    state.activeModal = null;
    state.modalData = null;
    renderModal();
  }

  // Checkout Modal with Split Payments & Cash Tendered (Prueba 6)
  function renderCheckoutModal() {
    const m = state.modalData || {};
    const total = m.total || 0;
    const payment = m.payments[0] || { method: 'EFECTIVO', amount: total, cash_tendered: total, cash_change: 0 };
    const change = Math.max(0, (payment.cash_tendered || 0) - payment.amount);

    return `
      <div class="bg-boca-card border border-boca-border rounded-2xl max-w-md w-full p-6 space-y-5 shadow-2xl">
        <div class="flex items-center justify-between border-b border-neutral-800 pb-3">
          <h3 class="font-display font-bold text-base text-boca-cream">Cobro y Pago de Venta</h3>
          <button onclick="window.BocaApp.closeModal()" class="text-neutral-400 hover:text-neutral-200">
            <i data-lucide="x" class="w-5 h-5"></i>
          </button>
        </div>

        <div class="text-center py-2 bg-neutral-950 rounded-xl border border-neutral-800">
          <span class="text-xs text-neutral-400">Total a Pagar:</span>
          <div class="text-3xl font-display font-black text-boca-gold">${formatCOP(total)}</div>
        </div>

        <!-- Payment Method Options -->
        <div class="space-y-3 text-xs">
          <label class="block font-bold text-neutral-300">Método de Pago:</label>
          <div class="grid grid-cols-2 gap-2">
            ${['EFECTIVO', 'TRANSFERENCIA', 'TARJETA', 'DIVIDIDO'].map(met => `
              <button onclick="window.BocaApp.setPaymentMethod('${met}')"
                class="p-2.5 rounded-xl font-bold border transition text-center ${m.selectedMethod === met ? 'bg-boca-cream text-boca-black border-boca-cream font-black shadow' : 'bg-neutral-900 border-neutral-800 text-neutral-300 hover:border-neutral-700'}">
                ${met}
              </button>
            `).join('')}
          </div>
        </div>

        <!-- Cash Details (Tendered & Change) -->
        ${m.selectedMethod === 'EFECTIVO' ? `
          <div class="space-y-3 bg-neutral-900/60 p-3.5 rounded-xl border border-neutral-800 text-xs">
            <div>
              <label class="block text-neutral-400 mb-1">Efectivo Recibido (Billetes):</label>
              <input type="number" value="${payment.cash_tendered || total}" oninput="window.BocaApp.setCashTendered(this.value)"
                class="w-full bg-boca-dark border border-neutral-700 rounded-xl p-2.5 text-base font-bold text-neutral-100 focus:outline-none focus:border-boca-gold" />
            </div>
            <div class="flex justify-between items-center pt-1 border-t border-neutral-800">
              <span class="text-neutral-400 font-bold">Cambio a Devolver:</span>
              <span class="text-lg font-display font-black text-emerald-400">${formatCOP(change)}</span>
            </div>
          </div>
        ` : m.selectedMethod === 'DIVIDIDO' ? `
          <!-- Split Payment Inputs (Prueba 6) -->
          <div class="space-y-2 bg-neutral-900/60 p-3.5 rounded-xl border border-neutral-800 text-xs">
            <span class="font-bold text-neutral-300">Pago Dividido:</span>
            <div class="flex items-center space-x-2">
              <span class="w-24 text-neutral-400">Efectivo:</span>
              <input type="number" value="${m.payments[0]?.amount || 0}" oninput="window.BocaApp.setSplitCash(this.value)"
                class="flex-1 bg-boca-dark border border-neutral-700 rounded-lg p-2 text-xs font-bold text-neutral-100" />
            </div>
            <div class="flex items-center space-x-2">
              <span class="w-24 text-neutral-400">Transferencia:</span>
              <input type="number" value="${m.payments[1]?.amount || 0}" oninput="window.BocaApp.setSplitTransfer(this.value)"
                class="flex-1 bg-boca-dark border border-neutral-700 rounded-lg p-2 text-xs font-bold text-neutral-100" />
            </div>
          </div>
        ` : `
          <div class="bg-blue-950/40 border border-blue-600/40 p-3 rounded-xl text-xs text-blue-300">
            Confirmar comprobante de transferencia Nequi / Daviplata o Datafono.
          </div>
        `}

        <button onclick="window.BocaApp.confirmSale()"
          class="w-full bg-boca-gold hover:bg-boca-goldLight text-boca-black font-display font-black py-3 rounded-xl text-sm transition shadow-lg flex items-center justify-center space-x-2">
          <i data-lucide="check" class="w-4 h-4"></i>
          <span>CONFIRMAR PAGO Y DESPACHAR</span>
        </button>
      </div>
    `;
  }

  // Variant / Portion Selector Modal
  function renderVariantModal() {
    const prod = state.modalData;
    if (!prod) return '';

    return `
      <div class="bg-boca-card border border-boca-border rounded-2xl max-w-sm w-full p-5 space-y-4 shadow-2xl">
        <div class="flex items-center justify-between border-b border-neutral-800 pb-2">
          <h3 class="font-display font-bold text-sm text-boca-cream">Selecciona la Porción</h3>
          <button onclick="window.BocaApp.closeModal()" class="text-neutral-400 hover:text-neutral-200">
            <i data-lucide="x" class="w-4 h-4"></i>
          </button>
        </div>
        <p class="text-xs text-neutral-400">${prod.name}</p>

        <div class="space-y-2">
          ${(prod.variants || []).map(v => `
            <button onclick="window.BocaApp.selectVariantAndAdd('${prod.id}', '${v.id}')"
              class="w-full p-3 rounded-xl bg-neutral-900 border border-neutral-800 hover:border-boca-gold text-left flex items-center justify-between transition group">
              <div>
                <div class="font-bold text-xs text-neutral-200 group-hover:text-boca-cream">${v.name}</div>
                ${v.grammage ? `<div class="text-[11px] text-boca-muted">${v.grammage} gramos de papas</div>` : ''}
              </div>
              <div class="font-display font-black text-xs text-boca-gold">${formatCOP(v.price)}</div>
            </button>
          `).join('')}
        </div>
      </div>
    `;
  }

  // Receipt / Comprobante Modal with Print capability
  function renderTicketModal() {
    const o = state.modalData;
    if (!o) return '';

    return `
      <div class="bg-white text-black rounded-2xl max-w-sm w-full p-6 space-y-4 shadow-2xl font-mono text-xs">
        <div class="text-center space-y-1 border-b border-neutral-300 pb-3">
          <img src="/logo.png" class="w-16 h-16 mx-auto object-contain invert mb-1" />
          <h2 class="font-bold text-base tracking-wider font-sans">BOCA2 WINGS</h2>
          <p class="text-[10px] text-neutral-600">NIT: 901.458.712-4 &bull; Régimen Común</p>
          <p class="text-[10px] text-neutral-600">Calle Principal Gourmet # 24 - 10</p>
          <p class="text-[10px] text-neutral-600">Tel: (+57) 310 987 6543</p>
        </div>

        <div class="space-y-1 text-[11px] border-b border-neutral-300 pb-2">
          <div><strong>PEDIDO: ${o.id}</strong></div>
          <div>Fecha: ${formatDate(o.created_at)}</div>
          <div>Tipo: ${o.order_type} (${o.table_number || o.delivery_address || 'Mostrador'})</div>
          <div>Cliente: ${o.customer_name || 'Cliente Mostrador'}</div>
        </div>

        <div class="space-y-1 text-[11px] border-b border-neutral-300 pb-2">
          ${(o.items || []).map(it => `
            <div>
              <div class="flex justify-between">
                <span>${it.quantity}x ${it.name}</span>
                <span>${formatCOP(it.total)}</span>
              </div>
              ${it.notes ? `<div class="text-[10px] text-neutral-600 pl-2 italic">&bull; Obs: ${it.notes}</div>` : ''}
            </div>
          `).join('')}
        </div>

        <div class="space-y-1 font-bold text-xs pt-1 border-b border-neutral-300 pb-2">
          <div class="flex justify-between">
            <span>SUBTOTAL:</span>
            <span>${formatCOP(o.subtotal)}</span>
          </div>
          <div class="flex justify-between text-sm">
            <span>TOTAL PAGADO:</span>
            <span>${formatCOP(o.total)}</span>
          </div>
        </div>

        <div class="text-center pt-2 text-[10px] text-neutral-600">
          ¡Gracias por tu compra en Boca2 Wings!<br>
          Las mejores alitas & papas de la ciudad.
        </div>

        <div class="pt-2 flex items-center space-x-2 font-sans">
          <button onclick="window.print()" class="flex-1 bg-black text-white font-bold py-2 rounded-xl text-xs hover:bg-neutral-800 transition">
            Imprimir Comprobante
          </button>
          <button onclick="window.BocaApp.closeModal()" class="px-4 py-2 border border-neutral-300 rounded-xl text-xs font-bold hover:bg-neutral-100 transition">
            Cerrar
          </button>
        </div>
      </div>
    `;
  }

  // Open Cash Modal
  function renderOpenCashModal() {
    return `
      <div class="bg-boca-card border border-boca-border rounded-2xl max-w-sm w-full p-6 space-y-4 shadow-2xl">
        <h3 class="font-display font-bold text-base text-boca-cream">Apertura de Turno de Caja</h3>
        <p class="text-xs text-neutral-400">Ingresa la base en efectivo con la que inicia el cajero.</p>

        <div>
          <label class="block text-xs text-neutral-400 mb-1">Fondo Inicial / Base (COP):</label>
          <input type="number" id="open-cash-amount" value="50000"
            class="w-full bg-neutral-900 border border-neutral-700 rounded-xl p-2.5 text-base font-bold text-neutral-100 focus:outline-none focus:border-boca-gold" />
        </div>

        <button onclick="window.BocaApp.confirmOpenCash()"
          class="w-full bg-boca-gold hover:bg-boca-goldLight text-boca-black font-bold py-2.5 rounded-xl text-xs transition shadow">
          Confirmar Apertura
        </button>
      </div>
    `;
  }

  // Close Cash Modal (Prueba 7)
  function renderCloseCashModal() {
    const reg = state.activeRegister || {};
    return `
      <div class="bg-boca-card border border-boca-border rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl">
        <h3 class="font-display font-bold text-base text-boca-cream">Arqueo y Cierre de Turno de Caja</h3>
        <div class="bg-neutral-950 p-3 rounded-xl border border-neutral-800 text-xs">
          <div class="flex justify-between text-neutral-400">
            <span>Efectivo Físico Esperado:</span>
            <span class="font-bold text-emerald-400 font-mono">${formatCOP(reg.expected_cash || 0)}</span>
          </div>
        </div>

        <div>
          <label class="block text-xs text-neutral-400 mb-1">Efectivo Físico Contado en Caja (COP):</label>
          <input type="number" id="counted-cash-amount" value="${reg.expected_cash || 0}"
            class="w-full bg-neutral-900 border border-neutral-700 rounded-xl p-2.5 text-base font-bold text-neutral-100 focus:outline-none focus:border-boca-gold" />
        </div>

        <button onclick="window.BocaApp.confirmCloseCash()"
          class="w-full bg-red-600 hover:bg-red-500 text-white font-bold py-2.5 rounded-xl text-xs transition shadow">
          Confirmar Cierre de Caja
        </button>
      </div>
    `;
  }

  // Cash Movement Modal (Ingreso/Retiro/Gasto)
  function renderCashMoveModal() {
    const type = state.modalData?.type || 'INGRESO';
    return `
      <div class="bg-boca-card border border-boca-border rounded-2xl max-w-sm w-full p-6 space-y-4 shadow-2xl">
        <h3 class="font-display font-bold text-base text-boca-cream">${type === 'INGRESO' ? 'Ingreso de Efectivo' : 'Retiro de Efectivo'}</h3>
        <div>
          <label class="block text-xs text-neutral-400 mb-1">Monto (COP):</label>
          <input type="number" id="cash-move-amount" value="10000" class="w-full bg-neutral-900 border border-neutral-700 rounded-xl p-2.5 text-xs text-neutral-100" />
        </div>
        <div>
          <label class="block text-xs text-neutral-400 mb-1">Motivo / Descripción:</label>
          <input type="text" id="cash-move-desc" placeholder="Ej: Cambio de billetes o compra bolsas" class="w-full bg-neutral-900 border border-neutral-700 rounded-xl p-2.5 text-xs text-neutral-100" />
        </div>
        <button onclick="window.BocaApp.confirmCashMove('${type}')" class="w-full bg-boca-gold hover:bg-boca-goldLight text-boca-black font-bold py-2.5 rounded-xl text-xs transition shadow">
          Confirmar Movimiento
        </button>
      </div>
    `;
  }

  // Adjust Stock Modal
  function renderAdjustStockModal() {
    return `
      <div class="bg-boca-card border border-boca-border rounded-2xl max-w-sm w-full p-6 space-y-4 shadow-2xl">
        <h3 class="font-display font-bold text-base text-boca-cream">Ajuste por Conteo Físico</h3>
        <div>
          <label class="block text-xs text-neutral-400 mb-1">Selecciona Insumo:</label>
          <select id="adj-ing-id" class="w-full bg-neutral-900 border border-neutral-700 rounded-xl p-2.5 text-xs text-neutral-100">
            ${state.ingredients.map(i => `<option value="${i.id}">${i.name} (Actual: ${i.stock_current} ${i.unit})</option>`).join('')}
          </select>
        </div>
        <div>
          <label class="block text-xs text-neutral-400 mb-1">Stock Físico Real Contado:</label>
          <input type="number" id="adj-counted-stock" value="20000" class="w-full bg-neutral-900 border border-neutral-700 rounded-xl p-2.5 text-xs text-neutral-100" />
        </div>
        <button onclick="window.BocaApp.confirmAdjustStock()" class="w-full bg-boca-gold hover:bg-boca-goldLight text-boca-black font-bold py-2.5 rounded-xl text-xs transition shadow">
          Aplicar Ajuste de Kárdex
        </button>
      </div>
    `;
  }

  // New Waste Modal
  function renderNewWasteModal() {
    return `
      <div class="bg-boca-card border border-boca-border rounded-2xl max-w-sm w-full p-6 space-y-4 shadow-2xl">
        <h3 class="font-display font-bold text-base text-boca-cream">Registrar Merma o Desperdicio</h3>
        <div>
          <label class="block text-xs text-neutral-400 mb-1">Insumo:</label>
          <select id="wst-ing-id" class="w-full bg-neutral-900 border border-neutral-700 rounded-xl p-2.5 text-xs text-neutral-100">
            ${state.ingredients.map(i => `<option value="${i.id}">${i.name}</option>`).join('')}
          </select>
        </div>
        <div>
          <label class="block text-xs text-neutral-400 mb-1">Cantidad Desperdiciada:</label>
          <input type="number" id="wst-qty" value="100" class="w-full bg-neutral-900 border border-neutral-700 rounded-xl p-2.5 text-xs text-neutral-100" />
        </div>
        <div>
          <label class="block text-xs text-neutral-400 mb-1">Motivo:</label>
          <select id="wst-reason" class="w-full bg-neutral-900 border border-neutral-700 rounded-xl p-2.5 text-xs text-neutral-100">
            <option value="DANO">Producto Dañado / Quemado</option>
            <option value="VENCIMIENTO">Vencimiento</option>
            <option value="ERROR_PREPARACION">Error de Preparación</option>
            <option value="CONSUMO_INTERNO">Consumo Interno / Personal</option>
          </select>
        </div>
        <button onclick="window.BocaApp.confirmNewWaste()" class="w-full bg-amber-500 hover:bg-amber-400 text-boca-black font-bold py-2.5 rounded-xl text-xs transition shadow">
          Descontar Merma de Inventario
        </button>
      </div>
    `;
  }

  // New Expense Modal
  function renderNewExpenseModal() {
    return `
      <div class="bg-boca-card border border-boca-border rounded-2xl max-w-sm w-full p-6 space-y-4 shadow-2xl">
        <h3 class="font-display font-bold text-base text-boca-cream">Registrar Gasto Operativo</h3>
        <div>
          <label class="block text-xs text-neutral-400 mb-1">Categoría:</label>
          <select id="exp-cat" class="w-full bg-neutral-900 border border-neutral-700 rounded-xl p-2.5 text-xs text-neutral-100">
            <option value="ARRIENDO">Arriendo</option>
            <option value="SERVICIOS">Servicios Públicos (Luz, Gas, Agua)</option>
            <option value="NOMINA">Nómina / Turno Extra</option>
            <option value="TRANSPORTE">Transporte / Domicilio</option>
            <option value="MANTENIMIENTO">Mantenimiento de Freidoras</option>
            <option value="PUBLICIDAD">Publicidad & Redes</option>
            <option value="OTROS">Otros Gastos</option>
          </select>
        </div>
        <div>
          <label class="block text-xs text-neutral-400 mb-1">Descripción:</label>
          <input type="text" id="exp-desc" placeholder="Ej: Pago de gas del mes" class="w-full bg-neutral-900 border border-neutral-700 rounded-xl p-2.5 text-xs text-neutral-100" />
        </div>
        <div>
          <label class="block text-xs text-neutral-400 mb-1">Monto (COP):</label>
          <input type="number" id="exp-amount" value="50000" class="w-full bg-neutral-900 border border-neutral-700 rounded-xl p-2.5 text-xs text-neutral-100" />
        </div>
        <button onclick="window.BocaApp.confirmNewExpense()" class="w-full bg-boca-gold hover:bg-boca-goldLight text-boca-black font-bold py-2.5 rounded-xl text-xs transition shadow">
          Guardar Gasto
        </button>
      </div>
    `;
  }

  // New Purchase Modal
  function renderNewPurchaseModal() {
    return `
      <div class="bg-boca-card border border-boca-border rounded-2xl max-w-sm w-full p-6 space-y-4 shadow-2xl">
        <h3 class="font-display font-bold text-base text-boca-cream">Nueva Orden de Compra</h3>
        <div>
          <label class="block text-xs text-neutral-400 mb-1">Proveedor:</label>
          <select id="po-supplier-id" class="w-full bg-neutral-900 border border-neutral-700 rounded-xl p-2.5 text-xs text-neutral-100">
            ${state.suppliers.map(s => `<option value="${s.id}">${s.name}</option>`).join('')}
          </select>
        </div>
        <div>
          <label class="block text-xs text-neutral-400 mb-1">Total Estimado Factura (COP):</label>
          <input type="number" id="po-total" value="150000" class="w-full bg-neutral-900 border border-neutral-700 rounded-xl p-2.5 text-xs text-neutral-100" />
        </div>
        <p class="text-[11px] text-neutral-400">Nota: La orden creada NO aumenta el stock hasta registrar la recepción física (Prueba 10).</p>
        <button onclick="window.BocaApp.confirmNewPurchase()" class="w-full bg-boca-gold hover:bg-boca-goldLight text-boca-black font-bold py-2.5 rounded-xl text-xs transition shadow">
          Crear Orden Solicitada
        </button>
      </div>
    `;
  }

  // Item Specific Notes Modal (Sin salsas, salsa aparte, etc.)
  function renderItemNotesModal() {
    const itemKey = state.modalData?.key;
    const item = state.cart.find(it => it.key === itemKey);
    if (!item) return '';

    const quickTags = [
      'Sin salsas',
      'Salsa aparte',
      'Sin cebolla',
      'Papas bien doradas',
      'Papas sin sal',
      'Sin queso',
      'Sin tocineta',
      'Extra servilletas',
      'Término medio',
      'Bien cocida'
    ];

    return `
      <div class="bg-boca-card border border-boca-border rounded-2xl max-w-sm w-full p-5 space-y-4 shadow-2xl">
        <div class="flex items-center justify-between border-b border-neutral-800 pb-2">
          <div>
            <h3 class="font-display font-bold text-sm text-boca-cream">Observación para este Plato</h3>
            <p class="text-[11px] text-boca-gold mt-0.5">${item.name}</p>
          </div>
          <button onclick="window.BocaApp.closeModal()" class="text-neutral-400 hover:text-neutral-200">
            <i data-lucide="x" class="w-4 h-4"></i>
          </button>
        </div>

        <!-- Quick Tags -->
        <div class="space-y-1.5">
          <label class="block text-[11px] font-bold text-neutral-400">Etiquetas Rápidas de Cocina:</label>
          <div class="flex flex-wrap gap-1.5">
            ${quickTags.map(tag => `
              <button type="button" onclick="window.BocaApp.appendQuickTag('${tag}')"
                class="px-2.5 py-1 rounded-lg bg-neutral-900 border border-neutral-800 hover:border-boca-gold hover:text-boca-cream text-neutral-300 text-[11px] font-medium transition">
                + ${tag}
              </button>
            `).join('')}
          </div>
        </div>

        <!-- Custom Input -->
        <div>
          <label class="block text-[11px] font-bold text-neutral-400 mb-1">Detalle Específico:</label>
          <input type="text" id="modal-item-notes-input" value="${item.notes || ''}"
            placeholder="Ej: Sin salsa, papas bien crocantes..."
            class="w-full bg-neutral-900 border border-neutral-700 rounded-xl p-2.5 text-xs text-neutral-100 focus:outline-none focus:border-boca-gold" />
        </div>

        <div class="pt-2 flex items-center space-x-2">
          <button onclick="window.BocaApp.saveItemNotes('${item.key}')"
            class="flex-1 bg-boca-gold hover:bg-boca-goldLight text-boca-black font-bold py-2.5 rounded-xl text-xs transition shadow">
            Guardar en este Plato &check;
          </button>
          <button onclick="window.BocaApp.closeModal()" class="px-3 py-2.5 border border-neutral-700 rounded-xl text-xs text-neutral-400 hover:bg-neutral-800">
            Cancelar
          </button>
        </div>
      </div>
    `;
  }

  // Change Password Modal (Admin)
  function renderChangePasswordModal() {
    const data = state.modalData || {};
    return `
      <div class="bg-boca-card border border-boca-border rounded-2xl max-w-sm w-full p-5 space-y-4 shadow-2xl">
        <div class="flex items-center justify-between border-b border-neutral-800 pb-2">
          <h3 class="font-display font-bold text-sm text-boca-cream">Asignar Nueva Clave de Acceso</h3>
          <button onclick="window.BocaApp.closeModal()" class="text-neutral-400 hover:text-neutral-200">
            <i data-lucide="x" class="w-4 h-4"></i>
          </button>
        </div>
        <p class="text-xs text-neutral-400">Usuario: <strong class="text-neutral-200">${data.name}</strong></p>

        <div>
          <label class="block text-xs text-neutral-400 mb-1">Nueva Clave de Acceso / PIN:</label>
          <input type="text" id="new-user-password" value="${data.password || ''}"
            class="w-full bg-neutral-900 border border-neutral-700 rounded-xl p-2.5 text-base font-mono font-bold text-neutral-100 focus:outline-none focus:border-boca-gold" />
        </div>

        <button onclick="window.BocaApp.saveNewPassword('${data.id}')"
          class="w-full bg-boca-gold hover:bg-boca-goldLight text-boca-black font-bold py-2.5 rounded-xl text-xs transition shadow">
          Actualizar Clave de Acceso
        </button>
      </div>
    `;
  }

  // New User Modal (Admin)
  function renderNewUserModal() {
    return `
      <div class="bg-boca-card border border-boca-border rounded-2xl max-w-sm w-full p-5 space-y-4 shadow-2xl">
        <div class="flex items-center justify-between border-b border-neutral-800 pb-2">
          <h3 class="font-display font-bold text-sm text-boca-cream">Registrar Nuevo Empleado</h3>
          <button onclick="window.BocaApp.closeModal()" class="text-neutral-400 hover:text-neutral-200">
            <i data-lucide="x" class="w-4 h-4"></i>
          </button>
        </div>

        <div class="space-y-3 text-xs">
          <div>
            <label class="block text-neutral-400 mb-1">Nombre Completo:</label>
            <input type="text" id="new-emp-name" placeholder="Ej: Camilo Pérez"
              class="w-full bg-neutral-900 border border-neutral-700 rounded-xl p-2.5 text-neutral-100" />
          </div>
          <div>
            <label class="block text-neutral-400 mb-1">Correo Institucional:</label>
            <input type="email" id="new-emp-email" placeholder="camilo@boca2wings.com"
              class="w-full bg-neutral-900 border border-neutral-700 rounded-xl p-2.5 text-neutral-100" />
          </div>
          <div>
            <label class="block text-neutral-400 mb-1">Rol / Cargo:</label>
            <select id="new-emp-role" class="w-full bg-neutral-900 border border-neutral-700 rounded-xl p-2.5 text-neutral-100">
              <option value="mesero">Mesero / Salón (Solo Pedidos)</option>
              <option value="cajero">Cajero (POS y Caja)</option>
              <option value="cocina">Cocina (Comandas KDS)</option>
              <option value="inventario">Encargado de Inventario</option>
              <option value="admin">Administrador (Acceso Total)</option>
            </select>
          </div>
          <div>
            <label class="block text-neutral-400 mb-1">Clave de Acceso Inicial / PIN:</label>
            <input type="text" id="new-emp-password" value="1234"
              class="w-full bg-neutral-900 border border-neutral-700 rounded-xl p-2.5 text-neutral-100 font-mono font-bold" />
          </div>
        </div>

        <button onclick="window.BocaApp.saveNewUser()"
          class="w-full bg-boca-gold hover:bg-boca-goldLight text-boca-black font-bold py-2.5 rounded-xl text-xs transition shadow">
          Crear Cuenta de Empleado
        </button>
      </div>
    `;
  }

  // Modal: Editar Plato (CARTA)
  function renderEditProductModal() {
    const p = state.modalData || {};
    return `
      <div class="bg-boca-card border border-boca-border rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl">
        <div class="flex items-center justify-between border-b border-neutral-800 pb-3">
          <div>
            <h3 class="font-display font-bold text-base text-boca-cream">Editar Plato</h3>
            <span class="text-[11px] text-neutral-400 font-mono">${p.code || p.id}</span>
          </div>
          <button onclick="window.BocaApp.closeModal()" class="text-neutral-400 hover:text-neutral-200">
            <i data-lucide="x" class="w-5 h-5"></i>
          </button>
        </div>

        <div class="space-y-3 text-xs max-h-[70vh] overflow-y-auto pr-1">
          <div>
            <label class="block text-neutral-400 mb-1 font-semibold">Nombre del Plato:</label>
            <input type="text" id="edit-prod-name" value="${p.name || ''}"
              class="w-full bg-neutral-900 border border-neutral-700 rounded-xl p-2.5 text-neutral-100 font-bold focus:border-boca-gold focus:outline-none" />
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-neutral-400 mb-1">Categoría:</label>
              <select id="edit-prod-category" class="w-full bg-neutral-900 border border-neutral-700 rounded-xl p-2.5 text-neutral-100">
                ${state.categories.map(c => `
                  <option value="${c.id}" ${p.category_id === c.id ? 'selected' : ''}>${c.name}</option>
                `).join('')}
              </select>
            </div>
            <div>
              <label class="block text-neutral-400 mb-1">Estación de Cocina:</label>
              <select id="edit-prod-station" class="w-full bg-neutral-900 border border-neutral-700 rounded-xl p-2.5 text-neutral-100">
                <option value="Frituras" ${p.prep_station === 'Frituras' ? 'selected' : ''}>Frituras</option>
                <option value="Alitas" ${p.prep_station === 'Alitas' ? 'selected' : ''}>Alitas</option>
                <option value="Parrilla" ${p.prep_station === 'Parrilla' ? 'selected' : ''}>Parrilla</option>
                <option value="Bebidas" ${p.prep_station === 'Bebidas' ? 'selected' : ''}>Bebidas</option>
                <option value="Empaque" ${p.prep_station === 'Empaque' ? 'selected' : ''}>Empaque</option>
              </select>
            </div>
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-neutral-400 mb-1 font-semibold">Precio de Venta ($ COP):</label>
              <input type="number" id="edit-prod-price" value="${p.price || 0}"
                class="w-full bg-neutral-900 border border-neutral-700 rounded-xl p-2.5 text-boca-gold font-bold font-mono focus:border-boca-gold focus:outline-none" />
            </div>
            <div>
              <label class="block text-neutral-400 mb-1 font-semibold">Costo Estimado ($ COP):</label>
              <input type="number" id="edit-prod-cost" value="${p.cost_estimated || 0}"
                class="w-full bg-neutral-900 border border-neutral-700 rounded-xl p-2.5 text-neutral-300 font-mono focus:border-boca-gold focus:outline-none" />
            </div>
          </div>

          <div>
            <label class="block text-neutral-400 mb-1">Descripción / Ingredientes visibles:</label>
            <textarea id="edit-prod-desc" rows="2"
              class="w-full bg-neutral-900 border border-neutral-700 rounded-xl p-2.5 text-neutral-100 text-xs focus:border-boca-gold focus:outline-none">${p.description || ''}</textarea>
          </div>

          <div>
            <label class="block text-neutral-400 mb-1">URL de la Fotografía (opcional):</label>
            <input type="text" id="edit-prod-image" value="${p.image_url || ''}" placeholder="https://..."
              class="w-full bg-neutral-900 border border-neutral-700 rounded-xl p-2.5 text-neutral-100 text-xs focus:border-boca-gold focus:outline-none" />
          </div>

          <div class="flex items-center space-x-2 pt-1">
            <input type="checkbox" id="edit-prod-active" ${p.active ? 'checked' : ''} class="w-4 h-4 accent-boca-gold rounded" />
            <label for="edit-prod-active" class="text-neutral-200 font-bold">Plato Activo y Disponible en POS</label>
          </div>
        </div>

        <div class="flex items-center gap-2 pt-2 border-t border-neutral-800">
          <button onclick="window.BocaApp.deleteProduct('${p.id}', '${(p.name || '').replace(/'/g, "\\'")}')" class="bg-red-950/80 hover:bg-red-900 text-red-400 border border-red-800/80 px-3 py-2.5 rounded-xl text-xs font-bold transition">
            Eliminar Plato
          </button>
          <button onclick="window.BocaApp.closeModal()" class="flex-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 font-bold py-2.5 rounded-xl text-xs transition">
            Cancelar
          </button>
          <button onclick="window.BocaApp.saveEditProduct('${p.id}')" class="flex-1 bg-boca-gold hover:bg-boca-goldLight text-boca-black font-display font-black py-2.5 rounded-xl text-xs transition shadow">
            Guardar Cambios
          </button>
        </div>
      </div>
    `;
  }

  // Modal: Nuevo Plato (CARTA)
  function renderNewProductModal() {
    return `
      <div class="bg-boca-card border border-boca-border rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl">
        <div class="flex items-center justify-between border-b border-neutral-800 pb-3">
          <h3 class="font-display font-bold text-base text-boca-cream">Crear Nuevo Plato en Carta</h3>
          <button onclick="window.BocaApp.closeModal()" class="text-neutral-400 hover:text-neutral-200">
            <i data-lucide="x" class="w-5 h-5"></i>
          </button>
        </div>

        <div class="space-y-3 text-xs max-h-[70vh] overflow-y-auto pr-1">
          <div>
            <label class="block text-neutral-400 mb-1 font-semibold">Nombre del Plato o Combo:</label>
            <input type="text" id="new-prod-name" placeholder="Ej: Combo Alitas Criollas x10"
              class="w-full bg-neutral-900 border border-neutral-700 rounded-xl p-2.5 text-neutral-100 font-bold focus:border-boca-gold focus:outline-none" />
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-neutral-400 mb-1">Categoría:</label>
              <select id="new-prod-category" class="w-full bg-neutral-900 border border-neutral-700 rounded-xl p-2.5 text-neutral-100">
                ${state.categories.map(c => `
                  <option value="${c.id}">${c.name}</option>
                `).join('')}
              </select>
            </div>
            <div>
              <label class="block text-neutral-400 mb-1">Estación Cocina:</label>
              <select id="new-prod-station" class="w-full bg-neutral-900 border border-neutral-700 rounded-xl p-2.5 text-neutral-100">
                <option value="Alitas" selected>Alitas</option>
                <option value="Frituras">Frituras</option>
                <option value="Parrilla">Parrilla</option>
                <option value="Bebidas">Bebidas</option>
                <option value="Empaque">Empaque</option>
              </select>
            </div>
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-neutral-400 mb-1 font-semibold">Precio de Venta ($ COP):</label>
              <input type="number" id="new-prod-price" placeholder="Ej: 29900"
                class="w-full bg-neutral-900 border border-neutral-700 rounded-xl p-2.5 text-boca-gold font-bold font-mono focus:border-boca-gold focus:outline-none" />
            </div>
            <div>
              <label class="block text-neutral-400 mb-1 font-semibold">Costo Estimado ($ COP):</label>
              <input type="number" id="new-prod-cost" placeholder="Ej: 11500"
                class="w-full bg-neutral-900 border border-neutral-700 rounded-xl p-2.5 text-neutral-300 font-mono focus:border-boca-gold focus:outline-none" />
            </div>
          </div>

          <div>
            <label class="block text-neutral-400 mb-1">Descripción corta:</label>
            <textarea id="new-prod-desc" rows="2" placeholder="Incluye alitas marinadas, papas y gaseosa..."
              class="w-full bg-neutral-900 border border-neutral-700 rounded-xl p-2.5 text-neutral-100 text-xs focus:border-boca-gold focus:outline-none"></textarea>
          </div>

          <div>
            <label class="block text-neutral-400 mb-1">URL Fotografía (opcional):</label>
            <input type="text" id="new-prod-image" placeholder="https://..."
              class="w-full bg-neutral-900 border border-neutral-700 rounded-xl p-2.5 text-neutral-100 text-xs focus:border-boca-gold focus:outline-none" />
          </div>
        </div>

        <div class="flex items-center gap-2 pt-2 border-t border-neutral-800">
          <button onclick="window.BocaApp.closeModal()" class="flex-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 font-bold py-2.5 rounded-xl text-xs transition">
            Cancelar
          </button>
          <button onclick="window.BocaApp.saveNewProduct()" class="flex-1 bg-gradient-to-r from-boca-cream to-boca-creamHover text-boca-black font-display font-black py-2.5 rounded-xl text-xs transition shadow">
            Crear Plato
          </button>
        </div>
      </div>
    `;
  }

  // Modal: Editar Insumo (INVENTARIO)
  function renderEditIngredientModal() {
    const ing = state.modalData || {};
    return `
      <div class="bg-boca-card border border-boca-border rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl">
        <div class="flex items-center justify-between border-b border-neutral-800 pb-3">
          <div>
            <h3 class="font-display font-bold text-base text-boca-cream">Editar Insumo</h3>
            <span class="text-[11px] text-neutral-400 font-mono">${ing.code || ing.id}</span>
          </div>
          <button onclick="window.BocaApp.closeModal()" class="text-neutral-400 hover:text-neutral-200">
            <i data-lucide="x" class="w-5 h-5"></i>
          </button>
        </div>

        <div class="space-y-3 text-xs">
          <div>
            <label class="block text-neutral-400 mb-1 font-semibold">Nombre de la Materia Prima:</label>
            <input type="text" id="edit-ing-name" value="${ing.name || ''}"
              class="w-full bg-neutral-900 border border-neutral-700 rounded-xl p-2.5 text-neutral-100 font-bold focus:border-boca-gold focus:outline-none" />
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-neutral-400 mb-1">Categoría:</label>
              <input type="text" id="edit-ing-cat" value="${ing.category || 'Varios'}"
                class="w-full bg-neutral-900 border border-neutral-700 rounded-xl p-2.5 text-neutral-100" />
            </div>
            <div>
              <label class="block text-neutral-400 mb-1">Unidad de Medida:</label>
              <select id="edit-ing-unit" class="w-full bg-neutral-900 border border-neutral-700 rounded-xl p-2.5 text-neutral-100 font-mono font-bold">
                <option value="g" ${ing.unit === 'g' ? 'selected' : ''}>g (Gramos)</option>
                <option value="und" ${ing.unit === 'und' ? 'selected' : ''}>und (Unidades / Piezas)</option>
                <option value="ml" ${ing.unit === 'ml' ? 'selected' : ''}>ml (Mililitros)</option>
                <option value="kg" ${ing.unit === 'kg' ? 'selected' : ''}>kg (Kilogramos)</option>
                <option value="paquete" ${ing.unit === 'paquete' ? 'selected' : ''}>paquete</option>
              </select>
            </div>
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-neutral-400 mb-1 font-semibold">Stock Físico Actual:</label>
              <input type="number" id="edit-ing-stock" value="${ing.stock_current || 0}"
                class="w-full bg-neutral-900 border border-neutral-700 rounded-xl p-2.5 text-emerald-400 font-mono font-bold focus:border-boca-gold focus:outline-none" />
            </div>
            <div>
              <label class="block text-neutral-400 mb-1 font-semibold">Stock Mínimo Alerta:</label>
              <input type="number" id="edit-ing-min" value="${ing.stock_min || 0}"
                class="w-full bg-neutral-900 border border-neutral-700 rounded-xl p-2.5 text-red-400 font-mono font-bold focus:border-boca-gold focus:outline-none" />
            </div>
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-neutral-400 mb-1 font-semibold">Costo Unitario ($ COP):</label>
              <input type="number" step="0.1" id="edit-ing-cost" value="${ing.cost_unit || 0}"
                class="w-full bg-neutral-900 border border-neutral-700 rounded-xl p-2.5 text-boca-gold font-mono font-bold focus:border-boca-gold focus:outline-none" />
            </div>
            <div>
              <label class="block text-neutral-400 mb-1">Ubicación Bodega:</label>
              <input type="text" id="edit-ing-loc" value="${ing.location || 'Bodega Principal'}"
                class="w-full bg-neutral-900 border border-neutral-700 rounded-xl p-2.5 text-neutral-100" />
            </div>
          </div>
        </div>

        <div class="flex items-center gap-2 pt-2 border-t border-neutral-800">
          <button onclick="window.BocaApp.deleteIngredient('${ing.id}', '${(ing.name || '').replace(/'/g, "\\'")}')" class="bg-red-950/80 hover:bg-red-900 text-red-400 border border-red-800/80 px-3 py-2.5 rounded-xl text-xs font-bold transition">
            Eliminar Insumo
          </button>
          <button onclick="window.BocaApp.closeModal()" class="flex-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 font-bold py-2.5 rounded-xl text-xs transition">
            Cancelar
          </button>
          <button onclick="window.BocaApp.saveEditIngredient('${ing.id}')" class="flex-1 bg-boca-gold hover:bg-boca-goldLight text-boca-black font-display font-black py-2.5 rounded-xl text-xs transition shadow">
            Guardar Insumo
          </button>
        </div>
      </div>
    `;
  }

  // Modal: Nuevo Insumo (INVENTARIO)
  function renderNewIngredientModal() {
    return `
      <div class="bg-boca-card border border-boca-border rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl">
        <div class="flex items-center justify-between border-b border-neutral-800 pb-3">
          <h3 class="font-display font-bold text-base text-boca-cream">Registrar Nueva Materia Prima</h3>
          <button onclick="window.BocaApp.closeModal()" class="text-neutral-400 hover:text-neutral-200">
            <i data-lucide="x" class="w-5 h-5"></i>
          </button>
        </div>

        <div class="space-y-3 text-xs">
          <div>
            <label class="block text-neutral-400 mb-1 font-semibold">Nombre del Insumo:</label>
            <input type="text" id="new-ing-name" placeholder="Ej: Queso Cheddar Americano"
              class="w-full bg-neutral-900 border border-neutral-700 rounded-xl p-2.5 text-neutral-100 font-bold focus:border-boca-gold focus:outline-none" />
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-neutral-400 mb-1">Categoría:</label>
              <input type="text" id="new-ing-cat" placeholder="Lácteos / Carnes / Empaque"
                class="w-full bg-neutral-900 border border-neutral-700 rounded-xl p-2.5 text-neutral-100" />
            </div>
            <div>
              <label class="block text-neutral-400 mb-1">Unidad de Medida:</label>
              <select id="new-ing-unit" class="w-full bg-neutral-900 border border-neutral-700 rounded-xl p-2.5 text-neutral-100 font-mono font-bold">
                <option value="g">g (Gramos)</option>
                <option value="und">und (Unidades / Piezas)</option>
                <option value="ml">ml (Mililitros)</option>
                <option value="kg">kg (Kilogramos)</option>
                <option value="paquete">paquete</option>
              </select>
            </div>
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-neutral-400 mb-1 font-semibold">Stock Inicial:</label>
              <input type="number" id="new-ing-stock" placeholder="0"
                class="w-full bg-neutral-900 border border-neutral-700 rounded-xl p-2.5 text-emerald-400 font-mono font-bold focus:border-boca-gold focus:outline-none" />
            </div>
            <div>
              <label class="block text-neutral-400 mb-1 font-semibold">Stock Mínimo (Alerta):</label>
              <input type="number" id="new-ing-min" placeholder="1000"
                class="w-full bg-neutral-900 border border-neutral-700 rounded-xl p-2.5 text-red-400 font-mono font-bold focus:border-boca-gold focus:outline-none" />
            </div>
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-neutral-400 mb-1 font-semibold">Costo Unitario ($ COP):</label>
              <input type="number" step="0.1" id="new-ing-cost" placeholder="18.5"
                class="w-full bg-neutral-900 border border-neutral-700 rounded-xl p-2.5 text-boca-gold font-mono font-bold focus:border-boca-gold focus:outline-none" />
            </div>
            <div>
              <label class="block text-neutral-400 mb-1">Ubicación:</label>
              <input type="text" id="new-ing-loc" placeholder="Refrigerador 2"
                class="w-full bg-neutral-900 border border-neutral-700 rounded-xl p-2.5 text-neutral-100" />
            </div>
          </div>
        </div>

        <div class="flex items-center gap-2 pt-2 border-t border-neutral-800">
          <button onclick="window.BocaApp.closeModal()" class="flex-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 font-bold py-2.5 rounded-xl text-xs transition">
            Cancelar
          </button>
          <button onclick="window.BocaApp.saveNewIngredient()" class="flex-1 bg-gradient-to-r from-boca-cream to-boca-creamHover text-boca-black font-display font-black py-2.5 rounded-xl text-xs transition shadow">
            Registrar Insumo
          </button>
        </div>
      </div>
    `;
  }

  // Modal: Cobro y Cierre de Mesa (MESAS)
  function renderTableCheckoutModal() {
    const m = state.modalData || {};
    const ord = m.order || {};
    const total = m.total || ord.total || 0;
    const method = m.selectedMethod || 'EFECTIVO';
    const pay = (m.payments && m.payments[0]) || { method: 'EFECTIVO', amount: total, cash_tendered: total, cash_change: 0 };
    const change = Math.max(0, (pay.cash_tendered || 0) - total);

    return `
      <div class="bg-boca-card border border-boca-border rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl">
        <div class="flex items-center justify-between border-b border-neutral-800 pb-3">
          <div>
            <h3 class="font-display font-bold text-base text-boca-cream">Cerrar y Cobrar Cuenta</h3>
            <span class="text-xs text-amber-300 font-semibold">${ord.table_number || 'Mesa'} &bull; Orden: ${ord.id}</span>
          </div>
          <button onclick="window.BocaApp.closeModal()" class="text-neutral-400 hover:text-neutral-200">
            <i data-lucide="x" class="w-5 h-5"></i>
          </button>
        </div>

        <!-- Order Summary Preview -->
        <div class="p-3 bg-neutral-900/80 rounded-xl border border-neutral-800 space-y-1.5 text-xs max-h-36 overflow-y-auto">
          ${(ord.items || []).map(it => `
            <div class="flex justify-between items-center text-[11px] py-0.5 border-b border-neutral-800/40">
              <span class="truncate pr-2">
                <strong class="text-boca-gold">${it.quantity}x</strong> ${it.name}
                ${it.notes ? `<em class="text-amber-300 text-[10px] block pl-3">Obs: ${it.notes}</em>` : ''}
              </span>
              <span class="font-mono text-neutral-300">${formatCOP(it.total)}</span>
            </div>
          `).join('')}
        </div>

        <!-- Big Total Display -->
        <div class="bg-boca-dark border border-neutral-800 rounded-xl p-4 text-center">
          <span class="text-xs text-neutral-400 uppercase tracking-wider font-bold">TOTAL A PAGAR</span>
          <div class="text-3xl font-display font-black text-boca-gold mt-1">${formatCOP(total)}</div>
        </div>

        <!-- Payment Method Tabs -->
        <div class="space-y-3">
          <div class="grid grid-cols-4 gap-1.5 p-1 bg-neutral-900 rounded-xl border border-neutral-800 text-xs font-bold text-center">
            <button onclick="window.BocaApp.setTablePaymentMethod('EFECTIVO')"
              class="py-2 rounded-lg transition ${method === 'EFECTIVO' ? 'bg-boca-cream text-boca-black' : 'text-neutral-400 hover:text-neutral-200'}">
              Efectivo
            </button>
            <button onclick="window.BocaApp.setTablePaymentMethod('TRANSFERENCIA')"
              class="py-2 rounded-lg transition ${method === 'TRANSFERENCIA' ? 'bg-boca-cream text-boca-black' : 'text-neutral-400 hover:text-neutral-200'}">
              Nequi/Dav
            </button>
            <button onclick="window.BocaApp.setTablePaymentMethod('TARJETA')"
              class="py-2 rounded-lg transition ${method === 'TARJETA' ? 'bg-boca-cream text-boca-black' : 'text-neutral-400 hover:text-neutral-200'}">
              Datáfono
            </button>
            <button onclick="window.BocaApp.setTablePaymentMethod('DIVIDIDO')"
              class="py-2 rounded-lg transition ${method === 'DIVIDIDO' ? 'bg-boca-cream text-boca-black' : 'text-neutral-400 hover:text-neutral-200'}">
              Dividido
            </button>
          </div>

          <!-- Method Specific Inputs -->
          ${method === 'EFECTIVO' ? `
            <div class="space-y-2 text-xs">
              <label class="block text-neutral-300 font-semibold">Efectivo Recibido:</label>
              <input type="number" value="${pay.cash_tendered || total}"
                oninput="window.BocaApp.setTableCashTendered(this.value)"
                class="w-full bg-neutral-900 border border-neutral-700 rounded-xl p-2.5 text-neutral-100 font-mono font-bold text-base focus:border-boca-gold focus:outline-none" />
              <div class="flex justify-between items-center p-2.5 bg-emerald-950/40 border border-emerald-600/40 rounded-xl">
                <span class="text-emerald-300 font-bold">Cambio / Vueltas:</span>
                <span class="text-lg font-display font-black text-emerald-400 font-mono">${formatCOP(change)}</span>
              </div>
            </div>
          ` : method === 'TRANSFERENCIA' ? `
            <div class="space-y-2 text-xs">
              <label class="block text-neutral-300 font-semibold">Número de Aprobación / Referencia Nequi/Daviplata:</label>
              <input type="text" id="table-transfer-ref" placeholder="Ej: M123456"
                class="w-full bg-neutral-900 border border-neutral-700 rounded-xl p-2.5 text-neutral-100 font-mono focus:border-boca-gold focus:outline-none" />
            </div>
          ` : method === 'TARJETA' ? `
            <div class="space-y-2 text-xs">
              <label class="block text-neutral-300 font-semibold">Comprobante Voucher Datáfono:</label>
              <input type="text" id="table-card-ref" placeholder="Ej: 004928"
                class="w-full bg-neutral-900 border border-neutral-700 rounded-xl p-2.5 text-neutral-100 font-mono focus:border-boca-gold focus:outline-none" />
            </div>
          ` : `
            <div class="space-y-2 text-xs">
              <div class="grid grid-cols-2 gap-2">
                <div>
                  <label class="block text-neutral-400 text-[11px] mb-1">Monto en Efectivo:</label>
                  <input type="number" value="${m.payments?.[0]?.amount || Math.round(total/2)}"
                    oninput="window.BocaApp.setTableSplitCash(this.value)"
                    class="w-full bg-neutral-900 border border-neutral-700 rounded-xl p-2 text-neutral-100 font-mono" />
                </div>
                <div>
                  <label class="block text-neutral-400 text-[11px] mb-1">Monto Transferencia:</label>
                  <input type="number" value="${m.payments?.[1]?.amount || Math.round(total/2)}"
                    oninput="window.BocaApp.setTableSplitTransfer(this.value)"
                    class="w-full bg-neutral-900 border border-neutral-700 rounded-xl p-2 text-neutral-100 font-mono" />
                </div>
              </div>
            </div>
          `}
        </div>

        <button onclick="window.BocaApp.confirmTableCheckout('${ord.id}')"
          class="w-full bg-gradient-to-r from-boca-gold to-boca-goldLight text-boca-black font-display font-black py-3 rounded-xl text-sm transition shadow-lg flex items-center justify-center space-x-2">
          <i data-lucide="check-circle" class="w-4 h-4"></i>
          <span>CONFIRMAR PAGO Y LIBERAR MESA</span>
        </button>
      </div>
    `;
  }

  // Modal: Pre-cuenta de Mesa (Imprimir ticket sin cerrar)
  function renderPreCuentaModal() {
    const ord = state.modalData?.order || {};
    const suggestedTip = Math.round((ord.total || 0) * 0.1);

    return `
      <div class="bg-boca-card border border-boca-border rounded-2xl max-w-sm w-full p-5 space-y-4 shadow-2xl">
        <div class="flex items-center justify-between border-b border-neutral-800 pb-2">
          <h3 class="font-display font-bold text-sm text-boca-cream">Pre-cuenta de Mesa</h3>
          <button onclick="window.BocaApp.closeModal()" class="text-neutral-400 hover:text-neutral-200">
            <i data-lucide="x" class="w-4 h-4"></i>
          </button>
        </div>

        <!-- Thermal Ticket Simulation -->
        <div class="bg-white text-black p-4 rounded-xl font-mono text-[11px] space-y-3 shadow-inner">
          <div class="text-center border-b border-dashed border-gray-400 pb-2">
            <img src="/logo.png" alt="Logo" class="w-12 h-12 mx-auto mb-1 invert" />
            <div class="font-black text-sm">BOCA2 WINGS</div>
            <div class="text-[9px] text-gray-600">NIT: 901.458.712-4</div>
            <div class="text-[9px] text-gray-600">Calle Principal Gourmet # 24 - 10</div>
            <div class="font-black text-xs mt-1">*** PRE-CUENTA DE CONTROL ***</div>
            <div class="text-[9px] text-gray-500">NO ES COMPROBANTE FISCAL</div>
          </div>

          <div class="border-b border-dashed border-gray-400 pb-2 space-y-0.5 text-[10px]">
            <div><strong>ORDEN:</strong> ${ord.id}</div>
            <div><strong>MESA:</strong> ${ord.table_number || 'Salón'}</div>
            <div><strong>CLIENTE:</strong> ${ord.customer_name || 'Cliente'}</div>
            <div><strong>FECHA:</strong> ${formatDate(ord.created_at)}</div>
          </div>

          <div class="space-y-1.5 border-b border-dashed border-gray-400 pb-2">
            ${(ord.items || []).map(it => `
              <div class="flex justify-between items-start text-[10px]">
                <div class="flex-1 pr-1">
                  <div><strong>${it.quantity}x</strong> ${it.name}</div>
                  ${it.notes ? `<div class="text-[9px] italic text-gray-600 pl-2">* ${it.notes}</div>` : ''}
                </div>
                <div class="font-bold">${formatCOP(it.total)}</div>
              </div>
            `).join('')}
          </div>

          <div class="space-y-1 text-xs border-b border-dashed border-gray-400 pb-2">
            <div class="flex justify-between">
              <span>SUBTOTAL:</span>
              <span>${formatCOP(ord.subtotal || ord.total)}</span>
            </div>
            <div class="flex justify-between font-black text-sm pt-1 border-t border-gray-300">
              <span>TOTAL CONSUMO:</span>
              <span>${formatCOP(ord.total)}</span>
            </div>
            <div class="flex justify-between text-[10px] text-gray-600 pt-1">
              <span>Propina sugerida 10%:</span>
              <span>${formatCOP(suggestedTip)}</span>
            </div>
            <div class="flex justify-between text-[10px] font-bold text-gray-700">
              <span>Total con Propina:</span>
              <span>${formatCOP(ord.total + suggestedTip)}</span>
            </div>
          </div>

          <div class="text-center text-[9px] text-gray-600 pt-1">
            ¡Gracias por preferir Boca2 Wings!<br>
            Alitas &bull; Papas &bull; Hamburguesas
          </div>
        </div>

        <div class="flex items-center gap-2">
          <button onclick="window.print()" class="flex-1 bg-boca-gold hover:bg-boca-goldLight text-boca-black font-bold py-2 rounded-xl text-xs transition shadow flex items-center justify-center space-x-1.5">
            <i data-lucide="printer" class="w-4 h-4"></i>
            <span>Imprimir Ticket</span>
          </button>
          <button onclick="window.BocaApp.closeModal()" class="flex-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 font-bold py-2 rounded-xl text-xs transition">
            Cerrar
          </button>
        </div>
      </div>
    `;
  }

  // Modal: Nueva Mesa
  function renderNewTableModal() {
    return `
      <div class="bg-boca-card border border-boca-border rounded-2xl max-w-sm w-full p-5 space-y-4 shadow-2xl">
        <div class="flex items-center justify-between border-b border-neutral-800 pb-2">
          <h3 class="font-display font-bold text-sm text-boca-cream">Crear Nueva Mesa</h3>
          <button onclick="window.BocaApp.closeModal()" class="text-neutral-400 hover:text-neutral-200">
            <i data-lucide="x" class="w-4 h-4"></i>
          </button>
        </div>

        <div class="space-y-3 text-xs">
          <div>
            <label class="block text-neutral-400 mb-1 font-semibold">Nombre o Número de Mesa:</label>
            <input type="text" id="new-table-name" placeholder="Ej: Mesa 9, Terraza 3, Barra 3"
              class="w-full bg-neutral-900 border border-neutral-700 rounded-xl p-2.5 text-neutral-100 font-bold focus:border-boca-gold focus:outline-none" />
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-neutral-400 mb-1">Capacidad Personas:</label>
              <input type="number" id="new-table-cap" value="4"
                class="w-full bg-neutral-900 border border-neutral-700 rounded-xl p-2.5 text-neutral-100 font-mono font-bold" />
            </div>
            <div>
              <label class="block text-neutral-400 mb-1">Área o Zona:</label>
              <select id="new-table-area" class="w-full bg-neutral-900 border border-neutral-700 rounded-xl p-2.5 text-neutral-100">
                <option value="Salón Principal" selected>Salón Principal</option>
                <option value="Terraza">Terraza</option>
                <option value="Barra">Barra</option>
                <option value="Segundo Piso">Segundo Piso</option>
              </select>
            </div>
          </div>
        </div>

        <button onclick="window.BocaApp.saveNewTable()"
          class="w-full bg-boca-gold hover:bg-boca-goldLight text-boca-black font-bold py-2.5 rounded-xl text-xs transition shadow">
          Crear Mesa
        </button>
      </div>
    `;
  }

  // --- WINDOW GLOBAL CONTROLLER ---
  window.BocaApp = {
    switchTab: (tabId) => {
      state.activeTab = tabId;
      render();
    },
    switchUser: (roleId) => {
      const usersByRole = {
        admin: { id: 'USR-001', name: 'Administrador Boca2', role_id: 'admin', role_name: 'Administrador', permissions: ['all'] },
        cajero: { id: 'USR-002', name: 'Cajero Principal', role_id: 'cajero', role_name: 'Cajero', permissions: ['pos', 'cash_register', 'orders_view'] },
        cocina: { id: 'USR-003', name: 'Chef de Cocina', role_id: 'cocina', role_name: 'Cocina', permissions: ['kds', 'orders_view'] },
        inventario: { id: 'USR-004', name: 'Encargado de Bodega', role_id: 'inventario', role_name: 'Encargado de Inventario', permissions: ['inventory', 'recipes', 'purchases', 'waste'] }
      };
      state.user = usersByRole[roleId] || usersByRole.admin;
      render();
    },
    toggleSound: () => {
      soundEnabled = !soundEnabled;
      render();
    },
    setPosCategory: (catId) => {
      state.posCategory = catId;
      render();
    },
    setPosSearch: (q) => {
      state.posSearch = q;
      render();
    },
    setOrderType: (type) => {
      state.orderType = type;
      render();
    },
    setTableNumber: (v) => { state.tableNumber = v; },
    setCustomerName: (v) => { state.customerName = v; },
    setDeliveryAddress: (v) => { state.deliveryAddress = v; },
    setDeliveryFee: (v) => { state.deliveryFee = Number(v) || 0; render(); },
    setOrderNotes: (v) => { state.orderNotes = v; },
    handleProductClick: (prodId) => {
      const prod = state.products.find(p => p.id === prodId);
      if (!prod) return;
      if (prod.has_variants && prod.variants && prod.variants.length > 0) {
        state.modalData = prod;
        state.activeModal = 'variant_select';
        renderModal();
      } else {
        addToCart(prod, null);
      }
    },
    selectVariantAndAdd: (prodId, varId) => {
      const prod = state.products.find(p => p.id === prodId);
      const variant = prod?.variants?.find(v => v.id === varId);
      if (prod && variant) {
        addToCart(prod, variant);
      }
      closeModal();
    },
    updateCartQty,
    clearCart,
    openCheckout,
    setPaymentMethod: (met) => {
      state.modalData.selectedMethod = met;
      const total = state.modalData.total;
      if (met === 'DIVIDIDO') {
        const half = Math.round(total / 2);
        state.modalData.payments = [
          { method: 'EFECTIVO', amount: half, cash_tendered: half, cash_change: 0 },
          { method: 'TRANSFERENCIA', amount: total - half }
        ];
      } else {
        state.modalData.payments = [
          { method: met, amount: total, cash_tendered: total, cash_change: 0 }
        ];
      }
      renderModal();
    },
    setCashTendered: (val) => {
      const num = Number(val) || 0;
      if (state.modalData.payments[0]) {
        state.modalData.payments[0].cash_tendered = num;
        state.modalData.payments[0].cash_change = Math.max(0, num - state.modalData.payments[0].amount);
      }
      renderModal();
    },
    setSplitCash: (val) => {
      const num = Number(val) || 0;
      const total = state.modalData.total;
      state.modalData.payments[0].amount = num;
      state.modalData.payments[0].cash_tendered = num;
      state.modalData.payments[1].amount = Math.max(0, total - num);
      renderModal();
    },
    setSplitTransfer: (val) => {
      const num = Number(val) || 0;
      state.modalData.payments[1].amount = num;
      renderModal();
    },
    confirmSale,
    closeModal,
    setKdsStation: (st) => {
      state.kdsStation = st;
      render();
    },
    updateOrderStatus,
    openOpenCashModal: () => {
      state.activeModal = 'open_cash';
      renderModal();
    },
    confirmOpenCash: async () => {
      const fund = Number(document.getElementById('open-cash-amount')?.value) || 0;
      try {
        const res = await api('/cash-registers/open', {
          method: 'POST',
          body: JSON.stringify({ userId: state.user.id, initialFund: fund })
        });
        state.activeRegister = res;
        closeModal();
        loadData();
      } catch (err) {
        alert(err.message);
      }
    },
    openCloseCashModal: () => {
      state.activeModal = 'close_cash';
      renderModal();
    },
    confirmCloseCash: async () => {
      const counted = Number(document.getElementById('counted-cash-amount')?.value) || 0;
      try {
        await api('/cash-registers/close', {
          method: 'POST',
          body: JSON.stringify({ cashRegisterId: state.activeRegister.id, userId: state.user.id, countedCash: counted })
        });
        state.activeRegister = null;
        closeModal();
        loadData();
      } catch (err) {
        alert(err.message);
      }
    },
    openCashMoveModal: (type) => {
      state.modalData = { type };
      state.activeModal = 'cash_move';
      renderModal();
    },
    confirmCashMove: async (type) => {
      const amount = Number(document.getElementById('cash-move-amount')?.value) || 0;
      const desc = document.getElementById('cash-move-desc')?.value || '';
      try {
        await api('/cash-registers/movements', {
          method: 'POST',
          body: JSON.stringify({ cashRegisterId: state.activeRegister.id, userId: state.user.id, type, amount, description: desc })
        });
        closeModal();
        loadData();
      } catch (err) {
        alert(err.message);
      }
    },
    openAdjustStockModal: () => {
      state.activeModal = 'adjust_stock';
      renderModal();
    },
    confirmAdjustStock: async () => {
      const ingId = document.getElementById('adj-ing-id')?.value;
      const counted = Number(document.getElementById('adj-counted-stock')?.value) || 0;
      try {
        await api('/ingredients/adjust', {
          method: 'POST',
          body: JSON.stringify({ ingredient_id: ingId, counted_stock: counted, reason: 'Conteo físico manual', user_id: state.user.id })
        });
        closeModal();
        loadData();
      } catch (err) {
        alert(err.message);
      }
    },
    openNewWasteModal: () => {
      state.activeModal = 'new_waste';
      renderModal();
    },
    confirmNewWaste: async () => {
      const ingId = document.getElementById('wst-ing-id')?.value;
      const qty = Number(document.getElementById('wst-qty')?.value) || 0;
      const reason = document.getElementById('wst-reason')?.value || 'DANO';
      try {
        await api('/waste', {
          method: 'POST',
          body: JSON.stringify({ ingredient_id: ingId, quantity: qty, reason, user_id: state.user.id })
        });
        closeModal();
        loadData();
      } catch (err) {
        alert(err.message);
      }
    },
    openNewExpenseModal: () => {
      state.activeModal = 'new_expense';
      renderModal();
    },
    confirmNewExpense: async () => {
      const cat = document.getElementById('exp-cat')?.value || 'OTROS';
      const desc = document.getElementById('exp-desc')?.value || '';
      const amount = Number(document.getElementById('exp-amount')?.value) || 0;
      try {
        await api('/expenses', {
          method: 'POST',
          body: JSON.stringify({ category: cat, description: desc, amount, user_id: state.user.id })
        });
        closeModal();
        loadData();
      } catch (err) {
        alert(err.message);
      }
    },
    openNewPurchaseModal: () => {
      state.activeModal = 'new_purchase';
      renderModal();
    },
    confirmNewPurchase: async () => {
      const supId = document.getElementById('po-supplier-id')?.value;
      const total = Number(document.getElementById('po-total')?.value) || 0;
      try {
        await api('/purchases', {
          method: 'POST',
          body: JSON.stringify({ supplier_id: supId, total, user_id: state.user.id })
        });
        closeModal();
        loadData();
      } catch (err) {
        alert(err.message);
      }
    },
    receivePurchase: async (poId) => {
      try {
        await api(`/purchases/${poId}/receive`, {
          method: 'POST',
          body: JSON.stringify({ user_id: state.user.id })
        });
        loadData();
      } catch (err) {
        alert(err.message);
      }
    },
    login: async () => {
      const email = document.getElementById('login-email')?.value;
      const password = document.getElementById('login-password')?.value;
      try {
        const res = await api('/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email, password })
        });
        state.user = res.user;
        localStorage.setItem('boca2_active_user', JSON.stringify(res.user));
        if (state.user.role_id === 'cocina') {
          state.activeTab = 'kds';
        } else if (state.user.role_id === 'inventario') {
          state.activeTab = 'inventory';
        } else {
          state.activeTab = 'pos';
        }
        render();
        loadData();
      } catch (err) {
        alert(err.message);
      }
    },
    quickLogin: async (email, password) => {
      try {
        const res = await api('/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email, password })
        });
        state.user = res.user;
        localStorage.setItem('boca2_active_user', JSON.stringify(res.user));
        if (state.user.role_id === 'cocina') {
          state.activeTab = 'kds';
        } else if (state.user.role_id === 'inventario') {
          state.activeTab = 'inventory';
        } else {
          state.activeTab = 'pos';
        }
        render();
        loadData();
      } catch (err) {
        alert(err.message);
      }
    },
    openItemNotesModal: (itemKey) => {
      state.modalData = { key: itemKey };
      state.activeModal = 'item_notes';
      renderModal();
    },
    appendQuickTag: (tag) => {
      const input = document.getElementById('modal-item-notes-input');
      if (!input) return;
      if (input.value.trim()) {
        input.value = input.value.trim() + ', ' + tag;
      } else {
        input.value = tag;
      }
    },
    saveItemNotes: (itemKey) => {
      const input = document.getElementById('modal-item-notes-input');
      const val = input ? input.value.trim() : '';
      const item = state.cart.find(it => it.key === itemKey);
      if (item) {
        item.notes = val;
      }
      closeModal();
      renderPOSCart();
    },
    clearItemNotes: (itemKey) => {
      const item = state.cart.find(it => it.key === itemKey);
      if (item) {
        item.notes = '';
      }
      renderPOSCart();
    },
    openChangePasswordModal: (userId, name, password) => {
      state.modalData = { id: userId, name, password };
      state.activeModal = 'change_password';
      renderModal();
    },
    saveNewPassword: async (userId) => {
      const newPass = document.getElementById('new-user-password')?.value;
      if (!newPass || !newPass.trim()) {
        alert('Ingresa una clave de acceso válida.');
        return;
      }
      try {
        await api(`/users/${userId}`, {
          method: 'PUT',
          body: JSON.stringify({ password: newPass.trim() })
        });
        playSuccessSound();
        closeModal();
        loadData();
      } catch (err) {
        alert(err.message);
      }
    },
    openNewUserModal: () => {
      state.activeModal = 'new_user';
      renderModal();
    },
    saveNewUser: async () => {
      const name = document.getElementById('new-emp-name')?.value;
      const email = document.getElementById('new-emp-email')?.value;
      const role_id = document.getElementById('new-emp-role')?.value;
      const password = document.getElementById('new-emp-password')?.value;

      if (!name || !email || !password) {
        alert('Por favor completa todos los campos.');
        return;
      }
      try {
        await api('/users', {
          method: 'POST',
          body: JSON.stringify({ name, email, role_id, password })
        });
        playSuccessSound();
        closeModal();
        loadData();
      } catch (err) {
        alert(err.message);
      }
    },
    toggleUserStatus: async (userId, active) => {
      try {
        await api(`/users/${userId}`, {
          method: 'PUT',
          body: JSON.stringify({ active })
        });
        loadData();
      } catch (err) {
        alert(err.message);
      }
    },
    refreshTables: () => {
      api('/tables').then(tbls => {
        state.tables = tbls;
        render();
      }).catch(() => {});
    },
    startTableOrder: (tableName) => {
      state.tableNumber = tableName;
      state.orderType = 'MESA';
      state.activeTab = 'pos';
      render();
    },
    openTableOrderInPOS: (tableName, orderId) => {
      state.tableNumber = tableName;
      state.orderType = 'MESA';
      state.activeTab = 'pos';
      render();
    },
    chargeToTable: async () => {
      if (state.cart.length === 0) {
        alert('Agrega al menos un producto al carrito para cargar a la mesa.');
        return;
      }
      const tableName = state.tableNumber || 'Mesa 1';
      const currentTable = (state.tables || []).find(t => t.name === tableName);
      const isOccupied = currentTable && currentTable.status === 'OCUPADA' && currentTable.active_order;

      try {
        if (isOccupied) {
          // Agregar nueva ronda de platos a la cuenta abierta
          await api(`/orders/${currentTable.active_order.id}/add-items`, {
            method: 'POST',
            body: JSON.stringify({
              items: state.cart.map(it => ({
                product_id: it.product_id,
                variant_id: it.variant_id,
                name: it.name,
                variant_name: it.variant_name,
                quantity: it.quantity,
                unit_price: it.unit_price,
                subtotal: it.total,
                total: it.total,
                notes: it.notes,
                station: it.station
              })),
              user_id: state.user.id
            })
          });
          playSuccessSound();
          alert(`🍽️ ¡Nueva ronda cargada con éxito a ${tableName} y comanda enviada a cocina!`);
        } else {
          // Abrir nueva cuenta para la mesa
          const idempotencyKey = `BW-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
          const total = getCartTotal();
          await api('/orders', {
            method: 'POST',
            body: JSON.stringify({
              idempotency_key: idempotencyKey,
              cash_register_id: state.activeRegister ? state.activeRegister.id : null,
              user_id: state.user.id,
              customer_name: state.customerName.trim() || `Cliente ${tableName}`,
              order_type: 'MESA',
              table_number: tableName,
              subtotal: getCartSubtotal(),
              discount: 0,
              tax: 0,
              total: total,
              payment_status: 'PENDIENTE',
              notes: state.orderNotes,
              items: state.cart.map(it => ({
                product_id: it.product_id,
                variant_id: it.variant_id,
                name: it.name,
                variant_name: it.variant_name,
                quantity: it.quantity,
                unit_price: it.unit_price,
                subtotal: it.total,
                total: it.total,
                notes: it.notes,
                station: it.station
              }))
            })
          });
          playNewOrderSound();
          alert(`🍽️ ¡Mesa ${tableName} abierta con éxito y comanda enviada a cocina!`);
        }

        clearCart();
        const updatedTables = await api('/tables').catch(() => []);
        state.tables = updatedTables;
        state.activeTab = 'tables';
        render();
      } catch (err) {
        alert(err.message || 'Error al cargar pedido a la mesa');
      }
    },
    openTableCheckoutModal: (orderId) => {
      let ord = null;
      for (const t of (state.tables || [])) {
        if (t.active_order && t.active_order.id === orderId) {
          ord = t.active_order;
          break;
        }
      }
      if (!ord) {
        ord = state.orders.find(o => o.id === orderId);
      }
      if (!ord) return;

      state.modalData = {
        orderId,
        order: ord,
        total: ord.total,
        selectedMethod: 'EFECTIVO',
        payments: [
          { method: 'EFECTIVO', amount: ord.total, cash_tendered: ord.total, cash_change: 0 }
        ]
      };
      state.activeModal = 'table_checkout';
      renderModal();
    },
    setTablePaymentMethod: (met) => {
      state.modalData.selectedMethod = met;
      const total = state.modalData.total;
      if (met === 'DIVIDIDO') {
        const half = Math.round(total / 2);
        state.modalData.payments = [
          { method: 'EFECTIVO', amount: half, cash_tendered: half, cash_change: 0 },
          { method: 'TRANSFERENCIA', amount: total - half }
        ];
      } else {
        state.modalData.payments = [
          { method: met, amount: total, cash_tendered: total, cash_change: 0 }
        ];
      }
      renderModal();
    },
    setTableCashTendered: (val) => {
      const num = Number(val) || 0;
      if (state.modalData.payments[0]) {
        state.modalData.payments[0].cash_tendered = num;
        state.modalData.payments[0].cash_change = Math.max(0, num - state.modalData.total);
      }
      renderModal();
    },
    setTableSplitCash: (val) => {
      const num = Number(val) || 0;
      const total = state.modalData.total;
      state.modalData.payments[0].amount = num;
      state.modalData.payments[0].cash_tendered = num;
      state.modalData.payments[1].amount = Math.max(0, total - num);
      renderModal();
    },
    setTableSplitTransfer: (val) => {
      const num = Number(val) || 0;
      state.modalData.payments[1].amount = num;
      renderModal();
    },
    confirmTableCheckout: async (orderId) => {
      const m = state.modalData;
      const total = m.total;
      const totalPaid = m.payments.reduce((sum, p) => sum + Number(p.amount), 0);

      if (totalPaid < total) {
        alert(`El total pagado (${formatCOP(totalPaid)}) no cubre la cuenta (${formatCOP(total)}).`);
        return;
      }

      try {
        const res = await api(`/orders/${orderId}/checkout`, {
          method: 'POST',
          body: JSON.stringify({
            payments: m.payments,
            user_id: state.user.id,
            cash_register_id: state.activeRegister ? state.activeRegister.id : null
          })
        });

        playSuccessSound();
        closeModal();

        // Print final ticket
        state.modalData = { order: res.order };
        state.activeModal = 'ticket';
        renderModal();

        loadData();
      } catch (err) {
        alert(err.message || 'Error al cerrar la mesa');
      }
    },
    printPreCuenta: (orderId) => {
      let ord = null;
      for (const t of (state.tables || [])) {
        if (t.active_order && t.active_order.id === orderId) {
          ord = t.active_order;
          break;
        }
      }
      if (!ord) {
        ord = state.orders.find(o => o.id === orderId);
      }
      if (!ord) return;

      state.modalData = { order: ord };
      state.activeModal = 'pre_cuenta';
      renderModal();
    },
    openNewTableModal: () => {
      state.activeModal = 'new_table';
      renderModal();
    },
    saveNewTable: async () => {
      const name = document.getElementById('new-table-name')?.value;
      const cap = Number(document.getElementById('new-table-cap')?.value) || 4;
      const area = document.getElementById('new-table-area')?.value;

      if (!name || !name.trim()) {
        alert('Ingresa el nombre o número de mesa.');
        return;
      }
      try {
        await api('/tables', {
          method: 'POST',
          body: JSON.stringify({ name: name.trim(), capacity: cap, area })
        });
        playSuccessSound();
        closeModal();
        loadData();
      } catch (err) {
        alert(err.message);
      }
    },
    setMenuSearch: (q) => {
      state.menuSearch = q;
      render();
    },
    toggleProductActive: async (prodId, active) => {
      try {
        await api(`/products/${prodId}`, {
          method: 'PUT',
          body: JSON.stringify({ active })
        });
        loadData();
      } catch (err) {
        alert(err.message);
      }
    },
    openEditProductModal: (prodId) => {
      const p = state.products.find(prod => prod.id === prodId);
      if (!p) return;
      state.modalData = { ...p };
      state.activeModal = 'edit_product';
      renderModal();
    },
    saveEditProduct: async (prodId) => {
      const name = document.getElementById('edit-prod-name')?.value;
      const category_id = document.getElementById('edit-prod-category')?.value;
      const prep_station = document.getElementById('edit-prod-station')?.value;
      const price = Number(document.getElementById('edit-prod-price')?.value) || 0;
      const cost_estimated = Number(document.getElementById('edit-prod-cost')?.value) || 0;
      const description = document.getElementById('edit-prod-desc')?.value;
      const image_url = document.getElementById('edit-prod-image')?.value;
      const active = document.getElementById('edit-prod-active')?.checked;

      if (!name || !name.trim()) {
        alert('El nombre del plato es obligatorio.');
        return;
      }
      try {
        await api(`/products/${prodId}`, {
          method: 'PUT',
          body: JSON.stringify({ name, category_id, prep_station, price, cost_estimated, description, image_url, active })
        });
        playSuccessSound();
        closeModal();
        loadData();
      } catch (err) {
        alert(err.message);
      }
    },
    openNewProductModal: () => {
      state.activeModal = 'new_product';
      renderModal();
    },
    saveNewProduct: async () => {
      const name = document.getElementById('new-prod-name')?.value;
      const category_id = document.getElementById('new-prod-category')?.value;
      const prep_station = document.getElementById('new-prod-station')?.value;
      const price = Number(document.getElementById('new-prod-price')?.value) || 0;
      const cost_estimated = Number(document.getElementById('new-prod-cost')?.value) || 0;
      const description = document.getElementById('new-prod-desc')?.value;
      const image_url = document.getElementById('new-prod-image')?.value;

      if (!name || !name.trim()) {
        alert('El nombre del plato es obligatorio.');
        return;
      }
      try {
        await api('/products', {
          method: 'POST',
          body: JSON.stringify({ name, category_id, prep_station, price, cost_estimated, description, image_url, active: true })
        });
        playSuccessSound();
        closeModal();
        loadData();
      } catch (err) {
        alert(err.message);
      }
    },
    openEditIngredientModal: (ingId) => {
      const ing = state.ingredients.find(i => i.id === ingId);
      if (!ing) return;
      state.modalData = { ...ing };
      state.activeModal = 'edit_ingredient';
      renderModal();
    },
    saveEditIngredient: async (ingId) => {
      const name = document.getElementById('edit-ing-name')?.value;
      const category = document.getElementById('edit-ing-cat')?.value;
      const unit = document.getElementById('edit-ing-unit')?.value;
      const stock_current = Number(document.getElementById('edit-ing-stock')?.value) || 0;
      const stock_min = Number(document.getElementById('edit-ing-min')?.value) || 0;
      const cost_unit = Number(document.getElementById('edit-ing-cost')?.value) || 0;
      const location = document.getElementById('edit-ing-loc')?.value;

      if (!name || !name.trim()) {
        alert('El nombre del insumo es obligatorio.');
        return;
      }
      try {
        await api(`/ingredients/${ingId}`, {
          method: 'PUT',
          body: JSON.stringify({ name, category, unit, stock_current, stock_min, cost_unit, location })
        });
        playSuccessSound();
        closeModal();
        loadData();
      } catch (err) {
        alert(err.message);
      }
    },
    openNewIngredientModal: () => {
      state.activeModal = 'new_ingredient';
      renderModal();
    },
    saveNewIngredient: async () => {
      const name = document.getElementById('new-ing-name')?.value;
      const category = document.getElementById('new-ing-cat')?.value;
      const unit = document.getElementById('new-ing-unit')?.value;
      const stock_current = Number(document.getElementById('new-ing-stock')?.value) || 0;
      const stock_min = Number(document.getElementById('new-ing-min')?.value) || 0;
      const cost_unit = Number(document.getElementById('new-ing-cost')?.value) || 0;
      const location = document.getElementById('new-ing-loc')?.value;

      if (!name || !name.trim()) {
        alert('El nombre del insumo es obligatorio.');
        return;
      }
      try {
        await api('/ingredients', {
          method: 'POST',
          body: JSON.stringify({ name, category, unit, stock_current, stock_min, cost_unit, location })
        });
        playSuccessSound();
        closeModal();
        loadData();
      } catch (err) {
        alert(err.message);
      }
    },
    deleteProduct: async (prodId, prodName) => {
      const confirmDelete = confirm(`¿Estás seguro de que deseas eliminar el plato "${prodName}"?\n\nEsta acción quitará el plato del menú y catálogo de ventas.`);
      if (!confirmDelete) return;

      try {
        const res = await api(`/products/${prodId}`, {
          method: 'DELETE'
        });
        playSuccessSound();
        alert(res.message || 'Plato eliminado exitosamente.');
        closeModal();
        loadData();
      } catch (err) {
        alert(err.message || 'Error al eliminar el plato.');
      }
    },
    deleteIngredient: async (ingId, ingName) => {
      const confirmDelete = confirm(`¿Estás seguro de que deseas eliminar "${ingName}" del inventario?\n\nEsta acción quitará la materia prima del catálogo de insumos.`);
      if (!confirmDelete) return;

      try {
        const res = await api(`/ingredients/${ingId}`, {
          method: 'DELETE'
        });
        playSuccessSound();
        alert(res.message || 'Insumo eliminado exitosamente.');
        closeModal();
        loadData();
      } catch (err) {
        alert(err.message || 'Error al eliminar el insumo.');
      }
    },
    logout: () => {
      state.user = null;
      localStorage.removeItem('boca2_active_user');
      render();
    }
  };

  // --- INITIALIZATION ---
  window.addEventListener('DOMContentLoaded', () => {
    loadData();
    connectSSE();
  });

})();
