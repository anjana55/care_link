import { cloneElement, createElement, type ReactElement } from 'react';
import { Text } from 'react-native';

/**
 * A stand-in for expo-router, shared by the screen tests:
 *   jest.mock('expo-router', () => require('../test-utils/router').expoRouterMock());
 * Navigation calls are recorded on `mockRouter`; <Redirect> renders where it
 * would go; <Link asChild> behaves like the real one, refusing an array of
 * styles on its child.
 */
type Href = string | { pathname: string; params?: Record<string, string> };

export const mockRouter = {
  push: jest.fn(),
  replace: jest.fn(),
  back: jest.fn(),
  params: {} as Record<string, string>,
  reset() {
    this.push.mockReset();
    this.replace.mockReset();
    this.back.mockReset();
    this.params = {};
  },
};

const describeHref = (href: Href) =>
  typeof href === 'string' ? href : `${href.pathname}${href.params?.role ? `?role=${href.params.role}` : ''}`;

export function expoRouterMock() {
  return {
    Link: ({ href, children }: { href: Href; children: ReactElement<{ style?: unknown }> }) => {
      if (Array.isArray(children.props.style)) throw new Error('[expo-router]: You are passing an array of styles to a child of <Slot>.');
      return cloneElement(children, { testID: `link:${describeHref(href)}` } as never);
    },
    Redirect: ({ href }: { href: Href }) => createElement(Text, null, `redirect:${describeHref(href)}`),
    Stack: () => createElement(require('../app/index').default),
    useRouter: () => mockRouter,
    useLocalSearchParams: () => mockRouter.params,
  };
}
