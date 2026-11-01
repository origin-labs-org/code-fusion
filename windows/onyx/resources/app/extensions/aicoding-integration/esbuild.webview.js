'use strict';

const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');
const postcss = require('postcss');
const tailwindcss = require('@tailwindcss/postcss');

const isWatch = process.argv.includes('--watch');
const isProduction = process.argv.includes('--production');

const postcssProcessor = postcss([
	tailwindcss(),
]);

function postcssPlugin() {
	return {
		name: 'postcss',
		setup(build) {
			build.onLoad({ filter: /\.css$/ }, async (args) => {
				const source = await fs.promises.readFile(args.path, 'utf8');
				const result = await postcssProcessor.process(source, { from: args.path });
				return { contents: result.css, loader: 'css' };
			});
		},
	};
}

/** @type {import('esbuild').BuildOptions} */
const buildOptions = {
	entryPoints: [path.resolve(__dirname, 'src/webview-ui/index.tsx')],
	bundle: true,
	outdir: path.resolve(__dirname, 'dist/webview'),
	format: 'iife',
	platform: 'browser',
	target: 'es2020',
	jsx: 'automatic',
	minify: isProduction,
	sourcemap: !isProduction,
	logLevel: 'info',
	plugins: [postcssPlugin()],
	alias: {
		'react': path.resolve(__dirname, 'node_modules/react'),
		'react-dom': path.resolve(__dirname, 'node_modules/react-dom'),
	},
};

async function main() {
	if (isWatch) {
		const ctx = await esbuild.context(buildOptions);
		await ctx.watch();
		console.log('[webview-ui] Watching for changes...');
	} else {
		await esbuild.build(buildOptions);
		console.log('[webview-ui] Build complete.');
	}
}

main().catch((err) => {
	console.error('[webview-ui] Build failed:', err);
	process.exit(1);
});
