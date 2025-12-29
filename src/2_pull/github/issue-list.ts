import {
  validateRenderOptions,
  type IssueFetchParameters,
  type DirtyRenderOptions,
  UpdateDetection,
} from "@config";
import { emojiCompare } from "@util/emoji";
import { emitWarning } from "@util/log";
import { title } from "@util/string";

import { Memory } from "@transform/memory";
import {
  renderIssueList,
  type RenderedIssueList,
} from "@transform/render-objects";
import { barChart } from "@transform/charts";

import { IssueWrapper, type Issue } from "./issue";
import { ProjectView } from "./project-view";

import {
  type GetIssueParameters,
  listIssuesForRepo,
  type ListIssuesForRepoParameters,
  listIssuesForProject,
  type ListIssuesForProjectParameters,
  listSubissuesForIssue,
  type ListSubissuesForIssueParameters,
  listCommentsForListOfIssues,
  listProjectFieldsForProject,
  getProjectView,
  type GetProjectViewParameters,
} from "./graphql";

type SourceOfTruth = {
  title: string;
  url: string;
  groupKey?: string; // When using a groupBy
};

export class IssueList {
  private memory = Memory.getInstance();

  private sourceOfTruth: SourceOfTruth;
  private issues: IssueWrapper[];

  public organization?: string; // All Issues from the same Org
  public projectNumber?: number; // All Issues from the same Project

  // Fetch State to prevent unnecessary requests
  private commentsFetched = false;
  private projectFieldsFetched = false;

  // Array-like Methods
  all(): IssueWrapper[] {
    return this.issues;
  }

  filter(predicate: (issue: IssueWrapper) => boolean): IssueWrapper[] {
    return this.issues.filter(predicate);
  }

  get length(): number {
    return this.issues.length;
  }

  get isEmpty(): boolean {
    return this.issues.length === 0;
  }

  [Symbol.iterator]() {
    return this.issues[Symbol.iterator]();
  }

  private find(params: GetIssueParameters): IssueWrapper | undefined {
    return this.issues.find(
      (issue) =>
        issue.organization === params.organization &&
        issue.repository === params.repository &&
        issue.number === params.issueNumber,
    );
  }

  copy(): IssueList {
    // Useful to perform multiple inline filters in templates
    const copy = new IssueList([], { ...this.sourceOfTruth });
    copy.issues = [...this.issues]; // Shallow copy the issues
    return copy;
  }

  // Properties
  get header(): string {
    return `[${this.sourceOfTruth.title}](${this.sourceOfTruth.url})`;
  }

  get title(): string {
    return this.sourceOfTruth.title;
  }

  get url(): string {
    return this.sourceOfTruth.url;
  }

  get groupKey(): string {
    if (!this.sourceOfTruth.groupKey) {
      throw new Error("Don't use groupKey without a groupBy.");
    }
    return this.sourceOfTruth.groupKey;
  }

  // Constructors
  private constructor(issues: Issue[], sourceOfTruth: SourceOfTruth) {
    this.sourceOfTruth = sourceOfTruth;
    this.issues = issues.map((issue) => new IssueWrapper(issue));
  }

  static null(): IssueList {
    return new IssueList([], { title: "No Issues", url: "" });
  }

  static async forRepo(
    params: ListIssuesForRepoParameters,
    fetchParams: IssueFetchParameters,
  ): Promise<IssueList> {
    const response = await listIssuesForRepo(params);
    const { issues, title, url } = response;

    const list = new IssueList(issues, { title, url });
    list.organization = params.organization;

    return await list.fetch(fetchParams);
  }

  static async forSubissues(
    params: ListSubissuesForIssueParameters,
    fetchParams: IssueFetchParameters,
  ): Promise<IssueList> {
    try {
      const response = await listSubissuesForIssue(params);
      const { subissues, title, url } = response;

      const list = new IssueList(subissues, { title, url });
      list.organization = params.organization;

      return await list.fetch(fetchParams);
    } catch (error: unknown) {
      // Sometimes the Subissues call fails
      emitWarning(
        `Could not fetch Subissues for ${JSON.stringify(params)}. Error: ${error}`,
      );
      return IssueList.null();
    }
  }

