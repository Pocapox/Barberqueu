import { createHash } from 'node:crypto';
import { z } from 'zod';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { allowedPushEndpoint } from '@/lib/push-validation';
import { ApiError, body, handleError, json, limit, requireManager } from '../_shared';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export function GET() {
  return json({ publicKey: process.env.VAPID_PUBLIC_KEY ?? null, enabled: !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) });
}
function validHost(value: string | null): string | null {
  const host = value?.split(',')[0]?.trim().toLowerCase();
  return host && /^[a-z0-9.-]+(?::\d{1,5})?$/.test(host) ? host : null;
}
function validProto(value: string | null): 'http' | 'https' | null {
  const proto = value?.split(',')[0]?.trim().toLowerCase();
  return proto === 'http' || proto === 'https' ? proto : null;
}
function verifyOrigin(request: Request): void {
  const origin = request.headers.get('origin');
  if (!origin) throw new ApiError(403, 'Origen inválido.');
  let parsedOrigin: string;
  try {
    const url = new URL(origin);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error();
    parsedOrigin = url.origin;
  } catch {
    throw new ApiError(403, 'Origen inválido.');
  }
  const requestUrl = new URL(request.url);
  const allowed = new Set<string>([requestUrl.origin]);
  const proto = validProto(request.headers.get('x-forwarded-proto')) ?? validProto(requestUrl.protocol.replace(':', ''));
  const forwardedHost = validHost(request.headers.get('x-forwarded-host'));
  const host = validHost(request.headers.get('host'));
  if (proto && forwardedHost) allowed.add(`${proto}://${forwardedHost}`);
  if (proto && host) allowed.add(`${proto}://${host}`);
  if (process.env.VAPID_SUBJECT) {
    try {
      const subjectUrl = new URL(process.env.VAPID_SUBJECT);
      if (subjectUrl.protocol === 'http:' || subjectUrl.protocol === 'https:') allowed.add(subjectUrl.origin);
    } catch { /* VAPID_SUBJECT may be mailto: */ }
  }
  if (!allowed.has(parsedOrigin)) throw new ApiError(403, 'Origen inválido.');
}
const schema=z.object({
  shopId:z.guid(), entryId:z.guid().optional(), token:z.string().regex(/^[a-f0-9]{64}$/).optional(),
  subscription:z.object({endpoint:z.string().max(2048).refine(allowedPushEndpoint,'Servicio de avisos no compatible.'),keys:z.object({p256dh:z.string().regex(/^[A-Za-z0-9_-]{87}=?$/),auth:z.string().regex(/^[A-Za-z0-9_-]{22}=?=?$/)})}),
});
export async function POST(request:Request) {
  try {
    verifyOrigin(request);
    if(!process.env.VAPID_PRIVATE_KEY) throw new ApiError(503,'Los avisos aún no están configurados.');
    const input=schema.parse(await body(request));
    const db=getSupabaseAdmin();
    if(input.entryId) {
      if(!input.token) throw new ApiError(403,'Falta la autorización del turno.');
      const {data,error}=await db.from('queue_entries').select('id').eq('id',input.entryId).eq('shop_id',input.shopId).eq('cancel_token_hash',createHash('sha256').update(input.token).digest('hex')).in('status',['waiting','serving']).maybeSingle();
      if(error) throw error;
      if(!data) throw new ApiError(403,'El turno ya no está activo.');
    } else {
      const manager=await requireManager(request);
      if(manager.shopId!==input.shopId) throw new ApiError(403,'Fila no autorizada.');
    }
    limit(`push:${input.entryId ?? input.shopId}`,20);
    const {endpoint,keys}=input.subscription;
    const row={shop_id:input.shopId,entry_id:input.entryId??null,endpoint,...keys,expires_at:new Date(Date.now()+(input.entryId?86400000:43200000)).toISOString()};
    const saved=await db.from('push_subscriptions').upsert(row,{onConflict:'endpoint,shop_id,entry_id'});
    if(saved.error) throw saved.error;
    return json({ok:true});
  } catch(error){return handleError(error);}
}

export async function DELETE(request:Request) {
  try {
    verifyOrigin(request);
    const {shopId}=await requireManager(request);
    const {endpoint}=z.object({endpoint:z.string().max(2048)}).parse(await body(request));
    const result=await getSupabaseAdmin().from('push_subscriptions').delete().eq('shop_id',shopId).eq('endpoint',endpoint).is('entry_id',null);
    if(result.error) throw result.error;
    return json({ok:true});
  }catch(error){return handleError(error);}
}
