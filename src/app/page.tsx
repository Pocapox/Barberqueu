"use client";
import Link from "next/link";
import { useEffect, useState, useRef, type FormEvent } from "react";
import { ArrowUpRight, Bell, BellOff, BellRing, Check, Clock3, MessageCircle, Scissors, Users } from "lucide-react";
import { useQueue } from "@/lib/use-queue";
import {
  getNotificationPermission,
  requestNotificationPermission,
  sendAppNotification,
  type NotificationPermissionState,
} from "@/lib/notifications";

type OwnTurn = { id: string; token: string; shopId?: string };
type BarberChoice = { id: string; barber_name: string; is_open: boolean };
const defaultShop = process.env.NEXT_PUBLIC_DEFAULT_SHOP_ID ?? "00000000-0000-0000-0000-000000000001";

export default function PublicPage() {
  const [shopId, setShopId] = useState(defaultShop);
  const [barbers, setBarbers] = useState<BarberChoice[]>([]);
  const { shop, queue, live, loading, error, refresh } = useQueue(shopId);
  const storageKey = shopId === defaultShop ? "barberqueue:turn" : `barberqueue:turn:${shopId}`;
  const [own, setOwn] = useState<OwnTurn | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [restored, setRestored] = useState(false);
  const [notifState, setNotifState] = useState<NotificationPermissionState>("default");

  const prevTurnRef = useRef<{ status?: string; position?: number; notifiedUpcoming?: boolean } | null>(null);

  useEffect(() => {
    setNotifState(getNotificationPermission());
  }, []);

  async function enableNotifications() {
    const res = await requestNotificationPermission();
    setNotifState(res);
    if (res === "granted") {
      void sendAppNotification("🔔 Notificaciones activadas", {
        body: "Te avisaremos aquí cuando tu turno esté cerca o pases al sillón.",
        sound: "ding",
        tag: "barberqueue-welcome",
      });
    }
  }

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("barber");
    if (requested && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(requested)) setShopId(requested);
    const controller = new AbortController();
    void fetch("/api/barbers", { signal: controller.signal, cache: "no-store" })
      .then(response => response.json()).then(data => { if (!controller.signal.aborted && Array.isArray(data.barbers)) setBarbers(data.barbers); })
      .catch(() => {});
    return () => controller.abort();
  }, []);

  useEffect(() => {
    setRestored(false); setOwn(null); setMessage("");
    try { const saved = JSON.parse(localStorage.getItem(storageKey) ?? "null"); if (saved && typeof saved.id === "string" && typeof saved.token === "string") setOwn(saved); }
    catch { /* Storage may be disabled by browser privacy settings. */ }
    setRestored(true);
  }, [storageKey]);

  const serving = queue.find(entry => entry.status === "serving");
  const waiting = queue.filter(entry => entry.status === "waiting");
  const myTurn = queue.find(entry => entry.id === own?.id);
  const position = waiting.findIndex(entry => entry.id === own?.id) + 1;

  // Real-time app notifications for the customer's turn progress
  useEffect(() => {
    if (!own || !myTurn) {
      if (prevTurnRef.current && !myTurn && own && !loading) {
        prevTurnRef.current = null;
      }
      return;
    }

    if (!prevTurnRef.current) {
      prevTurnRef.current = {
        status: myTurn.status,
        position,
        notifiedUpcoming: myTurn.notified_upcoming,
      };
      return;
    }

    const prev = prevTurnRef.current;

    if (prev.status !== "serving" && myTurn.status === "serving") {
      void sendAppNotification("💈 ¡Es tu turno!", {
        body: `Pasa al sillón con ${shop?.barber_name ?? "tu barbero"}. ¡Te están esperando!`,
        sound: "alert",
        tag: "barberqueue-serving",
      });
    } else if (
      myTurn.status === "waiting" &&
      ((prev.position && prev.position > 1 && position === 1) || (!prev.notifiedUpcoming && myTurn.notified_upcoming))
    ) {
      void sendAppNotification("💈 ¡Ya casi te toca!", {
        body: `Eres el próximo en la fila con ${shop?.barber_name ?? "tu barbero"}. Ve acercándote.`,
        sound: "ding",
        tag: "barberqueue-upcoming",
      });
    } else if (
      myTurn.status === "waiting" &&
      prev.position &&
      position > 1 &&
      position < prev.position
    ) {
      void sendAppNotification("💈 Tu turno avanzó", {
        body: `Faltan ${position - 1} persona(s) antes de ti con ${shop?.barber_name ?? "tu barbero"}.`,
        sound: "ding",
        tag: "barberqueue-progress",
      });
    }

    prevTurnRef.current = {
      status: myTurn.status,
      position,
      notifiedUpcoming: myTurn.notified_upcoming,
    };
  }, [myTurn, position, own, shop?.barber_name, loading]);

  async function join(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/queue/join", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: values.get("name"), phone: values.get("phone"), shopId }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      const turn = { id: data.id, token: data.token, shopId }; setOwn(turn);
      try { localStorage.setItem(storageKey, JSON.stringify(turn)); }
      catch { setMessage("Turno registrado. Mantén esta pestaña abierta: el navegador no permite guardarlo."); }
      if (data.whatsappQueued) setMessage("Tu turno está registrado. El aviso de WhatsApp quedó pendiente y se enviará cuando haya conexión.");
      else if (!data.whatsappDelivered) setMessage("Tu turno está registrado. Sigue esta página: WhatsApp no está disponible ahora.");
      form.reset(); await refresh();
      // Prompt for app notifications if not yet determined
      if (getNotificationPermission() === "default") {
        void enableNotifications();
      }
    } catch (e) { setMessage(e instanceof Error ? e.message : "No se pudo tomar turno."); }
    finally { setBusy(false); }
  }

  async function cancel() {
    if (!own || busy) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/queue/status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "cancel", ...own, shopId }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      setOwn(null); try { localStorage.removeItem(storageKey); } catch { /* In-memory state remains usable. */ }
      setMessage("Tu turno fue cancelado."); await refresh();
    } catch (e) { setMessage(e instanceof Error ? e.message : "No se pudo cancelar."); }
    finally { setBusy(false); }
  }

  return <main className="shell">
    <header className="topbar">
      <Link className="brand" href="/"><span className="brand-icon"><Scissors size={22}/></span>Barber<span>Queue</span></Link>
      <Link className="text-link" href="/admin">Soy barbero <ArrowUpRight size={16}/></Link>
    </header>
    <section className="intro">
      <div className="eyebrow"><span className={`dot ${shop?.is_open ? "green" : ""}`}/>{shop ? shop.is_open ? "ACEPTANDO TURNOS" : "FILA CERRADA" : "BIENVENIDO A TU BARBERÍA"}</div>
      <h1>Buen corte.<br/><span>Menos espera.</span></h1>
      <p>Toma tu lugar y sigue con tu día.<br/>Te avisamos por la app y por WhatsApp cuando estés cerca.</p>
      <div className="barber-picker">
        <label htmlFor="barber-choice">Elige tu barbero</label>
        <select id="barber-choice" value={shopId} onChange={event => setShopId(event.target.value)}>
          {barbers.length ? barbers.map(barber => <option key={barber.id} value={barber.id}>{barber.barber_name}{barber.is_open ? "" : " · fila cerrada"}</option>) : <option value={defaultShop}>{shop?.barber_name ?? "Barbero principal"}</option>}
        </select>
      </div>
    </section>
    <div className="public-grid">
      <section className="queue-panel" aria-labelledby="queue-title">
        <div className="section-heading">
          <div><p className="eyebrow">{shop?.name ?? "BARBERQUEUE"}</p><h2 id="queue-title">La fila, en vivo</h2></div>
          <span className="live-badge"><span className={`dot ${live ? "green" : ""}`}/>{live ? "En vivo" : "Actualizando"}</span>
        </div>
        <div className="stats">
          <div><Users size={18}/><strong>{loading ? "—" : waiting.length}</strong><span>en espera</span></div>
          <div><Clock3 size={18}/><strong>{shop ? `${(waiting.length + (serving ? 1 : 0)) * shop.avg_cut_minutes} min` : "—"}</strong><span>espera estimada</span></div>
        </div>
        {error && <div className="notice error" role="alert">{error}<button className="text-link" onClick={() => void refresh()}>Reintentar</button></div>}
        {loading ? <div className="empty" aria-live="polite">Cargando la fila…</div> : <>
          <div className="serving">
            <div className="chair-icon"><Scissors size={26}/></div>
            <div><span className="eyebrow">AHORA EN EL SILLÓN</span><h3>{serving?.customer_name ?? "Listo para el próximo"}</h3><p>{shop?.barber_name ?? "Tu barbero"}</p></div>
            {serving && <span className="pill">En atención</span>}
          </div>
          <ol className="queue-list">{waiting.map((entry, index) => <li className={entry.id === own?.id ? "mine" : ""} key={entry.id}><span className="position">{String(index + 1).padStart(2, "0")}</span><div><strong>{entry.customer_name}{entry.id === own?.id && <span className="you">Tú</span>}</strong><p>{entry.notified_upcoming ? "Avisado · acercándose" : index === 0 ? "El próximo en pasar" : "En espera"}</p></div><span className="eta">~{(index + (serving ? 1 : 0)) * (shop?.avg_cut_minutes ?? 25)} min</span></li>)}</ol>
          {!waiting.length && <div className="empty"><Users size={25}/><h3>La fila está libre</h3><p>{shop?.is_open ? "Un buen momento para tu próximo corte." : "Vuelve cuando abramos los turnos."}</p></div>}
        </>}
        <p className="footnote">Los tiempos son aproximados y pueden variar con cada corte.</p>
      </section>
      <aside className="join-panel">
        {myTurn ? <>
          <div className="eyebrow"><Check size={16}/>TU LUGAR ESTÁ GUARDADO</div>
          <h2>{myTurn.status === "serving" ? "En el sillón" : "Este es tu turno."}</h2>
          <div className="your-number">{myTurn.status === "serving" ? <Scissors size={68}/> : <><span>#</span>{position}</>}</div>
          <p>{myTurn.status === "serving" ? "Tu barbero te está atendiendo." : "Puedes seguir tu posición aquí. Mantente cerca cuando seas el próximo."}</p>

          {/* Notificaciones del cliente */}
          {notifState === "default" && (
            <div className="notif-prompt">
              <div className="notif-prompt-info">
                <Bell size={18} />
                <div>
                  <strong>¿Avisos en tu pantalla?</strong>
                  <p>Activa las notificaciones para que tu teléfono suene cuando sea tu turno.</p>
                </div>
              </div>
              <button type="button" className="button secondary full notif-btn" onClick={() => void enableNotifications()}>
                <Bell size={15} /> Activar notificaciones en la app
              </button>
            </div>
          )}
          {notifState === "granted" && (
            <div className="notif-badge granted">
              <BellRing size={15} />
              <span>Avisos de la app activados en este teléfono</span>
            </div>
          )}
          {notifState === "denied" && (
            <div className="notif-badge denied">
              <BellOff size={15} />
              <span>Notificaciones bloqueadas en el navegador</span>
            </div>
          )}

          {myTurn.status === "waiting" && <button type="button" className="button secondary full" disabled={busy} onClick={() => void cancel()}>{busy ? "Cancelando…" : "Cancelar mi turno"}</button>}
        </> : <>
          <span className="step-tag">TU PRÓXIMO CORTE EMPIEZA AQUÍ</span>
          <h2>Guarda tu lugar.</h2>
          <p>Solo necesitamos tu nombre y tu WhatsApp.</p>
          {own && !loading && !error && <p className="notice">Tu turno anterior ya no está en la fila activa.</p>}
          <form onSubmit={join}>
            <label htmlFor="name">Tu nombre</label>
            <input id="name" name="name" autoComplete="given-name" placeholder="¿Cómo te llamas?" required maxLength={80}/>
            <label htmlFor="phone">Número de WhatsApp</label>
            <input id="phone" name="phone" type="tel" autoComplete="tel" placeholder="809 555 1234" required maxLength={40}/>
            <p className="input-help">Para otros países, incluye + y el código de país.</p>
            <button className="button primary full" disabled={busy || !shop?.is_open || !restored || !!error}>{busy ? "Guardando tu lugar…" : shop && !shop.is_open ? "Fila cerrada" : "Tomar mi turno"}<ArrowUpRight size={20}/></button>
          </form>
          {notifState === "default" && (
            <button type="button" className="notif-chip" onClick={() => void enableNotifications()}>
              <Bell size={14} />
              <span>Activar notificaciones en esta app</span>
            </button>
          )}
          <div className="privacy"><MessageCircle size={18}/><span>Tu número es privado. Solo lo usamos para avisarte sobre tu turno.</span></div>
        </>}
        {message && <p className="notice" role="status">{message}</p>}
      </aside>
    </div>
    <footer><span>BarberQueue</span><span>Tu tiempo también cuenta.</span></footer>
  </main>;
}
