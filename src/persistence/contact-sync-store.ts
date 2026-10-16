export type ContactSyncCursor = {
  updatedAt: Date;
  contactId: number;
};

export type ContactSyncRecord = {
  sourceContactId: number;
  chatwootContactId: number;
  contentHash: string;
  sourceUpdatedAt: Date;
};

export interface ContactSyncStore {
  initialize(): Promise<void>;
  getCursor(): Promise<ContactSyncCursor>;
  setCursor(cursor: ContactSyncCursor): Promise<void>;
  getRecord(sourceContactId: number): Promise<ContactSyncRecord | null>;
  saveRecord(record: ContactSyncRecord): Promise<void>;
}
