import {z} from 'zod';
import {normalizePhone} from '@/lib/phone';
import {pairWhatsApp} from '@/lib/whatsapp-client';
import {body,handleError,json,limit,requireManager,ApiError} from '../../_shared';
export const runtime='nodejs';
export async function POST(request:Request){
 try{
  const {shopId}=await requireManager(request);
  limit(`pair:${shopId}`,3,300000);
  const input=z.object({phone:z.string().max(40)}).parse(await body(request));
  let phone:string;
  try {phone=normalizePhone(input.phone,'1');} catch {throw new ApiError(400,'Número inválido.');}
  try {return json({code:await pairWhatsApp(shopId,phone)});} catch(error){throw new ApiError(409,error instanceof Error?error.message:'No se pudo crear el código.');}
 }catch(error){return handleError(error);}
}
