import * as webpush from 'web-push';
import { getSupabaseAdmin } from './supabase-admin';
import { allowedPushEndpoint } from './push-validation';
let timer: ReturnType<typeof setInterval> | undefined;
let running: Promise<void> | undefined;
export function drainPushJobs():Promise<void> {
  if(running) return running;
  if(!process.env.VAPID_PRIVATE_KEY || !process.env.VAPID_PUBLIC_KEY) return Promise.resolve();
  running=(async()=>{
    const db=getSupabaseAdmin();
    const {data:jobs,error}=await db.rpc('claim_push_jobs',{}); if(error) throw error;
    await Promise.all((jobs??[]).map(async job=>{
      const sub=await db.from('push_subscriptions').select('*').eq('id',job.subscription_id).maybeSingle();
      if(sub.error) throw sub.error;
      if(!sub.data || !allowedPushEndpoint(sub.data.endpoint)) return;
      const entry=await db.from('queue_entries').select('status').eq('id',job.entry_id).maybeSingle();
      if(entry.error) throw entry.error;
      const stale=!entry.data || (job.kind==='serving' && entry.data.status!=='serving') || (job.kind==='upcoming' && entry.data.status!=='waiting');
      if(stale){await db.from('push_jobs').update({status:'expired'}).eq('id',job.id);return;}
      try {
        await webpush.sendNotification({endpoint:sub.data.endpoint,keys:{p256dh:sub.data.p256dh,auth:sub.data.auth}},JSON.stringify({title:job.title,body:job.body,url:job.url,tag:`turn-${job.entry_id}-${job.kind}`,expiresAt:job.expires_at}),{
          vapidDetails:{subject:process.env.VAPID_SUBJECT??'https://barberqueu.onrender.com',publicKey:process.env.VAPID_PUBLIC_KEY!,privateKey:process.env.VAPID_PRIVATE_KEY!},
          TTL:Math.max(0,Math.min(300,Math.floor((Date.parse(job.expires_at)-Date.now())/1000))),timeout:10000,urgency:'high',
        });
        const result=await db.from('push_jobs').update({status:'sent'}).eq('id',job.id); if(result.error) throw result.error;
      } catch(error) {
        const code=(error as {statusCode?:number}).statusCode;
        if(code===404 || code===410) {await db.from('push_subscriptions').delete().eq('id',sub.data.id);return;}
        await db.from('push_jobs').update({status:job.attempts>=5?'expired':'pending',next_attempt_at:new Date(Date.now()+Math.min(120000,15000*2**job.attempts)).toISOString()}).eq('id',job.id);
      }
    }));
  })().finally(()=>{running=undefined;});
  return running;
}
export function startPushWorker(){if(timer)return;const run=()=>void drainPushJobs().catch(()=>console.warn('Avisos de la app pendientes de reintento.'));timer=setInterval(run,5000);timer.unref();run();}
export async function stopPushWorker(){if(timer)clearInterval(timer);timer=undefined;await running;}

