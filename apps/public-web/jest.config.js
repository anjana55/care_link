/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  transform: {
    '^.+\\.(t|j)sx?$': ['ts-jest', { tsconfig: 'tsconfig.jest.json' }],
  },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@care-platform/shared$': '<rootDir>/../../packages/shared/src/index.ts',
    '^@care-platform/shared/i18n$': '<rootDir>/../../packages/shared/src/i18n/create-i18n.tsx',
  },
  testPathIgnorePatterns: ['/node_modules/', '/.next/'],
};
