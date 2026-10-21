module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  setupFilesAfterEnv: ['<rootDir>/tests/setupErrorObservation.ts'],
  globalSetup: '<rootDir>/tests/setup-generated-templates.cjs',
  // Avoid VM global lookup overhead in Math-heavy performance checks.
  sandboxInjectedGlobals: ['Math'],
  roots: ['<rootDir>/tests'],
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
  transform: { '^.+\\.tsx?$': ['ts-jest', { isolatedModules: true, tsconfig: { jsx: 'react-jsx' } }] },
};
