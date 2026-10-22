import type { BridgeConfig } from '../config/env.js';
import type { OperationalStore } from '../persistence/operational-store.js';
import type { TelnyxClient } from '../telnyx/client.js';
import type { BroadcastCampaign, BroadcastStore, ChatwootAudienceClient } from './types.js';

function delay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runBroadcastCampaign(
  campaign: BroadcastCampaign,
  deps: {
    config: BridgeConfig;
    store: BroadcastStore;
    audience: ChatwootAudienceClient;
    operationalStore: OperationalStore;
    telnyx: TelnyxClient;
  },
): Promise<void> {
  let sentCount = campaign.sentCount;
  let skippedCount = campaign.skippedCount;
  let failedCount = campaign.failedCount;
  const delayMs = deps.config.broadcast?.delayMs ?? 500;

  try {
    const phones = await deps.audience.listRecipientPhones({
      inboxId: campaign.inboxId,
      label: campaign.label,
    });
    if (phones.length === 0) {
      await deps.store.updateProgress(campaign.campaignId, {
        status: 'failed',
        lastError: 'no_recipients',
        completed: true,
      });
      return;
    }

    for (const phone of phones) {
      if (await deps.operationalStore.isSuppressed(phone)) {
        skippedCount += 1;
        continue;
      }
      const actionId = `broadcast-${campaign.campaignId}-${phone}`;
      if (!(await deps.operationalStore.claimOutboundAction(actionId))) {
        skippedCount += 1;
        continue;
      }

      if (deps.config.outbound.mode !== 'live') {
        await deps.operationalStore.completeOutboundAction(actionId, `fake-broadcast-${actionId}`);
        sentCount += 1;
        await delay(delayMs);
        continue;
      }

      try {
        const response = await deps.telnyx.sendSms({
          from: deps.config.telnyx.senderNumber,
          to: phone,
          text: campaign.message,
        });
        await deps.operationalStore.completeOutboundAction(actionId, response.id);
        sentCount += 1;
      } catch (error) {
        failedCount += 1;
        await deps.operationalStore.markOutboundUnknown(actionId);
        const message = error instanceof Error ? error.message : String(error);
        await deps.store.updateProgress(campaign.campaignId, { lastError: message.slice(0, 500) });
      }
      await delay(delayMs);
    }

    await deps.store.updateProgress(campaign.campaignId, {
      status: failedCount > 0 && sentCount === 0 ? 'failed' : 'completed',
      sentCount,
      skippedCount,
      failedCount,
      completed: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await deps.store.updateProgress(campaign.campaignId, {
      status: 'failed',
      lastError: message.slice(0, 500),
      sentCount,
      skippedCount,
      failedCount,
      completed: true,
    });
  }
}

export function startBroadcastScheduler(deps: {
  config: BridgeConfig;
  store: BroadcastStore;
  audience: ChatwootAudienceClient;
  operationalStore: OperationalStore;
  telnyx: TelnyxClient;
  intervalMs?: number;
}): { stop(): void } {
  if (!deps.config.broadcast?.enabled) return { stop() {} };
  const intervalMs = deps.intervalMs ?? 15_000;
  let timer: ReturnType<typeof setInterval> | undefined;
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      for (;;) {
        const campaign = await deps.store.claimDueCampaign();
        if (!campaign) break;
        await runBroadcastCampaign(campaign, deps);
      }
    } finally {
      running = false;
    }
  };

  timer = setInterval(() => { void tick(); }, intervalMs);
  void tick();

  return {
    stop() {
      if (timer) clearInterval(timer);
    },
  };
}
