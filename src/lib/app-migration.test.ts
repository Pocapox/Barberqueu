import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { beforeAll, afterAll, expect, it } from 'vitest';
let db: PGlite;
const shop='00000000-0000-0000-0000-000000000001';
beforeAll(async()=>{
  db=new PGlite();
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE PUBLICATION supabase_realtime; GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;');
  for(const file of (await readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort()) await db.exec(await readFile(`supabase/migrations/${file}`,'utf8'));
},30000);
afterAll(async()=>{await db?.close();});
it('removes WhatsApp tables, keeps queue transactions and cancels a serving turn by private token',async()=>{
  expect((await db.query("SELECT to_regclass('public.whatsapp_sessions') AS table_name")).rows).toEqual([{table_name:null}]);
  const result=await db.query<{entry:{id:string}}>('SELECT join_queue($1,$2,$3,$4) AS entry',[shop,'Ana','18095550123','a'.repeat(64)]);
  const id=result.rows[0].entry.id;
  await db.query("SELECT advance_queue($1,NULL,$2,'completed')",[shop,id]);
  await expect(db.query('SELECT cancel_queue($1,$2,$3)',[shop,id,'b'.repeat(64)])).rejects.toThrow('INVALID_TURN');
  await db.query('SELECT cancel_queue($1,$2,$3)',[shop,id,'a'.repeat(64)]);
  expect((await db.query('SELECT status FROM queue_entries WHERE id=$1',[id])).rows).toEqual([{status:'cancelled'}]);
});
it('protects subscriptions and jobs from public access',async()=>{
  expect((await db.query("SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public' AND tablename IN ('push_subscriptions','push_jobs')")).rows).toEqual([{n:2}]);
  await db.exec('SET ROLE anon');
  try {await expect(db.query('SELECT * FROM push_subscriptions')).rejects.toThrow(); await expect(db.query('SELECT * FROM push_jobs')).rejects.toThrow();}
  finally {await db.exec('RESET ROLE');}
});
it('queues only the next two, deduplicates events, leases retries and expires cancelled turns',async()=>{
  const ids:string[]=[];
  for(let n=0;n<4;n++){
    const result=await db.query<{entry:{id:string}}>('SELECT join_queue($1,$2,$3,$4) AS entry',[shop,'Prueba',`1809555020${n}`,'a'.repeat(64)]);
    ids.push(result.rows[0].entry.id);
    await db.query("INSERT INTO push_subscriptions(shop_id,entry_id,endpoint,p256dh,auth,expires_at) VALUES($1,$2,$3,'key','auth',now()+interval '1 hour')",[shop,ids[n],`https://fcm.googleapis.com/test-${n}`]);
  }
  await db.query("SELECT advance_queue($1,NULL,$2,'completed')",[shop,ids[0]]);
  const jobs=await db.query<{entry_id:string;kind:string}>("SELECT entry_id,kind FROM push_jobs WHERE kind='upcoming'");
  expect(jobs.rows.some(j=>j.entry_id===ids[2])).toBe(true);
  expect(jobs.rows.some(j=>j.entry_id===ids[3])).toBe(false);
  await expect(db.query("SELECT advance_queue($1,NULL,$2,'completed')",[shop,ids[0]])).rejects.toThrow('QUEUE_CHANGED');
  const claimed=await db.query('SELECT * FROM claim_push_jobs()');
  expect(claimed.rows.length).toBeGreaterThan(0);
  expect((await db.query('SELECT * FROM claim_push_jobs()')).rows).toHaveLength(0);
  await db.query('SELECT cancel_queue($1,$2,$3)',[shop,ids[1],'a'.repeat(64)]);
  await db.exec("UPDATE push_jobs SET next_attempt_at=now()-interval '1 minute';");
  const retry=await db.query<{entry_id:string;kind:string}>('SELECT * FROM claim_push_jobs()');
  expect(retry.rows.some(j=>j.entry_id===ids[1]&&j.kind==='upcoming')).toBe(false);
});
