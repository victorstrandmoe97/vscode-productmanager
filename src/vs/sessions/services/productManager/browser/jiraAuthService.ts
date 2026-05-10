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
import { IStorageService, StorageScope } from '../../../../platform/storage/common/storage.js';
import { IJiraAuthService, IJiraAuthSession } from '../common/jira.js';
import { IJiraConnectOptions, IJiraConnectionState, PRODUCT_MANAGER_ESTIMATOR_URL_SETTING } from '../common/productManager.js';
import { IToolProfileRegistryService, IToolSecretService } from '../common/toolProfiles.js';

const LOG_PREFIX = '[JiraAuthService]';
const LEGACY_JIRA_STORAGE_KEY = 'productManager.jira.connection';

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
		@IToolProfileRegistryService private readonly toolProfileRegistryService: IToolProfileRegistryService,
		@IToolSecretService private readonly toolSecretService: IToolSecretService,
		@ISecretStorageService private readonly secretStorageService: ISecretStorageService,
		@IStorageService private readonly storageService: IStorageService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@ILogService private readonly logService: ILogService,
	) {
		super();
	}

	async getConnectionState(profileId?: string): Promise<IJiraConnectionState> {
		const profile = await this.getProfile(profileId);
		if (!profile) {
			return { status: 'disconnected' };
		}

		return {
			status: profile.status ?? 'connected',
			siteUrl: profile.baseUrl,
			siteName: profile.baseUrl ? this.getSiteName(profile.baseUrl) : undefined,
			accountEmail: profile.accountEmail,
			lastValidatedAt: profile.lastValidatedAt,
		};
	}

	async connect(options: IJiraConnectOptions): Promise<IJiraAuthSession> {
		const siteUrl = this.normalizeSiteUrl(options.siteUrl);
		const email = options.email.trim();
		const apiToken = options.apiToken.trim();

		if (!siteUrl || !email || !apiToken) {
			throw new Error(localize('jiraConnectMissingFields', "Jira site URL, email, and API token are required."));
		}

		const profileId = this.buildProfileId(siteUrl, email);
		await this.toolSecretService.setSecret(profileId, apiToken);
		await this.toolProfileRegistryService.saveProfile({
			id: profileId,
			toolId: 'jira',
			label: `${this.getSiteName(siteUrl)} (${email})`,
			baseUrl: siteUrl,
			accountEmail: email,
			status: 'connected',
		});

		this.logService.info(`${LOG_PREFIX} connect: site=%s`, siteUrl);

		const session = {
			profileId,
			siteUrl,
			email,
			apiToken,
		} satisfies IJiraAuthSession;

		const validation = await this.validateSession(profileId);
		if (validation.status !== 'connected') {
			await this.disconnect(profileId);
			throw new Error(validation.lastError ?? localize('jiraValidationFailed', "Failed to validate the Jira connection."));
		}

		return session;
	}

	async getSession(profileId?: string): Promise<IJiraAuthSession | undefined> {
		let profile = await this.getProfile(profileId);
		if (!profile) {
			profile = await this.migrateLegacyProfile();
		}
		if (!profile?.baseUrl || !profile.accountEmail) {
			return undefined;
		}

		const secret = await this.toolSecretService.getSecret(profile.id);
		if (!secret) {
			return undefined;
		}

		return {
			profileId: profile.id,
			siteUrl: profile.baseUrl,
			email: profile.accountEmail,
			apiToken: secret,
		};
	}

	async validateSession(profileId?: string): Promise<IJiraConnectionState> {
		const session = await this.getSession(profileId);
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
			await this.toolProfileRegistryService.saveProfile({
				id: session.profileId,
				toolId: 'jira',
				label: `${this.getSiteName(myself?.site_url || session.siteUrl)} (${myself?.emailAddress || session.email})`,
				baseUrl: myself?.site_url || session.siteUrl,
				accountEmail: myself?.emailAddress || session.email,
				lastValidatedAt: new Date().toISOString(),
				status: 'connected',
			});
			await this.toolProfileRegistryService.markProfileUsed(session.profileId);
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

	async disconnect(profileId?: string): Promise<void> {
		const profile = await this.getProfile(profileId);
		if (profile) {
			await this.toolSecretService.deleteSecret(profile.id);
			await this.toolProfileRegistryService.deleteProfile(profile.id);
		}
		this.logService.info(`${LOG_PREFIX} disconnect`);
	}

	private buildProfileId(siteUrl: string, email: string): string {
		const authority = this.getSiteName(siteUrl).replace(/[^a-z0-9]+/gi, '-').toLowerCase();
		const normalizedEmail = email.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
		return `jira.${authority}.${normalizedEmail}`;
	}

	private normalizeSiteUrl(siteUrl: string): string {
		const trimmed = siteUrl.trim().replace(/\/$/, '');
		const uri = URI.parse(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
		if (!uri.scheme || !uri.authority) {
			throw new Error(localize('jiraInvalidSiteUrl', "Enter a valid Jira Cloud site URL."));
		}

		return `${uri.scheme}://${uri.authority}${uri.path.replace(/\/$/, '')}`;
	}

	private async getProfile(profileId?: string) {
		if (profileId) {
			return this.toolProfileRegistryService.getProfile(profileId);
		}

		const profiles = [...await this.toolProfileRegistryService.listProfiles('jira')];
		profiles.sort((left, right) => (right.lastUsedAt ?? '').localeCompare(left.lastUsedAt ?? ''));
		return profiles[0];
	}

	private async migrateLegacyProfile() {
		const raw = this.storageService.get(LEGACY_JIRA_STORAGE_KEY, StorageScope.APPLICATION);
		if (!raw) {
			return undefined;
		}

		try {
			const legacy = JSON.parse(raw) as { siteUrl?: string; email?: string };
			if (!legacy.siteUrl || !legacy.email) {
				return undefined;
			}

			const siteUrl = this.normalizeSiteUrl(legacy.siteUrl);
			const profileId = this.buildProfileId(siteUrl, legacy.email);
			const existing = await this.toolProfileRegistryService.getProfile(profileId);
			if (existing) {
				return existing;
			}

			const legacySecret = await this.secretStorageService.get(`productManager.jira.session:${siteUrl}`);
			if (!legacySecret) {
				return undefined;
			}

			const parsedSecret = JSON.parse(legacySecret) as { apiToken?: string };
			if (!parsedSecret.apiToken) {
				return undefined;
			}

			await this.toolSecretService.setSecret(profileId, parsedSecret.apiToken);
			await this.toolProfileRegistryService.saveProfile({
				id: profileId,
				toolId: 'jira',
				label: `${this.getSiteName(siteUrl)} (${legacy.email})`,
				baseUrl: siteUrl,
				accountEmail: legacy.email,
				status: 'connected',
			});
			return this.toolProfileRegistryService.getProfile(profileId);
		} catch (error) {
			this.logService.error(`${LOG_PREFIX} migrateLegacyProfile: failed`, error);
			return undefined;
		}
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
