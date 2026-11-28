import { z } from "zod";
import { PayloadValidationError } from "../domain/errors.ts";
import type { HttpClient, RequestOptions } from "./http-client.ts";

const RawPageArraySchema = z.array(z.unknown());

export type IssueStateFilter = "open" | "close" | "all";

export interface GitHubIssuesAdapterOptions {
  owner: string;
  repo: string;
  state?: IssueStateFilter;
  perPage?: number;
  maxPages?: number;
  token?: string;
}

export class GitHubIssuesAdapter {
  private readonly owner: string;
  private readonly repo: string;
  private readonly state: IssueStateFilter;
  private readonly perPage: number;
  private readonly maxPages: number;
  private readonly token: string | undefined;

  constructor(
    private readonly httpClient: HttpClient,
    options: GitHubIssuesAdapterOptions,
  ) {
    this.owner = options.owner;
    this.repo = options.repo;
    this.state = options.state ?? "all";
    this.perPage = options.perPage ?? 30;
    this.maxPages = options.maxPages ?? 10;
    this.token = options.token;
  }

  async fetchPage(page: number, requestOptions: RequestOptions = {}) {
    const params = new URLSearchParams({
      state: this.state,
      per_page: String(this.perPage),
      page: String(page),
    });

    const path = `/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}/issues?${params.toString()}`;

    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      ...requestOptions.headers,
    };

    if (this.token) {
      headers["Authorization"] = `Bearer ${this.token}`;
    }

    const rawPayload = await this.httpClient.getJson(path, {
      ...requestOptions,
      headers,
    });

    const parsedPage = RawPageArraySchema.safeParse(rawPayload);
    if (!parsedPage.success) {
      const issues = parsedPage.error.issues.map((issue) => issue.message);
      throw new PayloadValidationError(`page: ${page}`, issues);
    }

    return parsedPage.data;
  }

  async fetchAllRawIssues(requestOptions: RequestOptions = {}) {
    const collected: unknown[] = [];

    for (let page = 1; page <= this.maxPages; page++) {
      const pageItems = await this.fetchPage(page, requestOptions);
      collected.push(...pageItems);

      if (pageItems.length === 0 || pageItems.length < this.perPage) {
        break;
      }
    }

    return collected;
  }
}
