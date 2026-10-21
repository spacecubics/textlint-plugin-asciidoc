import type { TxtNode, TxtParentNode } from "@textlint/ast-node-types";
import { test as assertAST } from "@textlint/ast-tester";
import { TextlintKernel } from "@textlint/kernel";
import type { TextlintRuleReporter } from "@textlint/types";
import { describe, expect, it } from "vitest";
import plugin from "./index.js";
import { Source } from "./source.js";

const parse = (text: string) =>
  new plugin.Processor().processor().preProcess(text);
const reporter: TextlintRuleReporter = (context) => ({
  Str(node) {
    for (const match of node.value.matchAll(/teh/g))
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
  },
});
const options = {
  ext: ".adoc",
  plugins: [{ pluginId: "asciidoc", plugin }],
  rules: [{ ruleId: "typo", rule: { linter: reporter, fixer: reporter } }],
};
function checkSource(text: string, node: TxtNode) {
  expect(node.raw).toBe(text.slice(...node.range));
  for (const [offset, loc] of [
    [node.range[0], node.loc.start],
    [node.range[1], node.loc.end],
  ] as const) {
    const lines = text.slice(0, offset).split(/\r\n|\n/);
    expect(loc).toEqual({
      line: lines.length,
      column: lines[lines.length - 1].length,
    });
  }
  if ("children" in node) {
    let cursor = node.range[0];
    for (const child of (node as TxtParentNode).children) {
      expect(child.range[0]).toBeGreaterThanOrEqual(cursor);
      expect(child.range[1]).toBeLessThanOrEqual(node.range[1]);
      checkSource(text, child);
      cursor = child.range[1];
    }
  }
}
async function checkFix(
  text: string,
  expected = text.replaceAll("teh", "the"),
) {
  const ast = parse(text);
  assertAST({ ...ast });
  checkSource(text, ast);
  const kernel = new TextlintKernel();
  expect((await kernel.fixText(text, options)).output).toBe(expected);
  return ast;
}

describe("newlines between inline nodes", () => {
  it.each(["\n", "\r\n"])("maps newline positions with %j", async (eol) => {
    const text = [
      "😀teh text",
      "*teh emphasis*",
      "teh after `code`",
      "teh final",
    ].join(eol);
    await checkFix(text);
    expect(
      (await new TextlintKernel().lintText(text, options)).messages.map((m) => [
        m.line,
        m.column,
      ]),
    ).toEqual([
      [1, 3],
      [2, 2],
      [3, 1],
      [4, 1],
    ]);
  });
  it("does not accept a nonexistent newline at EOF", () => {
    expect(() => new Source("Text").offset({ line: 1, col: 5 })).toThrow(
      /Invalid/,
    );
    expect(() => new Source("Text\n").offset({ line: 1, col: 6 })).toThrow(
      /Invalid/,
    );
  });
});

describe("cross references", () => {
  it.each([
    "Read xref:page.adoc[teh label].",
    "Read xref:component:module:page.adoc[**teh** label].",
    "Read <<missing,teh label>>.",
    "[[id]]\nRead <<id,teh label>>.",
    "Read [[id]]teh text.",
    "* xref:page.adoc[teh label]\n* xref:other.adoc[teh label]",
  ])("lints source labels in %j", async (text) => {
    await checkFix(text);
  });
  it("keeps unlabeled targets out of prose rules", async () => {
    const text = "Read xref:teh.adoc[] and <<teh>> and [[teh]]teh text.";
    await checkFix(text, text.replace("teh text", "the text"));
  });
  it("still rejects parser recovery", () => {
    expect(() => parse("----\nUnclosed")).toThrow(/diagnostics/);
  });
});

describe("file-local includes", () => {
  it.each(["\n", "\r\n"])(
    "preserves directives without reading targets with %j",
    async (eol) => {
      const text = [
        "teh before",
        "include::missing/😀日本語-teh.adoc[]",
        "teh after {product}",
        "include::component:module:partial$teh.adoc[tag=example]",
        "teh final",
      ].join(eol);
      await checkFix(
        text,
        text
          .replace("teh before", "the before")
          .replace("teh after", "the after")
          .replace("teh final", "the final"),
      );
    },
  );
  it("keeps directives in code out of prose", async () => {
    await checkFix(
      "----\ninclude::missing/teh.adoc[]\n----\n\nteh",
      "----\ninclude::missing/teh.adoc[]\n----\n\nthe",
    );
  });
  it("preserves include-only files", async () => {
    const text = "include::https://example.invalid/teh.adoc[]";
    const ast = await checkFix(text, text);
    expect(ast.children[0]).toMatchObject({
      children: [{ type: "Code", value: text, range: [0, text.length] }],
    });
  });
});
