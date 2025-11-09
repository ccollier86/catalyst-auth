import type { CatalystError } from "../../types/domain-error.js";
import type { Result } from "../../types/result.js";
import type {
  IssueKeyInput,
  KeyOwnerReference,
  KeyRecord,
  KeyUsageOptions,
  ListKeysOptions,
  RevokeKeyInput,
} from "../../types/key.js";

export interface KeyStorePort {
  issueKey(input: IssueKeyInput): Promise<Result<KeyRecord, CatalystError>>;
  getKeyById(id: string): Promise<Result<KeyRecord | undefined, CatalystError>>;
  getKeyByHash(hash: string): Promise<Result<KeyRecord | undefined, CatalystError>>;
  listKeysByOwner(
    owner: KeyOwnerReference,
    options?: ListKeysOptions,
  ): Promise<Result<ReadonlyArray<KeyRecord>, CatalystError>>;
  recordKeyUsage(id: string, options?: KeyUsageOptions): Promise<Result<KeyRecord, CatalystError>>;
  revokeKey(id: string, input: RevokeKeyInput): Promise<Result<KeyRecord, CatalystError>>;
}
