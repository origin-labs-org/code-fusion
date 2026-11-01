'use strict';

import { node } from '../shared.webpack.config.mjs';
import webpack from 'webpack';
import path from 'path';

export default node({
	context: import.meta.dirname,
	output: {
		filename: '[name].js',
		path: path.join(import.meta.dirname, 'dist'),
		libraryTarget: 'commonjs',
	},
	entry: {
		extension: './src/extension.ts',
	},
	externals: {
		vscode: "commonjs vscode",
		bufferutil: "bufferutil",
		"utf-8-validate": "utf-8-validate",
	},
	plugins: [
		new webpack.IgnorePlugin({
			resourceRegExp: /crypto\/build\/Release\/sshcrypto\.node$/,
		}),
		new webpack.IgnorePlugin({
			resourceRegExp: /cpu-features/,
		})
	]
});
