import path from 'path';
import webpack from 'webpack';
import CopyWebpackPlugin from 'copy-webpack-plugin';
import TerserPlugin from 'terser-webpack-plugin';
import { execSync } from 'child_process';
import fs from 'fs';


// 固定品牌/环境常量（不依赖 env）
const APPNAME = (process.env.APPNAME || 'Qoder').replace(' Insider', '');
const APPNAME_CN = (process.env.APPNAME_CN || 'Qoder').replace(' Insider', '');
const APPNAME_LOWERCASE = APPNAME.toLowerCase().replace(/\s+/g, '-');
const COMMAND_PREFIX = 'aicoding';
const EXT_PUBLISHER = 'aicoding';
const EXT_PUBLISHER_LOWERCASE = EXT_PUBLISHER.toLowerCase();
const EXT_NAME = 'aicoding-agent';

// 替换规则（常量）
const REPLACEMENTS = {
	'@@APPNAME@@': APPNAME,
	'@@APPNAME_CN@@': APPNAME_CN,
	'@@APPNAME_LOWERCASE@@': APPNAME_LOWERCASE,
	'@@COMMAND_PREFIX@@': COMMAND_PREFIX,
	'@@EXT_PUBLISHER@@': EXT_PUBLISHER,
	'@@EXT_PUBLISHER_LOWERCASE@@': EXT_PUBLISHER_LOWERCASE,
	'@@EXT_NAME@@': EXT_NAME,
};

const createStringReplaceOptions = () => {
	return Object.entries(REPLACEMENTS).map(([search, replace]) => ({
		search,
		replace,
		flags: 'g'
	}));
};

const applyStringReplacements = (content) => {
	let result = content;
	Object.entries(REPLACEMENTS).forEach(([search, replace]) => {
		const regex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
		result = result.replace(regex, replace);
	});
	return result;
};

// 根据 APPNAME 选择 media 目录
const mediaSourceDir = APPNAME === 'Qoder' ? 'media-qoder' : 'media-lingma';

// 自定义插件：在构建前执行 preTask.js
class PreTaskPlugin {
	constructor(options = {}) {
		this.options = options;
	}

	apply(compiler) {
		compiler.hooks.beforeRun.tapAsync('PreTaskPlugin', (compiler, callback) => {
			console.log('[PreTaskPlugin] Running preTask.js before build...');
			try {
				console.log('[PreTaskPlugin] Deleting d3-dispatch types...');
				const d3DispatchPath = path.resolve(import.meta.dirname, 'node_modules', '@types', 'd3-dispatch');
				if (fs.existsSync(d3DispatchPath)) {
					fs.rmSync(d3DispatchPath, { recursive: true, force: true });
				}
				console.log('[PreTaskPlugin] d3-dispatch types deleted successfully');
				const preTaskScript = path.resolve(import.meta.dirname, 'scripts/preTask.js');
				execSync(`node "${preTaskScript}"`, {
					stdio: 'inherit',
					cwd: import.meta.dirname,
					env: { ...process.env, APPNAME }
				});
				console.log('[PreTaskPlugin] preTask.js completed successfully');
				callback();
			} catch (error) {
				console.error('[PreTaskPlugin] Error executing preTask.js:', error);
				callback(error);
			}
		});

		// 也在 watch 模式下的重新编译前执行
		compiler.hooks.watchRun.tapAsync('PreTaskPlugin', (compiler, callback) => {
			console.log('[PreTaskPlugin] Running preTask.js before watch rebuild...');
			try {
				const preTaskScript = path.resolve(import.meta.dirname, 'scripts/preTask.js');
				execSync(`node "${preTaskScript}"`, {
					stdio: 'inherit',
					cwd: import.meta.dirname,
					env: { ...process.env, APPNAME }
				});
				console.log('[PreTaskPlugin] preTask.js completed successfully');
				callback();
			} catch (error) {
				console.error('[PreTaskPlugin] Error executing preTask.js:', error);
				callback(error);
			}
		});
	}
}

export default {
	context: import.meta.dirname,
	target: 'node', // VS Code extensions run in Node.js context
	mode: process.env.NODE_ENV === 'production' ? 'production' : 'development',
	entry: {
		extension: './src/extension.ts'
	},
	output: {
		path: path.join(import.meta.dirname, 'dist'),
		filename: 'extension.js',
		libraryTarget: 'commonjs2', // Required for VS Code extensions
		clean: true, // Clean output directory before build
	},
	externals: {
		vscode: 'commonjs vscode', // Exclude vscode module
	},
	resolve: {
		extensions: ['.ts', '.js', '.node'], // Support TypeScript and JavaScript files
	},
	optimization: {
		minimize: true,
		minimizer: [
			new TerserPlugin({
				terserOptions: {
					compress: {
						drop_console: true,
					}
				},
			}),
		],
	},
	module: {
		rules: [
			{
				test: /\.ts$/,
				exclude: /node_modules/,
				use: [
					{ loader: 'ts-loader' },
					{
						loader: 'string-replace-loader',
						options: { multiple: createStringReplaceOptions() },
					},
				],
			},
			{
				test: /\.js$/,
				exclude: /node_modules/,
				use: [
					{
						loader: 'string-replace-loader',
						options: { multiple: createStringReplaceOptions() },
					},
				],
			},
			{
				test: /\.node$/,
				loader: 'node-loader',
			},
			{
				test: /\.(png|jpg|jpe?g|gif)$/,
				use: {
					loader: 'file-loader',
					options: {
						outputPath: './image/',
					},
				},
			},
			{
				test: /\.html$/,
				use: [
					{ loader: 'html-loader' },
					{
						loader: 'string-replace-loader',
						options: { multiple: createStringReplaceOptions() },
					},
				],
			},
		],
	},
	plugins: [
		new PreTaskPlugin(),
		new webpack.DefinePlugin({
			'process.env.IS_DEV': JSON.stringify(undefined),
			'process.env.IS_DEV_IDE': JSON.stringify(undefined),
		}),
		// 自定义插件：过滤 ModuleDependencyWarning
		{
			apply: (compiler) => {
				compiler.hooks.done.tap('FilterModuleDependencyWarning', (stats) => {
					if (stats.compilation.warnings) {
						stats.compilation.warnings = stats.compilation.warnings.filter((warning) => {
							// 过滤掉 ModuleDependencyWarning
							return !(
								warning.name === 'ModuleDependencyWarning' ||
								(warning.message && warning.message.includes('Critical dependency: the request of a dependency is an expression'))
							);
						});
					}
				});
			}
		},
		new CopyWebpackPlugin({
			patterns: [
				{
					from: 'l10n/package.nls.json',
					to: path.resolve(import.meta.dirname, 'package.nls.json'),
					transform(content) {
						const contentStr = content.toString();
						return applyStringReplacements(contentStr);
					},
				},
				{
					from: 'l10n/package.nls.zh-cn.json',
					to: path.resolve(import.meta.dirname, 'package.nls.zh-cn.json'),
					transform(content) {
						const contentStr = content.toString();
						return applyStringReplacements(contentStr);
					},
				},
				{ from: path.resolve(import.meta.dirname, mediaSourceDir), to: path.resolve(import.meta.dirname, 'media') },
			],
		}),
	],
	devtool: 'source-map',
};
