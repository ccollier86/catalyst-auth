import type { CatalystError } from "../../types/domain-error.js";
import type { Result } from "../../types/result.js";
import type { AppendAuditEventInput, AuditEventRecord } from "../../types/audit.js";

export interface AuditLogPort {
  appendEvent(input: AppendAuditEventInput): Promise<Result<AuditEventRecord, CatalystError>>;
  listEvents(): Promise<Result<ReadonlyArray<AuditEventRecord>, CatalystError>>;
}
