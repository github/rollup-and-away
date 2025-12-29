type RepoTreeMatch = {
  owner: string;
  repo: string;
  branch: string;
  directory: string;
};

type IssueMatch = {
  owner: string;
  repo: string;
  issueNumber?: number;
};

type DiscussionMatch = {
  owner: string;
  repo: string;
  discussionNumber?: number;
};

type DiscussionCategoryMatch = {
  owner: string;
  repo: string;
  categoryName: string | undefined;
};

type ProjectViewMatch = {
  organization: string;
  projectNumber: number;
  projectViewNumber?: number;
  customQuery?: string;
};

function validateUrl(url: string): URL {
  let urlParts: URL;
  try {
    urlParts = new URL(url);
  } catch {
    // Try adding protocol
    urlParts = new URL(`https://${url}`);
  }
  if (urlParts.hostname !== "github.com") {
    throw new Error(
      `Unsupported hostname: ${urlParts.hostname}. Please provide a valid GitHub URL.`,
    );
  }
  return urlParts;
}

export function scrapeUrls(
  blob: string,
  kinds: string[] = ["issue"],
): string[] {
  const urlRegex = /github\.com\/[^\s)'"<>]+/g;
  const matches = blob.match(urlRegex);
  if (!matches) {
    return [];
  }

  const urls = new Set<string>();
  for (const match of matches) {
    if (kinds.includes("issue") && matchIssueUrl(match)) {
      urls.add(match);
    } else if (kinds.includes("discussion") && matchDiscussionUrl(match)) {
      urls.add(match);
    }
  }

  // Deduplicate
  return Array.from(urls);
}

export function matchRepoTreeUrl(url: string): RepoTreeMatch | undefined {
  // Handle repo path, including /tree subpath
  const urlParts = validateUrl(url);
  const match = urlParts.pathname.match(
    /\/([^/]+)\/([^/]+)\/tree\/([^/]+)\/(.+)/,
  );
  if (!match) {
    return undefined;
  }
  const [, owner, repo, branch, directory] = match;

  if (!owner || !repo || !branch || !directory) {
    throw new Error(`Invalid GitHub URL: ${url}`);
  }

  return { owner, repo, branch, directory };
}

export function matchIssueUrl(url: string): IssueMatch | undefined {
  // Handle repo path, including /issues subpath
  const urlParts = validateUrl(url);
  const match = urlParts.pathname.match(
    /^\/([^/]+)\/([^/]+)(?:\/issues(?:\/(\d+))?)?$/,
  );
  if (!match) {
    return undefined;
  }
  const [, owner, repo, issueNumber] = match;

  if (!owner || !repo) {
    throw new Error(`Invalid GitHub URL: ${url}`);
  }

  let parsedIssueNumber: number | undefined;
  if (issueNumber) {
    parsedIssueNumber = parseInt(issueNumber);
    if (isNaN(parsedIssueNumber)) {
      throw new Error(`Invalid issue number in URL: ${url}`);
    }
  }

  return {
    owner,
    repo,
    issueNumber: parsedIssueNumber,
  };
}

export function matchDiscussionUrl(url: string): DiscussionMatch | undefined {
  // Handle repo path, including /discussions subpath
  const urlParts = validateUrl(url);
  const match = urlParts.pathname.match(
    /\/([^/]+)\/([^/]+)\/discussions\/(\d+)/,
  );
  if (!match) {
    return undefined;
  }

  const [, owner, repo, discussionNumber] = match;

  if (!owner || !repo) {
    throw new Error(`Invalid GitHub URL: ${url}`);
  }

  let parsedDiscussionNumber: number | undefined;
  if (discussionNumber) {
    parsedDiscussionNumber = parseInt(discussionNumber);
    if (isNaN(parsedDiscussionNumber)) {
      throw new Error(`Invalid discussion number in URL: ${url}`);
    }
  }

  return {
    owner,
    repo,
    discussionNumber: parsedDiscussionNumber,
  };
}

export function matchDiscussionCategoryUrl(
  url: string,
): DiscussionCategoryMatch | undefined {
  // Handle repo path, including /discussions/categories/{category} subpath
  const urlParts = validateUrl(url);
  const match = urlParts.pathname.match(
    /\/([^/]+)\/([^/]+)\/discussions(?:\/categories\/([^/]+))?/,
  );
  if (!match) {
    return undefined;
  }

  const [, owner, repo, categoryName] = match;

  if (!owner || !repo || !categoryName) {
    throw new Error(`Invalid GitHub URL: ${url}`);
  }

  return { owner, repo, categoryName };
}

export function matchProjectViewUrl(url: string): ProjectViewMatch | undefined {
  const urlParts = validateUrl(url);
  const match = urlParts.pathname.match(
    /orgs\/([^/]+)\/projects\/(\d+)(?:\/views\/(\d+))?/,
  );

  if (!match) {
    return undefined;
  }

  const [, organization, projectNumber, projectViewNumber] = match;

  if (!organization || !projectNumber) {
    throw new Error(`Invalid GitHub URL: ${url}`);
  }

  const parsedProjectNumber = parseInt(projectNumber);
  if (isNaN(parsedProjectNumber)) {
    throw new Error(`Invalid Project number in URL: ${url}`);
  }

  let parsedProjectViewNumber: number | undefined;
  if (projectViewNumber) {
    parsedProjectViewNumber = parseInt(projectViewNumber);
    if (isNaN(parsedProjectViewNumber)) {
      throw new Error(`Invalid Project View number in URL: ${url}`);
    }
  }

  return {
    organization,
    projectNumber: parsedProjectNumber,
    projectViewNumber: parsedProjectViewNumber,
    customQuery: urlParts.searchParams.get("filterQuery") || undefined,
  };
}
