# 🍗 BOCA2 WINGS POS — SISTEMA INTEGRAL DE GESTIÓN PARA RESTAURANTE DE COMIDAS RÁPIDAS

Sistema profesional, moderno, funcional, seguro y escalable desarrollado para **Boca2 Wings**, especializado en alitas de pollo, papas fritas, hamburguesas artesanales, combos, salchipapas, perros calientes, bebidas y salsas.

Inspirado en la facilidad de uso de **Treinta**, pero con capacidades empresariales avanzadas para gastronomía: inventario inteligente por porciones y recetas, KDS de cocina en tiempo real, control de caja y turnos, exportación contable a Excel XLSX en 8 hojas, costeo de recetas (COGS) y márgenes de rentabilidad.

---

## 🚀 CARACTERÍSTICAS PRINCIPALES

1. **Punto de Venta POS Rápido**:
   - Catálogo visual táctil con categorías, imágenes y buscador en tiempo real.
   - Selector inteligente de porciones/gramajes (ej: Papas Pequeñas 150g, Medianas 200g, Grandes 300g; Alitas 6, 12, 24 pcs).
   - Tipos de pedido: Consumo en Mesa, Para Llevar, Recoger y Domicilio.
   - **Observaciones por Plato**: Notas personalizadas en cada artículo ("Sin salsa", "Salsa aparte", "Sin cebolla", "Bien doradas") reflejadas en carrito, KDS cocina y ticket térmico.
   - **Gestión de Mesas & Cuentas Abiertas**: Botón dual en carrito: **"Cargar a Mesa / Enviar a Cocina"** (guarda la cuenta abierta en estado PENDIENTE) y **"Cobrar Directo"**.
   - Pagos divididos (Efectivo + Transferencia Nequi/Daviplata/Bancolombia) y cálculo exacto de cambio.
   - Mecanismo estricto de **idempotencia** para evitar pedidos duplicados por doble clic.
   - Identificadores únicos correlativos generados en el servidor: `BW-000001`, `BW-000002`...
   - Impresión térmica y visualización de comprobante de pago con logo oficial.

2. **Gestión Visual de Mesas y Salón ("Mesas / Salón")**:
   - Vista de salón con mesas configurables (Mesa 1 a 8, Barras, Terrazas).
   - Estados dinámicos: **LIBRE (Verde)** y **OCUPADA (Ámbar con animación)**.
   - Acumulación de rondas: Los meseros pueden agregar más platos y bebidas a una mesa en cualquier momento (`add-items`), sumando el consumo y descontando inventario en tiempo real.
   - Emisión de **Pre-cuenta de mesa**: Vista e impresión del consumo actual con propina sugerida (10%) antes de cobrar.
   - **Cierre de Mesa / Cobrar**: Permite liquidar la cuenta especificando el medio de pago (Efectivo con cambio, Transferencia, Tarjeta o Pago Dividido), acreditando a la caja y liberando la mesa a estado LIBRE.

3. **Administración de Carta, Platos e Insumos dentro de la App**:
   - Módulo **"Menú & Platos"**: Crear platos, modificar precios, costos estimados, estaciones de preparación y activar/desactivar platos sin borrarlos del histórico.
   - Módulo **"Inventario Materias"**: Crear materias primas, editar stock físico actual, stock mínimo de alerta, costos unitarios y realizar ajustes por conteo físico.

4. **Inventario Inteligente por Ingredientes y Porciones**:
   - Descuento automático coordinado al confirmar la venta en una **transacción ACID atómica**.
   - **Regla de Papas Fritas**: Descuenta exactamente los gramos según la receta (150g, 200g, 300g o 400g/850g en combos múltiples).
   - Descuento simultáneo de alitas, salsas en mililitros, pan, queso, tocineta, gaseosas y empaques.
   - Kárdex completo con fecha, hora, insumo, variación de stock, pedido y responsable.
   - Bloqueo preventivo si las existencias son insuficientes (política estricta sin stock negativo no autorizado).
   - Módulo de ajuste físico para registrar diferencias entre stock teórico y conteo real.

