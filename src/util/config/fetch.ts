// Fetch is finally happening
import { isTruthy } from "@config";

import type { IssueWrapper } from "@pull/github/issue";

// TODO: Positional and kwarg-based params
// kwargs need fuzzy matching
// e.g. issue_number -> `issueNumber`
//       org, owner -> `organization`
//       repo -> `repository`

export type IssueFetchParameters = {
  comments: number; // Number of Comments to Fetch (default 20)
  projectFields: boolean;
  issueFields: boolean;
  subissues: boolean;
  followLinks: boolean;
  filter: (issue: IssueWrapper) => boolean;
};

export type DirtyIssueFetchParameters = {
  comments?: unknown;
  projectFields?: unknown;
  issueFields?: unknown;
  subissues?: unknown;
  followLinks?: unknown;
  filter?: unknown;
  [invalidKey: string]: unknown;
};

const validKeys = new Set([
  "comments",
  "projectFields",
  "issueFields",
  "subissues",
  "followLinks",
  "filter",
]);

export function validateFetchParameters(
  params: DirtyIssueFetchParameters = {},
): IssueFetchParameters {
  const invalidKeys = Object.keys(params).filter((key) => !validKeys.has(key));
  if (invalidKeys.length > 0) {
    throw new Error(
      `Invalid FetchParameter${invalidKeys.length > 1 ? "s" : ""}: ${invalidKeys.join(", ")}`,
    );
  }

  let comments = 20;
  if (params?.comments !== undefined) {
    comments = Number(params.comments);
    if (isNaN(comments) || comments < 0) {
      throw new Error(
        `Invalid FetchParams value for "comments": ${params.comments}. Use a positive number. Default: 20.`,
      );
    }
  }

  let projectFields = false;
  if (params?.projectFields !== undefined) {
    projectFields = isTruthy(params.projectFields);
  }

  let issueFields = false;
  if (params?.issueFields !== undefined) {
    issueFields = isTruthy(params.issueFields);
  }

  let subissues = false;
  if (params?.subissues !== undefined) {
    subissues = isTruthy(params.subissues);
  }

  let followLinks = false;
  if (params?.followLinks !== undefined) {
    followLinks = isTruthy(params.followLinks);
  }

  let filter: (issue: IssueWrapper) => boolean = () => true;
  if (params?.filter !== undefined) {
    // Trust the user to provide a valid function (yikes emoji)
    filter = params.filter as (issue: IssueWrapper) => boolean;
  }

  return {
    comments,
    projectFields,
    issueFields,
    subissues,
    followLinks,
    filter,
  };
}