  static async forProject(
    params: ListIssuesForProjectParameters,
    fetchParams: IssueFetchParameters,
  ): Promise<IssueList> {
    const response = await listIssuesForProject(params);
    const { issues, title, url } = response;

    const list = new IssueList(issues, { title, url });

    // Set Project metavariables
    list.organization = params.organization;
    list.projectNumber = params.projectNumber;
    list.projectFieldsFetched = true;

    return await list.fetch(fetchParams);
  }

  static async forProjectView(
    params: GetProjectViewParameters,
    fetchParams: IssueFetchParameters,
  ): Promise<IssueList> {
    const response = await listIssuesForProject(params);
    const { issues, title, url } = response;

    const list = new IssueList(issues, { title, url });

    // Set Project metavariables
    list.organization = params.organization;
    list.projectNumber = params.projectNumber;
    list.projectFieldsFetched = true;

    let view: ProjectView;
    if (params.projectViewNumber === undefined) {
      if (params.customQuery === undefined) {
        throw new Error(
          "Either projectViewNumber or customQuery must be provided.",
        );
      }
      view = new ProjectView({
        projectNumber: params.projectNumber,
        filterQuery: params.customQuery,
      });
    } else {
      view = await getProjectView(params);
    }
    await list.applyViewFilter(view);

    return await list.fetch(fetchParams);
  }

  static async forUrls(
    urls: string[],
    params: IssueFetchParameters,
  ): Promise<IssueList> {
    const issues: IssueWrapper[] = [];
    for (const url of urls) {
      try {
        const issue = await IssueWrapper.forUrl(url, params);
        if (issue) {
          issues.push(issue);
        }
      } catch (error: unknown) {
        emitWarning(`Could not fetch Issue from URL ${url}: ${error}`);
      }
    }

    const list = new IssueList([], {
      title: `Issues from URLs`,
      url: `Multiple URLs`,
    });
    list.issues = issues;

    return await list.fetch(params);
  }

  // Fetching
  async fetch(params: IssueFetchParameters): Promise<IssueList> {
    if (params.projectFields && this.projectNumber) {
      await this.fetchProjectFields(this.projectNumber);
    }
    if (params.comments > 0) {
      await this.fetchComments(params.comments);
    }

    this.issues = this.filter(params.filter);

    for (const issue of this.issues) {
      await issue.fetch(params);
    }

    return this;
  }

  private async fetchComments(numComments: number) {
    if (this.commentsFetched) return;

    const timeframe = UpdateDetection.getInstance().timeframe;

    const commentsMap = await listCommentsForListOfIssues({
      issues: this.issues
        .filter((issue) => {
          // Exclude issues outside configured timeframe
          // TODO: Make this configurable with an environment variable
          return issue.wasUpdatedWithinTimeframe(timeframe);
        })
        .map((issue) => {
          return {
            organization: issue.organization,
            repository: issue.repository,
            issueNumber: issue.number,
          };
        }),
      numComments,
    });

    for (const [issueParams, comments] of commentsMap) {
      const issue = this.find(issueParams);
      if (issue !== undefined) {
        issue.comments = comments;
      } else {
        // This is good at catching race conditions, not much else
        throw new Error(
          `Fetching Comments for nonexistent Issue ${JSON.stringify(issueParams)}`,
        );
      }
    }

    this.commentsFetched = true;
  }

  async fetchProjectFields(projectNumber?: number) {
    if (this.projectFieldsFetched) return;

    if (!this.projectNumber && projectNumber) {
      // Project is somewhat mutable until >1 is supported per IssueList
      this.projectNumber = projectNumber;
    }

    if (!this.organization || !this.projectNumber) {
      throw new Error(
        "Cannot fetch Project Fields without a common organization and projectNumber.",
      );
    }

    // This function is memoized, only called once per Project
    const projectFieldItems = await listProjectFieldsForProject({
      organization: this.organization,
      projectNumber: this.projectNumber,
    });

    // Initialize Issues with empty ProjectFields first
    for (const issue of this.issues) {
      issue.project = {
        organization: this.organization,
        number: this.projectNumber,
        fields: new Map(),
      };
    }

    for (const item of projectFieldItems) {
      const issue = this.find(item.issueParams);
      if (issue !== undefined) {
        issue.project = {
          organization: this.organization,
          number: this.projectNumber,
          fields: item.fields,
        };
      }
    }

    this.projectFieldsFetched = true;
  }

