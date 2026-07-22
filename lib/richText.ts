// A contentEditable div (RichTextEditor) doesn't necessarily go back to an
// empty string when an admin deletes all the visible text — browsers
// commonly leave behind markup like "<br>" or "<div><br></div>", which is
// still a non-empty, truthy string. Saving/rendering that as-is makes a
// "cleared" section keep showing up (with nothing visible inside it)
// instead of disappearing like the admin expects.
//
// Strips tags/entities to check whether any real content remains; returns
// null if not, so callers can treat it exactly like an intentionally-blank
// field.
export function normalizeRichText(html: string): string | null {
  const stripped = html
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .trim();
  return stripped ? html.trim() : null;
}
