declare module 'vscode' {
	/** 可能是同步或异步的类型 */
	export type MaybePromise<T> = T | Promise<T>;

	export namespace aicoding {
		/** 可释放的资源接口 */
		interface Disposable {
			/** 释放资源 */
			dispose(): void;
		}

		/** 系统通知类型 */
		type SystemNotificationType = 'chat' | 'questMode' | 'repoWiki' | 'default';

		/** 系统通知选项 */
		interface SystemNotificationOptions {
			// ===== 必需字段 =====
			/** 通知标题 */
			title: string;
			/** 通知内容 */
			body: string;

			// ===== Electron 标准字段 =====
			/** 是否静音 */
			silent?: boolean;
			/** 通知图标路径（绝对路径） */
			icon?: string;
			/** 紧急程度（主要用于 Linux） */
			urgency?: 'normal' | 'critical' | 'low';

			// ===== 自定义扩展字段 =====
			/** 仅在窗口非活跃时显示 */
			onlyWhenInactive?: boolean;
			/** 通知类型，用于配置开关 */
			type: SystemNotificationType;
			/** 点击通知时的回调 */
			onClick?: () => void;
		}

		/**
		 * 显示系统通知
		 * @param options 通知选项
		 * @returns Promise，通知显示完成后 resolve
		 */
		export function showSystemNotification(options: SystemNotificationOptions): Promise<void>;

		export function sendRequest<TParams = any, TResult = any>(method: string, params?: TParams): Promise<TResult>;
		export function sendNotification<TParams = any>(method: string, params?: TParams): void;
		export function onRequest<TParams = any, TResult = any>(method: string, handler: (method: string, params?: TParams) => MaybePromise<TResult>): Disposable;
		export function onNotification<TParams = any>(method: string, handler: (method: string, params?: TParams) => void): Disposable;
	}
}
