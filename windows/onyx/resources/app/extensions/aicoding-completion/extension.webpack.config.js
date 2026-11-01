/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//@ts-check

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import CopyWebpackPlugin from 'copy-webpack-plugin';
import { node } from '../shared.webpack.config.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APPNAME = (process.env.APPNAME || 'Qoder').replace(/ Insider$/, '');
const mediaSourceDir = APPNAME === 'Qoder' ? 'media-qoder' : 'media-lingma';

const nodeConfig = node({
	context: __dirname,
	entry: {
		extension: './src/extension.ts',
		'diff-worker': './src/diff-history/diff-worker.ts',
	},
	externals: {
		'vscode': 'commonjs vscode',
		'axios': 'commonjs axios',
		'node-fetch': 'commonjs node-fetch',
	},
});

export default {
	...nodeConfig,
	plugins: [
		new CopyWebpackPlugin({
			patterns: [
				{ from: path.join(__dirname, mediaSourceDir), to: path.join(__dirname, 'media') },
			],
		}),
		...(nodeConfig.plugins ?? []),
	],
};
