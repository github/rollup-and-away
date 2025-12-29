import type {
  IssueRenderOptions,
  CommentRenderOptions,
  DiscussionRenderOptions,
} from "@transform/render-objects";

import { isTruthy } from "./truthy";

export type DirtyRenderOptions = {
  header?: unknown;
  body?: unknown;
  updates?: unknown;
  author?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
  field?: unknown;
  fields?: unknown;
  // TODO: Labels
  subissues?: unknown;
  relatedIssues?: unknown;
  skipIfEmpty?: unknown; // Skip rendering if no updates or body
  [invalidKey: string]: unknown; // Users can go ballistic, need to handle it
};

const validKeys = new Set([
  "header",
  "body",
  "updates",
  "author",
  "createdAt",
  "updatedAt",
  "field",
  "fields",
  "subissues",
  "skipIfEmpty",
]);

export function validateRenderOptions(
  options: DirtyRenderOptions = {},
): IssueRenderOptions & CommentRenderOptions & DiscussionRenderOptions {
  const invalidKeys = Object.keys(options).filter((key) => !validKeys.has(key));
  if (invalidKeys.length > 0) {
    throw new Error(
      `Invalid RenderOption${invalidKeys.length > 1 ? "s" : ""}: ${invalidKeys.join(", ")}`,
    );
  }

  if (options.field && options.fields) {
    throw new Error(
      'Cannot use both "field" and "fields" options. Use "fields" for multiple fields.',
    );
  }

  let header = true; // Default: render header
  if (options.header !== undefined) {
    header = isTruthy(options.header);
  }

  let body = false; // Default: skip body
  if (options.body !== undefined) {
    body = isTruthy(options.body);
  }

  let updates = 1; // Default: 1 update
  if (options.updates !== undefined) {
    updates = Number(options.updates);
    if (isNaN(updates)) {
      updates = Number(isTruthy(options.updates));
    } else if (updates < 0) {
      throw new Error(`Invalid updates option: ${updates}`);
    }
  }

  let author = true; // Default: render author
  if (options.author) {
    author = isTruthy(options.author);
  }

  let createdAt = false; // Default: skip createdAt
  if (options.createdAt) {
    createdAt = isTruthy(options.createdAt);
  }

  let updatedAt = false; // Default: skip updatedAt
  if (options.updatedAt) {
    updatedAt = isTruthy(options.updatedAt);
  }

  let fields: string[] = []; // Default: no fields
  if (options.field) {
    fields = [String(options.field)];
  } else if (options.fields) {
    fields = Array.isArray(options.fields)
      ? options.fields.map(String)
      : [String(options.fields)]; // Doesn't handle CSV
  }

  let subissues = undefined; // Default: render subissues if they exist
  if (options.subissues !== undefined) {
    subissues = isTruthy(options.subissues);
  }

  let relatedIssues = undefined; // Default: render related issues if they exist
  if (options.relatedIssues !== undefined) {
    relatedIssues = isTruthy(options.relatedIssues);
  }

  let skipIfEmpty = true; // Default: skip empty objects
  if (options.skipIfEmpty !== undefined) {
    skipIfEmpty = isTruthy(options.skipIfEmpty);
  }

  return {
    header,
    body,
    updates,
    author,
    createdAt,
    updatedAt,
    fields,
    subissues,
    relatedIssues,
    skipIfEmpty,
  };
}
