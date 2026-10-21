import type {
  TxtBlockQuoteNode,
  TxtDocumentNode,
  TxtHeaderNode,
  TxtImageNode,
  TxtParagraphNode,
} from "@textlint/ast-node-types";
import type { AcdcParseResult } from "./acdc.js";
import type { AcdcNode } from "./acdc-types.js";
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
  if (
    document.name !== "document" ||
    Object.keys(document.attributes ?? {}).length
  ) {
    throw new Error("Unsupported acdc document header or attributes");
  }
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
    if (node.name !== "text" || typeof node.value !== "string") {
      throw new Error(`Unsupported acdc inline: ${node.name}`);
    }
    const span = source.location(node.location);
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
  type Block = TxtBlockQuoteNode["children"][number];
  function block(node: AcdcNode): Block[] {
    if (
      node.title?.length &&
      node.name !== "section" &&
      node.name !== "heading"
    )
      throw new Error("Unsupported block caption");
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
