import {
  getConfig,
  isTrueString,
  UpdateDetection,
  validateFetchParameters,
  validateRenderOptions,
  type DirtyRenderOptions,
  type IssueFetchParameters,
} from "@config";
import { fuzzy } from "@util/string";
import { ONE_DAY } from "@util/date";
import { emitInfo } from "@util/log";

import { Memory } from "@transform/memory";
import { renderIssue, type RenderedIssue } from "@transform/render-objects";

import { type Comment } from "./comment";
import { CommentList } from "./comment-list";

import { IssueList } from "./issue-list";
import { mapFieldsToString } from "./fields";
import { type IssueFieldValue } from "./issue-fields";

import { type Project, type ProjectField } from "./project-fields";
import { ProjectView } from "./project-view";

import type { Timeframe } from "./update-detection";

import {
  getIssue,
  type GetIssueParameters,
  listCommentsForIssue,
  listProjectFieldsForIssue,
} from "./graphql";

import { SlackClient, slackLink, SLACK_FOOTER, SLACK_MUTE } from "@push/slack";
import { matchIssueUrl, scrapeUrls } from "@util/github-url";

type Parent = {
  title: string;
  url: string;
  number: number;
};
// Interface
export type Issue = {
  title: string;
  body: string;
  url: string;
  number: number;
  isOpen: boolean;
  createdAt: Date;
  updatedAt: Date;
  type: string;
  repository: {
    name: string;
    owner: string;
    nameWithOwner: string;
  };
  assignees: string[];
  labels: string[];
  comments?: Array<Comment>;
  parent?: Parent;
  project?: Project;
  issueFields?: Map<string, IssueFieldValue>;
  isSubissue?: boolean;
};

export class IssueWrapper {
  private memory = Memory.getInstance();

  private issue: Issue;
  private commentList: CommentList | undefined; // Cached property

  public subissues: IssueList | undefined;
  public relatedIssues: IssueList | undefined;

  constructor(issue: Issue) {
    this.issue = issue;
  }

  static async forIssue(
    params: GetIssueParameters,
    fetchParams: IssueFetchParameters,
  ): Promise<IssueWrapper> {
    // Create an IssueWrapper for a specific issue
    const issue = await getIssue(params);
    return new IssueWrapper(issue).fetch(fetchParams);
  }

  static async forUrl(
    url: string,
    fetchParams: IssueFetchParameters,
  ): Promise<IssueWrapper> {
    // Create an IssueWrapper for a specific issue URL
    const match = matchIssueUrl(url);
    if (!match) {
      throw new Error(`Invalid Issue URL: "${url}"`);
    }
    const { owner, repo, issueNumber } = match;
    if (!issueNumber) {
      throw new Error(`Issue URL is missing Issue number: "${url}"`);
    }
    return await IssueWrapper.forIssue(
      {
        organization: owner,
        repository: repo,
        issueNumber,
      },
      fetchParams,
    );
  }

  async fetch(params: IssueFetchParameters): Promise<IssueWrapper> {
    if (!this.issue.comments && params.comments > 0) {
      const timeframe = UpdateDetection.getInstance().timeframe;
      if (this.wasUpdatedWithinTimeframe(timeframe)) {
        await this.fetchComments(params.comments);
      }
    }
    if (params.projectFields && this.projectNumber) {
      await this.fetchProjectFields(this.projectNumber);
    }
    if (params.subissues) {
      await this.fetchSubissues(params);
    }
    if (params.followLinks) {
      // Follow links within the updates to find linked issues
      await this.followLinks(params);
    }
    return this;
  }

  // Properties
  get header(): string {
    return `[${this.title}](${this.url})`;
  }

  get title(): string {
    return this.issue.title.trim();
  }

  get _body(): string {
    return this.issue.body.trim();
  }

  get body(): void {
    this.remember({ body: true, updates: 0, subissues: false });
    // @ts-expect-error: Only call within templates
    return this._body;
  }

  get url(): string {
    return this.issue.url;
  }

  get number(): number {
    return this.issue.number;
  }

  get isOpen(): boolean {
    return this.issue.isOpen;
  }

  get isSubissue(): boolean {
    return this.issue.isSubissue || false;
  }

  get createdAt(): Date {
    return this.issue.createdAt;
  }

  get updatedAt(): Date {
    return this.issue.updatedAt;
  }

  get type(): string {
    if (this.isSubissue) {
      return "Subissue";
    }
    return this.issue.type;
  }

  // Repository
  get repo(): string {
    return this.issue.repository.name;
  }

