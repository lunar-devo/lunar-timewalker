/**
 * Keyboard, mouse and touch state for the surface game loop. Keys are tracked by KeyboardEvent.code so the
 * layout (Turkish Q / F keyboards included) does not change the physical WASD cluster; the few keys that act
 * by the character they type have codes of their own (see `CHARACTER_CODES`). On a touch screen one finger
 * looks around and taps, and the keys come from the on-screen pad (`setKey`).
 */
import { getGame, setGame } from './store';

/** A press that moves less than this many pixels is a click: a finger is less steady than a mouse. */
const CLICK_SLOP_PX = { mouse: 5, touch: 12 };

/** Keys whose browser default (scrolling, focus change) must be suppressed while playing. */
const GAME_KEYS: Record<string, true> = {
  Space: true, ArrowUp: true, ArrowDown: true, ArrowLeft: true, ArrowRight: true, Tab: true, PageUp: true, PageDown: true,
};

/**
 * Characters that act by what they are, not by where their key sits: plus and minus are on other keys in
 * every layout (on a Turkish Q keyboard "+" is Shift+4, and "-" is where a US keyboard has "="). A press
 * that types one of them counts as the code given here and not as its physical key, so that "+" does not
 * also act as the digit it shares a key with. "=" is the plus key of a US keyboard without Shift.
 */
const CHARACTER_CODES: Record<string, string> = { '+': 'ZoomIn', '=': 'ZoomIn', '-': 'ZoomOut' };

/** A point on the screen, in CSS pixels from the top-left corner of the window. */
export interface ScreenPoint {
  x: number;
  y: number;
}

/**
 * True when a key press belongs to the control that has the focus: a text, number or date field, an open
 * list, the space bar on a checkbox, the arrows on a slider. Letters pressed on a checkbox, a slider or a
 * button do not: shortcuts still work from them.
 */
export function keyBelongsToControl(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  if (!t || typeof t.tagName !== 'string') return false;
  if (t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable) return true;
  if (!(t instanceof HTMLInputElement)) return false;
  if (t.type === 'checkbox' || t.type === 'radio') return e.code === 'Space';
  if (t.type === 'range') return e.code.startsWith('Arrow') || e.code === 'Home' || e.code === 'End' || e.code.startsWith('Page');
  return true;
}

export class Input {
  private readonly down = new Set<string>();
  private readonly pressedThisFrame = new Set<string>();
  /** Physical keys held that count as a character's code, by KeyboardEvent.code: the key is released by it. */
  private readonly heldAsCharacter = new Map<string, string>();
  private lookX = 0;
  private lookY = 0;
  private wheel = 0;
  private clicks = 0;
  private clickAt: ScreenPoint | null = null;
  private hover: ScreenPoint | null = null;
  private leftDown = false;
  private rightDown = false;
  private dragMoved = 0;
  private lastMouseX = 0;
  private lastMouseY = 0;
  /** The finger that is looking around, by its pointer id; null when none is down. */
  private finger: number | null = null;
  /** When false, key presses are ignored (menus, text inputs). */
  enabled = false;

  constructor(private readonly canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('pointerlockchange', this.onLockChange);
    document.addEventListener('mousemove', this.onMouseMove);
    canvas.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    canvas.addEventListener('pointerdown', this.onTouchDown);
    window.addEventListener('pointermove', this.onTouchMove);
    window.addEventListener('pointerup', this.onTouchUp);
    window.addEventListener('pointercancel', this.onTouchUp);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    canvas.addEventListener('contextmenu', this.onContextMenu);
  }

  get locked(): boolean {
    return document.pointerLockElement === this.canvas;
  }

  requestLock(): void {
    // A touch screen has no pointer to lock (the method is missing there).
    if (this.locked || typeof this.canvas.requestPointerLock !== 'function') return;
    // Browsers reject the request shortly after an Esc-unlock; that rejection is expected and harmless.
    const p = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined;
    p?.catch?.(() => undefined);
  }

  exitLock(): void {
    if (this.locked) document.exitPointerLock();
  }

  isDown(code: string): boolean {
    return this.down.has(code);
  }

  /** Presses or releases a key from an on-screen control; it counts exactly as the key itself. */
  setKey(code: string, down: boolean): void {
    if (!this.enabled) return;
    if (!down) {
      this.down.delete(code);
      return;
    }
    if (!this.down.has(code)) this.pressedThisFrame.add(code);
    this.down.add(code);
  }

  /** True only on the frame the key went down. */
  wasPressed(code: string): boolean {
    return this.pressedThisFrame.has(code);
  }

  get rightButton(): boolean {
    return this.rightDown;
  }

  /** Accumulated mouse movement in pixels since the last call (pointer-locked only). */
  consumeLook(): { dx: number; dy: number } {
    const r = { dx: this.lookX, dy: this.lookY };
    this.lookX = 0;
    this.lookY = 0;
    return r;
  }

  /** Accumulated wheel delta (positive = scroll down / zoom out). */
  consumeWheel(): number {
    const w = this.wheel;
    this.wheel = 0;
    return w;
  }

  /**
   * Primary-button clicks on the canvas since the last call, and where the last of them landed. `at` is null
   * when the pointer is locked: such a click belongs to the crosshair.
   */
  consumeClicks(): { count: number; at: ScreenPoint | null } {
    const r = { count: this.clicks, at: this.clickAt };
    this.clicks = 0;
    this.clickAt = null;
    return r;
  }

