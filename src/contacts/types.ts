export type JamaContactRow = {
  contactId: number;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phoneE164: string;
  updatedAt: Date;
};

export type ChatwootCrmContactPayload = {
  phone: string;
  name: string;
  identifier: string;
  email?: string;
};
