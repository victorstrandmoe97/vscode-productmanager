/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IJiraApiClient, IJiraAuthService, IJiraSearchRequest, IJiraSyncResult, IJiraSyncService } from '../common/jira.js';
import { IJiraIssue, IJiraSyncState, PRODUCT_MANAGER_JIRA_FILTER_ID_SETTING, PRODUCT_MANAGER_JIRA_JQL_SETTING, PRODUCT_MANAGER_JIRA_PROJECT_KEYS_SETTING } from '../common/productManager.js';

const LOG_PREFIX = '[JiraSyncService]';
const JIRA_ISSUES_STORAGE_KEY = 'productManager.jira.issues';
const JIRA_SYNC_STORAGE_KEY = 'productManager.jira.syncState';
const DEFAULT_PAGE_SIZE = 50;

export class JiraSyncService extends Disposable implements IJiraSyncService {

	declare readonly _serviceBrand: undefined;

	constructor(
		@IJiraAuthService private readonly jiraAuthService: IJiraAuthService,
		@IJiraApiClient private readonly jiraApiClient: IJiraApiClient,
		@IStorageService private readonly storageService: IStorageService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@ILogService private readonly logService: ILogService,
	) {
		super();
	}

	async refresh(options?: { full?: boolean }): Promise<IJiraSyncResult> {
		const startedAt = new Date().toISOString();
		const previousState = this.loadSyncState();
		const syncBase: IJiraSyncState = {
			status: 'syncing',
			lastSyncStartedAt: startedAt,
			lastSuccessfulWatermark: previousState.lastSuccessfulWatermark,
			pagesFetched: 0,
			issuesFetched: 0,
			message: 'Syncing Jira issues…',
		};
		this.storeSyncState(syncBase);

		const session = await this.jiraAuthService.getSession();
		if (!session) {
			throw new Error('Jira is not connected.');
		}

		const full = options?.full === true;
		const searchRequest = this.buildSearchRequest(full, previousState);
		this.logService.info(`${LOG_PREFIX} refresh: full=%s projects=%d`, full, searchRequest.projectKeys.length);

		const fieldMap = await this.jiraApiClient.getFieldMap(session);
		const pages: IJiraIssue[] = [];
		let nextPageToken = searchRequest.nextPageToken;
		let pageCount = 0;
		let total = 0;

		while (true) {
			const page = await this.jiraApiClient.searchIssues(session, { ...searchRequest, nextPageToken });
			pageCount++;
			total = page.total ?? total + page.issues.length;
			pages.push(...page.issues);

			this.storeSyncState({
				...syncBase,
				pagesFetched: pageCount,
				issuesFetched: pages.length,
				message: `Fetched ${pages.length} of ${total} Jira issues…`,
			});

			if (page.nextPageToken === undefined) {
				break;
			}

			nextPageToken = page.nextPageToken;
		}

		const mergedIssues = full ? pages : this.mergeIssues(this.loadCachedIssues(), pages);
		const latestWatermark = mergedIssues.reduce<string | undefined>((latest, issue) => {
			if (!issue.updated) {
				return latest;
			}

			if (!latest || issue.updated > latest) {
				return issue.updated;
			}

			return latest;
		}, previousState.lastSuccessfulWatermark);

		const syncState: IJiraSyncState = {
			status: 'success',
			lastSyncStartedAt: startedAt,
			lastSyncCompletedAt: new Date().toISOString(),
			lastSuccessfulWatermark: latestWatermark,
			pagesFetched: pageCount,
			issuesFetched: mergedIssues.length,
			message: `Imported ${mergedIssues.length} Jira issues.`,
		};

		this.storeCachedIssues(mergedIssues);
		this.storeSyncState(syncState);
		this.logService.info(`${LOG_PREFIX} refresh: complete issues=%d pages=%d`, mergedIssues.length, pageCount);

		return {
			sync: syncState,
			issues: mergedIssues,
			fieldMap,
		};
	}

	async clear(): Promise<void> {
		this.storageService.remove(JIRA_ISSUES_STORAGE_KEY, StorageScope.APPLICATION);
		this.storageService.remove(JIRA_SYNC_STORAGE_KEY, StorageScope.APPLICATION);
		this.logService.info(`${LOG_PREFIX} clear`);
	}

	private loadCachedIssues(): readonly IJiraIssue[] {
		const raw = this.storageService.get(JIRA_ISSUES_STORAGE_KEY, StorageScope.APPLICATION);
		if (!raw) {
			return [];
		}

		try {
			return JSON.parse(raw) as IJiraIssue[];
		} catch (error) {
			this.logService.error(`${LOG_PREFIX} loadCachedIssues: invalid cache`, error);
			return [];
		}
	}

	private storeCachedIssues(issues: readonly IJiraIssue[]): void {
		this.storageService.store(JIRA_ISSUES_STORAGE_KEY, JSON.stringify(issues), StorageScope.APPLICATION, StorageTarget.USER);
	}

	private loadSyncState(): IJiraSyncState {
		const raw = this.storageService.get(JIRA_SYNC_STORAGE_KEY, StorageScope.APPLICATION);
		if (!raw) {
			return { status: 'idle' };
		}

		try {
			return JSON.parse(raw) as IJiraSyncState;
		} catch (error) {
			this.logService.error(`${LOG_PREFIX} loadSyncState: invalid state`, error);
			return { status: 'idle' };
		}
	}

	private storeSyncState(state: IJiraSyncState): void {
		this.storageService.store(JIRA_SYNC_STORAGE_KEY, JSON.stringify(state), StorageScope.APPLICATION, StorageTarget.USER);
	}

	private buildSearchRequest(full: boolean, state: IJiraSyncState): IJiraSearchRequest {
		const projectKeys = this.configurationService.getValue<string[]>(PRODUCT_MANAGER_JIRA_PROJECT_KEYS_SETTING) ?? [];
		const filterId = (this.configurationService.getValue<string>(PRODUCT_MANAGER_JIRA_FILTER_ID_SETTING) || '').trim() || undefined;
		const jql = (this.configurationService.getValue<string>(PRODUCT_MANAGER_JIRA_JQL_SETTING) || '').trim() || undefined;
		const updatedSince = !full ? state.lastSuccessfulWatermark : undefined;

		return {
			projectKeys,
			filterId,
			jql,
			updatedSince,
			maxResults: DEFAULT_PAGE_SIZE,
		};
	}

	private mergeIssues(existing: readonly IJiraIssue[], incoming: readonly IJiraIssue[]): readonly IJiraIssue[] {
		const byKey = new Map<string, IJiraIssue>();
		for (const issue of existing) {
			byKey.set(issue.key, issue);
		}
		for (const issue of incoming) {
			byKey.set(issue.key, issue);
		}

		return [...byKey.values()].sort((a, b) => b.updated.localeCompare(a.updated));
	}
}