3. **Pantalla de Cocina en Tiempo Real (KDS — Kitchen Display System)**:
   - Pantalla interactiva en 3 columnas: **1. PEDIDOS NUEVOS**, **2. EN PREPARACIÓN**, **3. LISTOS PARA ENTREGAR**.
   - Comunicación en tiempo real mediante **Server-Sent Events (SSE)** sin recargar la página.
   - Alerta sonora de timbre de restaurante (Ding-dong sintetizado vía Web Audio API) al llegar un pedido nuevo.
   - Cronómetro en vivo de tiempo transcurrido con alerta visual en rojo para pedidos retrasados (>15 min).
   - Filtro por estaciones de preparación: *Todas, Alitas, Frituras, Hamburguesas, Bebidas, Empaque*.

4. **Caja, Turnos y Arqueos de Efectivo**:
   - Apertura con fondo inicial (base de caja).
   - Separación rigurosa: Las ventas por transferencia **no se suman al efectivo físico**.
   - Entradas y retiros manuales autorizados de efectivo.
   - Cálculo automático del efectivo esperado: `Fondo Inicial + Ventas Efectivo + Entradas - Retiros - Gastos`.
   - Arqueo de cierre de caja con cálculo de sobrante/faltante (`Efectivo Contado - Efectivo Esperado`).

5. **Módulo Obligatorio de Exportación a Excel (8 Hojas XLSX Reales)**:
   - Botón visible y directo: **EXPORTAR CIERRE A EXCEL**.
   - Generación de archivos Microsoft Excel OpenXML (`.xlsx`) genuinos, no CSVs renombrados.
   - Cumplimiento de las 8 hojas exactas:
     - **Hoja 1: Resumen del Cierre**: Ventas brutas, netas, COGS, márgenes y conciliación de caja física.
     - **Hoja 2: Detalle de Pedidos**: Una fila por pedido con hora, cliente, tipo, cajero y estado.
     - **Hoja 3: Productos Vendidos**: Detalle de cada plato, variante, precio, costo y margen.
     - **Hoja 4: Pagos**: Desglose de cada transacción y método de pago (efectivo, transferencias).
     - **Hoja 5: Inventario y Consumo**: Kárdex exacto de ingredientes descontados por orden.
     - **Hoja 6: Productos Más Vendidos**: Ranking por unidades vendidas, ingresos y margen.
     - **Hoja 7: Cierre de Caja**: Historial de turnos, arqueos y diferencias.
     - **Hoja 8: Anulaciones y Devoluciones**: Registro de cancelaciones con auditoría.

6. **Compras y Proveedores**:
   - Registro de órdenes de compra en estado `SOLICITADA` (no altera el stock).
   - Recepción física confirmada de mercancía que incrementa automáticamente el inventario (Prueba 10).

7. **Desperdicios y Gastos Operativos**:
   - Registro de mermas por daño, vencimiento o error de cocina con costeo unitario.
   - Gastos operativos: Arriendo, servicios públicos, nómina, mantenimiento, publicidad.
   - Cálculo del **Resultado Operativo** = `Margen Bruto - Gastos Operativos`.

---

## 🛠️ ARQUITECTURA TÉCNICA

- **Runtime**: Node.js (v20+ / v24)
- **Servidor HTTP & API REST**: Servidor nativo de alto rendimiento en `server/index.js`
- **Base de Datos Persistente**: Motor relacional transaccional ACID en `server/db/database.js` con confirmación atómica en disco (`data/boca2_db.json`)
- **Esquema Relacional**: Esquema DDL para PostgreSQL / Supabase disponible en `server/db/schema.sql`
- **Realtime**: Server-Sent Events (SSE) `/api/events` con auto-reconexión
- **Motor Excel**: Generador nativo OpenXML `.xlsx` de alto rendimiento en `server/services/excelService.js` con soporte multi-hoja y CRC32
- **Frontend**: Aplicación SPA moderna con Tailwind CSS, Montserrat/Plus Jakarta Sans, Lucide Icons y Web Audio API
- **Identidad Gráfica**: Logo oficial de Boca2 Wings incorporado en `/logo.png`

---

## 🧪 RESULTADOS DE LA SUITE DE PRUEBAS AUTOMATIZADAS (25 DE 25 SUPERADAS)

Se ejecutó la suite automatizada completa con 25 de 25 pruebas superadas satisfactoriamente (`node --test tests/pos.test.js tests/auth_and_notes.test.js tests/tables.test.js`):

