import { expect, expectTypeOf, test } from "vitest";
import { isContractError, type ContractError, type Document } from "./types.ts";

test.each<{ name: string; value: Document | ContractError; isError: boolean }>([
  {
    name: "a parsed document",
    isError: false,
    value: {
      path: "memory/decision.md",
      type: "decision",
      title: "Keep memory in files",
      description: "Memory files are the source of record.",
      tier: "living",
      status: "stable",
      verified: [],
      sources: [],
      tags: [],
      body: "Store memory as Markdown.",
    },
  },
  {
    name: "a contract violation",
    isError: true,
    value: {
      path: "memory/decision.md",
      rule: "required-field",
      message: "The title is missing.",
      fix: "Add a title to the frontmatter.",
    },
  },
])("recognizes $name", ({ value, isError }) => {
  expect(isContractError(value)).toBe(isError);

  if (isContractError(value)) {
    expectTypeOf(value).toEqualTypeOf<ContractError>();
  } else {
    expectTypeOf(value).toEqualTypeOf<Document>();
  }

  expectTypeOf<Document["tier"]>().toEqualTypeOf<"living" | "archive">();
  expectTypeOf<Document["status"]>().toEqualTypeOf<"draft" | "stable" | "deprecated">();
});
