import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { barberPinFingerprint, hashBarberPin, issueBarberToken, ownerPinMatches, verifyBarberPin, verifyBarberToken } from "./barber-auth";

beforeEach(() => {
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-server-secret");
  vi.stubEnv("ADMIN_PIN", "owner-secret");
});
afterEach(() => vi.unstubAllEnvs());

describe("barber credentials", () => {
  it("salts and verifies a PIN without storing its plaintext", async () => {
    const first = await hashBarberPin("123456");
    const second = await hashBarberPin("123456");
    expect(first).not.toBe(second);
    expect(first).not.toContain("123456");
    expect(await verifyBarberPin("123456", first)).toBe(true);
    expect(await verifyBarberPin("654321", first)).toBe(false);
    expect(await verifyBarberPin("123456", "invalid")).toBe(false);
  });
  it("uses the same private fingerprint to prevent PIN reuse", () => {
    expect(barberPinFingerprint("123456")).toBe(barberPinFingerprint("123456"));
    expect(barberPinFingerprint("123456")).not.toBe(barberPinFingerprint("654321"));
    expect(ownerPinMatches("owner-secret")).toBe(true);
    expect(ownerPinMatches("wrong")).toBe(false);
  });
  it("signs a short-lived, tamper-resistant shop session", () => {
    const shopId = "00000000-0000-0000-0000-000000000002";
    const token = issueBarberToken(shopId, "stored-hash");
    expect(verifyBarberToken(token)?.shopId).toBe(shopId);
    expect(verifyBarberToken(`${token}x`)).toBeNull();
    expect(verifyBarberToken("bad")).toBeNull();
  });
});
