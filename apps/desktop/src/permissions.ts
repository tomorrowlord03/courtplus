/**
 * Allows microphone capture only for the app's own pages, audio only. Camera, screen and every
 * other permission stay denied.
 */
export function microphoneAllowed(permission: string, requestingUrl: string, mediaTypes: readonly string[], appOrigins: readonly string[]) {
  const url = URL.parse(requestingUrl);
  return permission === 'media' && url !== null && !url.username && !url.password
    && mediaTypes.length > 0 && mediaTypes.every(type => type === 'audio')
    && appOrigins.some(origin => {
      const allowed = new URL(origin);
      return url.protocol === allowed.protocol && url.host === allowed.host;
    });
}
