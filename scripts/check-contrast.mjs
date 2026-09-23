#!/usr/bin/env node
// Verifies every text/background color pair in DESIGN.md against the real
// WCAG relative-luminance contrast formula. Run this after changing any
// color token — a value that "looks fine" is not the same as one that
// passes 4.5:1 (normal text) or 3:1 (UI components like the focus ring).
//
// Usage: node scripts/check-contrast.mjs

function relLuminance(hex) {
  const c = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16) / 255);
  const lin = (v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  const [R, G, B] = [r, g, b].map(lin);
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

function contrastRatio(hex1, hex2) {
  const L1 = relLuminance(hex1);
  const L2 = relLuminance(hex2);
  return (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
}

// Every text/background pair actually used in DESIGN.md's token table.
// Update this list whenever a token changes.
const pairs = [
  ["DARK  text/bg", "#d7dbe0", "#17191d", 4.5],
  ["DARK  text/surface", "#d7dbe0", "#1e2126", 4.5],
  ["DARK  text/surface-hover", "#d7dbe0", "#262a30", 4.5],
  ["DARK  text-dim/bg", "#868e99", "#17191d", 4.5],
  ["DARK  text-dim/surface", "#868e99", "#1e2126", 4.5],
  ["DARK  accent-contrast/accent (button)", "#17191d", "#7b8794", 4.5],
  ["DARK  high-fg/high-bg (badge)", "#e2897d", "#3a2422", 4.5],
  ["DARK  med-fg/med-bg (badge)", "#d8b568", "#37301f", 4.5],
  ["DARK  reviewed-fg/bg", "#7fa08a", "#17191d", 4.5],
  ["DARK  reviewed-fg/surface", "#7fa08a", "#1e2126", 4.5],
  ["DARK  med-fg/bg (signal note text)", "#d8b568", "#17191d", 4.5],
  ["DARK  med-fg/surface (signal note text)", "#d8b568", "#1e2126", 4.5],
  ["DARK  focus-ring/bg (UI, 3:1 rule)", "#9aa4b1", "#17191d", 3.0],

  ["LIGHT text/bg", "#1c1e21", "#f4f5f2", 4.5],
  ["LIGHT text/surface", "#1c1e21", "#ffffff", 4.5],
  ["LIGHT text-dim/bg", "#6b7178", "#f4f5f2", 4.5],
  ["LIGHT text-dim/surface", "#6b7178", "#ffffff", 4.5],
  ["LIGHT accent-contrast/accent (button)", "#ffffff", "#4a525e", 4.5],
  ["LIGHT high-fg/high-bg (badge)", "#a5324a", "#fbe3e6", 4.5],
  ["LIGHT med-fg/med-bg (badge)", "#8f630b", "#fbecd0", 4.5],
  ["LIGHT reviewed-fg/bg", "#5c7657", "#f4f5f2", 4.5],
  ["LIGHT reviewed-fg/surface", "#5c7657", "#ffffff", 4.5],
  ["LIGHT med-fg/bg (signal note text)", "#8f630b", "#f4f5f2", 4.5],
  ["LIGHT med-fg/surface (signal note text)", "#8f630b", "#ffffff", 4.5],
  ["LIGHT focus-ring/bg (UI, 3:1 rule)", "#4a525e", "#f4f5f2", 3.0],
];

let anyFail = false;
for (const [label, fg, bg, req] of pairs) {
  const ratio = contrastRatio(fg, bg);
  const pass = ratio >= req;
  if (!pass) anyFail = true;
  console.log(`${pass ? "PASS" : "FAIL"}  ${label.padEnd(42)} ${fg} on ${bg}  ratio=${ratio.toFixed(2)}  req>=${req}`);
}

console.log(anyFail ? "\nSOME PAIRS FAIL" : "\nALL PAIRS PASS");
process.exit(anyFail ? 1 : 0);
