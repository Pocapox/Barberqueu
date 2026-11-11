"use client";
import Link from "next/link";
import { useEffect, useState, useRef, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, Bell, BellOff, BellRing, Check, Clock3, LockKeyhole, LogOut, MessageCircle, Pencil, Scissors, SkipForward, Trash2, Users } from "lucide-react";
import { useQueue } from "@/lib/use-queue";
import {
  getNotificationPermission,
  requestNotificationPermission,
  sendAppNotification,
  type NotificationPermissionState,
} from "@/lib/notifications";

type WAStatus = { status: string; qr: string | null };
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
  const [wa, setWa] = useState<WAStatus>({ status: "disconnected", qr: null });
  const [notifState, setNotifState] = useState<NotificationPermissionState>("default");
  const { shop, queue, refresh, error, live } = useQueue(activeShopId);
  const authenticated = session !== null;
  const owner = session?.role === "owner";

  const prevWaitingRef = useRef<Map<string, string> | null>(null);

  useEffect(() => {
    setNotifState(getNotificationPermission());
  }, []);

  async function enableNotifications() {
    const res = await requestNotificationPermission();
    setNotifState(res);
    if (res === "granted") {
      void sendAppNotification("🔔 Alertas del barbero activadas", {
        body: "Recibirás avisos sonoros y en pantalla cuando entren nuevos clientes o cancelen.",
        sound: "alert",
        url: "/admin",
        tag: "admin-welcome",
      });
    }
  }

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

  // Real-time app notifications for the barber (new customers, cancellations)
  useEffect(() => {
    if (!authenticated) {
      prevWaitingRef.current = null;
      return;
    }

    const currentWaiting = new Map(waiting.map(e => [e.id, e.customer_name]));

    if (prevWaitingRef.current === null) {
      prevWaitingRef.current = currentWaiting;
      return;
    }

    // 1. Detect newly joined waiting customers
    for (const [id, name] of currentWaiting) {
      if (!prevWaitingRef.current.has(id)) {
        const entryIndex = waiting.findIndex(e => e.id === id);
        void sendAppNotification("💈 Nuevo cliente en tu fila", {
          body: `${name} se unió a la espera (#${entryIndex + 1}).`,
          sound: "alert",
          url: "/admin",
          tag: `admin-new-${id}`,
        });
      }
    }

    // 2. Detect cancellations (client was waiting, now removed and not serving)
    for (const [prevId, prevName] of prevWaitingRef.current) {
      if (!currentWaiting.has(prevId) && serving?.id !== prevId) {
        void sendAppNotification("⚠️ Turno cancelado", {
          body: `${prevName} se retiró de la fila.`,
          sound: "cancel",
          url: "/admin",
          tag: `admin-cancel-${prevId}`,
        });
      }
    }

    prevWaitingRef.current = currentWaiting;
  }, [waiting, serving?.id, authenticated]);

  useEffect(() => { if (shop) setDurationDraft(String(shop.avg_cut_minutes)); }, [shop?.avg_cut_minutes]);

  useEffect(() => {
    if (!authenticated) return;
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const response = await fetch("/api/whatsapp/status", { headers: owner ? { "x-shop-id": activeShopId } : {}, signal: controller.signal, cache: "no-store" });
        const data = await response.json();
        if (response.status === 401) { setSession(null); setMessage("La sesión expiró. Inicia sesión de nuevo."); return; }
        if (!response.ok) throw new Error(data.error);
        setWa(data);
      } catch { if (!controller.signal.aborted) setWa({ status: "error", qr: null }); }
      finally { if (!controller.signal.aborted) timer = setTimeout(() => void poll(), 3000); }
    };
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [owner, authenticated, activeShopId]);

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
    await fetch("/api/barbers/session", { method: "DELETE" }).catch(() => {});
    setSession(null); setBarberName(""); setActiveShopId(defaultShop);
    setWa({ status: "disconnected", qr: null }); setMessage("");
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

      {/* Control de Notificaciones para el Barbero */}
      <div className="notif-barber-control">
        {notifState === "default" && (
          <div className="notif-banner">
            <div className="notif-banner-text">
              <Bell size={18} />
              <div>
                <strong>Alertas en tu pantalla y sonido del sillón</strong>
                <p>Entérate al instante con sonido y notificación en pantalla cuando un cliente entre a tu fila o cancele.</p>
              </div>
            </div>
            <button type="button" className="button primary sm" onClick={() => void enableNotifications()}>
              <Bell size={15} /> Activar alertas
            </button>
          </div>
        )}
        {notifState === "granted" && (
          <div className="notif-status-bar granted">
            <BellRing size={15} />
            <span>Alertas y sonido de clientes activos en este dispositivo</span>
          </div>
        )}
        {notifState === "denied" && (
          <div className="notif-status-bar denied">
            <BellOff size={15} />
            <span>Notificaciones bloqueadas en el navegador</span>
          </div>
        )}
      </div>

      <div className="share-row">
        <button type="button" className="button secondary" disabled={!shop} onClick={() => {
          const url = new URL("/", window.location.origin);
          if (["localhost", "127.0.0.1"].includes(url.hostname)) {
            setMessage("El enlace local solo funciona en esta computadora. Para compartirlo con contactos, abre el sitio publicado.");
            return;
          }
          url.searchParams.set("barber", activeShopId);
          const text = `Toma tu turno con ${shop?.barber_name ?? barberName}: ${url.toString()}`;
          window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
        }}>
          <MessageCircle size={18}/>Enviar enlace a mis contactos
        </button>
        <span>Se abrirá WhatsApp para elegir a quién enviarlo.</span>
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

      {error && <p className="notice error" role="alert">{error}</p>}
      {message && <p className="notice" role="status">{message}</p>}

      <div className="admin-grid">
        <div>
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
              <span>{busy ? "Actualizando…" : serving ? "Terminar y llamar" : "Llamar al siguiente"}<small>{serving ? "Completa este corte y avisa a todos los que esperan" : "El primero pasa al sillón; el segundo se acerca"}</small></span>
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

          <section className="queue-panel admin-queue">
            <div className="section-heading"><h2>En espera <span className="count">{waiting.length}</span></h2><Clock3 size={18}/></div>
            <ol className="queue-list">
              {waiting.map((entry, index) => (
                <li key={entry.id}>
                  <span className="position">{String(index + 1).padStart(2, "0")}</span>
                  <div><strong>{entry.customer_name}</strong><p>{entry.notified_upcoming ? "Pre-aviso enviado" : "Esperando su turno"}</p></div>
                  <button className="skip-button" disabled={busy || !!error} aria-label={`Marcar a ${entry.customer_name} como ausente`} onClick={() => { if (window.confirm(`¿Marcar a ${entry.customer_name} como ausente?`)) void action("status", { action: "skip", id: entry.id }); }}><SkipForward size={15}/>No-show</button>
                </li>
              ))}
            </ol>
            {!waiting.length && <div className="empty"><Users size={24}/><p>No hay clientes esperando.</p></div>}
          </section>
        </div>

        <aside className="whatsapp-panel">
          <div className="wa-heading"><MessageCircle size={25}/><h2>WhatsApp de {shop?.barber_name ?? barberName ?? "este barbero"}</h2></div>
          <span className={`connection-label ${wa.status === "connected" ? "connected" : ""}`}><span className={`dot ${wa.status === "connected" ? "green" : ""}`}/>{wa.status === "connected" ? "Conectado" : wa.status === "qr" ? "Listo para vincular" : wa.status === "error" ? "Conexión no disponible" : "Conectando…"}</span>
          {wa.qr ? <>
            <div className="qr-frame"><img src={wa.qr} alt="Código QR para vincular WhatsApp con BarberQueue" width={260} height={260}/></div>
            <h3>Vincula tu WhatsApp</h3>
            <ol className="qr-steps">
              <li>Abre WhatsApp en tu teléfono.</li>
              <li>Ve a Dispositivos vinculados.</li>
              <li>Toca Vincular un dispositivo y escanea.</li>
            </ol>
          </> : (
            <div className="wa-empty">
              <MessageCircle size={42}/>
              <h3>{wa.status === "connected" ? "Los avisos están listos" : "Preparando la conexión"}</h3>
              <p>{wa.status === "connected" ? "Al terminar un corte, cada cliente en espera recibe su nueva posición." : "El QR aparecerá aquí cuando el servicio esté disponible."}</p>
            </div>
          )}
          <button type="button" className="button secondary full" disabled={busy} onClick={() => {
            if (!window.confirm("¿Volver a vincular tu WhatsApp? Tendrás que escanear un QR nuevo con tu teléfono.")) return;
            setBusy(true);
            void fetch("/api/whatsapp/reset", { method: "POST", headers: owner ? { "x-shop-id": activeShopId } : {} })
              .then(async response => {
                const data = await response.json();
                if (!response.ok) throw new Error(data.error);
                setWa(data);
                setMessage("Escanea el nuevo QR con tu teléfono.");
              })
              .catch(error => setMessage(error instanceof Error ? error.message : "No se pudo reiniciar WhatsApp."))
              .finally(() => setBusy(false));
          }}>Volver a vincular mi WhatsApp</button>
          <div className="privacy"><LockKeyhole size={16}/><span>La sesión se conserva de forma privada. No necesitas volver a escanear en cada visita.</span></div>
        </aside>
      </div>
    </>}
    <footer><span>BarberQueue · Administración</span><span>Un toque. El siguiente.</span></footer>
  </main>;
}
