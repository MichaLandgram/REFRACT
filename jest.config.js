module.exports = {
  transformIgnorePatterns: ['node_modules/(?!(yjs|lib0|sucrase|y-protocols|y-websocket)/)'],
  transform: {
    '^.+\\.(js|jsx|ts|tsx|mjs)$': 'babel-jest',
  },
  setupFilesAfterEnv: ['<rootDir>/src/setupTests.ts'],
  testEnvironment: 'jsdom',
  collectCoverageFrom: [
    // TODO:
  ]
};

// Commands to run tests and view coverage report:
// Invoke-Item coverage\lcov-report\index.htm
// or 
// start coverage\lcov-report\index.html

