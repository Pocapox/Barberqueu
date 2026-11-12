import { expect, it } from 'vitest';
import { allowedPushEndpoint } from './push-validation';
it.each(['http://fcm.googleapis.com/a','https://localhost/a','https://127.0.0.1','https://fcm.googleapis.com.evil.test','https://fcm.googleapis.com:444/a','https://a:b@web.push.apple.com/a'])('rejects unsafe push destinations: %s',url=>expect(allowedPushEndpoint(url)).toBe(false));
it.each(['https://fcm.googleapis.com/fcm/send/a','https://web.push.apple.com/a','https://updates.push.services.mozilla.com/wpush/v2/a'])('accepts supported browser services: %s',url=>expect(allowedPushEndpoint(url)).toBe(true));
