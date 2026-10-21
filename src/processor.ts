import type { TextlintMessage, TextlintPluginProcessor } from "@textlint/types";
import { parseAsciiDoc } from "./acdc.js";
import { toTxtAST } from "./to-txtast.js";

export class AsciiDocProcessor implements TextlintPluginProcessor {
  availableExtensions() {
    return [".adoc", ".asciidoc", ".asc"];
  }
  processor() {
    return {
      preProcess(text: string) {
        return toTxtAST(text, parseAsciiDoc(text));
      },
      postProcess(messages: TextlintMessage[], filePath = "<asciidoc>") {
        return { messages, filePath };
      },
    };
  }
}