```bash
▶ BOCA2 WINGS POS — SUITE DE PRUEBAS FUNCIONALES OBLIGATORIAS (18 pruebas)
  ✔ Prueba 1 a 18: Descuentos, recetas, stock insuficiente, idempotencia, pagos divididos, arqueo, Excel XLSX, cocina KDS, persistencia.
✔ BOCA2 WINGS POS — SUITE DE PRUEBAS FUNCIONALES OBLIGATORIAS (293ms)

▶ BOCA2 WINGS POS — PRUEBAS DE CLAVES DE ACCESO Y OBSERVACIONES POR PLATO (2 pruebas)
  ✔ Gestión de Usuarios y Claves: Crear usuario, cambiar contraseña y verificar autenticación
  ✔ Observaciones por Plato: Guarda notas específicas en cada artículo y se reflejan en la orden
✔ BOCA2 WINGS POS — PRUEBAS DE CLAVES DE ACCESO Y OBSERVACIONES POR PLATO (44ms)

▶ BOCA2 WINGS POS — GESTIÓN DE MESAS, CUENTAS ABIERTAS Y EDICIÓN DE CARTA/INVENTARIO (5 pruebas)
  ✔ Mesas: Apertura de mesa, cuenta abierta con notas por plato y cambio de estado a OCUPADA
  ✔ Mesas: Agregar segunda ronda de platos a una cuenta abierta y actualizar total acumulado
  ✔ Mesas: Cierre de mesa, cobro y liberación de la mesa a estado LIBRE
  ✔ Modificación de Carta y Platos: Crear, editar precio y desactivar plato
  ✔ Modificación de Insumos: Crear, editar stock y costo unitario
✔ BOCA2 WINGS POS — GESTIÓN DE MESAS, CUENTAS ABIERTAS Y EDICIÓN DE CARTA/INVENTARIO (78ms)

ℹ TOTAL: 25 pruebas | 25 pass | 0 fail
```

---

## 🚦 INSTRUCCIONES DE EJECUCIÓN

### 1. Ejecutar las Pruebas Automatizadas
Para verificar en cualquier momento el funcionamiento matemático y relacional del sistema:
```bash
node --test tests/pos.test.js
```

### 2. Iniciar el Servidor de Boca2 Wings POS
Para iniciar la aplicación en el puerto `3001`:
```bash
node server/index.js
```

Abrir en el navegador:
```
http://localhost:3001
```

### 3. Credenciales de Demostración
- **Administrador**: `admin@boca2wings.com` (Acceso total)
- **Cajero**: `cajero@boca2wings.com` (POS, Caja, Pedidos)
- **Cocina**: `cocina@boca2wings.com` (KDS Pantalla de Cocina)
- **Inventario**: `inventario@boca2wings.com` (Insumos, Recetas, Compras, Mermas)

*(Se puede cambiar de rol inmediatamente desde el selector rápido en la barra superior).*

---

## 📦 CONEXIÓN A POSTGRESQL / SUPABASE (OPCIONAL)

El sistema incluye el script SQL listo para producción en `server/db/schema.sql`.

Para desplegar en Supabase o PostgreSQL:
1. Crear un proyecto en [Supabase](https://supabase.com).
2. Abrir el **SQL Editor** de Supabase.
3. Copiar y pegar el contenido de `server/db/schema.sql` y presionar **Run**.
4. Configurar las variables de entorno en `.env`:
   ```env
   DATABASE_URL=postgresql://postgres:[PASSWORD]@[HOST]:5432/postgres
   PORT=3001
   ```

---

## 💾 PROCEDIMIENTO DE COPIAS DE SEGURIDAD (BACKUP)

La base de datos persistente se almacena en `data/boca2_db.json` con escrituras atómicas (garantía anti-corrupción mediante archivos temporales y renombrado instantáneo).

Para generar un backup manual o programado:
```powershell
Copy-Item "data\boca2_db.json" "data\backups\boca2_backup_$(Get-Date -Format 'yyyyMMdd_HHmmss').json"
```

Para restaurar una copia de seguridad:
1. Detener el servidor.
2. Sobrescribir `data/boca2_db.json` con el archivo de backup deseado.
3. Iniciar el servidor nuevamente.
