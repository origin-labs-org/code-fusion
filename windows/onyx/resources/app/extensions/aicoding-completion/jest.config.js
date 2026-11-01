/** @type {import('jest').Config} */
module.exports = {
	preset: 'ts-jest',
	testEnvironment: 'node',
	roots: ['<rootDir>/src'],
	testMatch: [
		'**/__tests__/**/*.test.ts'
	],
	transform: {
		'^.+\\.ts$': 'ts-jest'
	},
	moduleFileExtensions: ['ts', 'js', 'json'],
	moduleNameMapper: {
		'^vscode$': '<rootDir>/src/lsp-context/__tests__/__mocks__/vscode.ts'
	},
	globals: {
		'ts-jest': {
			tsconfig: {
				module: 'commonjs',
				esModuleInterop: true,
				types: ['jest', 'node']
			}
		}
	}
};

