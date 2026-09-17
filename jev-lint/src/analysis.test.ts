import { describe, expect, it } from "vitest";
import { changedLines, collectIdentifiers, enclosingFunction, extractFunctions, extractImports, isJudgeable, numberedSource } from "./analysis.ts";
import { SAMPLES } from "./samples.ts";

const byId = (id: string) => SAMPLES.find((s) => s.id === id)!;

describe("extractFunctions", () => {
  it("finds TypeScript functions with correct spans", () => {
    const s = byId("ts");
    const fns = extractFunctions(s.text, "typescript");
    const names = fns.map((f) => f.name);
    expect(names).toEqual(["orderTotal", "lastItem", "loadUsersForOrders", "applyCoupon", "signOrder", "findDuplicateSkus", "describeOrder", "isEligibleForFreeShipping", "skuCount"]);
    const last = fns.find((f) => f.name === "lastItem")!;
    const lines = s.text.split("\n");
    expect(lines[last.startLine - 1]).toContain("function lastItem");
    expect(lines[last.endLine - 1]).toBe("}");
    expect(last.endLine - last.startLine).toBe(3);
  });

  it("handles arrow functions, methods, braces inside strings and comments", () => {
    const src = ["const add = (a: number, b: number) => {", '  const s = "}"; // }', "  return a + b;", "}", "class A {", "  run(x: number): void {", "    if (x) {", "    }", "  }", "}"].join("\n");
    const fns = extractFunctions(src, "typescript");
    expect(fns).toEqual([
      { name: "add", startLine: 1, endLine: 4 },
      { name: "run", startLine: 6, endLine: 9 },
    ]);
  });

  it("finds Python defs by indentation", () => {
    const s = byId("py");
    const fns = extractFunctions(s.text, "python");
    expect(fns.map((f) => f.name)).toEqual(["connect", "fetch_user", "average", "read_report", "make_reset_token", "user_names", "is_valid_email", "cleanup", "percent", "first_word"]);
    const cleanup = fns.find((f) => f.name === "cleanup")!;
    expect(s.text.split("\n")[cleanup.endLine - 1].trim()).toBe("return removed");
  });

  it("finds Go funcs and methods", () => {
    const fns = extractFunctions(byId("go").text, "go");
    expect(fns.map((f) => f.name)).toEqual(["getUser", "sessionToken", "hashPassword", "ping", "sumInts", "countRows", "contains", "close", "clamp"]);
  });

  it("finds Rust fns", () => {
    const fns = extractFunctions(byId("rs").text, "rust");
    expect(fns.map((f) => f.name)).toContain("run_report");
    expect(fns.map((f) => f.name)).toContain("admin_key");
    expect(fns).toHaveLength(12);
  });

  it("finds Bash functions", () => {
    const fns = extractFunctions(byId("sh").text, "bash");
    expect(fns.map((f) => f.name)).toEqual(["log", "usage", "build_release", "clean_old_releases", "wipe_release", "run_migration", "restart_service", "is_healthy", "wait_for_health", "main"]);
  });

  it("splits SQL into statements, respecting $$ bodies", () => {
    const s = byId("sql");
    const fns = extractFunctions(s.text, "sql");
    expect(fns.map((f) => f.name)).toContain("orders");
    expect(fns.map((f) => f.name)).toContain("inactive_users");
    expect(fns.map((f) => f.name)).toContain("order_by_id");
    const fn = fns.find((f) => f.name === "order_by_id")!;
    expect(s.text.split("\n")[fn.endLine - 1]).toBe("$$ LANGUAGE plpgsql;");
    for (let i = 1; i < fns.length; i++) expect(fns[i].startLine).toBeGreaterThan(fns[i - 1].endLine);
  });

  it("every planted issue except the top-level bash secret sits inside an extracted function", () => {
    for (const s of SAMPLES) {
      const fns = extractFunctions(s.text, s.language);
      for (const p of s.planted) {
        if (s.id === "sh" && p.line === 6) continue;
        expect(enclosingFunction(fns, p.line), `${s.id}:${p.line}`).toBeDefined();
      }
    }
  });
});

describe("enclosingFunction", () => {
  it("picks the innermost span", () => {
    const fns = [
      { name: "outer", startLine: 1, endLine: 20 },
      { name: "inner", startLine: 5, endLine: 8 },
    ];
    expect(enclosingFunction(fns, 6)?.name).toBe("inner");
    expect(enclosingFunction(fns, 12)?.name).toBe("outer");
    expect(enclosingFunction(fns, 30)).toBeUndefined();
  });
});

describe("changedLines", () => {
  it("returns nothing for identical text", () => {
    expect(changedLines("a\nb", "a\nb")).toEqual([]);
  });
  it("finds a single edited line", () => {
    expect(changedLines("a\nb\nc", "a\nB\nc")).toEqual([2]);
  });
  it("finds inserted lines", () => {
    expect(changedLines("a\nb\nc", "a\nx\ny\nb\nc")).toEqual([2, 3]);
  });
  it("reports the seam line on pure deletion", () => {
    expect(changedLines("a\nb\nc", "a\nc")).toEqual([2]);
    expect(changedLines("a\nb\nc", "a\nb")).toEqual([2]);
  });
  it("handles a newline typed at the end of a line", () => {
    expect(changedLines("a\nb", "a\n\nb")).toEqual([2]);
  });
  it("caps the number of changed lines", () => {
    const many = Array.from({ length: 50 }, (_, i) => `l${i}`).join("\n");
    expect(changedLines("", many, 12)).toHaveLength(12);
  });
  it("prefers the tail when suffix and prefix overlap (repeated lines)", () => {
    expect(changedLines("x\nx\nx", "x\nx\nx\nx")).toEqual([4]);
  });
});

describe("identifiers and imports", () => {
  it("collects declared and used identifiers in TypeScript", () => {
    const ids = collectIdentifiers("function f(a: number) {\n  const total = a + b;\n  return total;\n}", "typescript");
    expect(ids.declared).toContain("f");
    expect(ids.declared).toContain("total");
    expect(ids.declared).toContain("a");
    expect(ids.used).toContain("number");
  });
  it("extracts imports per language", () => {
    expect(extractImports(byId("ts").text, "typescript")).toEqual(['import { createHash } from "node:crypto";', 'import type { Db } from "./db";']);
    expect(extractImports(byId("py").text, "python")).toHaveLength(4);
    expect(extractImports(byId("go").text, "go")[0]).toContain('"crypto/md5"');
    expect(extractImports(byId("rs").text, "rust")).toEqual(["use std::collections::HashMap;", "use std::process::Command;"]);
  });
  it("numbers source lines", () => {
    expect(numberedSource("a\nb\nc\nd", 2, 3)).toBe("2: b\n3: c");
  });
  it("skips blank, brace-only and comment lines", () => {
    expect(isJudgeable("", "typescript")).toBe(false);
    expect(isJudgeable("}", "go")).toBe(false);
    expect(isJudgeable("// note", "typescript")).toBe(false);
    expect(isJudgeable("# note", "python")).toBe(false);
    expect(isJudgeable("-- note", "sql")).toBe(false);
    expect(isJudgeable("return x", "python")).toBe(true);
  });
});
