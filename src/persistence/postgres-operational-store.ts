import { Pool, type PoolClient } from 'pg';
import type { AiConversationState, AiDecisionRecord, AiDecisionStatus } from '../ai/types.js';
import type {
  AiDecisionClaimInput, AiDecisionClaimResult, AiDecisionOutcome, AiDecisionUnknownReason,
  AiReplyAttemptResult, OperationalEventProvider, OperationalEventStatus, OperationalStore,
  OutboundActionRecord,
} from './operational-store.js';
import { BRIDGE_SCHEMA, POSTGRES_SCHEMA_SQL } from './schema.js';

export class PostgresOperationalStore implements OperationalStore {
  readonly #pool: Pool;
  constructor(databaseUrl: string, pool = new Pool({ connectionString: databaseUrl })) { this.#pool = pool; }
  async initialize(): Promise<void> { await this.#pool.query(POSTGRES_SCHEMA_SQL); }
  async close(): Promise<void> { await this.#pool.end(); }

  async claimEvent(provider: OperationalEventProvider, eventId: string): Promise<boolean> {
    const r = await this.#pool.query(`INSERT INTO ${BRIDGE_SCHEMA}.processed_events(provider,event_id) VALUES($1,$2) ON CONFLICT DO NOTHING`, [provider,eventId]);
    return r.rowCount === 1;
  }
  async getEventStatus(provider: OperationalEventProvider, eventId: string): Promise<OperationalEventStatus | null> {
    const r = await this.#pool.query<{status: OperationalEventStatus}>(`SELECT status FROM ${BRIDGE_SCHEMA}.processed_events WHERE provider=$1 AND event_id=$2`,[provider,eventId]);
    return r.rows[0]?.status ?? null;
  }
  async setEventStatus(provider: OperationalEventProvider,eventId:string,status: Exclude<OperationalEventStatus,'processing'>): Promise<void> {
    const r = await this.#pool.query(`UPDATE ${BRIDGE_SCHEMA}.processed_events SET status=$3 WHERE provider=$1 AND event_id=$2`,[provider,eventId,status]);
    if (r.rowCount !== 1) throw new Error(`Event ${provider}/${eventId} not found`);
  }

  async suppress(phone:string,sourceEventId:string): Promise<void> { await this.#pool.query(`INSERT INTO ${BRIDGE_SCHEMA}.suppressions(phone,source_event_id) VALUES($1,$2) ON CONFLICT(phone) DO UPDATE SET source_event_id=EXCLUDED.source_event_id,suppressed_at=now()`,[phone,sourceEventId]); }
  async isSuppressed(phone:string): Promise<boolean> { const r=await this.#pool.query(`SELECT 1 FROM ${BRIDGE_SCHEMA}.suppressions WHERE phone=$1`,[phone]); return r.rowCount === 1; }
  async bindConversation(conversationId:number,phone:string): Promise<void> { await this.#pool.query(`INSERT INTO ${BRIDGE_SCHEMA}.conversation_bindings(conversation_id,phone) VALUES($1,$2) ON CONFLICT(conversation_id) DO UPDATE SET phone=EXCLUDED.phone,bound_at=now()`,[conversationId,phone]); }
  async getPhoneForConversation(conversationId:number): Promise<string|null> { const r=await this.#pool.query<{phone:string}>(`SELECT phone FROM ${BRIDGE_SCHEMA}.conversation_bindings WHERE conversation_id=$1`,[conversationId]); return r.rows[0]?.phone ?? null; }

  async claimOutboundAction(actionId:string): Promise<boolean> { const r=await this.#pool.query(`INSERT INTO ${BRIDGE_SCHEMA}.outbound_actions(action_id) VALUES($1) ON CONFLICT DO NOTHING`,[actionId]); return r.rowCount === 1; }
  async getOutboundAction(actionId:string): Promise<OutboundActionRecord|null> { const r=await this.#pool.query<{status:OutboundActionRecord['status'];telnyx_message_id:string|null}>(`SELECT status,telnyx_message_id FROM ${BRIDGE_SCHEMA}.outbound_actions WHERE action_id=$1`,[actionId]); const x=r.rows[0]; return x?{status:x.status,telnyxMessageId:x.telnyx_message_id}:null; }
  async completeOutboundAction(actionId:string,telnyxMessageId:string): Promise<void> { const r=await this.#pool.query(`UPDATE ${BRIDGE_SCHEMA}.outbound_actions SET status='sent',telnyx_message_id=$2 WHERE action_id=$1 AND status='submitting'`,[actionId,telnyxMessageId]); if(r.rowCount!==1) throw new Error(`Outbound action ${actionId} is not submitting`); }
  async markOutboundUnknown(actionId:string): Promise<void> { const r=await this.#pool.query(`UPDATE ${BRIDGE_SCHEMA}.outbound_actions SET status='unknown_needs_review' WHERE action_id=$1 AND status='submitting'`,[actionId]); if(r.rowCount!==1) throw new Error(`Outbound action ${actionId} is not submitting`); }

  async isAiHistoryMessage(messageId:number|string): Promise<boolean> { const r=await this.#pool.query(`SELECT 1 FROM ${BRIDGE_SCHEMA}.ai_decisions WHERE chatwoot_history_message_id=$1`,[Number(messageId)]); return r.rowCount===1; }
  async ensureAiActive(conversationId:number): Promise<boolean> { const r=await this.#pool.query(`INSERT INTO ${BRIDGE_SCHEMA}.ai_conversation_state(conversation_id,state) VALUES($1,'ai_active') ON CONFLICT(conversation_id) DO UPDATE SET state='ai_active',updated_at=now() WHERE ${BRIDGE_SCHEMA}.ai_conversation_state.state <> 'human_active'`,[conversationId]); return r.rowCount===1; }
  async claimAiDecision(input:AiDecisionClaimInput): Promise<AiDecisionClaimResult> {
    const r=await this.#pool.query(`INSERT INTO ${BRIDGE_SCHEMA}.ai_decisions(inbound_identity,conversation_id,inbound_message_id,event_id,ai_decision_id,outcome,status,state) VALUES($1,$2,$3,$4,$5,'provider_error','claimed','ai_active') ON CONFLICT(inbound_identity) DO NOTHING RETURNING ai_decision_id`,[input.inboundIdentity,input.conversationId,input.inboundMessageId,input.eventId,input.aiDecisionId]);
    if(r.rowCount===1) return {claimed:true,decisionId:input.aiDecisionId};
    const x=await this.#pool.query<{ai_decision_id:string;status:AiDecisionStatus}>(`SELECT ai_decision_id,status FROM ${BRIDGE_SCHEMA}.ai_decisions WHERE inbound_identity=$1`,[input.inboundIdentity]);
    if(!x.rows[0]) throw new Error('AI decision claim disappeared'); return {claimed:false,decisionId:x.rows[0].ai_decision_id,status:x.rows[0].status};
  }
  async getAiDecision(identityOrDecisionId:string): Promise<AiDecisionRecord|null> { const r=await this.#pool.query<AiDecisionRow>(`SELECT * FROM ${BRIDGE_SCHEMA}.ai_decisions WHERE inbound_identity=$1 OR ai_decision_id=$1 LIMIT 1`,[identityOrDecisionId]); return r.rows[0]?mapDecision(r.rows[0]):null; }
  async setAiDecisionOutcome(decisionId:string,outcome:AiDecisionOutcome):Promise<void> { const r=await this.#pool.query(`UPDATE ${BRIDGE_SCHEMA}.ai_decisions SET outcome=$2,status=$3,state=$4,updated_at=now() WHERE ai_decision_id=$1`,[decisionId,outcome.outcome,outcome.status,outcome.state]); if(r.rowCount!==1) throw new Error(`AI decision ${decisionId} not found`); }
  async recordAiHistoryMessage(decisionId:string,messageId:number):Promise<void> { const r=await this.#pool.query(`UPDATE ${BRIDGE_SCHEMA}.ai_decisions SET chatwoot_history_message_id=$2,status='history_completed',updated_at=now() WHERE ai_decision_id=$1`,[decisionId,messageId]); if(r.rowCount!==1) throw new Error(`AI decision ${decisionId} not found`); }
  async markAiDecisionUnknown(decisionId:string,reason:AiDecisionUnknownReason):Promise<void> { const r=await this.#pool.query(`UPDATE ${BRIDGE_SCHEMA}.ai_decisions SET status='unknown_needs_review',unknown_reason=$2,updated_at=now() WHERE ai_decision_id=$1`,[decisionId,reason]); if(r.rowCount!==1) throw new Error(`AI decision ${decisionId} not found`); }
  async recordAiTelnyxSubmission(decisionId:string,actionId:string,telnyxMessageId:string):Promise<void> { const r=await this.#pool.query(`UPDATE ${BRIDGE_SCHEMA}.ai_decisions SET telnyx_action_id=$2,telnyx_message_id=$3,status='completed',updated_at=now() WHERE ai_decision_id=$1`,[decisionId,actionId,telnyxMessageId]); if(r.rowCount!==1) throw new Error(`AI decision ${decisionId} not found`); }

  async countAiRepliesSince(phone:string,cutoff:number):Promise<number> { const r=await this.#pool.query<{count:string}>(`SELECT count(*)::text AS count FROM ${BRIDGE_SCHEMA}.ai_reply_sends WHERE phone=$1 AND sent_at >= $2`,[phone,cutoff]); return Number(r.rows[0]?.count ?? 0); }
  async getLastAiReplyAt(phone:string):Promise<number|null> { const r=await this.#pool.query<{sent_at:string}>(`SELECT sent_at::text FROM ${BRIDGE_SCHEMA}.ai_reply_sends WHERE phone=$1 ORDER BY sent_at DESC LIMIT 1`,[phone]); return r.rows[0]?Number(r.rows[0].sent_at):null; }
  async recordAiReply(phone:string,decisionId:string,sentAt:number):Promise<void> { await this.#pool.query(`INSERT INTO ${BRIDGE_SCHEMA}.ai_reply_sends(phone,ai_decision_id,sent_at) VALUES($1,$2,$3) ON CONFLICT(ai_decision_id) DO NOTHING`,[phone,decisionId,sentAt]); }
  async claimAiReplyAttempt(phone:string,decisionId:string,now:number,debounceMs:number,limit:number,windowMs:number):Promise<AiReplyAttemptResult> {
    return this.#transaction(async c=>{ await c.query(`SELECT pg_advisory_xact_lock(hashtext($1))`,[phone]);
      const suppressed=await c.query(`SELECT 1 FROM ${BRIDGE_SCHEMA}.suppressions WHERE phone=$1`,[phone]); if(suppressed.rowCount) return {allowed:false,reason:'suppressed'};
      const last=await c.query<{sent_at:string}>(`SELECT sent_at::text FROM ${BRIDGE_SCHEMA}.ai_reply_sends WHERE phone=$1 ORDER BY sent_at DESC LIMIT 1`,[phone]); const lastAt=last.rows[0]?Number(last.rows[0].sent_at):null;
      if(lastAt!==null && now-lastAt<debounceMs) return {allowed:false,reason:'debounced',retryAt:lastAt+debounceMs};
      const count=await c.query<{count:string}>(`SELECT count(*)::text AS count FROM ${BRIDGE_SCHEMA}.ai_reply_sends WHERE phone=$1 AND sent_at >= $2`,[phone,now-windowMs]); if(Number(count.rows[0]?.count??0)>=limit) return {allowed:false,reason:'quota_exhausted'};
      await c.query(`INSERT INTO ${BRIDGE_SCHEMA}.ai_reply_sends(phone,ai_decision_id,sent_at) VALUES($1,$2,$3) ON CONFLICT(ai_decision_id) DO NOTHING`,[phone,decisionId,now]); return {allowed:true};
    });
  }
  async #transaction<T>(fn:(c:PoolClient)=>Promise<T>):Promise<T>{const c=await this.#pool.connect();try{await c.query('BEGIN');const x=await fn(c);await c.query('COMMIT');return x;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
}

type AiDecisionRow={inbound_identity:string;conversation_id:number;inbound_message_id:number;event_id:string;ai_decision_id:string;chatwoot_history_message_id:number|null;telnyx_action_id:string|null;telnyx_message_id:string|null;outcome:AiDecisionRecord['outcome'];status:AiDecisionStatus;state:AiConversationState;model:string|null;created_at:Date;updated_at:Date;unknown_reason:string|null};
function mapDecision(r:AiDecisionRow):AiDecisionRecord{return {inboundIdentity:r.inbound_identity,conversationId:Number(r.conversation_id),inboundMessageId:Number(r.inbound_message_id),eventId:r.event_id,aiDecisionId:r.ai_decision_id,chatwootHistoryMessageId:r.chatwoot_history_message_id,telnyxActionId:r.telnyx_action_id,telnyxMessageId:r.telnyx_message_id,outcome:r.outcome,status:r.status,state:r.state,model:r.model,createdAt:r.created_at.toISOString(),updatedAt:r.updated_at.toISOString(),unknownReason:r.unknown_reason};}

void (null as unknown as OperationalStore);
