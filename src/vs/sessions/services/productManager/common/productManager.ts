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
export const PRODUCT_MANAGER_JIRA_SITE_URL_SETTING = 'sessions.productManager.jiraSiteUrl';
export const PRODUCT_MANAGER_JIRA_PROJECT_KEYS_SETTING = 'sessions.productManager.jiraProjectKeys';
export const PRODUCT_MANAGER_JIRA_FILTER_ID_SETTING = 'sessions.productManager.jiraFilterId';
export const PRODUCT_MANAGER_JIRA_JQL_SETTING = 'sessions.productManager.jiraJql';

export const CONNECT_JIRA_COMMAND_ID = 'workbench.action.productManager.connectJira';
export const DISCONNECT_JIRA_COMMAND_ID = 'workbench.action.productManager.disconnectJira';
export const REFRESH_JIRA_COMMAND_ID = 'workbench.action.productManager.refreshJira';
export const CONNECT_CRM_COMMAND_ID = 'workbench.action.productManager.connectCrm';
export const CONNECT_SNYK_COMMAND_ID = 'workbench.action.productManager.connectSnyk';
export const OPEN_JIRA_ISSUE_COMMAND_ID = 'workbench.action.productManager.openJiraIssue';
export const ASK_COPILOT_ABOUT_JIRA_ISSUE_COMMAND_ID = 'workbench.action.productManager.askCopilotAboutJiraIssue';
export const OPEN_DISCOVER_CHAT_COMMAND_ID = 'workbench.action.productManager.openDiscoverChat';
export const OPEN_LOCAL_CHAT_COMMAND_ID = 'workbench.action.productManager.openLocalChat';
export const CONFIGURE_OPENAI_AZURE_COMMAND_ID = 'workbench.action.productManager.configureOpenAIAzure';
export const CONFIGURE_CLAUDE_COMMAND_ID = 'workbench.action.productManager.configureClaude';

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

export type JiraConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'expired' | 'error';
export type JiraSyncStatus = 'idle' | 'syncing' | 'success' | 'error';

export interface IJiraConnectOptions {
	readonly siteUrl: string;
	readonly email: string;
	readonly apiToken: string;
	readonly projectKeys: readonly string[];
	readonly filterId?: string;
	readonly jql?: string;
}

export interface IJiraConnectionState {
	readonly status: JiraConnectionStatus;
	readonly siteUrl?: string;
	readonly siteName?: string;
	readonly accountEmail?: string;
	readonly lastValidatedAt?: string;
	readonly lastError?: string;
}

export interface IJiraSyncState {
	readonly status: JiraSyncStatus;
	readonly lastSyncStartedAt?: string;
	readonly lastSyncCompletedAt?: string;
	readonly lastSuccessfulWatermark?: string;
	readonly pagesFetched?: number;
	readonly issuesFetched?: number;
	readonly message?: string;
	readonly retryAfterSeconds?: number;
	readonly lastError?: string;
}

export interface IJiraFieldMap {
	readonly storyPointsFieldId?: string;
	readonly epicLinkFieldId?: string;
	readonly sprintFieldId?: string;
	readonly teamFieldId?: string;
}

export interface IJiraProjectSummary {
	readonly id: string;
	readonly key: string;
	readonly name: string;
}

export interface IJiraIssueTypeSummary {
	readonly id?: string;
	readonly name: string;
}

export interface IJiraUserSummary {
	readonly accountId?: string;
	readonly displayName: string;
	readonly emailAddress?: string;
}

export interface IJiraIssueLink {
	readonly id?: string;
	readonly type?: string;
	readonly direction: 'inward' | 'outward';
	readonly key: string;
	readonly summary?: string;
	readonly status?: string;
}

export interface IJiraIssue {
	readonly id: string;
	readonly key: string;
	readonly url: string;
	readonly projectKey: string;
	readonly summary: string;
	readonly description: string;
	readonly issueType: string;
	readonly status: string;
	readonly statusCategory?: string;
	readonly priority?: string;
	readonly assignee?: IJiraUserSummary;
	readonly reporter?: IJiraUserSummary;
	readonly labels: readonly string[];
	readonly components: readonly string[];
	readonly epicKey?: string;
	readonly parentKey?: string;
	readonly sprintNames: readonly string[];
	readonly storyPoints?: number;
	readonly created: string;
	readonly updated: string;
	readonly linkedIssues: readonly IJiraIssueLink[];
}

export interface IJiraIssuePage {
	readonly issues: readonly IJiraIssue[];
	readonly nextPageToken?: string;
	readonly total?: number;
}

export interface IJiraMappingCandidate {
	readonly issueKey: string;
	readonly featureTitle?: string;
	readonly lanes: readonly ProductManagerLaneId[];
	readonly confidence: number;
	readonly reason: string;
}

export interface IProductManagerJiraIssueModel {
	readonly issue: IJiraIssue;
	readonly mapping?: IJiraMappingCandidate;
}

export interface IProductManagerJiraModel {
	readonly summary: string;
	readonly callToAction: string;
	readonly checklist: readonly string[];
	readonly connection: IJiraConnectionState;
	readonly sync: IJiraSyncState;
	readonly selectedProjects: readonly string[];
	readonly issueCount: number;
	readonly issues: readonly IProductManagerJiraIssueModel[];
	readonly unmappedIssueCount: number;
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
	connectJira(options: IJiraConnectOptions): Promise<void>;
	disconnectJira(): Promise<void>;
	refreshJira(options?: { full?: boolean }): Promise<void>;
	openJiraIssue(issueKey: string): Promise<void>;
	askCopilotAboutJiraIssue(issueKey: string): Promise<void>;
}

export const IProductManagerDataService = createDecorator<IProductManagerDataService>('productManagerDataService');

export function isProductManagerEnabled(configurationService: IConfigurationService): boolean {
	return configurationService.getValue<boolean>(PRODUCT_MANAGER_MODE_SETTING) === true;
}
