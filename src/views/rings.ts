/**
 * Saturn's main rings as a shader function, shared by the close-up globe and the Explosion Lab's map.
 *
 * `saturnRing(r)` takes the distance from the planet's centre in planet radii and returns
 * (brightness, opacity). The radii are the real ones: C ring 1.239–1.527, B ring 1.527–1.951, the Cassini
 * Division 1.951–2.027, A ring 2.027–2.269 with the Encke Gap at 2.214. Brightness and opacity inside
 * each ring are a model (bright, nearly opaque B ring; fainter A ring; thin, dusky C ring); the fine
 * ripples stand for the thousands of ringlets and are not individual measured features.
 */
export const SATURN_RING_INNER = 1.239;
export const SATURN_RING_OUTER = 2.269;

export const SATURN_RING_GLSL = /* glsl */ `
  vec2 saturnRing(float r) {
    float t = (r - ${SATURN_RING_INNER.toFixed(3)}) / ${(SATURN_RING_OUTER - SATURN_RING_INNER).toFixed(3)};
    if (t <= 0.0 || t >= 1.0) return vec2(0.0);
    float ripple = 0.84 + 0.13 * sin(t * 173.0) * sin(t * 61.0 + 1.3) + 0.05 * sin(t * 431.0 + 0.7);
    float cRing = smoothstep(0.0, 0.03, t) * (1.0 - smoothstep(0.268, 0.282, t));
    float bRing = smoothstep(0.276, 0.296, t) * (1.0 - smoothstep(0.684, 0.693, t));
    float division = smoothstep(0.690, 0.698, t) * (1.0 - smoothstep(0.758, 0.766, t));
    float aRing = smoothstep(0.762, 0.772, t) * (1.0 - smoothstep(0.985, 1.0, t));
    float encke = 1.0 - smoothstep(0.9435, 0.9455, t) * (1.0 - smoothstep(0.9495, 0.9515, t));
    float opacity = (cRing * 0.20 + bRing * (0.74 + 0.22 * smoothstep(0.30, 0.62, t)) + division * 0.05 + aRing * 0.60 * encke) * ripple;
    float brightness = cRing * 0.42 + bRing * 1.0 + division * 0.35 + aRing * 0.84;
    return vec2(brightness, clamp(opacity, 0.0, 1.0));
  }
  /** Colour of the ring material at brightness b: dusky brown where thin, cream where dense. */
  vec3 saturnRingColour(float b) {
    return mix(vec3(0.46, 0.40, 0.34), vec3(0.95, 0.89, 0.76), smoothstep(0.3, 1.0, b));
  }
`;
