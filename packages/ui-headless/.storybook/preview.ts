import type { Preview } from '@storybook/react';

const preview: Preview = {
  parameters: {
    actions: { argTypesRegex: '^on[A-Z].*' },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/
      }
    },
    a11y: {
      element: '#root',
      config: {},
      options: {
        checks: { 'color-contrast': { options: { noScroll: true } } }
      }
    }
  }
};

export default preview;
