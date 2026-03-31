module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  collectCoverageFrom: ['lib/**/*.js'],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'text-summary'],
};