  /** Where the free pointer rests on the canvas; null when it is locked or over something else. */
  get hoverPoint(): ScreenPoint | null {
    return this.hover;
  }

  /** Call at the end of every frame. */
  endFrame(): void {
    this.pressedThisFrame.clear();
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('pointerlockchange', this.onLockChange);
    document.removeEventListener('mousemove', this.onMouseMove);
    this.canvas.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    this.canvas.removeEventListener('pointerdown', this.onTouchDown);
    window.removeEventListener('pointermove', this.onTouchMove);
    window.removeEventListener('pointerup', this.onTouchUp);
    window.removeEventListener('pointercancel', this.onTouchUp);
    this.canvas.removeEventListener('wheel', this.onWheel);
    this.canvas.removeEventListener('contextmenu', this.onContextMenu);
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (!this.enabled || keyBelongsToControl(e) || e.metaKey || e.ctrlKey || e.altKey) return;
    if (GAME_KEYS[e.code]) e.preventDefault();
    // A real key: the on-screen pad of a touch screen is not needed any more.
    if (getGame().touchInput) setGame({ touchInput: false });
    // A key that went down as a character stays that character while it repeats, also once Shift is let go.
    const code = CHARACTER_CODES[e.key] ?? this.heldAsCharacter.get(e.code) ?? e.code;
    if (code !== e.code) this.heldAsCharacter.set(e.code, code);
    if (!this.down.has(code)) this.pressedThisFrame.add(code);
    this.down.add(code);
  };

  /** The character a key typed when it went down is what is released, whatever Shift does in between. */
  private onKeyUp = (e: KeyboardEvent): void => {
    const character = this.heldAsCharacter.get(e.code);
    if (character) {
      this.heldAsCharacter.delete(e.code);
      this.down.delete(character);
    }
    this.down.delete(e.code);
  };

  /** The window lost the keyboard: nothing stays held, and nothing queued acts when it comes back. */
  private onBlur = (): void => {
    this.down.clear();
    this.heldAsCharacter.clear();
    this.pressedThisFrame.clear();
    this.leftDown = false;
    this.rightDown = false;
    this.finger = null;
    this.lookX = 0;
    this.lookY = 0;
    this.wheel = 0;
    this.clicks = 0;
    this.clickAt = null;
  };

  private onLockChange = (): void => {
    setGame({ pointerLocked: this.locked });
    if (this.locked) this.hover = null;
    else { this.down.clear(); this.heldAsCharacter.clear(); this.leftDown = false; this.rightDown = false; }
  };

  private onMouseMove = (e: MouseEvent): void => {
    if (this.locked) {
      this.lookX += e.movementX;
      this.lookY += e.movementY;
      return;
    }
    this.hover = e.target === this.canvas ? { x: e.clientX, y: e.clientY } : null;
    if (!this.enabled || !this.leftDown) return;
    const dx = e.clientX - this.lastMouseX;
    const dy = e.clientY - this.lastMouseY;
    this.lastMouseX = e.clientX;
    this.lastMouseY = e.clientY;
    this.dragMoved += Math.hypot(dx, dy);
    this.lookX += dx * 1.35;
    this.lookY += dy * 1.35;
  };

  private onMouseDown = (e: MouseEvent): void => {
    if (e.button === 0) {
      if (this.locked) {
        this.clicks++;
        this.clickAt = null;
      } else {
        this.leftDown = true;
        this.dragMoved = 0;
        this.lastMouseX = e.clientX;
        this.lastMouseY = e.clientY;
      }
    }
    if (e.button === 2) this.rightDown = true;
  };

  private onMouseUp = (e: MouseEvent): void => {
    if (e.button === 0 && this.leftDown) {
      this.leftDown = false;
      if (this.enabled && this.dragMoved < CLICK_SLOP_PX.mouse) {
        this.clicks++;
        this.clickAt = { x: e.clientX, y: e.clientY };
      }
    }
    if (e.button === 2) this.rightDown = false;
  };

  /** The first finger on the canvas looks around; without movement it is a click where it was put down. */
  private onTouchDown = (e: PointerEvent): void => {
    if (e.pointerType !== 'touch') return;
    // No mouse events are made up for this touch: they would count the tap a second time.
    e.preventDefault();
    if (!getGame().touchInput) setGame({ touchInput: true });
    if (this.finger !== null) return;
    this.finger = e.pointerId;
    this.dragMoved = 0;
    this.lastMouseX = e.clientX;
    this.lastMouseY = e.clientY;
  };

  private onTouchMove = (e: PointerEvent): void => {
    if (e.pointerId !== this.finger) return;
    const dx = e.clientX - this.lastMouseX;
    const dy = e.clientY - this.lastMouseY;
    this.lastMouseX = e.clientX;
    this.lastMouseY = e.clientY;
    this.dragMoved += Math.hypot(dx, dy);
    if (!this.enabled) return;
    this.lookX += dx * 1.35;
    this.lookY += dy * 1.35;
  };

  private onTouchUp = (e: PointerEvent): void => {
    if (e.pointerId !== this.finger) return;
    this.finger = null;
    if (e.type === 'pointerup' && this.enabled && this.dragMoved < CLICK_SLOP_PX.touch) {
      this.clicks++;
      this.clickAt = { x: e.clientX, y: e.clientY };
    }
  };

  private onWheel = (e: WheelEvent): void => {
    if (!this.enabled) return;
    e.preventDefault();
    this.wheel += e.deltaY;
  };

  private onContextMenu = (e: Event): void => {
    e.preventDefault();
  };
}
