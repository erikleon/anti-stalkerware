// electron-builder configuration. Kept in JS, not package.json's "build"
// field, because a platform's `files` list replaces the top-level list
// instead of merging with it. With the lists in JSON, adding one
// per-platform exclude silently dropped every shared exclude, and the
// installers shipped the whole repository: .git, src/, test/,
// qa-reports/, and the design docs. Here each platform list is built
// from the same base.

/** Everything that isn't the built app. The app is dist/ plus production node_modules. */
const base = [
  "**/*",
  "!.git/**/*",
  "!.github/**/*",
  "!.gitignore",
  "!src/**/*",
  "!renderer/**/*",
  "!test/**/*",
  "!test-results/**/*",
  "!playwright-report/**/*",
  "!qa-reports/**/*",
  "!docs/**/*",
  "!scripts/**/*",
  "!release/**/*",
  "!models/**/*",
  "!build/**/*",
  "!*.md",
  "!package-lock.json",
  "!tsconfig*.json",
  "!playwright.config.ts",
  "!vitest.config.ts",
  "!eslint.config.js",
  "!electron-builder.cjs",
  "!dist/**/*.map",
  "!dist/**/*.d.ts",
  // Native-module source and build inputs: both modules load prebuilt N-API binaries.
  "!node_modules/better-sqlite3/{deps,src}/**/*",
];

/** Native binaries for the other platforms. onnxruntime names platforms after Node (darwin/win32); better-sqlite3 adds linuxmusl. */
const otherPlatformBinaries = {
  mac: ["!node_modules/onnxruntime-node/bin/napi-v6/{linux,win32}/**", "!node_modules/better-sqlite3/prebuilds/{linux,linuxmusl,win32}-*.node"],
  win: ["!node_modules/onnxruntime-node/bin/napi-v6/{linux,darwin}/**", "!node_modules/better-sqlite3/prebuilds/{darwin,linux,linuxmusl}-*.node"],
  linux: ["!node_modules/onnxruntime-node/bin/napi-v6/{darwin,win32}/**", "!node_modules/better-sqlite3/prebuilds/{darwin,win32}-*.node"],
};

/** @type {import("electron-builder").Configuration} */
module.exports = {
  appId: "com.docket.notes",
  productName: "Notes",
  directories: { output: "release", buildResources: "build" },
  files: base,
  asarUnpack: ["**/*.node"],
  // Pinned assets as plain files next to the app (process.resourcesPath/models),
  // not inside app.asar: onnxruntime opens the .onnx file by path. The
  // WhatsMyName rules ship with their license and attribution (CC BY-SA 4.0).
  extraResources: [
    {
      from: "models",
      to: "models",
      filter: ["toxicity.json", "toxicity/**", "whatsmyname.json", "whatsmyname.ATTRIBUTION.txt", "whatsmyname/**"],
    },
  ],
  // Both native modules ship prebuilt N-API binaries that load in any
  // Node or Electron version; rebuilding would compile better-sqlite3
  // from source for nothing.
  npmRebuild: false,
  mac: {
    target: ["dmg"],
    category: "public.app-category.productivity",
    icon: "build/icon.icns",
    files: [...base, ...otherPlatformBinaries.mac],
  },
  win: {
    target: ["nsis"],
    icon: "build/icon.ico",
    files: [...base, ...otherPlatformBinaries.win],
  },
  nsis: { oneClick: false, allowToChangeInstallationDirectory: true },
  linux: {
    target: ["AppImage"],
    icon: "build/icon.png",
    category: "Office",
    files: [...base, ...otherPlatformBinaries.linux],
  },
};
