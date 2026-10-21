import type { AcdcNode, AcdcTable } from "./acdc-types.js";
import type { Source } from "./source.js";

/** Supplement acdc's missing cell ranges; row grouping stays with acdc.
 * This follows its PSV/! separator and trailing cell-specifier rules.
 */
export function tableCellRanges(
  source: Source,
  node: AcdcNode,
  table: AcdcTable,
): [number, number][] | null {
  const separator = node.metadata?.attributes?.separator ?? node.delimiter?.[0];
  const format = node.metadata?.attributes?.format;
  if (
    (separator !== "|" && separator !== "!") ||
    (format !== undefined && format !== "psv")
  )
    return null;
  const start = source.lineStart(table.location[0].line + 1);
  const end = source.lineStart(table.location[1].line);
  const separators: number[] = [];
  for (let index = start; index < end; index++) {
    if (source.text[index] === "\\" && source.text[index + 1] === separator)
      index++;
    else if (source.text[index] === separator) separators.push(index);
  }
  return separators.map((delimiter, index) => {
    const cellStart = delimiter + 1;
    let cellEnd = separators[index + 1] ?? end;
    if (index + 1 < separators.length) {
      // A specifier belongs to the following cell only at a whitespace boundary.
      const part = source.text.slice(cellStart, cellEnd);
      const specifier =
        /[ \t\r\n]((?:(?:\d+(?:\.\d+)?|\.\d+)[+*])?[<^>]?(?:\.[<^>])?[adehlms]?)$/.exec(
          part,
        );
      if (specifier?.[1]) cellEnd -= specifier[1].length;
    }
    const raw = source.text.slice(cellStart, cellEnd);
    const trimmed = raw.trim();
    if (!trimmed) return [cellStart, cellStart];
    const contentStart = cellStart + raw.length - raw.trimStart().length;
    return [contentStart, contentStart + trimmed.length];
  });
}
