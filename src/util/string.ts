export function stripHtml(s: string): string {
  // Remove HTML, script/style tags, and comments from Markdown - from Liquidjs
  // Apply the replacement repeatedly to avoid incomplete multi-character sanitization.
  const stripRegex =
    /<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<.*?>|<!--[\s\S]*?-->/g;
  let previous: string;
  let current = s;
  do {
    previous = current;
    current = current.replace(stripRegex, "");
  } while (current !== previous);
  return current;
}

export function title(s: string): string {
  // Convert a string to title case
  return s
    .toLowerCase()
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function toSnakeCase(s: string): string {
  // Convert a string to snake_case
  return s
    .replace(/[^a-zA-Z0-9_\s]/g, "") // Remove non-alphanumeric characters except underscores
    .trim() // Trim whitespace
    .replace(/([a-z])([A-Z])/g, "$1_$2") // Add underscore before uppercase letters
    .replace(/\s+/g, "_") // Replace spaces with underscores
    .toLowerCase(); // Convert to lowercase
}

export function fuzzy(s: string): string {
  // Remove all whitespace and underscores, then convert to uppercase
  return s.replace(/[\s_]+/g, "").toUpperCase();
  // TODO: Implement something like
  //   https://github.com/git/git/blob/e813a0200a7121b97fec535f0d0b460b0a33356c/help.c#L631
}

// Regexes for parsing Sections
function splitMarkdownByRegex(
  markdown: string,
  regex: RegExp,
): Map<string, string> {
  // Thanks Copilot
  const sections = new Map<string, string>();
  let match: RegExpExecArray | null;
  let lastHeader: string | null = null;
  let lastIndex = 0;

  while ((match = regex.exec(markdown)) !== null) {
    if (lastHeader !== null) {
      const content = markdown.slice(lastIndex, match.index).trim();
      if (sections.has(lastHeader)) {
        // Append to existing section
        const existingContent = sections.get(lastHeader);
        sections.set(lastHeader, existingContent + "\n\n" + content);
      } else {
        sections.set(lastHeader, content);
      }
    }
    lastHeader = toSnakeCase(match[1]!.trim());
    lastIndex = match.index + match[0].length;
  }

  if (lastHeader !== null) {
    // TODO: Remove duplication with above
    const content = markdown.slice(lastIndex).trim();
    if (sections.has(lastHeader)) {
      // Append to existing section
      const existingContent = sections.get(lastHeader);
      sections.set(lastHeader, existingContent + "\n\n" + content);
    } else {
      sections.set(lastHeader, content);
    }
  }

  return sections;
}

export function firstHeader(markdown: string): string | undefined {
  const regex = /^#+\s+(.*)$/m;
  const match = markdown.match(regex);
  if (match) {
    return title(match[1]!.trim());
  }
  return undefined;
}

export function splitMarkdownByHeaders(markdown: string): Map<string, string> {
  // Split markdown by headers (e.g. # Header, ## Subheader)
  // Only match headers at the start of a line
  return splitMarkdownByRegex(markdown, /^#+\s+(.*)$/gm);
}

export function splitMarkdownByBoldedText(
  markdown: string,
): Map<string, string> {
  // Split markdown by bolded text (e.g. **bolded text**)
  // Not as strict as the header one, so it can match bolded text anywhere
  return splitMarkdownByRegex(markdown, /\*\*(.*?)\*\*/g);
}

export function extractDataBlocks(markdown: string): Map<string, string> {
  // Extract content between <!-- data key="..." start --> and <!-- data end -->
  const regex =
    /<!--\s*data\s+key="([^"]+)"\s+start\s*-->([\s\S]*?)<!--\s*data\s+end\s*-->/g;
  const blocks = new Map<string, string>();
  let match: RegExpExecArray | null;
  while ((match = regex.exec(markdown)) !== null) {
    const key = toSnakeCase(match[1]!.trim());
    const content = match[2]!.trim();
    blocks.set(key, content);
  }
  return blocks;
}
