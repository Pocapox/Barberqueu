import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  isNotificationSupported,
  getNotificationPermission,
  requestNotificationPermission,
  playNotificationSound,
  sendAppNotification,
} from "./notifications";

describe("notifications utility", () => {
  const originalWindow = globalThis.window;
  const originalNotification = globalThis.Notification;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).window = originalWindow;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).Notification = originalNotification;
  });

  it("handles environment without window or Notification gracefully", () => {
    // In node environment without window.Notification
    expect(isNotificationSupported()).toBe(false);
    expect(getNotificationPermission()).toBe("unsupported");
    expect(playNotificationSound("ding")).toBeUndefined();
  });

  it("reports supported when window and Notification exist", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).window = globalThis;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).Notification = {
      permission: "default",
      requestPermission: vi.fn().mockResolvedValue("granted"),
    };

    expect(isNotificationSupported()).toBe(true);
    expect(getNotificationPermission()).toBe("default");
  });

  it("requests permission and returns granted result", async () => {
    const requestPermissionMock = vi.fn().mockResolvedValue("granted");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).window = globalThis;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).Notification = {
      permission: "default",
      requestPermission: requestPermissionMock,
    };

    const res = await requestNotificationPermission();
    expect(res).toBe("granted");
    expect(requestPermissionMock).toHaveBeenCalled();
  });

  it("handles denied permission request", async () => {
    const requestPermissionMock = vi.fn().mockRejectedValue(new Error("denied"));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).window = globalThis;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).Notification = {
      permission: "default",
      requestPermission: requestPermissionMock,
    };

    const res = await requestNotificationPermission();
    expect(res).toBe("denied");
  });

  it("sends notification via Notification constructor when service worker not available", async () => {
    const notificationConstructor = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).window = globalThis;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).Notification = Object.assign(notificationConstructor, {
      permission: "granted",
    });

    const success = await sendAppNotification("Turno listo", { body: "Pasa al sillón" });
    expect(success).toBe(true);
    expect(notificationConstructor).toHaveBeenCalledWith(
      "Turno listo",
      expect.objectContaining({
        body: "Pasa al sillón",
        icon: "/icon-192.png",
      })
    );
  });

  it("returns false if permission is not granted", async () => {
    const notificationConstructor = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).window = globalThis;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).Notification = Object.assign(notificationConstructor, {
      permission: "denied",
    });

    const success = await sendAppNotification("Turno listo");
    expect(success).toBe(false);
    expect(notificationConstructor).not.toHaveBeenCalled();
  });
});
