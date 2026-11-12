"use client";
import { useEffect, useState } from 'react';
import { subscribeToPush, type PushScope } from '@/lib/push-client';
export function PushControl({shopId,entryId,token}:PushScope) {
  const [state,setState]=useState<'idle'|'busy'|'active'>('idle');
  const [message,setMessage]=useState('');
  useEffect(()=>{
    let current=true;setState('idle');setMessage('');
    if('Notification' in window && Notification.permission==='granted') void subscribeToPush({shopId,entryId,token},false).then(()=>{if(current)setState('active');}).catch(()=>{});
    return()=>{current=false;};
  },[shopId,entryId,token]);
  return <section className="push-control"><strong>{state==='active'?'Avisos de este dispositivo activados':'Recibe avisos de la app'}</strong><p>{entryId?'Te avisaremos cuando estés entre los dos siguientes y cuando sea tu turno.':'Recibe avisos de nuevos clientes y cancelaciones durante tu sesión.'}</p>{state!=='active'&&<button className="button secondary" disabled={state==='busy'} onClick={()=>{setState('busy');setMessage('');void subscribeToPush({shopId,entryId,token}).then(()=>setState('active')).catch(error=>{setState('idle');setMessage(error instanceof Error?error.message:'No se pudieron activar.');});}}>{state==='busy'?'Activando…':'Activar notificaciones'}</button>}<small>En iPhone, instala y abre la app desde su icono. Los avisos requieren conexión y permiso; revisa también tu fila.</small>{message&&<p role="status">{message}</p>}</section>;
}
