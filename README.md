# Boca2 Wings POS

Aplicación web de punto de venta que permite crear, leer, actualizar y eliminar **categorías, platos, inventario, mesas y personal**.  
Todos los cambios se persisten en una base SQLite (`data/boca2.sqlite`).

## Requisitos

- **Node.js** (>= 18)  
- **npm** (viene con Node)  
- (Opcional) **pnpm** si prefieres usarlo.

## Instalación

```powershell
# 1️⃣ Cambiar la política de ejecución (solo en esta ventana)
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force

# 2️⃣ Ir a la carpeta del proyecto
cd C:\Users\sanab\.gemini\antigravity\scratch\boca2-wings-pos

# 3️⃣ Instalar dependencias
npm install          # o: pnpm install

# 4️⃣ Instalar SQLite (ya está en dependencies)
#    Si usas pnpm:
#    pnpm add sqlite3