  get repository(): string {
    return this.issue.repository.name;
  }

  // Organization
  get organization(): string {
    return this.issue.repository.owner;
  }

  get org(): string {
    return this.issue.repository.owner;
  }

  get owner(): string {
    return this.issue.repository.owner;
  }

  get repoNameWithOwner(): string {
    return this.issue.repository.nameWithOwner;
  }

  get assignees(): string[] {
    return this.issue.assignees.map((assignee) => assignee.trim());
  }

  get labels(): string[] {
    return this.issue.labels.map((label) => label.trim());
  }

  get parent(): Parent | undefined {
    if (!this.issue.parent) {
      return undefined;
    }
    return this.issue.parent;
  }

  // Comments
  get comments(): CommentList {
    if (!this.commentList) {
      const comments = this.issue.comments || [];
      this.commentList = new CommentList(this, comments);
    }
    return this.commentList;
  }

  set comments(comments: Comment[]) {
    this.issue.comments = comments;
    this.commentList = undefined; // Invalidate cache
  }

  // Fields
  field(fieldName: string): string {
    // Return the value of a field by name
    switch (fuzzy(fieldName)) {
      case fuzzy("title"):
        return this.title;
      case fuzzy("url"):
        return this.url;
      case fuzzy("number"):
        return String(this.number);
      case fuzzy("body"):
        return this.body as unknown as string; // Counts as a valid .body access
      case fuzzy("type"):
        return this.type;
      case fuzzy("repo"):
      case fuzzy("repository"):
        return this.repo;
      case fuzzy("org"):
      case fuzzy("organization"):
      case fuzzy("owner"):
        return this.owner;
      case fuzzy("full_name"):
      case fuzzy("name_with_owner"):
      case fuzzy("repo_name_with_owner"):
        return this.repoNameWithOwner;
      case fuzzy("parent"):
      case fuzzy("parent_issue"):
      case fuzzy("parent_title"):
        return this.parent?.title || "";
      case fuzzy("parent_url"):
        return this.parent?.url || "";
    }

    // TODO: Labels

    // Finally check ProjectFields / IssueFields
    const slug = ProjectView.slugifyFieldName(fieldName);
    const fieldValue =
      this.issueFields.get(slug) || this.projectFields.get(slug);

    // if (fieldValue === undefined) {
    //   emitWarning(
    //     `Found no value for field: "${fieldName}" on "${this.header}". If this is unexpected, double check the field name.`,
    //   );
    // }

    return fieldValue || "";
  }

  set project(project: Project) {
    this.issue.project = project;
  }

  get projectNumber(): number | undefined {
    return this.issue.project?.number;
  }

  get _projectFields(): Map<string, ProjectField> | undefined {
    // Raw Project Fields for internal use
    return this.issue.project?.fields;
  }

  get projectFields(): Map<string, string> {
    // Project Fields mapped to string representation for simple interface in the templates
    if (!this._projectFields) {
      return new Map();
    }

    // TODO: Memoize these mappings
    return mapFieldsToString(this._projectFields);
  }

  get _issueFields(): Map<string, IssueFieldValue> | undefined {
    return this.issue.issueFields;
  }

  get issueFields(): Map<string, string> {
    // Issue Fields mapped to string representation for simple interface in the templates
    if (!this._issueFields) {
      return new Map();
    }

    return mapFieldsToString(this._issueFields);
  }

  status(fieldName: string): string {
    // Return the status of the issue by fieldName
    const emojiOverride = getConfig("EMOJI_OVERRIDE");
    const update = this.comments.latestUpdate;
    if (emojiOverride && update) {
      // If EMOJI_OVERRIDE is set, check the body of an update for an emoji
      let emojiSections: string[];
      if (isTrueString(emojiOverride)) {
        emojiSections = []; // If just set to true, search entire body
      } else {
        // If set to a comma-separated list, search those sections
        emojiSections = emojiOverride.split(",").map((s) => s.trim());
      }
      const emoji = update.emojiStatus(emojiSections);
      if (emoji) {
        const field = this._projectFields?.get(fieldName);
        if (field && field.kind === "SingleSelect") {
          // Try to match to ProjectFieldValue for parity
          for (const option of field?.options || []) {
            if (option.includes(emoji)) {
              // Return first option with matching emoji - Small false positive risk
              return option;
            }
          }
        } else {
          return emoji;
        }
      }
    }
    const value = this.field(fieldName);
    if (!value) {
      return "No Status";
    }
    return value;
  }

