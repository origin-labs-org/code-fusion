import * as vscode from 'vscode';

export interface DeeplinkParams {
	path: string;
	query: Record<string, string>;
}

export function activate(context: vscode.ExtensionContext) {
	// 注册 URI Handler - 参考 aicoding-agent 的实现
	context.subscriptions.push(
		vscode.window.registerUriHandler({
			handleUri: async (uri: vscode.Uri) => {
				// uri 格式: qoder://aicoding.aicoding-deeplink/path?params
				// uri.path = '/chat' 或 '/rule' 等
				// uri.query = 'text=xxx&mode=xxx'

				try {
					await handleDeeplink(uri);
				} catch (error: any) {
					vscode.window.showErrorMessage(
						`Handle deeplink failed: ${error.message}`
					);
				}
			}
		})
	);
}

async function handleDeeplink(uri: vscode.Uri): Promise<void> {
	const path = uri.path;

	// 解析 query 参数
	const params = new URLSearchParams(uri.query);
	const queryObj: Record<string, string> = {};
	params.forEach((value, key) => {
		queryObj[key] = value;
	});

	// 通过 vscode.aicoding.sendNotification 发送到 workbench 层
	vscode.aicoding.sendNotification('deeplink.handle', {
		path,
		query: queryObj
	});
}

export function deactivate() { }
