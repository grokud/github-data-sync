import { SyncError } from "../domain/errors.ts";
import {
  extractCandidateId,
  NormalizedIssueSchema,
  type NormalizedIssue,
  type SyncErrorRecord,
  type SyncSummary,
} from "../domain/models.ts";
import type { GitHubIssuesAdapter } from "../infrastructure/api-adapter.ts";
import type { RequestOptions } from "../infrastructure/http-client.ts";

export interface SyncServiceOptions {
  nowFn?: () => Date;
  onNormalizedBatch?: (
    issues: readonly NormalizedIssue[],
  ) => Promise<void> | void;
}

export class SyncService {
  private readonly nowFn: () => Date;
  private readonly onNormailzedBatch:
    ((issues: readonly NormalizedIssue[]) => Promise<void> | void) | undefined;

  constructor(
    private readonly adapter: GitHubIssuesAdapter,
    options: SyncServiceOptions = {},
  ) {
    this.nowFn = options.nowFn ?? (() => new Date());
    this.onNormailzedBatch = options.onNormalizedBatch;
  }

  async runSync(requestOptions: RequestOptions = {}): Promise<SyncSummary> {
    const startedDate = this.nowFn();
    const startedMs = startedDate.getTime();
    const errors: SyncErrorRecord[] = [];
    const normalizedIssues: NormalizedIssue[] = [];

    let fetchedCount = 0;

    try {
      const rawItems = await this.adapter.fetchAllRawIssues(requestOptions);
      fetchedCount = rawItems.length;

      for (const rawItem of rawItems) {
        const result = NormalizedIssueSchema.safeParse(rawItem);

        if (result.success) {
          normalizedIssues.push(result.data);
          continue;
        }

        const recordId = extractCandidateId(rawItem);
        const issues = result.error.issues.map((issue) => {
          const pathLabel =
            issue.path.length > 0 ? issue.path.join(".") : "root";
          return `${pathLabel}: ${issue.message}`;
        });

        errors.push({
          recordId,
          code: "PAYLOAD_VALIDATION_ERROR",
          message: `Validation failed for record ${recordId ?? "unknown"}: ${issues.join("; ")}`,
        });
      }

      if (this.onNormailzedBatch && normalizedIssues.length > 0) {
        await this.onNormailzedBatch(normalizedIssues);
      }
    } catch (error: unknown) {
      const code =
        error instanceof SyncError ? error.code : "UNEXPECTED_SYNC_ERROR";
      const message =
        error instanceof Error
          ? error.message
          : "Unexpected failure during ingestion sync";

      errors.push({
        recordId: null,
        code,
        message,
      });
    }

    const completedDate = this.nowFn();
    const completedMs = completedDate.getTime();

    return {
      startedAt: startedDate.toISOString(),
      completedAt: completedDate.toISOString(),
      durationMs: Math.max(0, completedMs - startedMs),
      fetchedCount,
      succeededCount: normalizedIssues.length,
      failedCount: errors.length,
      errors,
    };
  }
}
