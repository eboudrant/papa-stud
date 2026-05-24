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
  // electron-packager's `extendInfo` is ignored for CFBundleName /
  // CFBundleDisplayName because `name` wins for those specific keys; patch
  // the plist directly after packaging so macOS dock + Finder show
  // "Papa Studio" instead of the filesystem-friendly "PapaStudio".
  hooks: {
    postPackage: async (_forgeConfig, options) => {
      if (options.platform !== 'darwin') return;
      for (const outPath of options.outputPaths) {
        const plist = path.join(outPath, 'PapaStudio.app', 'Contents', 'Info.plist');
        execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Set :CFBundleName Papa Studio', plist]);
        execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Set :CFBundleDisplayName Papa Studio', plist]);
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
