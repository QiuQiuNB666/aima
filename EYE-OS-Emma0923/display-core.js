// Pure capability policy shared by the controller, receiver and tests.
// Screen coordinates here are browser CSS pixels, never native Windows pixels.
const screenIds = new WeakMap();
let nextScreenId = 0;
export function screenKey(screen) {
  // ScreenDetailed objects are live. Resolution, position and labels may change;
  // they must not redirect a running capture to a different physical screen.
  if (!screenIds.has(screen)) screenIds.set(screen, `screen-${++nextScreenId}`);
  return screenIds.get(screen);
}

export function chooseScreen(screens, preferred = '') {
  const valid = screens.filter(s => Number.isFinite(s.width) && s.width > 0 && Number.isFinite(s.height) && s.height > 0);
  if (preferred) {
    const target = valid.find(s => screenKey(s) === preferred);
    return { target: target || null, reason: target ? 'selected' : 'selection-lost' };
  }
  // A non-primary screen is not necessarily external. Use the browser's capability.
  const external = valid.filter(s => s.isInternal === false);
  return { target: external.length === 1 ? external[0] : null,
    reason: external.length === 1 ? 'single-external' : external.length ? 'ambiguous' : 'no-external' };
}

export function placementFeatures(screen) {
  if (!screen) return 'popup,width=1100,height=700';
  const number = (value, fallback) => Number.isFinite(value) ? Math.round(value) : fallback;
  return `popup,left=${number(screen.availLeft ?? screen.left, 0)},top=${number(screen.availTop ?? screen.top, 0)},width=${Math.max(320, number(screen.availWidth ?? screen.width, 1100))},height=${Math.max(240, number(screen.availHeight ?? screen.height, 700))}`;
}

export function normalizeScene(value = {}) {
  if (!value || typeof value !== 'object') value = {};
  const clean = (s, fallback, max) => typeof s === 'string' && s.trim() ? s.slice(0, max) : fallback;
  return {
    title: clean(value.title, '京都 · 巷间慢行', 100),
    subtitle: clean(value.subtitle, '把目光，留给风景。', 200),
    region: clean(value.region, 'KYOTO, JAPAN', 80),
    theme: ['kyoto', 'iceland', 'amalfi'].includes(value.theme) ? value.theme : 'kyoto',
    // Unknown hardware never activates stereo or claims optical calibration.
    mode: 'mono',
  };
}

export function safeInset(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(12, Math.max(0, n)) : 4;
}

export function viewportLayout(width, height, ratio = 1) {
  const dimension = value => Number.isFinite(Number(value)) ? Math.max(1, Number(value)) : 1;
  const w = dimension(width), h = dimension(height);
  const dpr = Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
  return { width: Math.round(w), height: Math.round(h), pixelWidth: Math.round(w * dpr), pixelHeight: Math.round(h * dpr),
    orientation: w >= h ? 'landscape' : 'portrait', mode: 'mono' };
}
