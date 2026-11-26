import { z } from "zod";

const GitHubUserSchema = z.object({
    login: z.string().min(1),
});

const GitHubLabelSchema = z.object({
    name: z.string().min(1),
});

export const ExternalGitHubIssueSchema = z.object({
    id: z.number().int().positive(),
    number: z.number().int().positive(),
    title: z.string().trim().min(1),
    state: z.enum(["open", "closed"]),
    pull_request: z.record(z.string(), z.unknown()).optional(),
    user: GitHubUserSchema.nullable(),
    labels: z.array(GitHubLabelSchema).default([]),
    created_at: z.iso.datetime(),
    updated_at: z.iso.datetime(),
    closed_at: z.iso.datetime().nullable(),
});

export interface NormalizedIssue {
    externalId: string;
    issueNumber: number;
    title: string;
    isOpen: boolean;
    isPullRequest: boolean;
    author: string;
    labels: readonly string[];
    createdAt: Date;
    updatedAt: Date;
    closedAt: Date | null;
}

export const NormalizedIssueSchema = ExternalGitHubIssueSchema.transform(
    (raw): NormalizedIssue => ({
        externalId: String(raw.id),
        issueNumber: raw.number,
        title: raw.title,
        isOpen: raw.state === "open",
        isPullRequest: raw.pull_request !== undefined,
        author: raw.user?.login ?? "ghost",
        labels: raw.labels.map((label) => label.name),
        createdAt: new Date(raw.created_at),
        updatedAt: new Date(raw.updated_at),
        closedAt: raw.closed_at === null ? null : new Date(raw.closed_at)
    })
);

export interface SyncErrorRecord {
    recordId: string | number | null;
    code: string;
    message: string;
}

export interface SyncSummary {
    startedAt: string;
    completedAt: string;
    durationMs: number;
    fetchedCount: number;
    succeededCount: number;
    failedCount: number;
    errors: readonly SyncErrorRecord[];
}

export function extractCandidateId(input: unknown) {
    if (typeof input !== "object" || input === null) {
        return null;
    }

    if ("id" in input && (typeof input.id === "number" || typeof input.id === "string")) {
        return input.id;
    }

    if ("number" in input && typeof input.number === "number") {
        return input.number;
    }

    return null;
}
