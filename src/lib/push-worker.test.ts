import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({send:vi.fn(),rpc:vi.fn(),sub:vi.fn(),entry:vi.fn(),updates:vi.fn(),remove:vi.fn()}));
vi.mock('web-push',()=>({sendNotification:mocks.send}));
vi.mock('./supabase-admin',()=>({getSupabaseAdmin:()=>({rpc:mocks.rpc,from:(table:string)=>({
 select:()=>({eq:()=>({maybeSingle:table==='push_subscriptions'?mocks.sub:mocks.entry})}),
 update:(value:unknown)=>({eq:()=>{mocks.updates(value);return Promise.resolve({error:null});}}),
 delete:()=>({eq:mocks.remove}),
})})}));
import {drainPushJobs} from './push-worker';
beforeEach(()=>{vi.clearAllMocks();vi.stubEnv('VAPID_PUBLIC_KEY','public');vi.stubEnv('VAPID_PRIVATE_KEY','private');mocks.rpc.mockResolvedValue({data:[{id:'job',subscription_id:'sub',entry_id:'entry',kind:'serving',title:'Jeury',body:'Tu turno',url:'/',attempts:1,expires_at:new Date(Date.now()+60000).toISOString()}]});mocks.sub.mockResolvedValue({data:{id:'sub',endpoint:'https://fcm.googleapis.com/test',p256dh:'key',auth:'key'}});mocks.entry.mockResolvedValue({data:{status:'serving'}});mocks.send.mockResolvedValue({statusCode:201});mocks.remove.mockResolvedValue({error:null});});
afterEach(()=>vi.unstubAllEnvs());
it('sends a private push and marks provider acceptance',async()=>{await drainPushJobs();expect(mocks.send).toHaveBeenCalledOnce();expect(mocks.updates).toHaveBeenCalledWith({status:'sent'});});
it('does not send obsolete chair notifications',async()=>{mocks.entry.mockResolvedValue({data:{status:'cancelled'}});await drainPushJobs();expect(mocks.send).not.toHaveBeenCalled();expect(mocks.updates).toHaveBeenCalledWith({status:'expired'});});
it('retries temporary failures without altering a turn',async()=>{mocks.send.mockRejectedValue({statusCode:503});await drainPushJobs();expect(mocks.updates).toHaveBeenCalledWith(expect.objectContaining({status:'pending'}));});
it('removes expired browser subscriptions',async()=>{mocks.send.mockRejectedValue({statusCode:410});await drainPushJobs();expect(mocks.remove).toHaveBeenCalledWith('id','sub');});
it('does not open duplicate drain loops',async()=>{await Promise.all([drainPushJobs(),drainPushJobs()]);expect(mocks.rpc).toHaveBeenCalledOnce();});
