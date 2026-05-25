const { execFileSync } = require('child_process');
const path = require('path');

module.exports = {
  packagerConfig: {
    name: 'PapaStudio',
    executableName: 'PapaStudio',
    appBundleId: 'io.papastud.app',
    icon: './static/icon',
    ignore: [
      /^\/server\//,
      /^\/tests\//,
      /^\/data\//,
      /^\/\.github\//,
      /^\/\.claude\//,
      /Dockerfile/,
      /playwright\.config/,
      /CHANGES\//,
      /CLAUDE\.md/,
      /\.gitignore/,
    ],
  },
  // Override CFBundleDisplayName so macOS dock + Finder show "Papa Studio"
  // (with space) instead of the filesystem-friendly "PapaStudio". Don't
  // touch CFBundleName — Electron derives the Helper bundle paths from it
  // (e.g. `${CFBundleName} Helper (Renderer).app`), so a rename here would
  // make the runtime fail with "Unable to find helper app" → SIGTRAP.
  // The plist edit invalidates the bundle's ad-hoc signature; re-sign with
  // --deep so cross-arch builds (where electron-packager leaves nested
  // Squirrel.framework unsigned) get a complete signature chain.
  hooks: {
    postPackage: async (_forgeConfig, options) => {
      if (options.platform !== 'darwin') return;
      for (const outPath of options.outputPaths) {
        const appPath = path.join(outPath, 'PapaStudio.app');
        const plist = path.join(appPath, 'Contents', 'Info.plist');
        execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Set :CFBundleDisplayName Papa Studio', plist]);
        execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath]);
      }
    },
  },
  makers: [
    {
      name: '@electron-forge/maker-zip',
      platforms: ['darwin', 'linux', 'win32'],
    },
    {
      name: '@electron-forge/maker-dmg',
      config: {
        name: 'PapaStudio',
        format: 'ULFO',
      },
    },
  ],
};
