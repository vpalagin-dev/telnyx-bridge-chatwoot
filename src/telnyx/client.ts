export type TelnyxSendInput = {
  from: string;
  to: string;
  text: string;
};

export interface TelnyxClient {
  sendSms(input: TelnyxSendInput): Promise<{ id: string }>;
}
