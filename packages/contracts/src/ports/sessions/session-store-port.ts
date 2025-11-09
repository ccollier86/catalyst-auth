export interface SessionRecord {
  readonly id: string;
  readonly userId: string;
  readonly createdAt: string;
  readonly lastSeenAt: string;
  readonly factorsVerified: ReadonlyArray<string>;
  readonly metadata?: Record<string, unknown>;
}

export interface SessionTouchUpdate {
  readonly lastSeenAt: string;
  readonly factorsVerified?: ReadonlyArray<string>;
  readonly metadata?: Record<string, unknown>;
}

export interface SessionStorePort {
  getSession(id: string): Promise<SessionRecord | undefined>;
  listSessionsByUser(userId: string): Promise<ReadonlyArray<SessionRecord>>;
  createSession(session: SessionRecord): Promise<SessionRecord>;
  touchSession(id: string, update: SessionTouchUpdate): Promise<SessionRecord>;
  deleteSession(id: string): Promise<void>;
}
