import type {
  TxtBlockQuoteNode,
  TxtCommentNode,
  TxtDocumentNode,
  TxtHeaderNode,
  TxtImageNode,
  TxtListItemNode,
  TxtNode,
  TxtParagraphNode,
  TxtParentNode,
  TxtTableCellNode,
  TxtTableRowNode,
} from "@textlint/ast-node-types";
import type { AcdcParseResult } from "./acdc.js";
import type { AcdcListItem, AcdcNode, AcdcTableRow } from "./acdc-types.js";
import { Source } from "./source.js";
import { tableCellRanges } from "./source-table.js";

export function toTxtAST(
  text: string,
  result: AcdcParseResult,
): TxtDocumentNode {
  const fatalWarnings = result.warnings.filter(
    (_, index) => result.warningKinds?.[index] !== "unresolved-reference",
  );
  if (result.sourceRecovery || fatalWarnings.length) {
    throw new Error(`acdc diagnostics: ${fatalWarnings.join("; ")}`);
  }
  const source = new Source(text);
  const opaqueRanges = [
    ...(result.attributeReferences ?? []),
    ...(result.sourceDirectives ?? []),
  ].sort((a, b) => a[0] - b[0]);
  const document = result.document;
  if (document.name !== "document") throw new Error("Expected acdc document");
  if (
    Object.keys(document.attributes ?? {}).length &&
    !result.attributeReferences
  )
    throw new Error("Document attributes require an original-source mapping");
  function codeValue(nodes: AcdcNode[]): string {
    return nodes
      .map((node) => {
        if (node.name === "callout_reference")
          return source.location(node.location).raw;
        if (
          !["text", "raw"].includes(node.name) ||
          typeof node.value !== "string"
        )
          throw new Error(`Unsupported code content: ${node.name}`);
        return node.value;
      })
      .join("");
  }
  function image(node: AcdcNode): TxtImageNode {
    const target = node.target ?? node.source;
    if (!target || typeof target === "string")
      throw new Error("Image target is missing");
    const alt = node.metadata?.attributes?.alt;
    return {
      type: "Image",
      ...source.location(node.location),
      url: target.value,
      alt: typeof alt === "string" ? alt : codeValue(node.title ?? []),
    };
  }
  function inline(node: AcdcNode): TxtParagraphNode["children"][number] {
    if (node.name === "stem" && typeof node.content === "string")
      return {
        type: "Code",
        ...source.location(node.location),
        value: node.content,
      };
    if (
      node.name === "span" &&
      node.inlines &&
      (node.variant === "strong" || node.variant === "emphasis")
    ) {
      return {
        type: node.variant === "strong" ? "Strong" : "Emphasis",
        ...source.location(node.location),
        children: node.inlines.flatMap(inlines),
      };
    }
    if (node.name === "span" && node.variant === "code" && node.inlines) {
      return {
        type: "Code",
        ...source.location(node.location),
        value: codeValue(node.inlines),
      };
    }
    if (node.name === "image") return image(node);
    if (node.name === "anchor") {
      const span = source.location(node.location);
      return { type: "Code", ...span, value: span.raw };
    }
    if (node.name === "xref" && typeof node.target === "string") {
      const children = (node.inlines ?? []).flatMap(inlines).map((child) => {
        if (child.type === "Link")
          throw new Error("Nested links are unsupported");
        return child;
      });
      return {
        type: "Link",
        ...source.location(node.location),
        url: node.target,
        children,
      };
    }
    if (
      node.name === "ref" &&
      (node.variant === "link" || node.variant === "autolink") &&
      node.target &&
      typeof node.target !== "string"
    ) {
      const span = source.location(node.location);
      const children = (node.inlines ?? []).flatMap(inlines).map((child) => {
        if (child.type === "Link")
          throw new Error("Nested links are unsupported");
        return child;
      });
      if (!children.length) {
        const offset = span.raw.indexOf(node.target.value);
        if (offset < 0)
          throw new Error("Transformed link target is unsupported");
        const targetSpan = source.span(
          span.range[0] + offset,
          span.range[0] + offset + node.target.value.length,
        );
        children.push({ type: "Str", ...targetSpan, value: targetSpan.raw });
      }
      return { type: "Link", ...span, url: node.target.value, children };
    }
    if (node.name === "break")
      return { type: "Break", ...source.location(node.location) };
    if (node.name === "raw" && typeof node.value === "string") {
      const span = source.location(node.location);
      if (span.raw === `\\${node.value}` && /^\{[^{}]+\}$/.test(node.value))
        return { type: "Str", ...span, value: span.raw };
    }
    if (node.name !== "text" || typeof node.value !== "string") {
      const span = source.location(node.location);
      return { type: "Code", ...span, value: span.raw };
    }
    let span = source.location(node.location);
    // acdc 0.11 reports escaped punctuation at the backslash only.
    // Extend only when the adjacent source character exactly matches.
    if (
      span.raw === "\\" &&
      /^[*_`#{}[\]\\]$/.test(node.value) &&
      text[span.range[1]] === node.value
    ) {
      span = source.span(span.range[0], span.range[1] + 1);
      return { type: "Str", ...span, value: span.raw };
    }
    if (
      span.raw.replace(/\r\n/g, "\n").replace(/[ \t]+(?=\n)/g, "") !==
      node.value
    ) {
      throw new Error(
        "Transformed text cannot be mapped to the original source",
      );
    }
    return { type: "Str", ...span, value: span.raw };
  }
  function inlines(node: AcdcNode): TxtParagraphNode["children"] {
    return sourceInlines(node).flatMap((child) => {
      if (child.type !== "Str") return [child];
      const children: TxtParagraphNode["children"][number][] = [];
      let cursor = child.range[0];
      for (const [start, end] of opaqueRanges) {
        if (start < child.range[0] || end > child.range[1]) continue;
        if (cursor < start) {
          const span = source.span(cursor, start);
          children.push({ type: "Str", ...span, value: span.raw });
        }
        const span = source.span(start, end);
        children.push({ type: "Code", ...span, value: span.raw });
        cursor = end;
      }
      if (cursor < child.range[1]) {
        const span = source.span(cursor, child.range[1]);
        children.push({ type: "Str", ...span, value: span.raw });
      }
      return children;
    });
  }
  function sourceInlines(node: AcdcNode): TxtParagraphNode["children"] {
    if (node.name === "indexterm" && node.visible && node.term?.length)
      return node.term.flatMap(inlines);
    // TxtAST has no footnote, mark or sub/superscript node. Preserve their prose
    // at its original ranges without pretending the contents are emphasis.
    if (
      node.name === "footnote" ||
      (node.name === "span" &&
        ["subscript", "superscript", "mark"].includes(node.variant ?? ""))
    ) {
      if (node.inlines?.length) return node.inlines.flatMap(inlines);
      const span = source.location(node.location);
      return [{ type: "Code", ...span, value: span.raw }];
    }
    if (node.name !== "text" || node.location[0].line === node.location[1].line)
      return [inline(node)];
    const span = source.location(node.location);
    // acdc removes full-line comments inside paragraphs before parsing inlines.
    // Only reconstruct them if removing precisely these lines reproduces its value.
    const pattern = /^\/\/[^\r\n]*(?:\r\n|\n|$)/gm;
    const matches = [...span.raw.matchAll(pattern)];
    if (!matches.length) return [inline(node)];
    if (
      span.raw
        .replace(pattern, "")
        .replace(/\r\n/g, "\n")
        .replace(/[ \t]+(?=\n)/g, "") !== node.value
    )
      throw new Error(
        "Comment removal cannot be mapped to the original source",
      );
    const children: TxtParagraphNode["children"][number][] = [];
    let cursor = span.range[0];
    for (const match of matches) {
      const start = span.range[0] + match.index;
      if (start === span.range[0] && node.location[0].col !== 1)
        throw new Error("Expected a full-line comment");
      if (cursor < start) {
        const part = source.span(cursor, start);
        children.push({ type: "Str", ...part, value: part.raw });
      }
      const raw = match[0].replace(/\r?\n$/, "");
      children.push({
        type: "Comment",
        ...source.span(start, start + raw.length),
        value: raw.slice(2),
      });
      cursor = start + match[0].length;
    }
    if (cursor < span.range[1]) {
      const part = source.span(cursor, span.range[1]);
      children.push({ type: "Str", ...part, value: part.raw });
    }
    return children;
  }
  function heading(title: AcdcNode[], level: number): TxtHeaderNode {
    if (!title.length || !Number.isInteger(level) || level < 0 || level > 5) {
      throw new Error("Unsupported heading level or empty title");
    }
    const children = title.flatMap(inlines);
    const lineStart = source.lineStart(title[0].location[0].line);
    const prefix = text.slice(lineStart, children[0].range[0]);
    const marker = /=+[ \t]+$/.exec(prefix);
    return {
      type: "Header",
      depth: (level + 1) as TxtHeaderNode["depth"],
      ...source.span(
        marker ? children[0].range[0] - marker[0].length : lineStart,
        children[children.length - 1].range[1],
      ),
      children,
    };
  }
  function paragraph(nodes: AcdcNode[]): TxtParagraphNode {
    if (!nodes.length) throw new Error("Missing paragraph content");
    const children = nodes.flatMap(inlines);
    return {
      type: "Paragraph",
      ...source.span(
        children[0].range[0],
        children[children.length - 1].range[1],
      ),
      children,
    };
  }
  function listItem(node: AcdcListItem): TxtListItemNode {
    if (node.name !== "listItem")
      throw new Error(`Unsupported list item: ${node.name}`);
    return {
      type: "ListItem",
      ...source.location(node.location),
      checked: node.checked ?? null,
      children: [
        ...(node.principal?.length ? [paragraph(node.principal)] : []),
        ...blockChildren(node.blocks ?? []),
      ],
    };
  }
  function tableRow(
    row: AcdcTableRow,
    ranges: [number, number][],
  ): TxtTableRowNode {
    const children: TxtTableCellNode[] = row.columns.map((column, index) => {
      const span = source.span(...ranges[index]);
      let children: TxtTableCellNode["children"] = [];
      if (column.style === "literal" || column.style === "monospace") {
        if (span.raw) children = [{ type: "Code", ...span, value: span.raw }];
      } else if (column.content[0]?.inlines?.length) {
        children = column.content[0].inlines.flatMap(inlines);
        if (column.style === "strong" || column.style === "emphasis")
          children = [
            {
              type: column.style === "strong" ? "Strong" : "Emphasis",
              ...span,
              children,
            },
          ];
      }
      for (const child of children) {
        if (child.range[0] < span.range[0] || child.range[1] > span.range[1])
          throw new Error("Table cell content is outside its original source");
      }
      return { type: "TableCell", ...span, children };
    });
    if (!children.length) throw new Error("Unsupported empty table row");
    return {
      type: "TableRow",
      ...source.span(
        children[0].range[0],
        children[children.length - 1].range[1],
      ),
      children,
    };
  }
  type Block = TxtBlockQuoteNode["children"][number] | TxtCommentNode;
  function blockChildren(nodes: AcdcNode[]): TxtBlockQuoteNode["children"] {
    // TxtAST permits Comment at the root and in phrasing content, but its
    // block-container types require a paragraph around a comment.
    return nodes.flatMap(block).map((node) =>
      node.type === "Comment"
        ? {
            type: "Paragraph",
            ...source.span(...node.range),
            children: [node],
          }
        : node,
    );
  }
  function opaqueBlock(node: AcdcNode): Block[] {
    const span = source.location(node.location);
    return [{ type: "CodeBlock", ...span, value: span.raw, lang: null }];
  }
  function block(node: AcdcNode): Block[] {
    if (node.type === "attribute") return [];
    if (node.name === "comment") {
      // Line-comment ends in acdc 0.11 overshoot the original line.
      const span = source.span(
        source.offset(node.location[0]),
        source.lineEnd(node.location[1].line),
      );
      const lines = span.raw.split(/\r\n|\n|\r/);
      if (node.delimiter) {
        if (lines[0] !== node.delimiter || lines.at(-1) !== node.delimiter)
          throw new Error("Comment delimiters do not match the source");
        return [
          { type: "Comment", ...span, value: lines.slice(1, -1).join("\n") },
        ];
      }
      if (
        lines.length !== 1 ||
        !span.raw.startsWith("//") ||
        span.raw.slice(2) !== (node.content ?? "")
      )
        throw new Error("Comment content does not match the source");
      return [{ type: "Comment", ...span, value: span.raw.slice(2) }];
    }
    if (
      node.title?.length &&
      node.name !== "section" &&
      node.name !== "heading"
    ) {
      const titleEnd = node.title[node.title.length - 1].location[1];
      return [
        paragraph(node.title),
        ...block({
          ...node,
          title: undefined,
          location: [{ line: titleEnd.line + 1, col: 1 }, node.location[1]],
        }),
      ];
    }
    if (node.name === "stem" && typeof node.content === "string")
      return [
        {
          type: "CodeBlock",
          ...source.location(node.location),
          value: node.content,
          lang: null,
        },
      ];
    if (node.name === "quote" && node.blocks) {
      return [
        {
          type: "BlockQuote",
          ...source.location(node.location),
          children: blockChildren(node.blocks),
        },
      ];
    }
    if (
      ["admonition", "example", "sidebar", "open"].includes(node.name) &&
      node.blocks
    ) {
      return node.blocks.flatMap(block);
    }
    if (node.name === "break" && node.variant === "page") {
      // acdc includes the column after the marker, even at end of file.
      const span = source.span(
        source.offset(node.location[0]),
        source.lineEnd(node.location[1].line),
      );
      return [{ type: "CodeBlock", ...span, value: span.raw, lang: null }];
    }
    if (node.name === "break" && node.variant === "thematic") {
      return [{ type: "HorizontalRule", ...source.location(node.location) }];
    }
    if (
      node.name === "table" &&
      node.content &&
      typeof node.content !== "string"
    ) {
      const content = node.content;
      const rows = [
        ...(content.header ? [content.header] : []),
        ...content.rows,
        ...(content.footer ? [content.footer] : []),
      ];
      const ranges = tableCellRanges(source, node, content);
      const columns = rows.flatMap((row) => row.columns);
      if (!ranges || ranges.length !== columns.length) return opaqueBlock(node);
      const complex = columns.some(
        (column) =>
          column.content.length > 1 ||
          column.content.some((child) => child.name !== "paragraph"),
      );
      if (complex) {
        // Standard TxtAST TableCell accepts only inline content. Keep block
        // boundaries and code semantics by exposing complex tables as blocks.
        return columns.flatMap((column, index) => {
          const span = source.span(...ranges[index]);
          if (column.style === "literal" || column.style === "monospace")
            return span.raw
              ? [
                  {
                    type: "CodeBlock" as const,
                    ...span,
                    value: span.raw,
                    lang: null,
                  },
                ]
              : [];
          return column.content.flatMap(block).map((child) => {
            if (
              child.range[0] < span.range[0] ||
              child.range[1] > span.range[1]
            )
              throw new Error("Table block is outside its original cell");
            if (
              child.type === "Paragraph" &&
              (column.style === "strong" || column.style === "emphasis")
            )
              return {
                ...child,
                children: [
                  {
                    type:
                      column.style === "strong"
                        ? ("Strong" as const)
                        : ("Emphasis" as const),
                    ...source.span(...child.range),
                    children: child.children,
                  },
                ],
              };
            return child;
          });
        });
      }
      let cursor = 0;
      return [
        {
          type: "Table",
          ...source.location(node.location),
          children: rows.map((row) => {
            const result = tableRow(
              row,
              ranges.slice(cursor, cursor + row.columns.length),
            );
            cursor += row.columns.length;
            return result;
          }),
        },
      ];
    }
    if (
      node.name === "list" &&
      node.items &&
      ["ordered", "unordered", "callout"].includes(node.variant ?? "")
    ) {
      const ordered = node.variant === "ordered";
      const start = Number(
        node.metadata?.attributes?.start ??
          (/^\d+\./.test(node.items[0]?.marker ?? "")
            ? Number.parseInt(node.items[0].marker ?? "1", 10)
            : 1),
      );
      if (ordered && (!Number.isSafeInteger(start) || start < 1))
        throw new Error("Invalid ordered list start");
      return [
        {
          type: "List",
          ...source.location(node.location),
          ordered,
          start: ordered ? start : null,
          children: node.items.map(listItem),
        },
      ];
    }
    if (node.name === "dlist" && node.items?.length) {
      const children: TxtListItemNode[] = node.items.map((item) => {
        if (!item.term?.length)
          throw new Error("Missing description-list term");
        const children: TxtListItemNode["children"] = [
          paragraph(item.term),
          ...(item.principal_text?.length
            ? [paragraph(item.principal_text)]
            : []),
          ...blockChildren(item.description ?? []),
        ];
        // acdc 0.11 can overshoot the final line for description lists.
        // Derive the containing range from the actual term/description nodes.
        return {
          type: "ListItem",
          ...source.span(
            source.offset(item.location[0]),
            children[children.length - 1].range[1],
          ),
          checked: null,
          children,
        };
      });
      return [
        {
          type: "List",
          ...source.span(
            source.offset(node.location[0]),
            children[children.length - 1].range[1],
          ),
          ordered: false,
          start: null,
          children,
        },
      ];
    }
    if (node.name === "image") {
      return [
        {
          type: "Paragraph",
          ...source.location(node.location),
          children: [image(node)],
        },
      ];
    }
    if (node.name === "listing" || node.name === "literal") {
      const language = node.metadata?.attributes?.language;
      return [
        {
          type: "CodeBlock",
          ...source.location(node.location),
          value: codeValue(node.inlines ?? []),
          lang: typeof language === "string" ? language : null,
        },
      ];
    }
    if (
      (node.name === "section" || node.name === "heading") &&
      node.title &&
      node.level !== undefined
    ) {
      return [
        heading(node.title, node.level),
        ...(node.blocks ?? []).flatMap(block),
      ];
    }
    if (node.name !== "paragraph" || !node.inlines) {
      return opaqueBlock(node);
    }
    return [
      {
        type: "Paragraph",
        ...source.location(node.location),
        children: node.inlines.flatMap(inlines),
      },
    ];
  }
  function restoreCommentGaps<T extends TxtNode>(node: T): T {
    if (!("children" in node)) return node;
    const parent = node as T & TxtParentNode;
    const children = parent.children
      .map(restoreCommentGaps)
      .sort((a, b) => a.range[0] - b.range[0]);
    const restored: TxtParentNode["children"][number][] = [];
    let cursor = node.range[0];
    for (const child of [...children, null]) {
      const end = child?.range[0] ?? node.range[1];
      const gap = source.span(cursor, end);
      for (const match of gap.raw.matchAll(/^\/\/[^\r\n]*/gm)) {
        const start = cursor + match.index;
        // A gap may start partway through a source line (e.g. after a title).
        if (source.position(start).column !== 0) continue;
        const comment: TxtCommentNode = {
          type: "Comment",
          ...source.span(start, start + match[0].length),
          value: match[0].slice(2),
        };
        if (["List", "Table", "TableRow"].includes(node.type))
          throw new Error(`Unsupported comment between ${node.type} children`);
        restored.push(
          node.type === "BlockQuote" || node.type === "ListItem"
            ? {
                type: "Paragraph",
                ...source.span(...comment.range),
                children: [comment],
              }
            : comment,
        );
      }
      if (child) {
        restored.push(child);
        cursor = child.range[1];
      }
    }
    return { ...node, children: restored };
  }
  return restoreCommentGaps({
    type: "Document",
    ...source.span(0, text.length),
    children: [
      ...(document.header ? [heading(document.header.title, 0)] : []),
      ...(document.blocks ?? []).flatMap(block),
    ],
  });
}
