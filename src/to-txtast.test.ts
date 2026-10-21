import { test as assertAST } from "@textlint/ast-tester";
import { TextlintKernel } from "@textlint/kernel";
import type { TextlintRuleReporter } from "@textlint/types";
import { describe, expect, it } from "vitest";
import plugin from "./index.js";

const parse = (text: string) =>
  new plugin.Processor().processor().preProcess(text);
const reporter: TextlintRuleReporter = (context) => ({
  Str(node) {
    const index = node.value.indexOf("teh");
    if (index < 0) return;
    context.report(
      node,
      new context.RuleError("Use the", {
        index,
        fix: context.fixer.replaceTextRange([index, index + 3], "the"),
      }),
    );
  },
});
const options = {
  ext: ".adoc",
  plugins: [{ pluginId: "asciidoc", plugin }],
  rules: [{ ruleId: "typo", rule: { linter: reporter, fixer: reporter } }],
};

describe("plain text", () => {
  it("represents an empty document", () => {
    expect(parse("")).toEqual({
      type: "Document",
      raw: "",
      range: [0, 0],
      children: [],
      loc: { start: { line: 1, column: 0 }, end: { line: 1, column: 0 } },
    });
  });
  it("maps a paragraph and its original range", () => {
    const ast = parse("Hello world.");
    assertAST({ ...ast });
    expect(ast.children).toEqual([
      {
        type: "Paragraph",
        raw: "Hello world.",
        range: [0, 12],
        loc: { start: { line: 1, column: 0 }, end: { line: 1, column: 12 } },
        children: [
          {
            type: "Str",
            value: "Hello world.",
            raw: "Hello world.",
            range: [0, 12],
            loc: {
              start: { line: 1, column: 0 },
              end: { line: 1, column: 12 },
            },
          },
        ],
      },
    ]);
  });
  it("reports and fixes the source through textlint", async () => {
    const kernel = new TextlintKernel();
    const result = await kernel.lintText("Read teh manual.", options);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toMatchObject({ line: 1, column: 6, index: 5 });
    expect((await kernel.fixText("Read teh manual.", options)).output).toBe(
      "Read the manual.",
    );
  });
  it("rejects unsupported syntax and parser recovery", () => {
    expect(() => parse("A *strong* word.")).toThrow(/Unsupported/);
    expect(() => parse("----\nUnclosed")).toThrow(/diagnostics/);
  });
});
