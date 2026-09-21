import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Config } from '@remotion/cli/config';

function playwrightChrome(): string | undefined {
  const versions = ['1243', '1228', '1223', '1208'];
  for (const version of versions) {
    const candidate = join(
      homedir(),
      '.cache/ms-playwright',
      `chromium-${version}`,
      'chrome-linux64',
      'chrome',
    );
    if (existsSync(candidate)) return candidate;
  }
  if (existsSync('/usr/bin/chromium-browser')) return '/usr/bin/chromium-browser';
  return undefined;
}

const executable = playwrightChrome();
if (executable) Config.setBrowserExecutable(executable);

Config.setVideoImageFormat('jpeg');
Config.setOverwriteOutput(true);
// WSL has no GPU (/dev/dri). `angle` waits on GL and leaves CPU idle; swangle is software.
Config.setChromiumOpenGlRenderer('swangle');
Config.overrideWebpackConfig((currentConfiguration) => {
  return {
    ...currentConfiguration,
    module: {
      ...currentConfiguration.module,
      rules: [
        ...(currentConfiguration.module?.rules ?? []),
        { test: /\.vtt$/, type: 'asset/source' },
      ],
    },
  };
});
