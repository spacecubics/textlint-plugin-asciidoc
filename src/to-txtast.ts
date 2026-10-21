import type {
  TxtDocumentNode,
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
    document.header ||
    Object.keys(document.attributes ?? {}).length
  ) {
    throw new Error("Unsupported acdc document header or attributes");
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
  function block(node: AcdcNode): TxtParagraphNode {
    if (node.name !== "paragraph" || !node.inlines) {
      throw new Error(`Unsupported acdc block: ${node.name}`);
    }
    return {
      type: "Paragraph",
      ...source.location(node.location),
      children: node.inlines.map(inline),
    };
  }
  return {
    type: "Document",
    ...source.span(0, text.length),
    children: (document.blocks ?? []).map(block),
  };
}
