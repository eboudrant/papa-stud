module.exports = {
  packagerConfig: {
    name: 'PapaStud',
    executableName: 'PapaStud',
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
  makers: [
    {
      name: '@electron-forge/maker-zip',
      platforms: ['darwin', 'linux', 'win32'],
    },
    {
      name: '@electron-forge/maker-dmg',
      config: {
        name: 'PapaStud',
        format: 'ULFO',
      },
    },
  ],
};
