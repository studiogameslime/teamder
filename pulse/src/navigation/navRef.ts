import { createNavigationContainerRef } from '@react-navigation/native';

// Shared ref so the hamburger menu (rendered outside any screen) can
// navigate to any tab destination.
export const navRef = createNavigationContainerRef();

// `screen` targets a specific child screen inside a stack-tab, so opening a
// tab from the menu always lands on its ROOT screen (e.g. the users LIST)
// instead of restoring whatever detail was last left on top of the stack.
export function go(name: string, screen?: string) {
  if (navRef.isReady()) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (screen) (navRef as any).navigate(name, { screen });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    else (navRef as any).navigate(name);
  }
}
