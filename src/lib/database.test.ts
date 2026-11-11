import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const shop = "00000000-0000-0000-0000-000000000001";
const otherShop = "00000000-0000-0000-0000-000000000002";
let db: PGlite;

async function insert(phone = "18095551234", status = "waiting", shopId = shop) {
  return db.query<{ id: string; position: number }>(
    `INSERT INTO public.queue_entries (shop_id, customer_name, customer_phone, status)
     VALUES ($1, 'Cliente', $2, $3) RETURNING id, position`, [shopId, phone, status],
  );
}

async function asRole(role: "anon" | "authenticated" | "service_role", sql: string) {
  await db.exec(`SET ROLE ${role}`);
  try { return await db.query(sql); }
  finally { await db.exec("RESET ROLE"); }
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated;
    CREATE ROLE service_role BYPASSRLS;
    CREATE PUBLICATION supabase_realtime;
    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;`);
  const sql = await readFile("supabase/migrations/001_initial_schema.sql", "utf8");
  await db.exec(sql);
  await db.exec(await readFile("supabase/migrations/002_queue_operations.sql", "utf8"));
  const accessSql = await readFile("supabase/migrations/003_repair_api_access.sql", "utf8");
  await db.exec(accessSql);
  await db.exec(accessSql);
  await db.exec(await readFile("supabase/migrations/004_barber_accounts.sql", "utf8"));
  await db.exec(await readFile("supabase/migrations/005_global_active_phone.sql", "utf8"));
  await db.exec(await readFile("supabase/migrations/006_claim_primary_barber.sql", "utf8"));
  await db.exec(await readFile("supabase/migrations/007_manage_barbers.sql", "utf8"));
  await db.exec(await readFile("supabase/migrations/008_whatsapp_outbox.sql", "utf8"));
  await db.exec(await readFile("supabase/migrations/009_whatsapp_delivery.sql", "utf8"));
  await db.exec(`INSERT INTO public.shops (id,slug,name,barber_name)
    VALUES ('${otherShop}', 'otra', 'Otra', 'Otro')`);
}, 30000);

beforeEach(async () => {
  await db.exec("TRUNCATE public.queue_entries, public.whatsapp_sessions, public.whatsapp_outbox RESTART IDENTITY");
  await db.exec(`DELETE FROM public.barber_accounts;
    DELETE FROM public.shops WHERE id NOT IN ('${shop}', '${otherShop}');
    UPDATE public.shops SET barber_name='Barbero Principal', is_open=true, archived_at=NULL WHERE id='${shop}';`);
});

afterAll(async () => { await db?.close(); });

describe("durable WhatsApp outbox", () => {
  it("requires a delivery receipt, survives a retry and ignores another barber's receipt", async () => {
    await db.query("SELECT join_queue($1,$2,$3,$4)", [shop,"Ana","18095551234","a".repeat(64)]);
    expect((await db.query("SELECT * FROM claim_whatsapp_deliveries($1,1)", [[otherShop]])).rows).toHaveLength(0);
    const claimed = (await db.query<{ id: string; message_id: string }>("SELECT * FROM claim_whatsapp_deliveries($1,1)", [[shop]])).rows[0];
    await db.query("SELECT finish_whatsapp_attempt($1,$2,true)", [claimed.id,claimed.message_id]);
    expect((await db.query<{ status: string }>("SELECT status FROM whatsapp_outbox WHERE id=$1", [claimed.id])).rows[0].status).toBe("sending");
    await db.query("SELECT confirm_whatsapp_delivery($1,$2)", [otherShop,claimed.message_id]);
    await db.query("UPDATE whatsapp_outbox SET leased_until=now()-interval '1 second' WHERE id=$1", [claimed.id]);
    const retry = (await db.query<{ message_id: string }>("SELECT * FROM claim_whatsapp_deliveries($1,1)", [[shop]])).rows[0];
    expect(retry.message_id).toBe(claimed.message_id);
    await db.query("SELECT confirm_whatsapp_delivery($1,$2)", [shop,claimed.message_id]);
    await db.query("SELECT finish_whatsapp_attempt($1,$2,false)", [claimed.id,claimed.message_id]);
    expect((await db.query<{ status: string; delivered_at: string }>("SELECT status,delivered_at FROM whatsapp_outbox WHERE id=$1", [claimed.id])).rows[0]).toMatchObject({ status: "sent", delivered_at: expect.anything() });
    expect((await db.query("SELECT * FROM claim_whatsapp_deliveries($1,1)", [[shop]])).rows).toHaveLength(0);
  });
  it("retries failures within 30 seconds and supersedes old messages when the turn advances", async () => {
    const first = (await db.query<{ data: { id: string } }>("SELECT join_queue($1,$2,$3,$4) AS data", [shop,"Ana","18095551234","a".repeat(64)])).rows[0].data.id;
    const old = (await db.query<{ id: string; message_id: string }>("SELECT * FROM claim_whatsapp_deliveries($1,1)", [[shop]])).rows[0];
    await db.query("SELECT finish_whatsapp_attempt($1,$2,false)", [old.id,old.message_id]);
    expect((await db.query<{ seconds: number }>("SELECT extract(epoch FROM next_attempt_at-now())::int AS seconds FROM whatsapp_outbox WHERE id=$1", [old.id])).rows[0].seconds).toBeLessThanOrEqual(30);
    await db.query("SELECT advance_queue($1,$2,$3,$4)", [shop,null,first,"completed"]);
    const latest = (await db.query<{ kind: string; body: string }>("SELECT * FROM claim_whatsapp_deliveries($1,1)", [[shop]])).rows[0];
    expect(latest.kind).toBe("chair"); expect(latest.body).toContain("Barbero Principal");
    expect((await db.query<{ status: string }>("SELECT status FROM whatsapp_outbox WHERE id=$1", [old.id])).rows[0].status).toBe("superseded");
  });
  it("queues welcome and progress atomically, then claims and marks delivery", async () => {
    const first = (await db.query<{ data: { id: string } }>("SELECT join_queue($1,$2,$3,$4) AS data", [shop,"Ana","18095551234","a".repeat(64)])).rows[0].data.id;
    const second = (await db.query<{ data: { id: string } }>("SELECT join_queue($1,$2,$3,$4) AS data", [shop,"Luis","18295551234","b".repeat(64)])).rows[0].data.id;
    expect((await db.query<{ count: number }>("SELECT count(*)::int AS count FROM whatsapp_outbox")).rows[0].count).toBe(2);
    await db.query("SELECT advance_queue($1,$2,$3,$4)", [shop,null,first,"completed"]);
    const pending = await db.query<{ id: string; kind: string; body: string }>("SELECT id,kind,body FROM whatsapp_outbox WHERE status='pending'");
    expect(pending.rows.some(row => row.kind === "chair" && row.body.includes("Barbero Principal"))).toBe(true);
    expect(pending.rows.some(row => row.kind === "upcoming" && row.body.includes("Luis"))).toBe(true);
    const claimed = await db.query<{ id: string }>("SELECT id FROM claim_whatsapp_outbox(10)");
    expect(claimed.rows.length).toBe(2);
    for (const row of claimed.rows) await db.query("SELECT finish_whatsapp_outbox($1,true)", [row.id]);
    expect((await db.query<{ notified_turn: boolean }>("SELECT notified_turn FROM queue_entries WHERE id=$1", [first])).rows[0].notified_turn).toBe(true);
    expect((await db.query<{ notified_upcoming: boolean }>("SELECT notified_upcoming FROM queue_entries WHERE id=$1", [second])).rows[0].notified_upcoming).toBe(true);
  });
});

describe("active queue constraints", () => {
  it("allows a barber's WhatsApp command to cancel a serving turn without touching another shop", async () => {
    const current = await insert("18095551234", "serving", shop);
    const other = await insert("18295551234", "serving", otherShop);
    await asRole("service_role", `UPDATE public.queue_entries SET status='cancelled'
      WHERE shop_id='${shop}' AND customer_phone='18095551234' AND status IN ('waiting','serving')`);
    expect((await db.query<{ status: string }>("SELECT status FROM queue_entries WHERE id=$1", [current.rows[0].id])).rows[0].status).toBe("cancelled");
    expect((await db.query<{ status: string }>("SELECT status FROM queue_entries WHERE id=$1", [other.rows[0].id])).rows[0].status).toBe("serving");
  });
  it.each(["waiting", "serving"])("rejects duplicate active phone when existing is %s", async (status) => {
    await insert("18095551234", status);
    await expect(insert()).rejects.toMatchObject({ code: "23505" });
  });

  it.each(["completed", "cancelled", "no_show"])("allows a new entry after %s", async (status) => {
    await insert("18095551234", status);
    await expect(insert()).resolves.toMatchObject({ rows: [{ id: expect.any(String), position: 2 }] });
  });

  it("rejects the same active phone in a different barber queue", async () => {
    await insert();
    await expect(insert("18095551234", "waiting", otherShop)).rejects.toMatchObject({ code: "23505" });
  });

  it("rejects reactivating a historical duplicate", async () => {
    const historical = await insert("18095551234", "cancelled");
    await insert();
    await expect(db.query("UPDATE queue_entries SET status='waiting' WHERE id=$1", [historical.rows[0].id]))
      .rejects.toMatchObject({ code: "23505" });
  });

  it("allows only one serving entry per shop", async () => {
    await insert("18095551234", "serving");
    await expect(insert("18295551234", "serving")).rejects.toMatchObject({ code: "23505" });
    await expect(insert("18295551234", "serving", otherShop)).resolves.toBeDefined();
  });

  it.each(["+18095551234", "abc", "0123456789", "123", "1234567890123456"])("rejects unnormalized phone %s", async (phone) => {
    await expect(insert(phone)).rejects.toMatchObject({ code: "23514" });
  });

  it("rejects invalid statuses and unknown shops", async () => {
    await expect(insert("18095551234", "invalid")).rejects.toMatchObject({ code: "23514" });
    await expect(insert("18095551234", "waiting", "00000000-0000-0000-0000-000000000099"))
      .rejects.toMatchObject({ code: "23503" });
  });

  it("updates timestamps automatically", async () => {
    const entry = await insert();
    await db.query("UPDATE queue_entries SET updated_at='2000-01-01' WHERE id=$1", [entry.rows[0].id]);
    const result = await db.query<{ recent: boolean }>("SELECT updated_at > '2020-01-01' AS recent FROM queue_entries");
    expect(result.rows[0].recent).toBe(true);
  });
});

describe("database access", () => {
  it.each(["anon", "authenticated"] as const)("%s reads public metadata but not phones or WA auth", async (role) => {
    await insert();
    expect((await asRole(role, "SELECT id, customer_name, status, position FROM queue_entries")).rows).toHaveLength(1);
    expect((await asRole(role, "SELECT id FROM shops")).rows).toHaveLength(2);
    await expect(asRole(role, "SELECT customer_phone FROM queue_entries")).rejects.toMatchObject({ code: "42501" });
    await expect(asRole(role, "SELECT * FROM queue_entries")).rejects.toMatchObject({ code: "42501" });
    await expect(asRole(role, "SELECT * FROM whatsapp_sessions")).rejects.toMatchObject({ code: "42501" });
    await expect(asRole(role, "UPDATE shops SET is_open=false")).rejects.toMatchObject({ code: "42501" });
    await expect(asRole(role, "DELETE FROM queue_entries")).rejects.toMatchObject({ code: "42501" });
    await expect(asRole(role, "TRUNCATE queue_entries")).rejects.toMatchObject({ code: "42501" });
    await expect(asRole(role, `INSERT INTO queue_entries (shop_id,customer_name,customer_phone)
      VALUES ('${shop}','Cliente','18295551234')`)).rejects.toMatchObject({ code: "42501" });
  });

  it("service role can store and read session data", async () => {
    await asRole("service_role", `INSERT INTO whatsapp_sessions (shop_id,key_id,data)
      VALUES ('${shop}','creds','serialized')`);
    expect((await asRole("service_role", "SELECT data FROM whatsapp_sessions")).rows).toEqual([{ data: "serialized" }]);
    await expect(asRole("service_role", `INSERT INTO queue_entries (shop_id,customer_name,customer_phone)
      VALUES ('${shop}','Cliente','18095551234') RETURNING customer_phone`)).resolves.toMatchObject({ rows: [{ customer_phone: "18095551234" }] });
  });

  it("enables RLS and publishes only shops and queue entries", async () => {
    const rls = await db.query<{ relrowsecurity: boolean }>(`SELECT relrowsecurity FROM pg_class
      WHERE oid IN ('public.shops'::regclass,'public.queue_entries'::regclass,'public.whatsapp_sessions'::regclass)`);
    expect(rls.rows).toEqual(Array(3).fill({ relrowsecurity: true }));
    const published = await db.query<{ tablename: string }>(`SELECT tablename FROM pg_publication_tables
      WHERE pubname='supabase_realtime' ORDER BY tablename`);
    expect(published.rows.map(row => row.tablename)).toEqual(["queue_entries", "shops"]);
    await expect(asRole("anon", "SELECT pin_hash FROM public.barber_accounts")).rejects.toThrow();
  });
});

describe("transactional queue engine", () => {
  it("completes current, serves first and leaves second waiting", async () => {
    const current = (await insert("18095551000", "serving")).rows[0];
    const first = (await insert("18095551001")).rows[0];
    const second = (await insert("18095551002")).rows[0];
    await db.query("SELECT advance_queue($1,$2,$3,'completed')", [shop, current.id, first.id]);
    const rows = await db.query<{ id: string; status: string }>("SELECT id,status FROM queue_entries ORDER BY position");
    expect(rows.rows).toEqual([{ id: current.id, status: "completed" }, { id: first.id, status: "serving" }, { id: second.id, status: "waiting" }]);
    await expect(db.query("SELECT advance_queue($1,$2,$3,'completed')", [shop, current.id, first.id])).rejects.toMatchObject({ message: "QUEUE_CHANGED" });
  });
  it("advances empty and single-entry queues without inventing turns", async () => {
    await expect(db.query("SELECT advance_queue($1,NULL,NULL,'completed')", [shop])).resolves.toBeDefined();
    const first = (await insert()).rows[0];
    await db.query("SELECT advance_queue($1,NULL,$2,'completed')", [shop, first.id]);
    const result = await db.query<{ status: string }>("SELECT status FROM queue_entries");
    expect(result.rows[0].status).toBe("serving");
  });
  it("rejects joining a closed shop", async () => {
    await db.query("UPDATE shops SET is_open=false WHERE id=$1", [shop]);
    try {
      await expect(db.query("SELECT join_queue($1,'Cliente','18095551234',$2)", [shop, "a".repeat(64)])).rejects.toMatchObject({ message: "SHOP_CLOSED" });
    } finally { await db.query("UPDATE shops SET is_open=true WHERE id=$1", [shop]); }
  });
  it("requires a private token for customer cancellation", async () => {
    await db.query("SELECT join_queue($1,'Cliente','18095551234',$2)", [shop, "a".repeat(64)]);
    const row = (await db.query<{ id: string }>("SELECT id FROM queue_entries")).rows[0];
    await expect(db.query("SELECT cancel_queue($1,$2,$3)", [shop, row.id, "b".repeat(64)])).rejects.toMatchObject({ message: "INVALID_TURN" });
    await db.query("SELECT cancel_queue($1,$2,$3)", [shop, row.id, "a".repeat(64)]);
    expect((await db.query<{ status: string }>("SELECT status FROM queue_entries")).rows[0].status).toBe("cancelled");
  });
  it("cancels a waiting turn from the registered WhatsApp phone", async () => {
    const matching = (await insert("18095551234")).rows[0];
    const other = (await insert("18095551235")).rows[0];
    await db.query("SELECT cancel_queue_phone($1,$2)", [shop, "18095551234"]);
    const rows = await db.query<{ id: string; status: string }>("SELECT id,status FROM queue_entries ORDER BY position");
    expect(rows.rows).toEqual([{ id: matching.id, status: "cancelled" }, { id: other.id, status: "waiting" }]);
  });
  it("creates independent barber queues while enforcing one active turn per phone", async () => {
    const pinHash = `scrypt:${"a".repeat(32)}:${"b".repeat(128)}`;
    const claimed = await db.query<{ data: { id: string } }>("SELECT create_barber_shop($1,$2,$3,$4) AS data", [shop, "María", pinHash, "c".repeat(64)]);
    expect(claimed.rows[0].data.id).toBe(shop);
    expect((await db.query<{ barber_name: string }>("SELECT barber_name FROM shops WHERE id=$1", [shop])).rows[0].barber_name).toBe("María");
    await expect(db.query("SELECT create_barber_shop($1,$2,$3,$4)", [shop, "Pedro", pinHash, "c".repeat(64)])).rejects.toMatchObject({ code: "23505" });
    const created = await db.query<{ data: { id: string } }>("SELECT create_barber_shop($1,$2,$3,$4) AS data", [shop, "Pedro", pinHash, "e".repeat(64)]);
    const barberShop = created.rows[0].data.id;
    expect(barberShop).not.toBe(shop);
    const main = (await db.query<{ data: { id: string } }>("SELECT join_queue($1,$2,$3,$4) AS data", [shop, "Cliente", "18095551234", "a".repeat(64)])).rows[0].data;
    await expect(db.query("SELECT join_queue($1,$2,$3,$4)", [barberShop, "Cliente", "18095551234", "b".repeat(64)])).rejects.toMatchObject({ code: "23505" });
    const barber = (await db.query<{ data: { id: string } }>("SELECT join_queue($1,$2,$3,$4) AS data", [barberShop, "Cliente", "18095551235", "b".repeat(64)])).rows[0].data;
    await expect(db.query("SELECT create_barber_shop($1,$2,$3,$4)", [shop, "MARÍA", pinHash, "d".repeat(64)])).rejects.toMatchObject({ code: "23505" });
    expect((await db.query<{ count: number }>("SELECT cancel_queue_phone_all($1) AS count", ["18095551234"])).rows[0].count).toBe(1);
    const rows = await db.query<{ id: string; status: string }>("SELECT id,status FROM queue_entries WHERE id = ANY($1)", [[main.id, barber.id]]);
    expect(rows.rows.map(row => row.status).sort()).toEqual(["cancelled", "waiting"]);
  });
  it("renames a barber, rotates the PIN and archives only an empty queue", async () => {
    const firstHash = `scrypt:${"a".repeat(32)}:${"b".repeat(128)}`;
    const nextHash = `scrypt:${"c".repeat(32)}:${"d".repeat(128)}`;
    await db.query("SELECT create_barber_shop($1,$2,$3,$4)", [shop, "María", firstHash, "e".repeat(64)]);
    const second = (await db.query<{ data: { id: string } }>("SELECT create_barber_shop($1,$2,$3,$4) AS data", [shop, "Pedro", firstHash, "f".repeat(64)])).rows[0].data.id;
    await db.query("SELECT update_barber_account($1,$2,$3,$4)", [second, "Pedro Nuevo", nextHash, "a".repeat(64)]);
    expect((await db.query<{ barber_name: string }>("SELECT barber_name FROM shops WHERE id=$1", [second])).rows[0].barber_name).toBe("Pedro Nuevo");
    expect((await db.query<{ pin_hash: string }>("SELECT pin_hash FROM barber_accounts WHERE shop_id=$1", [second])).rows[0].pin_hash).toBe(nextHash);
    await db.query("SELECT join_queue($1,$2,$3,$4)", [second, "Cliente", "18095551234", "a".repeat(64)]);
    await expect(db.query("SELECT archive_barber_account($1,$2)", [second, shop])).rejects.toMatchObject({ message: "BARBER_HAS_ACTIVE_TURNS" });
    expect((await db.query<{ names: string[] }>("SELECT cancel_queue_phone_details($1) AS names", ["18095551234"])).rows[0].names).toEqual(["Pedro Nuevo"]);
    await db.query("SELECT archive_barber_account($1,$2)", [second, shop]);
    expect((await db.query<{ archived_at: string | null }>("SELECT archived_at FROM shops WHERE id=$1", [second])).rows[0].archived_at).not.toBeNull();
    expect((await db.query<{ count: number }>("SELECT count(*) FROM queue_entries WHERE shop_id=$1", [second])).rows[0].count).toBe(1);
    await expect(db.query("SELECT join_queue($1,$2,$3,$4)", [second, "Cliente", "18095551234", "b".repeat(64)])).rejects.toMatchObject({ message: "SHOP_CLOSED" });
    await db.query("SELECT archive_barber_account($1,$2)", [shop, shop]);
    expect((await db.query<{ barber_name: string }>("SELECT barber_name FROM shops WHERE id=$1", [shop])).rows[0].barber_name).toBe("Barbero Principal");
  });
});
