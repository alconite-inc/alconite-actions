const WINDOWS_DEVICE_BASENAMES = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
]);

/** Exact platform-parity predicate for one normal, cross-platform-safe path component. */
export function isPortablePathComponent(component: string): boolean {
  if (!component || component === '.' || component === '..' || component.endsWith('.') || component.endsWith(' ')) {
    return false;
  }
  if (/[<>:"|?*]|\p{Cc}/u.test(component)) return false;
  const basename = component.split('.', 1)[0]?.toUpperCase() ?? '';
  return !WINDOWS_DEVICE_BASENAMES.has(basename);
}

/** Exact platform-parity syntax predicate; byte/profile bounds remain caller-specific. */
export function hasPortableRelativePathSyntax(value: string): boolean {
  return value.length > 0 && !value.includes('\\') && !value.startsWith('/') &&
    !/^[A-Za-z]:/u.test(value) && value.split('/').every(isPortablePathComponent);
}
