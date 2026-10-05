import type { AiConversationState, AiDecisionRecord } from '../../src/ai/types.js';
import type { OperationalStore, OutboundActionRecord, AiDecisionClaimInput, AiDecisionClaimResult, AiDecisionOutcome, AiReplyAttemptResult, OperationalEventProvider, OperationalEventStatus, AiDecisionUnknownReason } from '../../src/persistence/operational-store.js';

export class FakeOperationalStore implements OperationalStore {
  private static instances = new Map<string, FakeOperationalStore>();
  private events = new Map<string, OperationalEventStatus>(); private outbound = new Map<string, OutboundActionRecord>(); private suppressions = new Set<string>(); private conversations = new Map<number, string>(); private decisions = new Map<string, AiDecisionRecord>(); private history = new Set<number>(); private replies = new Map<string, number[]>(); private states = new Map<number, AiConversationState>();
  constructor(path = ':memory:') {
    const prior = path === ':memory:' ? undefined : FakeOperationalStore.instances.get(path);
    if (prior) {
      this.events = prior.events; this.outbound = prior.outbound; this.suppressions = prior.suppressions; this.conversations = prior.conversations; this.decisions = prior.decisions; this.history = prior.history; this.replies = prior.replies; this.states = prior.states;
    } else if (path !== ':memory:') FakeOperationalStore.instances.set(path, this);
  }
  close(): void {}
  claimEvent(p: OperationalEventProvider, id: string): boolean { const k=`${p}:${id}`; if(this.events.has(k)) return false; this.events.set(k,'processing'); return true; }
  getEventStatus(p: OperationalEventProvider,id:string): OperationalEventStatus|null { return this.events.get(`${p}:${id}`)??null; }
  setEventStatus(p:OperationalEventProvider,id:string,s:Exclude<OperationalEventStatus,'processing'>):void { this.events.set(`${p}:${id}`,s); }
  suppress(phone:string,_event:string):void { this.suppressions.add(phone); } isSuppressed(phone:string):boolean{return this.suppressions.has(phone);}
  bindConversation(id:number,phone:string):void{this.conversations.set(id,phone);} getPhoneForConversation(id:number):string|null{return this.conversations.get(id)??null;}
  claimOutboundAction(id:string):boolean{if(this.outbound.has(id))return false;this.outbound.set(id,{status:'submitting',telnyxMessageId:null});return true;} getOutboundAction(id:string):OutboundActionRecord|null{return this.outbound.get(id)??null;}
  completeOutboundAction(id:string,msg:string):void{this.outbound.set(id,{status:'sent',telnyxMessageId:msg});} markOutboundUnknown(id:string):void{this.outbound.set(id,{status:'unknown_needs_review',telnyxMessageId:null});}
  isAiHistoryMessage(id:number|string):boolean{return this.history.has(Number(id));} ensureAiActive(id:number):boolean{this.states.set(id,'ai_active');return true;}
  claimAiDecision(i:AiDecisionClaimInput):AiDecisionClaimResult{const old=this.decisions.get(i.inboundIdentity);if(old)return{claimed:false,decisionId:old.aiDecisionId,status:old.status};const now=new Date().toISOString();this.decisions.set(i.inboundIdentity,{...i,chatwootHistoryMessageId:null,telnyxActionId:null,telnyxMessageId:null,outcome:'provider_error',status:'claimed',state:'ai_active',model:null,createdAt:now,updatedAt:now,unknownReason:null});return{claimed:true,decisionId:i.aiDecisionId};}
  getAiDecision(id:string):AiDecisionRecord|null{for(const d of this.decisions.values())if(d.inboundIdentity===id||d.aiDecisionId===id)return d;return null;}
  setAiDecisionOutcome(id:string,o:AiDecisionOutcome):void{const d=this.getAiDecision(id);if(d){Object.assign(d,o);this.states.set(d.conversationId,o.state);}}
  recordAiHistoryMessage(id:string,m:number):void{const d=this.getAiDecision(id);if(d){d.chatwootHistoryMessageId=m;d.status='history_completed';this.history.add(m);}}
  markAiDecisionUnknown(id:string,r:AiDecisionUnknownReason):void{const d=this.getAiDecision(id);if(d){d.status='unknown_needs_review';d.unknownReason=r;}}
  recordAiTelnyxSubmission(id:string,a:string,m:string):void{const d=this.getAiDecision(id);if(d){d.telnyxActionId=a;d.telnyxMessageId=m;d.status='completed';}}
  countAiRepliesSince(p:string,c:number):number{return(this.replies.get(p)??[]).filter(x=>x>=c).length;} getLastAiReplyAt(p:string):number|null{const x=this.replies.get(p)??[];return x.length?x[x.length-1]!:null;}
  recordAiReply(p:string,_d:string,t:number):void{this.replies.set(p,[...(this.replies.get(p)??[]),t]);}
  claimAiReplyAttempt(p:string,d:string,n:number,b:number,l:number,w:number):AiReplyAttemptResult{if(this.isSuppressed(p))return{allowed:false,reason:'suppressed'};const last=this.getLastAiReplyAt(p);if(last!==null&&n-last<b)return{allowed:false,reason:'debounced',retryAt:last+b};if(this.countAiRepliesSince(p,n-w)>=l)return{allowed:false,reason:'quota_exhausted'};this.recordAiReply(p,d,n);return{allowed:true};}
  transitionToHumanActive(conversationId:number,_messageId:string):void{this.states.set(conversationId,'human_active');}
}
