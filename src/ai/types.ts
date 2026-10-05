export type AiConversationState = 'ai_active' | 'waiting_for_human' | 'human_active';
export type AiOutcome = 'answered' | 'fallback' | 'escalated' | 'disabled' | 'provider_error' | 'validation_error' | 'unknown_needs_review';
export type AiDecisionStatus = 'claimed' | 'history_pending' | 'history_completed' | 'telnyx_pending' | 'completed' | 'unknown_needs_review';
export type OpenAiRequest = { model:string; maxInputTokens:number; maxOutputTokens:number; systemInstruction:string; eventId:string; approvedContext:string; customerMessage:string; safeFallbackText:string };
export type OpenAiDecision = { kind:'answer'; text:string } | { kind:'fallback'; text:string; escalate:true } | { kind:'error'; reason:'timeout'|'provider_error'|'malformed' };
export interface OpenAiAdapter { generate(request:OpenAiRequest):Promise<OpenAiDecision> }
export type AiHistoryMetadata = { ai_generated:true; ai_decision_id:string; event_id:string; outcome:Extract<AiOutcome,'answered'|'fallback'|'escalated'> };
export type ChatwootAiHistoryMessage = { id:number };
export interface ChatwootAiHistoryWriter { createAiHistoryMessage(conversationId:number,text:string,metadata:AiHistoryMetadata):Promise<ChatwootAiHistoryMessage> }
export type AiTelnyxDispatchInput = { from:string; to:string; text:string; aiDecisionId:string };
export type AiTelnyxDispatchResult = { actionId:string; telnyxMessageId:string; mode:'fake'|'live' };
export interface AiTelnyxDispatcher { submit(input:AiTelnyxDispatchInput):Promise<AiTelnyxDispatchResult> }
export type PostInboundAiInput = { inboundIdentity:string; telnyxEventId:string; telnyxMessageId:string; conversationId:number; inboundMessageId:number; recipient:string; customerMessage:string };
export type AiProcessResult = { outcome:AiOutcome|'duplicate'|'suppressed'|'human_active'|'waiting_for_human'|'unknown_needs_review'|'blocked'; aiDecisionId:string; state:AiConversationState };
export type AiDecisionRecord = { inboundIdentity:string; conversationId:number; inboundMessageId:number; eventId:string; aiDecisionId:string; chatwootHistoryMessageId:number|null; telnyxActionId:string|null; telnyxMessageId:string|null; outcome:AiOutcome; status:AiDecisionStatus; state:AiConversationState; model:string|null; createdAt:string; updatedAt:string; unknownReason:string|null };
