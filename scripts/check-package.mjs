import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// Install the actual tarball without build scripts or a link to this checkout.
const tarball = resolve(process.argv[2]);
const { devDependencies } = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
const directory = mkdtempSync(join(tmpdir(), "asciidoc-package-"));
try {
  writeFileSync(join(directory, "package.json"), '{"private":true}\n');
  execFileSync(
    "npm",
    [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      tarball,
      `textlint@${devDependencies.textlint}`,
    ],
    { cwd: directory, stdio: "inherit" },
  );
  writeFileSync(
    join(directory, "probe.cjs"),
    `module.exports = context => ({ Str(node) {
      if (node.value === "日本語 😀") context.report(node, new context.RuleError("package probe"));
    } });\n`,
  );
  let output;
  try {
    output = execFileSync(
      process.execPath,
      [
        "node_modules/textlint/bin/textlint.js",
        "--no-textlintrc",
        "--plugin",
        "asciidoc",
        "--rule",
        join(directory, "probe.cjs"),
        "--stdin",
        "--stdin-filename",
        "probe.adoc",
        "--format",
        "json",
      ],
      {
        cwd: directory,
        input: "Before **日本語 😀** after.\n",
        encoding: "utf8",
      },
    );
  } catch (error) {
    // textlint exits with 1 when the probe reports its expected diagnostic.
    if (error.status !== 1) throw error;
    output = error.stdout;
  }
  const results = JSON.parse(output);
  assert.equal(results.length, 1);
  assert.equal(results[0].messages.length, 1);
  assert.equal(results[0].messages[0].message, "package probe");
  assert.equal(results[0].messages[0].line, 1);
  assert.equal(results[0].messages[0].column, 10);
} finally {
  rmSync(directory, { recursive: true, force: true });
}
