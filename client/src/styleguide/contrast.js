// WCAG 2.x relative-luminance / contrast, computed live in the browser so the
// ratios shown on the StyleGuide are always the ratios actually rendering.
// A palette edit that reintroduces a failure will light up red here.

function srgbToLinear(c) {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

/** Resolve any CSS color (incl. `var(--x)`) to [r,g,b] via the browser. */
export function resolveColor(cssColor) {
  const probe = document.createElement("span");
  probe.style.display = "none";
  probe.style.color = cssColor;
  document.body.appendChild(probe);
  const computed = getComputedStyle(probe).color;
  probe.remove();
  const m = computed.match(/-?\d+(\.\d+)?/g);
  if (!m) return [0, 0, 0];
  return [Number(m[0]), Number(m[1]), Number(m[2])];
}

export function luminance([r, g, b]) {
  return (
    0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b)
  );
}

/** Contrast ratio between two CSS colors, rounded to 2dp. */
export function contrast(fg, bg) {
  const lf = luminance(resolveColor(fg));
  const lb = luminance(resolveColor(bg));
  const hi = Math.max(lf, lb);
  const lo = Math.min(lf, lb);
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
}

/**
 * WCAG verdict.
 * `size`: "normal" (needs 4.5), "large" (>=18.66px bold or >=24px, needs 3),
 * or "nontext" (UI components / decorative, needs 3).
 */
export function verdict(ratio, size = "normal") {
  const min = size === "normal" ? 4.5 : 3;
  const aaa = size === "normal" ? 7 : 4.5;
  if (ratio >= aaa) return { label: "AAA", state: "pass" };
  if (ratio >= min) return { label: "AA", state: "pass" };
  return { label: "FAIL", state: "fail" };
}
