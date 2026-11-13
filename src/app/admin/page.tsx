"use client";
import Link from "next/link";
import { InstallGuide, ShareQueue } from "@/app/install-guide";
import { useEffect, useState, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, Check, Clock3, LockKeyhole, LogOut, Pencil, Scissors, SkipForward, Trash2, Users } from "lucide-react";
import { useQueue } from "@/lib/use-queue";
import { PushControl } from "@/app/push-control";

type BarberChoice = { id: string; barber_name: string; is_open: boolean; registered: boolean };
type ManagerSession = { role: "owner" | "barber"; shopId: string; name: string };
const defaultShop = process.env.NEXT_PUBLIC_DEFAULT_SHOP_ID ?? "00000000-0000-0000-0000-000000000001";

export default function AdminPage() {
  const [session, setSession] = useState<ManagerSession | null>(null);
  const [sessionChecked, setSessionChecked] = useState(false);
  const [barberName, setBarberName] = useState("");
  const [activeShopId, setActiveShopId] = useState(defaultShop);
  const [barbers, setBarbers] = useState<BarberChoice[]>([]);
  const [loginMode, setLoginMode] = useState<"owner" | "barber">("barber");
  const [nameDraft, setNameDraft] = useState("");
  const [newBarberName, setNewBarberName] = useState("");
  const [newBarberPin, setNewBarberPin] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editPin, setEditPin] = useState("");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [durationDraft, setDurationDraft] = useState("");
  const { shop, queue, refresh, error, live } = useQueue(activeShopId);
  const authenticated = session !== null;
  const owner = session?.role === "owner";



  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/barbers/session", { signal: controller.signal, cache: "no-store" })
      .then(async response => {
        if (!response.ok) return;
        const restored = await response.json() as ManagerSession;
        if (!controller.signal.aborted) { setSession(restored); setBarberName(restored.name); setActiveShopId(restored.shopId); }
      }).catch(() => {}).finally(() => { if (!controller.signal.aborted) setSessionChecked(true); });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!owner) return;
    const controller = new AbortController();
    void fetch("/api/barbers", { signal: controller.signal, cache: "no-store" })
      .then(response => response.json()).then(data => { if (!controller.signal.aborted && Array.isArray(data.barbers)) setBarbers(data.barbers); })
      .catch(() => {});
    return () => controller.abort();
  }, [owner]);

  const serving = queue.find(entry => entry.status === "serving");
  const waiting = queue.filter(entry => entry.status === "waiting");



  useEffect(() => { if (shop) setDurationDraft(String(shop.avg_cut_minutes)); }, [shop?.avg_cut_minutes]);


  async function login(event: FormEvent) {
    event.preventDefault(); setBusy(true); setMessage("");
    try {
      const response = await fetch(loginMode === "owner" ? "/api/barbers/owner-login" : "/api/barbers/login", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(loginMode === "owner" ? { pin: draft } : { name: nameDraft, pin: draft }),
      });
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      setSession({ role: loginMode, shopId: data.shopId, name: data.name });
      setBarberName(data.name); setActiveShopId(data.shopId);
      setDraft(""); setNameDraft("");
    } catch (e) { setMessage(e instanceof Error ? e.message : "No se pudo iniciar sesión."); }
    finally { setBusy(false); }
  }

  async function action(path: string, payload: unknown, successMessage = "Fila actualizada.") {
    if (busy) return;
    setBusy(true); setMessage("");
    try {
      const headers: Record<string, string> = owner
        ? { "Content-Type": "application/json", "x-shop-id": activeShopId }
        : { "Content-Type": "application/json" };
      const response = await fetch(`/api/queue/${path}`, { method: "POST", headers, body: JSON.stringify(payload) });
      const data = await response.json();
      if (response.status === 401) setSession(null);
      if (!response.ok) throw new Error(data.error);
      setMessage(data.warnings?.length ? data.warnings.join(" ") : successMessage);
    } catch (e) { setMessage(e instanceof Error ? e.message : "No se pudo actualizar la fila."); }
    finally { await refresh(); setBusy(false); }
  }

  const advance = (finish: "completed" | "no_show") => action("advance", { servingId: serving?.id ?? null, waitingId: waiting[0]?.id ?? null, finish });

  async function registerBarber(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!owner || busy) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/barbers/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: newBarberName, pin: newBarberPin }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      const listResponse = await fetch("/api/barbers", { cache: "no-store" });
      const list = await listResponse.json(); if (listResponse.ok) setBarbers(list.barbers);
      setNewBarberName(""); setNewBarberPin(""); setActiveShopId(data.barber.id);
      if (data.barber.id === activeShopId) await refresh();
      setMessage(`${data.barber.name} ya tiene su propia fila y puede entrar con su PIN.`);
    } catch (e) { setMessage(e instanceof Error ? e.message : "No se pudo crear el barbero."); }
    finally { setBusy(false); }
  }

  async function manageBarber(payload: { action: "update"; shopId: string; name: string; pin?: string } | { action: "archive"; shopId: string }) {
    if (!owner || busy) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/barbers/manage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      const listResponse = await fetch("/api/barbers", { cache: "no-store" });
      const list = await listResponse.json(); if (listResponse.ok) setBarbers(list.barbers);
      setEditingId(null); setEditPin("");
      if (payload.action === "archive" && payload.shopId === activeShopId && activeShopId !== defaultShop) setActiveShopId(defaultShop);
      else if (payload.shopId === activeShopId) await refresh();
      setMessage(payload.action === "archive" ? "Barbero eliminado de la lista. Su historial de turnos se conserva." : "Datos del barbero actualizados.");
    } catch (e) { setMessage(e instanceof Error ? e.message : "No se pudo actualizar el barbero."); }
    finally { setBusy(false); }
  }

  async function logout() {
    if ('serviceWorker' in navigator) {
      try {
        const registration = await navigator.serviceWorker.getRegistration();
        const subscription = await registration?.pushManager.getSubscription();
        if (subscription) await fetch('/api/push', {method:'DELETE',headers:{'Content-Type':'application/json','x-shop-id':activeShopId},body:JSON.stringify({endpoint:subscription.endpoint})});
      } catch { /* Session logout must remain available if push is unavailable. */ }
    }
    await fetch("/api/barbers/session", { method: "DELETE" }).catch(() => {});
    setSession(null); setBarberName(""); setActiveShopId(defaultShop);
    setMessage("");
  }

  return <main className="shell admin-shell">
    <header className="topbar">
      <Link className="brand" href="/"><span className="brand-icon"><Scissors size={22}/></span>Barber<span>Queue</span></Link>
      <div className="admin-nav">
        <Link className="text-link" href="/"><ArrowLeft size={15}/>Ver fila pública</Link>
        {authenticated && <button className="text-link" onClick={() => void logout()}><LogOut size={16}/>Salir</button>}
      </div>
    </header>

    {!sessionChecked ? (
      <section className="login-card"><p className="eyebrow">RECUPERANDO SESIÓN</p><h1>Un momento…</h1></section>
    ) : !authenticated ? (
      <section className="login-card">
        <div className="brand-icon"><LockKeyhole size={22}/></div>
        <p className="eyebrow">ACCESO DEL BARBERO</p>
        <h1>Tu silla.<br/><span>Tu control.</span></h1>
        <div className="login-modes">
          <button type="button" className={loginMode === "barber" ? "selected" : ""} onClick={() => { setLoginMode("barber"); setDraft(""); setMessage(""); }}>Soy barbero</button>
          <button type="button" className={loginMode === "owner" ? "selected" : ""} onClick={() => { setLoginMode("owner"); setDraft(""); setMessage(""); }}>Soy administrador</button>
        </div>
        <p>{loginMode === "owner" ? "Entra con el PIN administrador para crear barberos y ver todas las filas." : "Entra con tu nombre y tu PIN para gestionar tu propia fila."}</p>
        <form onSubmit={login}>
          {loginMode === "barber" && <>
            <label htmlFor="barber-name">Tu nombre</label>
            <input id="barber-name" value={nameDraft} onChange={e => setNameDraft(e.target.value)} autoComplete="username" required maxLength={80} placeholder="Nombre registrado"/>
          </>}
          <label htmlFor="pin">{loginMode === "owner" ? "PIN administrador" : "Tu PIN"}</label>
          <input id="pin" type="password" inputMode="numeric" value={draft} onChange={e => setDraft(e.target.value)} autoComplete="current-password" maxLength={loginMode === "owner" ? 128 : 12} required placeholder="••••••"/>
          <button className="button primary full" disabled={busy}>{busy ? "Verificando…" : "Entrar al panel"}<ArrowRight size={18}/></button>
        </form>
        {message && <p className="notice" role="alert">{message}</p>}
      </section>
    ) : <>
      <section className="admin-intro">
        <div>
          <p className="eyebrow">{owner ? "ADMINISTRACIÓN DE BARBEROS" : "PANEL DEL BARBERO"}</p>
          <h1>Todo listo,<br/><span>{shop?.barber_name ?? barberName ?? "barbero"}.</span></h1>
          <p>{shop?.name ?? "Tu barbería"} · {live ? "Fila en vivo" : "Actualización automática"}</p>
        </div>
        <button className="shop-switch" role="switch" aria-checked={shop?.is_open ?? false} aria-label="Fila abierta" disabled={busy || !shop || !!error} onClick={() => void action("status", { action: "open", isOpen: !shop?.is_open })}>
          <span><strong>{shop?.is_open ? "Fila abierta" : "Fila cerrada"}</strong><small>{shop?.is_open ? "Recibiendo nuevos turnos" : "No se aceptan nuevos turnos"}</small></span>
          <span className={`switch-track ${shop?.is_open ? "on" : ""}`}><span/></span>
        </button>
      </section>

      {error && <p className="notice error" role="alert">{error}</p>}
      {message && <p className="notice" role="status">{message}</p>}

      <div className="admin-grid">
        <div className="admin-main">
          <section className="queue-panel admin-queue">
            <div className="section-heading"><h2>En espera <span className="count">{waiting.length}</span></h2><Clock3 size={18}/></div>
            <ol className="queue-list">
              {waiting.map((entry, index) => (
                <li key={entry.id}>
                  <span className="position">{String(index + 1).padStart(2, "0")}</span>
                  <div><strong>{entry.customer_name}</strong><p>{index < 2 ? "Casi es su turno" : "Esperando su turno"}</p></div>
                  <button className="skip-button" disabled={busy || !!error} aria-label={`Marcar a ${entry.customer_name} como ausente`} onClick={() => { if (window.confirm(`¿Marcar a ${entry.customer_name} como ausente?`)) void action("status", { action: "skip", id: entry.id }); }}><SkipForward size={15}/>No-show</button>
                </li>
              ))}
            </ol>
            {!waiting.length && <div className="empty"><Users size={24}/><p>No hay clientes esperando.</p></div>}
          </section>

          <section className="control-panel">
            <div className="section-heading"><p className="eyebrow">EN EL SILLÓN</p><Scissors size={20}/></div>
            <h2>{serving?.customer_name ?? "Esperando al próximo"}</h2>
            <p>{serving ? "Al terminar, llamaremos al siguiente y diremos a cada cliente cuántas personas le faltan." : "Comienza a atender al primero de la fila con un solo toque."}</p>
            <div className="next-preview">
              <div><span>01 · PASA AL SILLÓN</span><strong>{waiting[0]?.customer_name ?? "Sin clientes en espera"}</strong></div>
              <div><span>02 · RECIBE PRE-AVISO</span><strong>{waiting[1]?.customer_name ?? "Sin segundo turno"}</strong></div>
            </div>
            <button className="button primary one-tap" disabled={busy || !!error || !shop || (!serving && !waiting.length)} onClick={() => void advance("completed")}>
              <Check size={28}/>
              <span>{busy ? "Actualizando…" : serving ? "Terminar y llamar" : "Llamar al siguiente"}<small>{serving ? "Completa este corte y actualiza la fila" : "El primero pasa al sillón; los dos siguientes se acercan"}</small></span>
              <ArrowRight size={24}/>
            </button>
            {serving && <button className="text-link no-show" disabled={busy || !!error} onClick={() => { if (window.confirm(`¿Marcar a ${serving.customer_name} como ausente y llamar al siguiente?`)) void advance("no_show"); }}><SkipForward size={16}/>No llegó · saltar turno actual</button>}
          </section>

          <section className="duration-panel">
            <div className="section-heading"><h2>Tiempo por corte</h2><Clock3 size={19}/></div>
            <p>Elige cuántos minutos tardas aproximadamente por cliente. Usaremos este valor para mostrar la espera estimada.</p>
            <form onSubmit={event => { event.preventDefault(); void action("status", { action: "duration", minutes: Number(durationDraft) }, "Tiempo estimado actualizado."); }}>
              <label htmlFor="cut-minutes">Minutos aproximados</label>
              <div className="duration-controls">
                <input id="cut-minutes" type="number" inputMode="numeric" min="5" max="180" step="1" required value={durationDraft} onChange={event => setDurationDraft(event.target.value)}/>
                <button className="button secondary" disabled={busy || !!error || !shop || Number(durationDraft) === shop.avg_cut_minutes}>Guardar tiempo</button>
              </div>
            </form>
          </section>
        </div>

        <div className="admin-side">
          <PushControl key={activeShopId} shopId={activeShopId} />

          <ShareQueue shopId={activeShopId} name={shop?.barber_name ?? barberName} />

          <InstallGuide />
        </div>
      </div>

      {owner && (
        <section className="barber-management">
          <div>
            <h2>Barberos y filas</h2>
            <p>Solo tú puedes crear, editar y eliminar accesos.</p>
            <label htmlFor="managed-barber">Fila que estás gestionando</label>
            <select id="managed-barber" value={activeShopId} onChange={event => setActiveShopId(event.target.value)}>
              {barbers.length ? barbers.map(barber => <option key={barber.id} value={barber.id}>{barber.barber_name}</option>) : <option value={defaultShop}>Barbero principal</option>}
            </select>
            <ul className="barber-list">
              {barbers.map(barber => (
                <li key={barber.id}>
                  <span>{barber.barber_name}</span>
                  {barber.registered ? (
                    <div>
                      <button type="button" className="text-link" disabled={busy} onClick={() => { setEditingId(barber.id); setEditName(barber.barber_name); setEditPin(""); }}><Pencil size={14}/>Editar</button>
                      <button type="button" className="text-link danger" disabled={busy} onClick={() => { if (window.confirm(`¿Eliminar a ${barber.barber_name}? Su acceso se cerrará y su fila desaparecerá de la selección pública. Los turnos anteriores se conservarán.`)) void manageBarber({ action: "archive", shopId: barber.id }); }}><Trash2 size={14}/>Eliminar</button>
                    </div>
                  ) : <small>Se asignará al primer barbero registrado</small>}
                </li>
              ))}
            </ul>
            {editingId && (
              <form className="edit-barber" onSubmit={event => { event.preventDefault(); void manageBarber({ action: "update", shopId: editingId, name: editName, ...(editPin ? { pin: editPin } : {}) }); }}>
                <h3>Editar barbero</h3>
                <label htmlFor="edit-barber-name">Nombre</label>
                <input id="edit-barber-name" value={editName} onChange={event => setEditName(event.target.value)} required maxLength={80}/>
                <label htmlFor="edit-barber-pin">PIN nuevo (opcional)</label>
                <input id="edit-barber-pin" type="password" inputMode="numeric" pattern="[0-9]{6,12}" minLength={6} maxLength={12} value={editPin} onChange={event => setEditPin(event.target.value)} placeholder="Déjalo vacío para conservar el PIN"/>
                <div className="edit-actions">
                  <button className="button primary" disabled={busy}>Guardar cambios</button>
                  <button type="button" className="button secondary" disabled={busy} onClick={() => { setEditingId(null); setEditPin(""); }}>Cancelar</button>
                </div>
              </form>
            )}
          </div>
          <form onSubmit={registerBarber}>
            <h3>Registrar barbero</h3>
            <label htmlFor="new-barber-name">Nombre</label>
            <input id="new-barber-name" value={newBarberName} onChange={event => setNewBarberName(event.target.value)} minLength={1} maxLength={80} required placeholder="Nombre del barbero"/>
            <label htmlFor="new-barber-pin">PIN personal</label>
            <input id="new-barber-pin" type="password" inputMode="numeric" pattern="[0-9]{6,12}" minLength={6} maxLength={12} value={newBarberPin} onChange={event => setNewBarberPin(event.target.value)} required placeholder="6 a 12 dígitos"/>
            <button className="button secondary full" disabled={busy}>Crear barbero y su fila</button>
          </form>
        </section>
      )}
    </>}
    <footer><span>BarberQueue · Administración</span><span>Un toque. El siguiente.</span></footer>
  </main>;
}
