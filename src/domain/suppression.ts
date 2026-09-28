export type ConsentCommand = 'opt_out' | 'opt_in_claimed' | 'none';

const optOutCommands = new Set(['STOP', 'STOPALL', 'STOP ALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT']);
const optInClaims = new Set(['START', 'UNSTOP']);

export function classifyConsentCommand(body: string): ConsentCommand {
  const command = body.trim().replace(/\s+/g, ' ').toUpperCase();
  if (optOutCommands.has(command)) return 'opt_out';
  if (optInClaims.has(command)) return 'opt_in_claimed';
  return 'none';
}
