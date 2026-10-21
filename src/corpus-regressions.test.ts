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

describe("math and verbatim code", () => {
  it.each([
    ["Read stem:[teh+x] and teh text.", "Read stem:[teh+x] and the text."],
    [
      "[stem]\n++++\nteh + x\n++++\n\nteh text.",
      "[stem]\n++++\nteh + x\n++++\n\nthe text.",
    ],
    ["Use `+teh__name+` and teh.", "Use `+teh__name+` and the."],
  ])("excludes non-prose content in %j", async (text, expected) => {
    await checkFix(text, expected);
  });
});

it("lints math captions without linting the formula", async () => {
  await checkFix(
    ".teh formula\n[stem]\n++++\nteh+x\n++++",
    ".the formula\n[stem]\n++++\nteh+x\n++++",
  );
});

describe("footnotes and script text", () => {
  it.each([
    "Read footnote:[teh note] and teh text.",
    "Read footnote:note[**teh** note] and footnote:note[].",
    "A~teh~ and x^teh^.",
    "|===\n|V~teh~ |footnote:[teh note]\n|===",
    "😀 footnote:[日本語のteh] and x^teh^.",
  ])("lints original text in %j", async (text) => {
    await checkFix(text);
  });
  it("does not lint footnote identifiers or duplicate reused notes", async () => {
    const text = "footnote:teh[teh note] and footnote:teh[].";
    await checkFix(text, text.replace("[teh note]", "[the note]"));
    expect(
      (await new TextlintKernel().lintText(text, options)).messages,
    ).toHaveLength(1);
  });
});

describe("description lists", () => {
  it.each([
    "teh term:: teh definition",
    "teh term::\nteh definition\n\nOther:: teh description",
    "teh term:: teh definition\n+\nAnother teh paragraph.",
    "teh term:: first\nNested::: teh definition",
    "teh term::\n+\n* teh item\n* Other",
    "|===\na|teh term:: teh definition\n|===",
  ])("lints terms and descriptions in %j", async (text) => {
    await checkFix(text);
    await checkFix(text.replaceAll("\n", "\r\n"));
  });
  it("keeps terms and definitions in separate paragraphs", () => {
    expect(parse("Term:: Definition").children[0]).toMatchObject({
      type: "List",
      children: [
        {
          type: "ListItem",
          children: [
            { type: "Paragraph", raw: "Term" },
            { type: "Paragraph", raw: "Definition" },
          ],
        },
      ],
    });
  });
});

describe("prose immediately following a title", () => {
  it.each(["\n", "\r\n"])(
    "recovers a non-standard author line with %j",
    async (eol) => {
      const text = [
        "= Title",
        "This is **teh** first sentence of a longer paragraph with 😀 text.",
        "",
        "Read teh next paragraph.",
      ].join(eol);
      const ast = await checkFix(text);
      expect(ast.children.map((node) => node.type)).toEqual([
        "Header",
        "Paragraph",
        "Paragraph",
      ]);
      expect(
        (await new TextlintKernel().lintText(text, options)).messages.map(
          (m) => m.line,
        ),
      ).toEqual([2, 4]);
    },
  );
  it("preserves a standard author and revision header as metadata", async () => {
    const text =
      "= Title\nJane teh <jane@example.com>\nv1.0, 2026-01-01\n\nRead teh text.";
    await checkFix(text, text.replace("Read teh", "Read the"));
  });
});

describe("additional prose syntax", () => {
  it.each(["\n", "\r\n"])("preserves prose and fixes with %j", async (eol) => {
    await checkFix(
      [
        "😀 Before teh #marked teh# and [.red]#**teh** text#.",
        "",
        "A visible ((teh term)) after teh.",
        "",
        "[source]",
        "----",
        "code <1>",
        "----",
        "<1> Explain **teh** value.",
        "+",
        "Another teh paragraph.",
        "",
        "After teh.",
      ].join(eol),
    );
  });
});

describe("opaque unsupported elements", () => {
  it.each([
    "kbd:[teh]",
    "btn:[teh]",
    "menu:teh[teh > teh]",
    "pass:[<b>teh</b>]",
    "+++<b>teh</b>+++",
    "(((teh)))",
  ])("lints prose around %s", async (element) => {
    for (const eol of ["\n", "\r\n"]) {
      const text = `:experimental:${eol}${eol}😀 Before teh ${element} after **teh**.`;
      await checkFix(
        text,
        text.replace("Before teh", "Before the").replace("**teh**", "**the**"),
      );
    }
  });
  it.each([
    "++++\n<b>teh</b>\n++++",
    "video::teh.mp4[]",
    "audio::teh.ogg[]",
    "<<<",
    '[format="csv"]\n|===\nteh,teh\nteh,teh\n|===',
    '[separator=";"]\n|===\n;teh;teh\n|===',
    '[cols="1,1"]\n|===\n2*|teh\n|===',
  ])("lints prose around block %s", async (element) => {
    for (const eol of ["\n", "\r\n"]) {
      const text = `😀 Before teh.\n\n${element}\n\nAfter teh.`.replaceAll(
        "\n",
        eol,
      );
      await checkFix(
        text,
        text
          .replace("Before teh", "Before the")
          .replace("After teh", "After the"),
      );
    }
  });
  it("accepts a page break at EOF", async () => {
    await checkFix("Before teh.\n\n<<<");
  });
  it("lints captions of otherwise opaque blocks", async () => {
    await checkFix(
      ".A teh caption\nvideo::teh.mp4[]",
      ".A the caption\nvideo::teh.mp4[]",
    );
  });
});

describe("comment gap source positions", () => {
  it.each(["\n", "\r\n"])("keeps containers ordered with %j", async (eol) => {
    await checkFix(
      [
        "😀 Before teh.",
        "",
        "* teh",
        "// first comment",
        "// second comment",
        "* teh",
        "",
        '[cols="1"]',
        "|===",
        "// leading comment",
        "|teh",
        "// middle comment",
        "|teh",
        "|===",
        "",
        "After teh.",
      ].join(eol),
    );
  });
});

describe("conditional source isolation", () => {
  it.each([
    "ifdef::missing[]\nHidden teh 😀.\nendif::[]",
    "ifndef::missing[]\nHidden teh.\nifdef::nested[]\nNested teh.\nendif::[]\nendif::[]",
    "ifeval::[1 == 1]\nHidden teh.\nendif::[]",
    "ifdef::missing[Hidden teh.]",
    "ifdef::missing[]\n// textlint-disable\nHidden teh {name}.\n\n:attr: teh\nendif::[]",
  ])("isolates %s without losing adjacent prose", async (element) => {
    for (const eol of ["\n", "\r\n"]) {
      const text = `😀 Before teh.\n${element}\nAfter teh {name}.`.replaceAll(
        "\n",
        eol,
      );
      await checkFix(
        text,
        text
          .replace("Before teh", "Before the")
          .replace("After teh", "After the"),
      );
    }
  });
  it("keeps conditional-looking code from hiding following prose", async () => {
    const text = "----\nifdef::missing[]\n----\n\nAfter teh.";
    await checkFix(text);
  });
});
