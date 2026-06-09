/**
 * Google-Maps-style camera control overlay for AMap.
 *
 *   ⌘ + drag vertically  → tilt (pitch)
 *   ⇧ + drag horizontally → rotate (bearing)
 *
 * Implementation:
 *   When the modifier is pressed at mousedown, we capture the drag, suppress
 *   AMap's default drag-to-pan for that gesture, and adjust pitch/rotation by
 *   a sensitivity factor of the cursor delta. On mouseup we hand the map back
 *   to AMap.
 *
 * AMap's own keyboard-drag (right-button drag for pitch/rotate) is left
 * enabled — this overlay just adds the GMaps-style modifier gestures on top.
 */

const TILT_SENSITIVITY = 0.5;   // degrees per pixel of vertical drag
const ROTATE_SENSITIVITY = 0.5; // degrees per pixel of horizontal drag
const MAX_PITCH = 75;
const MIN_PITCH = 0;

export class CameraController {
    constructor(map, container) {
        this.map = map;
        this.container = container;
        this._active = null; // 'tilt' | 'rotate' | null
        this._lastX = 0;
        this._lastY = 0;

        this._onDown = this._onDown.bind(this);
        this._onMove = this._onMove.bind(this);
        this._onUp = this._onUp.bind(this);

        container.addEventListener('mousedown', this._onDown, {capture: true});
        window.addEventListener('mousemove', this._onMove, {capture: true});
        window.addEventListener('mouseup', this._onUp, {capture: true});
    }

    destroy() {
        this.container.removeEventListener('mousedown', this._onDown, {capture: true});
        window.removeEventListener('mousemove', this._onMove, {capture: true});
        window.removeEventListener('mouseup', this._onUp, {capture: true});
    }

    _onDown(e) {
        if (e.button !== 0) return;
        const tilt = e.metaKey || e.ctrlKey; // ⌘ on mac, Ctrl on win/linux
        const rotate = e.shiftKey;
        if (!tilt && !rotate) return;
        // Take over this gesture from AMap.
        this._active = tilt ? 'tilt' : 'rotate';
        this._lastX = e.clientX;
        this._lastY = e.clientY;
        // Temporarily disable AMap drag so the pan doesn't fight us.
        try {
            this.map.setStatus({dragEnable: false});
        } catch (_) { /* older AMap */ }
        e.stopPropagation();
        e.preventDefault();
    }

    _onMove(e) {
        if (!this._active) return;
        const dx = e.clientX - this._lastX;
        const dy = e.clientY - this._lastY;
        this._lastX = e.clientX;
        this._lastY = e.clientY;
        // `immediately = true` skips AMap's default smoothing so the camera
        // tracks the cursor 1:1 like Google Maps.
        if (this._active === 'tilt') {
            const current = this.map.getPitch();
            const next = clamp(current - dy * TILT_SENSITIVITY, MIN_PITCH, MAX_PITCH);
            this.map.setPitch(next, true);
        } else if (this._active === 'rotate') {
            const current = this.map.getRotation();
            const next = current + dx * ROTATE_SENSITIVITY;
            this.map.setRotation(((next % 360) + 360) % 360, true);
        }
        e.stopPropagation();
        e.preventDefault();
    }

    _onUp(e) {
        if (!this._active) return;
        this._active = null;
        try {
            this.map.setStatus({dragEnable: true});
        } catch (_) { /* noop */ }
        e.stopPropagation();
    }
}

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
