import { test as assertAST } from "@textlint/ast-tester";
import { TextlintKernel } from "@textlint/kernel";
import type { TextlintRuleReporter } from "@textlint/types";
import { describe, expect, it } from "vitest";
import plugin from "./index.js";

const parse = (text: string) =>
  new plugin.Processor().processor().preProcess(text);
const reporter: TextlintRuleReporter = (context) => ({
  Str(node) {
    for (const match of node.value.matchAll(/teh/g)) {
      context.report(
        node,
        new context.RuleError("Use the", {
          index: match.index,
          fix: context.fixer.replaceTextRange(
            [match.index, match.index + 3],
            "the",
          ),
        }),
      );
    }
  },
});
const options = {
  ext: ".adoc",
  plugins: [{ pluginId: "asciidoc", plugin }],
  rules: [{ ruleId: "typo", rule: { linter: reporter, fixer: reporter } }],
};

describe("source attribute references", () => {
  it("keeps references opaque and does not lint definition values or names", async () => {
    const text =
      ":teh: teh definition\n\nRead {teh} and teh text.\n\n:teh: another teh value\n\nRead {teh}.";
    const ast = parse(text);
    assertAST({ ...ast });
    expect(ast.children[0]).toMatchObject({
      children: [
        { type: "Str", value: "Read " },
        { type: "Code", raw: "{teh}", value: "{teh}" },
        { type: "Str", value: " and teh text." },
      ],
    });
    expect((await new TextlintKernel().fixText(text, options)).output).toBe(
      text.replace("and teh text", "and the text"),
    );
  });
  it.each([
    "Read {nbsp}teh {unknown}text.",
    "Read **{product} teh** and __{product} teh__.",
    "= {product} teh\n\n== {unknown} teh\n\nRead teh.",
    "Read link:{url}[{product} teh].",
    "{url}[😀teh] and {url}[teh].",
    "Read https://example.com/{path}[{product} teh].",
    "* Read {product} teh\n* {unknown} teh",
    "|===\n|{product} teh |{unknown} teh\n|===",
    "\\{unknown} teh and {unknown\\} teh.",
    "\uE000 {product} teh.",
  ])("preserves syntax and fix positions in %j", async (body) => {
    const header = ":product: *expanded*\n:url: https://example.com\n\n";
    for (const eol of ["\n", "\r\n"]) {
      const text = (header + body).replaceAll("\n", eol);
      assertAST({ ...parse(text) });
      const kernel = new TextlintKernel();
      const result = await kernel.lintText(text, options);
      expect(
        result.messages.map((message) => [message.line, message.column]),
      ).toEqual(
        [...text.matchAll(/teh/g)].map((match) => {
          const lines = text.slice(0, match.index).split(eol);
          return [lines.length, lines[lines.length - 1].length + 1];
        }),
      );
      expect((await kernel.fixText(text, options)).output).toBe(
        text.replaceAll("teh", "the"),
      );
    }
  });
  it("recognizes attribute link targets without exposing target names as prose", () => {
    expect(parse("{u}[Read teh]").children[0]).toMatchObject({
      children: [
        {
          type: "Link",
          raw: "{u}[Read teh]",
          range: [0, 13],
          url: "{u}",
          children: [{ type: "Str", value: "Read teh", range: [4, 12] }],
        },
      ],
    });
  });
  it("does not expand references inside code or mutate original code values", () => {
    expect(parse("----\n{url}[teh]\n----").children[0]).toMatchObject({
      type: "CodeBlock",
      value: "{url}[teh]",
    });
  });
  it("accepts unset and multiline definitions without linting their values", async () => {
    const text = ":product: teh \\\n definition\n:other!:\n\n{product} teh.";
    expect((await new TextlintKernel().fixText(text, options)).output).toBe(
      text.replace("{product} teh", "{product} the"),
    );
  });
});
