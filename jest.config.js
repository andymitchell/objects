
module.exports = {
    
    preset: 'ts-jest',
    testEnvironment: 'node',
    transform: {
        // Use babel-jest to transform JS files
        '^.+\\.(js|jsx)$': 'babel-jest',
        // Use ts-jest for ts/tsx files
        '^.+\\.(ts|tsx)$': 'ts-jest',
      },
      transformIgnorePatterns: [
        // Don't transform node_modules except lodash-es (or any other ES modules you use)
        '/node_modules/(?!lodash-es|dot-prop|\@electric\-sql\/pglite/)',
      ],
    
      
};
