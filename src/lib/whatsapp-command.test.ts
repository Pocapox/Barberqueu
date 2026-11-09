import { describe, expect, it } from "vitest";
import { isCancelCommand } from "./whatsapp-command";

describe("WhatsApp cancellation command", () => {
  it.each(["Cancelar", "CANCELAR", "cancelar", " cancelar ", "CaNcElAr"])("accepts %s", text => {
    expect(isCancelCommand(text)).toBe(true);
  });
  it.each([undefined, "", "cancelado", "cancelar ahora", "NO CANCELAR"])("rejects %s", text => {
    expect(isCancelCommand(text)).toBe(false);
  });
});
