export interface AuditActorDescriptor {
  readonly type: string;
  readonly id: string;
  readonly labels?: Record<string, unknown>;
}

export interface AuditResourceDescriptor {
  readonly type: string;
  readonly id?: string;
  readonly labels?: Record<string, unknown>;
}

export interface AuditEventRecord {
  readonly id: string;
  readonly occurredAt: string;
  readonly category: string;
  readonly action: string;
  readonly actor?: AuditActorDescriptor;
  readonly subject?: AuditActorDescriptor;
  readonly resource?: AuditResourceDescriptor;
  readonly metadata?: Record<string, unknown>;
  readonly correlationId?: string;
}

export interface AppendAuditEventInput {
  readonly category: string;
  readonly action: string;
  readonly occurredAt?: string;
  readonly actor?: AuditActorDescriptor;
  readonly subject?: AuditActorDescriptor;
  readonly resource?: AuditResourceDescriptor;
  readonly metadata?: Record<string, unknown>;
  readonly correlationId?: string;
}
