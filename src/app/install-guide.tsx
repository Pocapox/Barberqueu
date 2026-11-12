"use client";
import { useEffect, useState } from 'react';
export function InstallGuide() {
  const [platform,setPlatform]=useState<'android'|'ios'>('android');
  useEffect(()=>{if(/iPhone|iPad|iPod/.test(navigator.userAgent))setPlatform('ios');},[]);
  return <section className="install-guide"><p className="eyebrow">SIEMPRE A MANO</p><h2>Instala BarberQueue</h2><p>Sin buscarla en una tienda. Abre el enlace en el navegador del teléfono.</p><div className="login-modes"><button className={platform==='android'?'selected':''} onClick={()=>setPlatform('android')}>Android</button><button className={platform==='ios'?'selected':''} onClick={()=>setPlatform('ios')}>iPhone</button></div><img src={`/api/install-card?platform=${platform}`} alt={platform==='android'?'Android: abre el enlace en Chrome, menú de tres puntos, Añadir a pantalla de inicio, Instalar. Abre el icono y activa los avisos.':'iPhone: abre el enlace en Safari, Compartir, Añadir a pantalla de inicio, Añadir. Abre el icono y activa los avisos.'} width={900} height={1200} /><a className="text-link" href={`/api/install-card?platform=${platform}`} download={`instalar-barberqueue-${platform}.png`}>Guardar instrucciones</a></section>;
}
export function ShareQueue({shopId,name}:{shopId:string;name:string}) {
  const [platform,setPlatform]=useState('both');
  const [file,setFile]=useState<File|null>(null);
  const [message,setMessage]=useState('');
  const [url,setUrl]=useState('');
  useEffect(()=>{const target=new URL('/',location.origin);target.searchParams.set('barber',shopId);setUrl(target.toString());},[shopId]);
  useEffect(()=>{let active=true;setFile(null);void fetch(`/api/install-card?platform=${platform}`).then(r=>{if(!r.ok)throw new Error();return r.blob();}).then(blob=>{if(active)setFile(new File([blob],`instalar-barberqueue-${platform}.png`,{type:'image/png'}));}).catch(()=>{if(active)setMessage('Puedes copiar el enlace y guardar la guía por separado.');});return()=>{active=false;};},[platform]);
  async function share(){
    setMessage('');
    try{
      const text=`Toma tu turno con ${name}. Instala la app y activa los avisos. ${url}`;
      if(file && navigator.canShare?.({files:[file]}) && navigator.share) await navigator.share({title:`Tu turno con ${name}`,text,files:[file]});
      else if(navigator.share){await navigator.share({title:`Tu turno con ${name}`,text});setMessage('El enlace se compartió. Guarda la imagen para enviarla también.');}
      else {await navigator.clipboard.writeText(text);setMessage('Enlace copiado. Pégalo en el chat y adjunta la imagen descargada.');}
    }catch(error){if((error as Error).name!=='AbortError')setMessage('No se pudo compartir. Copia el enlace y guarda la imagen.');}
  }
  return <section className="share-guide"><h2>Comparte tu fila</h2><p>Envía tu enlace y las instrucciones de instalación a tus contactos.</p><label htmlFor="share-platform">Guía para compartir</label><select id="share-platform" value={platform} onChange={e=>setPlatform(e.target.value)}><option value="both">Android y iPhone</option><option value="android">Android</option><option value="ios">iPhone</option></select><div className="share-row"><button className="button primary" onClick={()=>void share()} disabled={!url||!file}>Compartir enlace e imagen</button><a className="button secondary" href={`/api/install-card?platform=${platform}`} download={`instalar-barberqueue-${platform}.png`}>Guardar imagen</a><button className="text-link" onClick={()=>void navigator.clipboard.writeText(url).then(()=>setMessage('Enlace copiado.')).catch(()=>setMessage('Selecciona el enlace de abajo y cópialo.'))}>Copiar enlace</button></div><a href={url}>{url}</a><small>Elige tú la aplicación y los contactos. Algunas aplicaciones requieren adjuntar la imagen por separado.</small>{message&&<p role="status">{message}</p>}</section>;
}
