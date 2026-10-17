// Loads soul-engine/.env (if present) before any other module reads process.env.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.env');
try {
  process.loadEnvFile(file);
} catch {
  /* no .env: defaults and the shell's environment apply */
}
