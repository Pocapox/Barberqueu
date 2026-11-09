import { describe, expect, it } from "vitest";
import { normalizePhone } from "./phone";

describe("normalizePhone", () => {
  it.each([
    ["8095551234", "18095551234"],
    ["(829) 555-1234", "18295551234"],
    ["849.555.1234", "18495551234"],
    ["+1 (809) 555-1234", "18095551234"],
    ["18095551234", "18095551234"],
    ["  +34 612 345 678  ", "34612345678"],
    ["0034 612 345 678", "34612345678"],
    ["+443456789012345", "443456789012345"],
  ])("normalizes %s to international digits", (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it("supports an explicit default country code", () => {
    expect(normalizePhone("612 345 678", "34")).toBe("34612345678");
  });

  it("does not add the country code twice", () => {
    expect(normalizePhone(normalizePhone("8095551234"))).toBe("18095551234");
  });

  it.each([
    "", "   ", "abc8095551234", "8095551234 ext 2", "123",
    "+0123456789", "+1234567890123456", "809+5551234", "++18095551234",
    "809/555/1234", "8095551234\n123", "000", "0123456789",
    "1234567890", "1809555123", "+1809555123", "+10005551234",
  ])("rejects invalid or ambiguous input %s", (input) => {
    expect(() => normalizePhone(input)).toThrow();
  });

  it.each(["", "0", "+1", "1234", "abc"])("rejects invalid country code %s", (code) => {
    expect(() => normalizePhone("8095551234", code)).toThrow();
  });
});
