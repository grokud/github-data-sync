import { mkdir, writeFile } from "node:fs/promises";

const url = "https://api.github.com/repos/octocat/Hello-World/issues?per_page=5&state=all";

const response = await fetch(url, {
    headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "github-issue-sync-fixture-fetcher",
    },
});

if (!response.ok) {
    throw new Error(`GitHub API request failed with status ${response.status}`);
}

const rawData = await response.json();

if (!Array.isArray(rawData)) {
    throw new Error("Expected JSON array from issues endpoint");
}

const redacted = rawData.map((item) => {
    const record = 
        typeof item === "object" && item !== null 
            ? { ...item } 
            : {};
    const user = 
        typeof record.user === "object" && record.user !== null 
            ? {
                login: "[REDACTED_USER]",
                id: 0,
                type: record.user.type ?? "User",
            } : null;

    return {
        id: record.id,
        node_id: "[REDACTED_NODE_ID]",
        number: record.number,
        title: record.title,
        state: record.state,
        locked: record.locked,
        draft: record.draft,
        pull_request: record.pull_request ? { has_pr: true } : undefined,
        user,
        assignee: record.assignee ? { login: "[REDACTED_ASSIGNEE" } : null,
        assignees: Array.isArray(record.assignees)
            ? record.assignees.map(() => ({ login : "[REDACTED_ASSIGNEE]"}))
            : [],
        labels: Array.isArray(record.labels) 
            ? record.labels.map((label: unknown) => {
            typeof label === "object" && label !== null && "name" in label 
                ? { name: label.name }
                : {}
        })
            : [],
        comments: record.comments,
        created_at: record.created_at,
        updated_at: record.updated_at,
        closed_at: record.closed_at,
        body: typeof record.body === "string" 
            ? "[REDACTED_BODY]" 
            : null,
    };
});

await mkdir("tests/fixtures", { recursive: true });

await writeFile("tests/fixtures/github-issues-page-1.json", `${JSON.stringify(redacted, null, 2)}`, "utf-8");

console.log(`Saved ${redacted.length} redacted records to tests/fixtures/github-issues-page-1.json`);
