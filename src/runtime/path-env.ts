export function withWindowsNpmGlobalBin(
  env: NodeJS.ProcessEnv,
  platform = process.platform,
): NodeJS.ProcessEnv {
  if (platform !== 'win32') return env;

  const npmBin = windowsNpmGlobalBin(env, platform);
  if (!npmBin) return env;

  const currentPath = env.Path ?? env.PATH ?? env.path ?? '';
  env.Path = prependPathSegment(currentPath, npmBin, ';', true);
  delete env.PATH;
  delete env.path;
  return env;
}

export function windowsNpmGlobalBin(
  env: NodeJS.ProcessEnv = process.env,
  platform = process.platform,
): string | undefined {
  if (platform !== 'win32') return undefined;
  const appData = trimTrailingSlashes(env.APPDATA);
  return appData ? `${appData}\\npm` : undefined;
}

export function prependPathSegment(
  pathValue: string,
  segment: string,
  delimiter = process.platform === 'win32' ? ';' : ':',
  caseInsensitive = process.platform === 'win32',
): string {
  const normalizedSegment = normalizePathSegment(segment, caseInsensitive);
  const alreadyPresent = pathValue
    .split(delimiter)
    .some((part) => normalizePathSegment(part, caseInsensitive) === normalizedSegment);
  if (alreadyPresent) return pathValue;
  return pathValue ? `${segment}${delimiter}${pathValue}` : segment;
}

function trimTrailingSlashes(value: string | undefined): string {
  return value?.replace(/[\\/]+$/, '') ?? '';
}

function normalizePathSegment(value: string, caseInsensitive: boolean): string {
  const normalized = trimTrailingSlashes(value.trim());
  return caseInsensitive ? normalized.toLowerCase() : normalized;
}
