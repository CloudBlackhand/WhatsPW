/**
 * Repõe src/dashboard/.gitkeep após `vite build` (emptyOutDir apaga a pasta).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dashboardRoot = path.join(__dirname, '..', '..', 'src', 'dashboard');

fs.mkdirSync(dashboardRoot, { recursive: true });
fs.writeFileSync(path.join(dashboardRoot, '.gitkeep'), '');
