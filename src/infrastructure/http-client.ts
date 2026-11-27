import {
    SyncError,
    RateLimitError,
    TransientNetworkError,
    NonRetryableHttpError
} from "../domain/errors.ts";


export type SleepFn = (ms: number) => Promise<void>;
export type RandomFn = () => number;


export interface HttpClientOptions {
    baseUrl?: string;
    defaultHeaders?: Readonly<Record<string, string>>;
    maxRetries?: number;
    baseDelayMs?: number;
    maxDelaysMs?: number;
    timeoutMs?: number;
    fetchFn?: typeof fetch;
    sleepFn?: SleepFn;
    randomFn?: RandomFn;
}

export interface RequestOptions {
    headers?: Readonly<Record<string, string>>;
    signal?: AbortSignal;
    timeoutMs?: number;
    maxRetries?: number;
}

const RETRYABLE_STATUS_CODES = new Set<number>([429, 500, 503, 504]);

const defaultSleep: SleepFn = (ms: number) => 
new Promise<void>((resolve) => {
    setTimeout(resolve, Math.max(0, ms));
});

export function parseRetryAfterMs(headerValue: string | null, nowMs = Date.now()) {
    if (!headerValue) {
        return null;
    }

    const trimmed = headerValue.trim();
    if (/^\d+$/.test(trimmed)) {
        const seconds = Number(trimmed);
        return Number.isFinite(seconds) ? Math.max(0, seconds * 1000) : null;
    }

    const parsedDateMs = Date.parse(trimmed);
    if (!Number.isNaN(parsedDateMs)) {
        return Math.max(0, parsedDateMs - nowMs);
    }

    return null;
}


export class HttpClient {
    private readonly baseUrl: string;
    private readonly defaultHeaders: Readonly<Record<string, string>>;
    private readonly maxRetries: number;
    private readonly baseDelayMs: number;
    private readonly maxDelayMs: number;
    private readonly timeoutMs: number;
    private readonly fetchFn: typeof fetch;
    private readonly sleepFn: SleepFn;
    private readonly randomFn: RandomFn;

    constructor(options: HttpClientOptions = {}) {
        this.baseUrl = options.baseUrl ?? "";
        this.defaultHeaders = options.defaultHeaders ?? {};
        this.maxRetries = options.maxRetries ?? 3;
        this.baseDelayMs = options.baseDelayMs ?? 250;
        this.maxDelayMs = options.maxDelaysMs ?? 10_000;
        this.timeoutMs = options.timeoutMs ?? 10_000;
        this.fetchFn = options.fetchFn ?? fetch;
        this.sleepFn = options.sleepFn ?? defaultSleep;
        this.randomFn = options.randomFn ?? Math.random;
    }

    private resolveUrl(pathOrUrl: string) {
        if (/^https?:\/\//i.test(pathOrUrl)) {
            return pathOrUrl;
        }

        const base= this.baseUrl.replace(/\/+$/, "");
        const path = pathOrUrl.replace(/^\/+/, "");

        return `${base}/${path}`;
    }

    private computeBackofMs(attempt: number) {
        const exponential = this.baseDelayMs * (2 ** attempt);
        const clamped = Math.min(exponential, this.maxDelayMs);
        const jitter = Math.floor(this.randomFn() * Math.min(250, clamped * 0.25));
        return clamped + jitter;
    }

    private isRetryableTransportError(error: unknown) {
        if (error instanceof TypeError) {
            return true;
        }

        if (error instanceof DOMException && error.name === "AbortError") {
            return true;
        }

        if (error instanceof Error && error.name === "AbortError") {
            return true;
        }

        return false;
    }

    async getJson(pathOrUrl: string, options: RequestOptions = {}) {
        const url = this.resolveUrl(pathOrUrl);
        const retriesAllowed = options.maxRetries ?? this.maxRetries;
        const effectiveTimeoutMs = options.timeoutMs ?? this.timeoutMs;

        let attempt = 0;

        while (true) {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => {
                controller.abort();
            }, effectiveTimeoutMs);

            const onExternalAbort = () => {
                controller.abort();
            };

            options.signal?.addEventListener("abort", onExternalAbort, { once: true });

            try {
                const response = await this.fetchFn(url, {
                    method: "GET",
                    headers: {
                        ...this.defaultHeaders,
                        ...options.headers,
                    },
                    signal: controller.signal,
                });

                clearTimeout(timeoutId);
                options.signal?.removeEventListener("abort", onExternalAbort);

                if (response.ok) {
                    const text = await response.text();
                    if (text.trim() === "") {
                        return null;
                    }

                    return JSON.parse(text);
                }

                if (response.status === 429) {
                    const retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"));
                    const rateLimitError = new RateLimitError(
                        retryAfterMs,
                        `Rate limited (${response.status}) when requesting ${url}`
                    );
                    if (attempt >= retriesAllowed) {
                        throw rateLimitError;
                    }

                    const delayMs = retryAfterMs ?? this.computeBackofMs(attempt);
                    await this.sleepFn(delayMs);
                    attempt += 1;
                    continue;
                }

                if (RETRYABLE_STATUS_CODES.has(response.status)) {
                    const transientError = new TransientNetworkError(
                        response.status,
                        `Transient HTTP ${response.status} when requesting ${url}`
                    );

                    if (attempt >= retriesAllowed){
                        throw transientError;
                    }

                    await this.sleepFn(this.computeBackofMs(attempt));
                    attempt += 1;
                    continue;
                }

                throw new NonRetryableHttpError(
                    response.status,
                    `Request faileed with non-retryable status ${response.status} for ${url}`
                );
                
            } catch (error) {
                clearTimeout(timeoutId);
                options.signal?.removeEventListener("abort", onExternalAbort); 

                if (error instanceof SyncError) {
                    throw new Error;
                }

                if (options.signal?.aborted) {
                    throw new NonRetryableHttpError(0, `Request aborted by caller for ${url}`);
                }

                if (this.isRetryableTransportError(error)) {
                    const message = error instanceof Error ? error.message : "Network request failed";
                    const transientError = new TransientNetworkError(null, message);

                    if (attempt >= retriesAllowed) {
                        throw transientError;
                    }

                    await this.sleepFn(this.computeBackofMs(attempt));
                    attempt += 1;
                    continue;
                }

                const message = error instanceof Error ? error.message : "Unexpected error";
                throw new NonRetryableHttpError(0, message);
            }
        }
    }
}









