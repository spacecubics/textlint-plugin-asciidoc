import { ASTNodeTypes, type TxtDocumentNode } from "@textlint/ast-node-types";
import type { TextlintMessage, TextlintPluginProcessor } from "@textlint/types";

// Temporary plain-text AST for integration testing. Replace with acdc parsing.
function parse(text: string): TxtDocumentNode {
  const lines = text.split(/\r\n|\r|\n/);
  const position = () => ({
    raw: text,
    range: [0, text.length] as [number, number],
    loc: {
      start: { line: 1, column: 0 },
      end: { line: lines.length, column: lines[lines.length - 1].length },
    },
  });

  return {
    type: ASTNodeTypes.Document,
    ...position(),
    children: text.length
      ? [
          {
            type: ASTNodeTypes.Paragraph,
            ...position(),
            children: [{ type: ASTNodeTypes.Str, ...position(), value: text }],
          },
        ]
      : [],
  };
}

export class AsciiDocProcessor implements TextlintPluginProcessor {
  availableExtensions() {
    return [".adoc", ".asciidoc", ".asc"];
  }

  processor() {
    return {
      preProcess: parse,
      postProcess(messages: TextlintMessage[], filePath = "<asciidoc>") {
        return { messages, filePath };
      },
    };
  }
}
