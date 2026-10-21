import type {
  TxtBlockQuoteNode,
  TxtCommentNode,
  TxtDocumentNode,
  TxtHeaderNode,
  TxtImageNode,
  TxtListItemNode,
  TxtParagraphNode,
  TxtTableRowNode,
} from "@textlint/ast-node-types";
import type { AcdcParseResult } from "./acdc.js";
import type { AcdcNode, AcdcTableRow } from "./acdc-types.js";
import { Source } from "./source.js";

export function toTxtAST(
  text: string,
  result: AcdcParseResult,
): TxtDocumentNode {
  if (result.sourceRecovery || result.warnings.length) {
    throw new Error(`acdc diagnostics: ${result.warnings.join("; ")}`);
  }
  const source = new Source(text);
  const document = result.document;
  if (document.name !== "document") throw new Error("Expected acdc document");
  if (Object.keys(document.attributes ?? {}).length)
    throw new Error("Document attributes require an original-source mapping");
  function codeValue(nodes: AcdcNode[]): string {
    return nodes
      .map((node) => {
        if (node.name !== "text" || typeof node.value !== "string")
          throw new Error(`Unsupported code content: ${node.name}`);
        return node.value;
      })
      .join("");
  }
  function image(node: AcdcNode): TxtImageNode {
    const target = node.target ?? node.source;
    if (!target) throw new Error("Image target is missing");
    const alt = node.metadata?.attributes?.alt;
    return {
      type: "Image",
      ...source.location(node.location),
      url: target.value,
      alt: typeof alt === "string" ? alt : codeValue(node.title ?? []),
    };
  }
  function inline(node: AcdcNode): TxtParagraphNode["children"][number] {
    if (
      node.name === "span" &&
      node.inlines &&
      (node.variant === "strong" || node.variant === "emphasis")
    ) {
      return {
        type: node.variant === "strong" ? "Strong" : "Emphasis",
        ...source.location(node.location),
        children: node.inlines.map(inline),
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
    if (
      node.name === "ref" &&
      (node.variant === "link" || node.variant === "autolink") &&
      node.target
    ) {
      const span = source.location(node.location);
      const children = (node.inlines ?? []).map(inline).map((child) => {
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
      throw new Error(`Unsupported acdc inline: ${node.name}`);
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
  function heading(title: AcdcNode[], level: number): TxtHeaderNode {
    if (!title.length || !Number.isInteger(level) || level < 0 || level > 5) {
      throw new Error("Unsupported heading level or empty title");
    }
    return {
      type: "Header",
      depth: (level + 1) as TxtHeaderNode["depth"],
      ...source.span(
        source.lineStart(title[0].location[0].line),
        source.lineEnd(title[title.length - 1].location[1].line),
      ),
      children: title.map(inline),
    };
  }
  function paragraph(nodes: AcdcNode[]): TxtParagraphNode {
    if (!nodes.length) throw new Error("Missing paragraph content");
    const children = nodes.map(inline);
    return {
      type: "Paragraph",
      ...source.span(
        children[0].range[0],
        children[children.length - 1].range[1],
      ),
      children,
    };
  }
  function listItem(node: AcdcNode): TxtListItemNode {
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
  function tableRow(row: AcdcTableRow): TxtTableRowNode {
    const children = row.columns.map((column) => {
      if (
        column.content.length !== 1 ||
        column.content[0].name !== "paragraph" ||
        !column.content[0].inlines?.length ||
        (column.colspan ?? 1) !== 1 ||
        (column.rowspan ?? 1) !== 1
      ) {
        throw new Error(
          "Unsupported empty, merged, or block-content table cell",
        );
      }
      const cell = paragraph(column.content[0].inlines);
      return { ...cell, type: "TableCell" as const };
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
    return nodes
      .flatMap(block)
      .map((node) =>
        node.type === "Comment"
          ? {
              type: "Paragraph",
              ...source.span(...node.range),
              children: [node],
            }
          : node,
      );
  }
  function block(node: AcdcNode): Block[] {
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
    if (node.name === "break" && node.variant === "thematic") {
      return [{ type: "HorizontalRule", ...source.location(node.location) }];
    }
    if (
      node.name === "table" &&
      node.content &&
      typeof node.content !== "string"
    ) {
      const content = node.content;
      return [
        {
          type: "Table",
          ...source.location(node.location),
          children: [
            ...(content.header ? [content.header] : []),
            ...content.rows,
            ...(content.footer ? [content.footer] : []),
          ].map(tableRow),
        },
      ];
    }
    if (
      node.name === "list" &&
      node.items &&
      (node.variant === "ordered" || node.variant === "unordered")
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
      throw new Error(`Unsupported acdc block: ${node.name}`);
    }
    return [
      {
        type: "Paragraph",
        ...source.location(node.location),
        children: node.inlines.map(inline),
      },
    ];
  }
  return {
    type: "Document",
    ...source.span(0, text.length),
    children: [
      ...(document.header ? [heading(document.header.title, 0)] : []),
      ...(document.blocks ?? []).flatMap(block),
    ],
  };
}
