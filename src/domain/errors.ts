export abstract class SyncError extends Error {
    abstract readonly code: string;
    abstract readonly retryable: boolean;

    protected constructor(message: string) {
        super(message);
        this.name = new.target.name;
    }
}

export class RateLimitError extends SyncError {
    readonly code = "RATE_LIMIT_EXCEEDED";
    readonly retryable = true;

    constructor (
        public readonly retryAfterMs: number | null,
        message = "Upstream rate limit exceeded",
    ) {
            super(message);
        }
}

export class TransientNetworkError extends SyncError {
    readonly code = "TRANSIENT_NETWORK_ERROR";
    readonly retryable = true;

    constructor(
        public readonly status: number | null,
        message: string,
    ) {
        super(message);
    }
}

export class PayloadValidationError extends SyncError {
    readonly code = "PAYLOAD_VALIDATION_ERROR"; 
    readonly retryable = false;

    constructor(
        public readonly rawId: string | number | null,
        public readonly issues: readonly string[],
    ) {
        super(`validation failed for record ${rawId ?? "unknown"}: ${issues.join("; ")}`);
    }
}

export class NonRetryableHttpError extends SyncError {
    readonly code = "NON_RETRYABLE_HTTP_ERROR";
    readonly retryable = false;

    constructor(
        public readonly status: number,
        message: string,
    ) {
        super(message);
    }
} 