  // Timeframe
  // TODO: Reuse functions from CommentWrapper
  wasPostedSince(daysAgo: number): boolean {
    return new Date().getTime() - this.createdAt.getTime() < daysAgo * ONE_DAY;
  }

  wasUpdatedSince(daysAgo: number): boolean {
    return new Date().getTime() - this.updatedAt.getTime() < daysAgo * ONE_DAY;
  }

  get wasPostedToday(): boolean {
    return this.wasPostedSince(1);
  }

  get wasPostedThisWeek(): boolean {
    return this.wasPostedSince(7);
  }

  get wasPostedThisMonth(): boolean {
    return this.wasPostedSince(31);
  }

  get wasPostedThisYear(): boolean {
    return this.wasPostedSince(365);
  }

  get wasUpdatedToday(): boolean {
    return this.wasUpdatedSince(1);
  }

  get wasUpdatedThisWeek(): boolean {
    return this.wasUpdatedSince(7);
  }

  get wasUpdatedThisMonth(): boolean {
    return this.wasUpdatedSince(31);
  }

  get wasUpdatedThisYear(): boolean {
    return this.wasUpdatedSince(365);
  }

  wasUpdatedWithinTimeframe(timeframe: Timeframe): boolean {
    // Check if the Issue was created within the given Timeframe
    switch (timeframe) {
      case "all-time":
        return true;
      case "today":
        return this.wasUpdatedToday;
      case "last-week":
        return this.wasUpdatedThisWeek;
      case "last-month":
        return this.wasUpdatedThisMonth;
      case "last-year":
        return this.wasUpdatedThisYear;
      default:
        throw new Error(
          `Invalid Timeframe for Issue filtering: "${timeframe}".`,
        );
    }
  }

  // Fetching
  // Should be called as late as possible, to avoid wasted queries
  private async fetchComments(numComments: number) {
    if (this.issue.comments) {
      return; // Already fetched, probably at the list level
    }
    this.issue.comments = await listCommentsForIssue({
      organization: this.organization,
      repository: this.repository,
      issueNumber: this.number,
      numComments,
    });
  }

  private async fetchProjectFields(projectNumber: number) {
    if (this.issue.project) {
      if (this.issue.project.number === projectNumber) {
        return; // Already fetched
      } else {
        throw new Error(
          `Issue is already associated with Project #${this.issue.project.number}, cannot fetch fields for Project #${projectNumber}.`,
        );
      }
    }

    this.issue.project = {
      organization: this.organization,
      number: projectNumber,
      fields: await listProjectFieldsForIssue({
        organization: this.organization,
        repository: this.repository,
        issueNumber: this.number,
        projectNumber,
      }),
    };
  }

  private async fetchSubissues(params: IssueFetchParameters) {
    const subissues = await IssueList.forSubissues(
      {
        organization: this.organization,
        repository: this.repository,
        issueNumber: this.number,
      },
      validateFetchParameters({
        ...params, // Inherit fetch params
        subissues: true,
      }),
    );
    if (this.projectNumber) {
      await subissues.fetchProjectFields(this.projectNumber);
    }
    this.subissues = subissues;
  }

  private async followLinks(params: IssueFetchParameters) {
    if (this.relatedIssues) {
      return; // Already fetched
    }

    const update = this.comments.latestUpdate?.update;

    if (update) {
      const issueUrls = scrapeUrls(update, ["issue"]);
      if (issueUrls.length === 0) {
        this.relatedIssues = IssueList.null();
        return;
      }

      this.relatedIssues = await IssueList.forUrls(issueUrls, {
        ...params,
        subissues: false, // Prevent loops
      });
    }
  }

  // Slack
  async dmAssignees(message: string): Promise<void> {
    const slack = new SlackClient();

    message = `Regarding the Issue ${slackLink(this.url, this.title)}:\n${message}\n_${SLACK_FOOTER}_`;

    if (this.assignees.length === 0) {
      return await slack.sendDm(undefined, message);
    }
    await Promise.all(
      this.assignees.map(async (assignee) => {
        emitInfo(
          `${SLACK_MUTE ? "[SLACK_MUTE=true]" : ""} 
          ${SLACK_MUTE ? "Skipping" : "Sending"} Slack DM to @${assignee} about Issue ${this.header}`,
        );
        return await slack.sendDm(assignee, message);
      }),
    );
  }

  // Render / Memory Functions
  private _render(options?: DirtyRenderOptions): RenderedIssue | undefined {
    return renderIssue(this, validateRenderOptions(options));
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
