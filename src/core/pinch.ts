/**
 * Two fingers on a touch screen do what the wheel does: spreading them zooms in, pinching zooms out. The
 * views and the surface only know the wheel, so the gesture is handed to them as wheel events at the point
 * between the fingers.
 */

/** Wheel units per pixel the fingers move apart or together: 100 pixels is about three notches of a wheel. */
const WHEEL_PER_PX = 3;

/** Starts turning pinches on `target` into wheel events; the function returned stops it. */
export function attachPinch(target: HTMLElement): () => void {
  const fingers = new Map<number, { x: number; y: number }>();
  let apart = 0;

  const gap = (): number => {
    const [a, b] = [...fingers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };
  const onDown = (e: PointerEvent): void => {
    if (e.pointerType !== 'touch') return;
    fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (fingers.size === 2) apart = gap();
  };
  const onMove = (e: PointerEvent): void => {
    const finger = fingers.get(e.pointerId);
    if (!finger) return;
    finger.x = e.clientX;
    finger.y = e.clientY;
    if (fingers.size !== 2) return;
    const now = gap();
    const [a, b] = [...fingers.values()];
    target.dispatchEvent(new WheelEvent('wheel', {
      deltaY: (apart - now) * WHEEL_PER_PX,
      clientX: (a.x + b.x) / 2,
      clientY: (a.y + b.y) / 2,
      bubbles: true,
      cancelable: true,
    }));
    apart = now;
  };
  const onUp = (e: PointerEvent): void => {
    fingers.delete(e.pointerId);
  };

  target.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
  return () => {
    target.removeEventListener('pointerdown', onDown);
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
  };
}