  // Issue Transformations
  private async applyViewFilter(view: ProjectView): Promise<IssueList> {
    if (view.usesCustomFields) {
      // Make sure Fields are fetched so we can filter on them
      await this.fetchProjectFields(view.projectNumber);
    }

    // Scope the Source of Truth to the View
    if (view.number) {
      this.sourceOfTruth.url += `/views/${view.number}`;
    } else {
      this.sourceOfTruth.url += `?filterQuery=${encodeURIComponent(
        view.filterQuery,
      )}`;
    }
    if (view.name) {
      this.sourceOfTruth.title += ` (${view.name})`;
    }

    if (view.unsupportedFields.length > 0) {
      emitWarning(
        `View "${this.sourceOfTruth.url}" uses unsupported filters: ${view.unsupportedFields.join(", ")}.
        These fields will be ignored. Please contact the maintainer or open a "github/rollup-and-away" Issue to request for them to be implemented.`,
      );
    }

    // Filter the issues by the View's query
    this.issues = this.filter((issue) => view.filterIssue(issue));

    return this;
  }

  sort(fieldName: string, direction: "asc" | "desc" = "asc"): IssueList {
    // Sort the issues by the given fieldName and direction
    this.issues.sort((a, b): number => {
      const aValue = a.status(fieldName);
      const bValue = b.status(fieldName);

      const comparison =
        emojiCompare(aValue, bValue) || aValue.localeCompare(bValue);

      return direction === "asc" ? comparison : -comparison;
    });

    return this; // Allow method chaining
  }

  groupBy(fieldName: string): IssueList[] {
    // Group the issues by the given fieldName
    const groups = new Map<string, IssueList>();

    for (const issue of this.issues) {
      const key = issue.status(fieldName);
      if (!groups.has(key)) {
        groups.set(
          key,
          new IssueList([], {
            title: this.sourceOfTruth.title,
            url: this.sourceOfTruth.url,
            // This replicates the formatting of GitHub Project groupBy
            groupKey: key || "No " + title(fieldName),
          }),
        );
      }
      groups.get(key)!.issues.push(issue);
    }

    return Array.from(groups.entries())
      .sort(([a], [b]) => {
        // Sort alphabetically by groupKey
        return emojiCompare(a, b) ?? a.localeCompare(b);
      })
      .map(([, group]) => group);
  }

  status(fieldName: string): string | undefined {
    // Get the max status emoji from the Issues
    return this.issues
      .map((issue) => issue.status(fieldName) ?? "")
      .sort((a, b) => emojiCompare(a, b) ?? a.localeCompare(b))[0];
  }

  chart(fieldName: string, title?: string): string {
    // Groups by the given field name and a Markdown-embedded QuickChart
    const groups = this.groupBy(fieldName);
    if (groups.length === 0) {
      return "ERROR: No issues found. Cannot create chart.";
    }

    title = title || `Number of Issues by ${fieldName}`;

    // TODO: Support other chart types
    return barChart(
      new Map(groups.map((group) => [group.groupKey, group.length])),
      fieldName,
      title,
    );
  }

  // Updates
  get hasUpdates(): boolean {
    // Check if any Issue has an Update
    return this.issues.some((issue) => issue.comments.hasUpdate);
  }

  blame(strategiesBlob?: string | string[]): IssueList {
    const blameList = this.copy();
    blameList.issues = blameList.filter((issue) => {
      const updates = issue.comments.latestUpdates(1, strategiesBlob);
      return updates.length === 0; // Keep Issues with no Updates
    });
    blameList.sourceOfTruth.title += " - Stale Updates";
    return blameList;
  }

  // Slack
  async dmAssignees(message: string): Promise<void> {
    await Promise.all(this.issues.map((issue) => issue.dmAssignees(message)));
  }

  // Render / Memory Functions
  private _render(options?: DirtyRenderOptions): RenderedIssueList | undefined {
    return renderIssueList(this, validateRenderOptions(options));
  }

  remember(options?: DirtyRenderOptions) {
    const rendered = this._render(options);
    if (rendered) {
      this.memory.remember({
        content: rendered.markdown,
        sources: rendered.sources,
      });
    }
  }

  render(options?: DirtyRenderOptions): string {
    this.remember(options);
    const rendered = this._render(options);
    if (rendered) {
      return rendered.markdown;
    }
    return "";
  }
}
