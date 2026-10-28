/**
 * A conversation's title from the first thing the person asked, without another model call.
 *
 * `summariseOne` hands the titler `Asked: …Answered: …`; the asked half is the person's own words
 * and needs no paraphrase. Local mode uses this instead of the model titler, so naming a
 * conversation cannot fail because a second service is missing and cannot cost a second call.
 */
export function localChannelTitle(excerpt: string): string | null {
  // `openingOf` has already flattened the pair to one line, so the answer is separated by spaces
  // rather than by the newline the excerpt was written with.
  const asked = excerpt.match(/^Asked:\s*([\s\S]*?)(?:\s+Answered:|$)/)?.[1];
  const line = asked?.replace(/\s+/g, " ").trim() ?? "";
  if (!line) return null;
  if (line.length <= 60) return line;
  const cut = line.slice(0, 60);
  const boundary = cut.lastIndexOf(" ");
  return `${(boundary > 30 ? cut.slice(0, boundary) : cut).trimEnd()}…`;
}
