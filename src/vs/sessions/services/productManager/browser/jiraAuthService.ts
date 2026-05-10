/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IRequestService, asJson, asText } from '../../../../platform/request/common/request.js';
import { ISecretStorageService } from '../../../../platform/secrets/common/secrets.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IJiraAuthService, IJiraAuthSession } from '../common/jira.js';
import { IJiraConnectOptions, IJiraConnectionState, PRODUCT_MANAGER_ESTIMATOR_URL_SETTING } from '../common/productManager.js';

const LOG_PREFIX = '[JiraAuthService]';
const JIRA_STORAGE_KEY = 'productManager.jira.connection';

interface IJiraConnectionMetadata {
	readonly siteUrl: string;
	readonly email: string;
}

interface IJiraSecretPayload {
	readonly apiToken: string;
}

interface IJiraMyselfResponse {
	readonly emailAddress?: string;
	readonly displayName?: string;
	readonly site_url?: string;
	readonly site_name?: string;
}

export class JiraAuthService extends Disposable implements IJiraAuthService {

	declare readonly _serviceBrand: undefined;

	constructor(
		@IRequestService private readonly requestService: IRequestService,
		@ISecretStorageService private readonly secretStorageService: ISecretStorageService,
		@IStorageService private readonly storageService: IStorageService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@ILogService private readonly logService: ILogService,
	) {
		super();
	}

	async getConnectionState(): Promise<IJiraConnectionState> {
		const metadata = this.readStoredMetadata();
		if (!metadata) {
			return { status: 'disconnected' };
		}

		return {
			status: 'connected',
			siteUrl: metadata.siteUrl,
			siteName: this.getSiteName(metadata.siteUrl),
			accountEmail: metadata.email,
		};
	}

	async connect(options: IJiraConnectOptions): Promise<IJiraAuthSession> {
		const siteUrl = this.normalizeSiteUrl(options.siteUrl);
		const email = options.email.trim();
		const apiToken = options.apiToken.trim();

		if (!siteUrl || !email || !apiToken) {
			throw new Error(localize('jiraConnectMissingFields', "Jira site URL, email, and API token are required."));
		}

		const secretKey = this.buildSecretKey(siteUrl);
		await this.secretStorageService.set(secretKey, JSON.stringify({ apiToken } satisfies IJiraSecretPayload));
		this.persistMetadata({ siteUrl, email });

		this.logService.info(`${LOG_PREFIX} connect: site=%s`, siteUrl);

		const session = {
			siteUrl,
			email,
			apiToken,
		} satisfies IJiraAuthSession;

		const validation = await this.validateSession();
		if (validation.status !== 'connected') {
			await this.disconnect();
			throw new Error(validation.lastError ?? localize('jiraValidationFailed', "Failed to validate the Jira connection."));
		}

		return session;
	}

	async getSession(): Promise<IJiraAuthSession | undefined> {
		const metadata = this.readStoredMetadata();
		if (!metadata) {
			return undefined;
		}

		const secretKey = this.buildSecretKey(metadata.siteUrl);
		const rawSecret = await this.secretStorageService.get(secretKey);
		if (!rawSecret) {
			return undefined;
		}

		try {
			const parsed = JSON.parse(rawSecret) as IJiraSecretPayload;
			if (!parsed.apiToken) {
				return undefined;
			}

			return {
				siteUrl: metadata.siteUrl,
				email: metadata.email,
				apiToken: parsed.apiToken,
			};
		} catch (error) {
			this.logService.error(`${LOG_PREFIX} getSession: invalid secret payload`, error);
			return undefined;
		}
	}

