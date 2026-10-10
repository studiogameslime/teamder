module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // Avoid VM global lookup overhead in Math-heavy performance checks.
  sandboxInjectedGlobals: ['Math'],
  roots: ['<rootDir>/tests'],
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
  transform: { '^.+\\.tsx?$': ['ts-jest', { isolatedModules: true, tsconfig: { jsx: 'react-jsx' } }] },
};
