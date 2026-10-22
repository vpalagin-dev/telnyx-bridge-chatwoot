import type { BridgeConfig } from '../config/env.js';
import type { OperationalStore } from '../persistence/operational-store.js';
import type { TelnyxClient } from '../telnyx/client.js';
import type {
  AiTelnyxDispatcher,
  AiTelnyxDispatchInput,
  AiTelnyxDispatchResult,
} from './types.js';

export class FakeAiTelnyxDispatcher implements AiTelnyxDispatcher {
  calls: AiTelnyxDispatchInput[] = [];

  async submit(input: AiTelnyxDispatchInput): Promise<AiTelnyxDispatchResult> {
    this.calls.push(input);
    return {
      actionId: `ai-${input.aiDecisionId}`,
      telnyxMessageId: `fake-ai-${input.aiDecisionId}`,
      mode: 'fake',
    };
  }
}

function recipientAllowed(cfg: BridgeConfig, to: string): boolean {
  const allowlist = cfg.aiOutbound?.recipientAllowlist ?? [];
  if (allowlist.length === 0) return true;
  return allowlist.includes(to);
}

export class LiveAiTelnyxDispatcher implements AiTelnyxDispatcher {
  constructor(
    private readonly client: TelnyxClient,
    private readonly cfg: BridgeConfig,
    private readonly store: OperationalStore,
  ) {}

  async submit(input: AiTelnyxDispatchInput): Promise<AiTelnyxDispatchResult> {
    if (!this.cfg.aiOutbound?.liveSmsApproved) {
      throw new Error('AI live SMS gate: AI_LIVE_SMS_APPROVED is false');
    }
    if (this.cfg.outbound.mode !== 'live') {
      throw new Error('AI live SMS gate: OUTBOUND_MODE is not live');
    }
    if (!recipientAllowed(this.cfg, input.to)) {
      throw new Error('AI live SMS gate: recipient not on AI_LIVE_RECIPIENT_ALLOWLIST');
    }
    const actionId = `ai-${input.aiDecisionId}`;
    if (!(await this.store.claimOutboundAction(actionId))) {
      throw new Error('AI live SMS gate: outbound action already claimed');
    }
    try {
      const response = await this.client.sendSms({ from: input.from, to: input.to, text: input.text });
      await this.store.completeOutboundAction(actionId, response.id);
      return { actionId, telnyxMessageId: response.id, mode: 'live' as const };
    } catch (error) {
      await this.store.markOutboundUnknown(actionId);
      throw error;
    }
  }
}

export function createAiTelnyxDispatcher(
  cfg: BridgeConfig,
  telnyx: TelnyxClient,
  store: OperationalStore,
): AiTelnyxDispatcher {
  return cfg.outbound.mode === 'fake'
    ? new FakeAiTelnyxDispatcher()
    : new LiveAiTelnyxDispatcher(telnyx, cfg, store);
}
