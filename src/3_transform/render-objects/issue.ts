import { IssueWrapper } from "@pull/github/issue";
import { renderComment } from "./comment";

export type IssueRenderOptions = {
  header: boolean;
  body: boolean;
  updates: number;
  author: boolean; // Author of the update, not the issue
  createdAt: boolean;
  updatedAt: boolean;
  fields: string[];
  subissues: boolean | undefined;
  relatedIssues: boolean | undefined;
  skipIfEmpty: boolean; // Skip rendering if no updates or body
};

export type RenderedIssue = {
  markdown: string;
  sources: string[];
};

export function renderIssue(
  issue: IssueWrapper,
  options: IssueRenderOptions,
  headerLevel: number = 3, // Default to Level 3 for Issues
): RenderedIssue | undefined {
  if (options.subissues === undefined) {
    // Render subissues by default if they exist
    options.subissues = issue.subissues !== undefined;
  }

  if (options.relatedIssues === undefined) {
    // Render related issues by default if they exist
    options.relatedIssues = issue.relatedIssues !== undefined;
  }

  // Render an IssueWrapper as a Markdown string
  let markdown = "";
  const sources = [issue.url];

  if (options.header) {
    markdown += `${"#".repeat(headerLevel)} ${issue.header}\n\n`;
  }

  if (
    (!options.updates || !issue.comments.hasUpdate) &&
    (!options.body || !issue._body) &&
    (!options.subissues || !issue.subissues || !issue.subissues.hasUpdates)
  ) {
    if (options.skipIfEmpty || !options.header) {
      return undefined;
    } else {
      markdown += "This Issue has no updates, or body content to render.\n\n";
      return {
        markdown,
        sources,
      };
    }
  }

  if (options.createdAt) {
    markdown += `Issue Opened: ${issue.createdAt.toISOString()}`;
  }

  if (options.updatedAt) {
    markdown += `Issue Edited: ${issue.updatedAt.toISOString()}`;
  }

  if (options.fields.length > 0) {
    for (const fieldName of options.fields) {
      const fieldValue = issue.field(fieldName);
      if (fieldValue) {
        markdown += `**${fieldName}:** ${fieldValue}\n`;
      }
    }
    markdown += "\n";
  }

  if (options.body) {
    markdown += `${issue._body}\n\n`;
  }

  if (options.updates) {
    const latestUpdates = issue.comments.latestUpdates(options.updates);

    for (const update of latestUpdates) {
      const renderedUpdate = renderComment(update, options, headerLevel + 1);
      if (renderedUpdate) {
        markdown += `${renderedUpdate.markdown}\n\n`;
        sources.push(...renderedUpdate.sources);
      }
    }
  }

  if (options.subissues && issue.subissues) {
    for (const subissue of issue.subissues) {
      const renderedSubissue = renderIssue(subissue, options, headerLevel + 1);
      if (renderedSubissue) {
        markdown += `${renderedSubissue.markdown}\n\n`;
        sources.push(...renderedSubissue.sources);
      }
    }

    markdown += `---\n\n`; // End Subissues with a horizontal rule
  }

  if (options.relatedIssues && issue.relatedIssues) {
    for (const relatedIssue of issue.relatedIssues) {
      const renderedRelatedIssue = renderIssue(
        relatedIssue,
        options,
        headerLevel + 1,
      );
      if (renderedRelatedIssue) {
        markdown += `${renderedRelatedIssue.markdown}\n\n`;
        sources.push(...renderedRelatedIssue.sources);
      }
    }

    markdown += `---\n\n`; // End Related Issues with a horizontal rule
  }

  return {
    markdown,
    sources,
  };
}
