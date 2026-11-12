export type PushScope = { shopId:string; entryId?:string; token?:string };
export async function subscribeToPush(scope:PushScope, askPermission=true):Promise<void> {
  if(!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) throw new Error('Instala la app para activar los avisos. En iPhone necesitas iOS 16.4 o posterior.');
  // Request permission directly from the button gesture, before network awaits.
  const permission=askPermission?await Notification.requestPermission():Notification.permission;
  if(permission!=='granted') throw new Error('Permite las notificaciones en los ajustes del navegador.');
  const config=await fetch('/api/push',{cache:'no-store'}).then(r=>r.json());
  if(!config.enabled || !config.publicKey) throw new Error('Los avisos están pendientes de configuración. Puedes seguir la fila aquí.');
  const registration=await navigator.serviceWorker.register('/sw.js');
  await Promise.race([navigator.serviceWorker.ready,new Promise((_,reject)=>setTimeout(()=>reject(new Error('La app se está preparando. Intenta otra vez.')),10000))]);
  const key=Uint8Array.from(atob(config.publicKey.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
  const subscription=await registration.pushManager.getSubscription() ?? await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key});
  const response=await fetch('/api/push',{method:'POST',headers:{'Content-Type':'application/json','x-shop-id':scope.shopId},body:JSON.stringify({...scope,subscription:subscription.toJSON()})});
  const data=await response.json();
  if(!response.ok) throw new Error(data.error??'No se pudieron activar los avisos.');
}
