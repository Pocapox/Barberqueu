export function allowedPushEndpoint(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && (
      url.hostname === 'fcm.googleapis.com' || url.hostname === 'updates.push.services.mozilla.com' ||
      url.hostname === 'web.push.apple.com' || url.hostname.endsWith('.push.apple.com') ||
      url.hostname === 'wns.windows.com' || url.hostname.endsWith('.notify.windows.com')
    );
  } catch { return false; }
}
