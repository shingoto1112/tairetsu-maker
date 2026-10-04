import { createMaintenanceHandler } from './handler.ts';
import { createBackend } from '../_shared/backend.ts';
Deno.serve(createMaintenanceHandler(createBackend(), (Deno.env.get('COLLAB_ALLOWED_ORIGINS') ?? '').split(',').map(s => s.trim()).filter(Boolean)));
