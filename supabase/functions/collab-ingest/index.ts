import { createHandler, RpcError, type Backend } from './handler.ts';

const url = Deno.env.get('SUPABASE_URL')!;
const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const origins = (Deno.env.get('COLLAB_ALLOWED_ORIGINS') ?? '').split(',').map(s => s.trim()).filter(Boolean);
const backend: Backend = {
  async authenticate(token) {
    const response = await fetch(`${url}/auth/v1/user`, { headers: { apikey: anonKey, Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000) });
    if (!response.ok) return null;
    const user = await response.json();
    return { id: user.id, is_anonymous: user.is_anonymous === true };
  },
  async rpc(name, args) {
    const response = await fetch(`${url}/rest/v1/rpc/${name}`, { method: 'POST', headers: {
      apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json',
    }, body: JSON.stringify(args), signal: AbortSignal.timeout(15000) });
    const result = await response.json();
    if (!response.ok) throw new RpcError(result.code ?? 'SERVER_ERROR', result.message ?? 'SERVER_UNAVAILABLE');
    return result;
  },
};
Deno.serve(createHandler(backend, origins));
