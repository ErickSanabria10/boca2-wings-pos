// server/users.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname   = path.dirname(__filename);
const USERS_FILE = path.join(__dirname, '..', '..', 'data', 'users.json');

// Lee el archivo JSON (crea uno vacío si no existe)
export const loadUsers = async () => {
  try {
    const raw = await fs.promises.readFile(USERS_FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
};

// Añade un usuario y persiste
export const addUser = async (user) => {
  const users = await loadUsers();
  const newUser = { id: Date.now(), ...user, is_deleted: 0 };
  users.push(newUser);
  await fs.promises.writeFile(USERS_FILE, JSON.stringify(users, null, 2));
  return newUser;
};

// Soft‑delete (marca is_deleted)
export const softDeleteUser = async (id) => {
  const users = await loadUsers();
  const idx = users.findIndex(u => u.id === Number(id));
  if (idx >= 0) {
    users[idx].is_deleted = 1;
    await fs.promises.writeFile(USERS_FILE, JSON.stringify(users, null, 2));
  }
};
