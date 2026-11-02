import { UIManager } from 'react-native';
import { requireOptionalNativeModule } from 'expo';

/**
 * Whether this build of the app has a native module - asked without loading
 * it. A development build made before a native package was added doesn't have
 * it, and loading it anyway logs an error even when the error is caught; the
 * feature should instead quietly say it isn't available on this phone.
 */
export function hasNativeModule(name: string): boolean {
  try {
    return requireOptionalNativeModule(name) !== null;
  } catch {
    return false;
  }
}

/**
 * Whether this build has a native view, such as react-native-svg's - asked
 * without drawing it. Drawing a view the build doesn't have stops the screen
 * with "Can't find ViewManager", so a picture checks first and falls back.
 */
export function hasNativeView(name: string): boolean {
  try {
    return Boolean(UIManager.hasViewManagerConfig?.(name));
  } catch {
    return false;
  }
}
