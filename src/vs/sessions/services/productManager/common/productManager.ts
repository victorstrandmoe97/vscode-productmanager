/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';

export const PRODUCT_MANAGER_MODE_SETTING = 'sessions.productManager.enabled';
export const PRODUCT_MANAGER_ESTIMATOR_URL_SETTING = 'sessions.productManager.estimatorUrl';
export const PRODUCT_MANAGER_REPO_ID_SETTING = 'sessions.productManager.repoId';
export const PRODUCT_MANAGER_REPO_URL_SETTING = 'sessions.productManager.repoUrl';
export const PRODUCT_MANAGER_REPOS_PATH_SETTING = 'sessions.productManager.localReposPath';

export const CONNECT_JIRA_COMMAND_ID = 'workbench.action.productManager.connectJira';
export const CONNECT_CRM_COMMAND_ID = 'workbench.action.productManager.connectCrm';
export const CONNECT_SNYK_COMMAND_ID = 'workbench.action.productManager.connectSnyk';
export const OPEN_DISCOVER_CHAT_COMMAND_ID = 'workbench.action.productManager.openDiscoverChat';

export const PRODUCT_MANAGER_LANES = [
	'shared',
	'application',
	'presentation',
	'entrypoint',
	'ops',
	'data',
	'domain',
] as const;

export type ProductManagerLaneId = typeof PRODUCT_MANAGER_LANES[number];

export interface IProductManagerOverviewModel {
	readonly title: string;
	readonly summary: string;
	readonly highlights: readonly string[];
}

export interface IProductManagerLaneModel {
	readonly id: ProductManagerLaneId;
	readonly title: string;
	readonly summary: string;
	readonly coverageLabel: string;
	readonly files?: readonly string[];
	readonly fileCount?: number;
	readonly weight?: number;
}

export interface IUserStory {
	readonly title: string;
	readonly description: string;
}

export interface IProductManagerFeatureModel {
	readonly title: string;
	readonly summary: string;
	readonly lanes: readonly ProductManagerLaneId[];
	readonly userStories?: readonly IUserStory[];
}

export interface IProductManagerJiraModel {
	readonly summary: string;
	readonly callToAction: string;
	readonly checklist: readonly string[];
}

export interface IProductManagerMarketModel {
	readonly summary: string;
	readonly topics: readonly string[];
}

export type ProductManagerArtifactsStatus = 'loading' | 'notGenerated' | 'ready' | 'error';

export interface IProductManagerArtifactsState {
	readonly status: ProductManagerArtifactsStatus;
	readonly message?: string;
	readonly generatedAt?: string;
	/** Total files classified by the complexity-estimator. */
	readonly fileCount?: number;
}

export interface IProductManagerFeaturesMetadata {
	readonly discoveredAt: string;
	readonly featureCount: number;
	readonly userStoryCount: number;
	readonly symbolsProcessed: number;
	readonly filesProcessed: number;
	readonly llmModel: string;
}


export interface IProductManagerDataService {
	readonly _serviceBrand: undefined;
	readonly onDidChange: Event<void>;

	getArtifactsState(): IProductManagerArtifactsState;
	getOverview(): IProductManagerOverviewModel;
	getArchitecture(): readonly IProductManagerLaneModel[];
	getFeatures(): readonly IProductManagerFeatureModel[];
	getFeaturesMetadata(): IProductManagerFeaturesMetadata | undefined;
	getJira(): IProductManagerJiraModel;
	getMarket(): IProductManagerMarketModel;
	fetchArchitectureFromApi(): Promise<void>;
	connectRepository(repoUrl: string, githubToken?: string, githubUsername?: string): Promise<void>;
	disconnectRepository(): Promise<void>;
	recookAndRefresh(): Promise<void>;
	discoverFeatures(): Promise<void>;
}

export const IProductManagerDataService = createDecorator<IProductManagerDataService>('productManagerDataService');

export function isProductManagerEnabled(configurationService: IConfigurationService): boolean {
	return configurationService.getValue<boolean>(PRODUCT_MANAGER_MODE_SETTING) === true;
}
