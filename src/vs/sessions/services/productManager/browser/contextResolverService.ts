/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IRepoManifestReference, IRepoManifestService, IRepoToolConfig, ProductManagerJsonObject } from '../common/repoManifest.js';
import { IContextResolverService, IResolvedProductManagerContext, IResolvedToolBinding, IToolBindingStateStoreService } from '../common/toolBindings.js';
import { IToolProfileRegistryService, IToolProfile, ProductManagerToolId } from '../common/toolProfiles.js';
import {
	PRODUCT_MANAGER_JIRA_FILTER_ID_SETTING,
	PRODUCT_MANAGER_JIRA_JQL_SETTING,
	PRODUCT_MANAGER_JIRA_PROJECT_KEYS_SETTING,
	PRODUCT_MANAGER_JIRA_SITE_URL_SETTING,
	PRODUCT_MANAGER_REPO_ID_SETTING,
	PRODUCT_MANAGER_REPO_URL_SETTING,
	PRODUCT_MANAGER_REPOS_PATH_SETTING,
} from '../common/productManager.js';

const LOG_PREFIX = '[ContextResolverService]';

export class ContextResolverService extends Disposable implements IContextResolverService {

	declare readonly _serviceBrand: undefined;

	constructor(
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IRepoManifestService private readonly repoManifestService: IRepoManifestService,
		@IToolProfileRegistryService private readonly toolProfileRegistryService: IToolProfileRegistryService,
		@IToolBindingStateStoreService private readonly toolBindingStateStoreService: IToolBindingStateStoreService,
		@ILogService private readonly logService: ILogService,
	) {
		super();
	}

	async resolveContext(): Promise<IResolvedProductManagerContext | undefined> {
		const repoId = (this.configurationService.getValue<string>(PRODUCT_MANAGER_REPO_ID_SETTING) || '').trim();
		const repoUrl = (this.configurationService.getValue<string>(PRODUCT_MANAGER_REPO_URL_SETTING) || '').trim();
		if (!repoId || !repoUrl) {
			return undefined;
		}

		const reference = {
			repoId,
			repoUrl,
			repoRootPath: `${this.resolveReposPath()}/${repoId}`,
		};

		let manifest = undefined;
		try {
			manifest = await this.repoManifestService.getManifest(reference);
		} catch (error) {
			this.logService.error(`${LOG_PREFIX} resolveContext: manifest load failed`, error);
		}

		const featureConfig = manifest?.productManager.tools.features ?? this.getDefaultFeatureConfig();
		const jiraConfig = manifest?.productManager.tools.jira ?? await this.getLegacyJiraConfig();

		const bindings: Partial<Record<ProductManagerToolId, IResolvedToolBinding>> = {};
		bindings.features = await this.resolveBinding(reference, 'features', featureConfig, 'repo-local');
		if (jiraConfig) {
			bindings.jira = await this.resolveBinding(reference, 'jira', jiraConfig, manifest?.productManager.tools.jira ? 'repo-local' : 'legacy-settings');
		}

		return {
			...reference,
			manifest,
			bindings,
		};
	}

	private async resolveBinding(
		reference: IRepoManifestReference,
		toolId: ProductManagerToolId,
		config: IRepoToolConfig,
		source: 'repo-local' | 'legacy-settings' | 'default',
	): Promise<IResolvedToolBinding> {
		const profileId = config.binding?.profileId;
		const profile = profileId ? await this.toolProfileRegistryService.getProfile(profileId) : await this.findCompatibleProfile(toolId);
		const selectors = (config.binding?.selectors ?? {}) as ProductManagerJsonObject;
		return {
			toolId,
			enabled: config.enabled,
			autoRefresh: config.autoRefresh,
			profile,
			binding: config.binding,
			selectors,
			source,
			cacheKey: this.toolBindingStateStoreService.createCacheKey(reference, toolId, profile?.id ?? profileId, selectors),
		};
	}

	private async findCompatibleProfile(toolId: ProductManagerToolId): Promise<IToolProfile | undefined> {
		const profiles = [...await this.toolProfileRegistryService.listProfiles(toolId)];
		profiles.sort((left, right) => (right.lastUsedAt ?? '').localeCompare(left.lastUsedAt ?? ''));
		return profiles[0];
	}

	private getDefaultFeatureConfig(): IRepoToolConfig {
		return {
			enabled: true,
			autoRefresh: true,
			binding: {
				selectors: {
					generator: 'complexity-estimator',
					mode: 'full',
					includeArchitecture: true,
					includeStories: true,
				},
			},
		};
	}

	private async getLegacyJiraConfig(): Promise<IRepoToolConfig | undefined> {
		const siteUrl = (this.configurationService.getValue<string>(PRODUCT_MANAGER_JIRA_SITE_URL_SETTING) || '').trim();
		const projectKeys = this.configurationService.getValue<string[]>(PRODUCT_MANAGER_JIRA_PROJECT_KEYS_SETTING) ?? [];
		if (!siteUrl || projectKeys.length === 0) {
			return undefined;
		}

		const profiles = await this.toolProfileRegistryService.listProfiles('jira');
		const matchedProfile = profiles.find(profile => profile.baseUrl === siteUrl);
		return {
			enabled: true,
			autoRefresh: true,
			binding: {
				profileId: matchedProfile?.id,
				selectors: {
					projectKeys,
					filterId: (this.configurationService.getValue<string>(PRODUCT_MANAGER_JIRA_FILTER_ID_SETTING) || '').trim(),
					jql: (this.configurationService.getValue<string>(PRODUCT_MANAGER_JIRA_JQL_SETTING) || '').trim(),
				},
			},
		};
	}

	private resolveReposPath(): string {
		const configured = (this.configurationService.getValue<string>(PRODUCT_MANAGER_REPOS_PATH_SETTING) || '').trim();
		if (configured) {
			return configured.replace(/\/$/, '');
		}

		const folders = this.workspaceContextService.getWorkspace().folders;
		if (folders.length > 0) {
			return `${folders[0].uri.fsPath.replace(/\/$/, '')}/complexity-estimator/repos`;
		}

		return './complexity-estimator/repos';
	}
}