	async validateSession(): Promise<IJiraConnectionState> {
		const session = await this.getSession();
		if (!session) {
			return { status: 'disconnected' };
		}

		try {
			const context = await this.requestService.request({
				type: 'POST',
				url: `${this.getProxyBaseUrl()}/api/jira/validate`,
				headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
				data: JSON.stringify({
					site_url: session.siteUrl,
					email: session.email,
					api_token: session.apiToken,
				}),
				callSite: 'productManager.jira.validateSession',
			}, CancellationToken.None);

			const statusCode = context.res.statusCode ?? 0;
			if (statusCode === 401 || statusCode === 403) {
				this.logService.warn(`${LOG_PREFIX} validateSession: auth rejected for site=%s`, session.siteUrl);
				return {
					status: 'expired',
					siteUrl: session.siteUrl,
					siteName: this.getSiteName(session.siteUrl),
					accountEmail: session.email,
					lastError: localize('jiraAuthExpired', "Your Jira credentials were rejected. Reconnect Jira to continue."),
				};
			}

			if (statusCode < 200 || statusCode >= 300) {
				const body = await asText(context).catch(() => '') ?? '';
				return {
					status: 'error',
					siteUrl: session.siteUrl,
					siteName: this.getSiteName(session.siteUrl),
					accountEmail: session.email,
					lastError: body || localize('jiraAuthUnknownError', "Jira validation failed with HTTP {0}.", statusCode),
				};
			}

			const myself = await asJson<IJiraMyselfResponse>(context);
			return {
				status: 'connected',
				siteUrl: myself?.site_url || session.siteUrl,
				siteName: myself?.site_name || this.getSiteName(session.siteUrl),
				accountEmail: myself?.emailAddress || session.email,
				lastValidatedAt: new Date().toISOString(),
			};
		} catch (error) {
			this.logService.error(`${LOG_PREFIX} validateSession: request failed`, error);
			return {
				status: 'error',
				siteUrl: session.siteUrl,
				siteName: this.getSiteName(session.siteUrl),
				accountEmail: session.email,
				lastError: error instanceof Error ? error.message : String(error),
			};
		}
	}

	async disconnect(): Promise<void> {
		const metadata = this.readStoredMetadata();
		if (metadata) {
			await this.secretStorageService.delete(this.buildSecretKey(metadata.siteUrl));
		}
		this.storageService.remove(JIRA_STORAGE_KEY, StorageScope.APPLICATION);
		this.logService.info(`${LOG_PREFIX} disconnect`);
	}

	private buildSecretKey(siteUrl: string): string {
		return `productManager.jira.session:${this.normalizeSiteUrl(siteUrl)}`;
	}

	private normalizeSiteUrl(siteUrl: string): string {
		const trimmed = siteUrl.trim().replace(/\/$/, '');
		const uri = URI.parse(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
		if (!uri.scheme || !uri.authority) {
			throw new Error(localize('jiraInvalidSiteUrl', "Enter a valid Jira Cloud site URL."));
		}

		return `${uri.scheme}://${uri.authority}${uri.path.replace(/\/$/, '')}`;
	}

	private readStoredMetadata(): IJiraConnectionMetadata | undefined {
		const raw = this.storageService.get(JIRA_STORAGE_KEY, StorageScope.APPLICATION);
		if (!raw) {
			return undefined;
		}

		try {
			return JSON.parse(raw) as IJiraConnectionMetadata;
		} catch (error) {
			this.logService.error(`${LOG_PREFIX} readStoredMetadata: invalid metadata`, error);
			return undefined;
		}
	}

	private persistMetadata(metadata: IJiraConnectionMetadata): void {
		this.storageService.store(JIRA_STORAGE_KEY, JSON.stringify(metadata), StorageScope.APPLICATION, StorageTarget.USER);
	}

	private getSiteName(siteUrl: string): string {
		try {
			return URI.parse(siteUrl).authority;
		} catch {
			return siteUrl;
		}
	}

	private getProxyBaseUrl(): string {
		return (this.configurationService.getValue<string>(PRODUCT_MANAGER_ESTIMATOR_URL_SETTING) || 'http://localhost:8000').replace(/\/$/, '');
	}
}
