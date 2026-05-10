/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IJiraApiClient, IJiraAuthService, IJiraSearchRequest, IJiraSyncResult, IJiraSyncService } from '../common/jira.js';
import { IJiraIssue, IJiraSyncState, PRODUCT_MANAGER_JIRA_FILTER_ID_SETTING, PRODUCT_MANAGER_JIRA_JQL_SETTING, PRODUCT_MANAGER_JIRA_PROJECT_KEYS_SETTING } from '../common/productManager.js';
import { ProductManagerJsonObject } from '../common/repoManifest.js';
import { IResolvedToolBinding, IToolBindingStateStoreService } from '../common/toolBindings.js';

const LOG_PREFIX = '[JiraSyncService]';
const DEFAULT_PAGE_SIZE = 50;

export class JiraSyncService extends Disposable implements IJiraSyncService {

	declare readonly _serviceBrand: undefined;

	constructor(
		@IJiraAuthService private readonly jiraAuthService: IJiraAuthService,
		@IJiraApiClient private readonly jiraApiClient: IJiraApiClient,
		@IToolBindingStateStoreService private readonly toolBindingStateStoreService: IToolBindingStateStoreService,
		@ILogService private readonly logService: ILogService,
	) {
		super();
	}

	async restore(binding: IResolvedToolBinding): Promise<IJiraSyncResult | undefined> {
		const cached = await this.toolBindingStateStoreService.loadState<{ issues: readonly IJiraIssue[]; sync: IJiraSyncState }>(binding.cacheKey);
		if (!cached) {
			return undefined;
		}

		const session = await this.jiraAuthService.getSession(binding.profile?.id ?? binding.binding?.profileId);
		if (!session) {
			return undefined;
		}

		return {
			issues: cached.issues,
			sync: cached.sync,
			fieldMap: await this.jiraApiClient.getFieldMap(session),
		};
	}

	async refresh(binding: IResolvedToolBinding, options?: { full?: boolean }): Promise<IJiraSyncResult> {
		const startedAt = new Date().toISOString();
		const previousState = await this.loadSyncState(binding);
		const cachedIssues = await this.loadCachedIssues(binding);
		const syncBase: IJiraSyncState = {
			status: 'syncing',
			lastSyncStartedAt: startedAt,
			lastSuccessfulWatermark: previousState.lastSuccessfulWatermark,
			pagesFetched: 0,
			issuesFetched: 0,
			message: 'Syncing Jira issues…',
		};
		await this.storeState(binding, { issues: cachedIssues, sync: syncBase });

		const session = await this.jiraAuthService.getSession(binding.profile?.id ?? binding.binding?.profileId);
		if (!session) {
			throw new Error('Jira is not connected.');
		}

		const full = options?.full === true;
		const searchRequest = this.buildSearchRequest(binding, full, previousState);
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

			await this.storeState(binding, {
				issues: pages,
				sync: {
				...syncBase,
				pagesFetched: pageCount,
				issuesFetched: pages.length,
				message: `Fetched ${pages.length} of ${total} Jira issues…`,
				},
			});

			if (page.nextPageToken === undefined) {
				break;
			}

			nextPageToken = page.nextPageToken;
		}

		const mergedIssues = full ? pages : this.mergeIssues(cachedIssues, pages);
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

		await this.storeState(binding, { issues: mergedIssues, sync: syncState });
		this.logService.info(`${LOG_PREFIX} refresh: complete issues=%d pages=%d`, mergedIssues.length, pageCount);

		return {
			sync: syncState,
			issues: mergedIssues,
			fieldMap,
		};
	}

	async clear(binding: IResolvedToolBinding): Promise<void> {
		await this.toolBindingStateStoreService.clearState(binding.cacheKey);
		this.logService.info(`${LOG_PREFIX} clear`);
	}

	private async loadCachedIssues(binding: IResolvedToolBinding): Promise<readonly IJiraIssue[]> {
		const cached = await this.toolBindingStateStoreService.loadState<{ issues: readonly IJiraIssue[]; sync: IJiraSyncState }>(binding.cacheKey);
		if (!cached) {
			return [];
		}

		return cached.issues;
	}

	private async loadSyncState(binding: IResolvedToolBinding): Promise<IJiraSyncState> {
		const cached = await this.toolBindingStateStoreService.loadState<{ issues: readonly IJiraIssue[]; sync: IJiraSyncState }>(binding.cacheKey);
		if (!cached) {
			return { status: 'idle' };
		}

		return cached.sync;
	}

	private async storeState(binding: IResolvedToolBinding, state: { issues: readonly IJiraIssue[]; sync: IJiraSyncState }): Promise<void> {
		await this.toolBindingStateStoreService.saveState(binding.cacheKey, state);
	}

	private buildSearchRequest(binding: IResolvedToolBinding, full: boolean, state: IJiraSyncState): IJiraSearchRequest {
		const selectors = binding.selectors as ProductManagerJsonObject;
		const projectKeysValue = selectors[PRODUCT_MANAGER_JIRA_PROJECT_KEYS_SETTING] ?? selectors.projectKeys;
		const projectKeys = Array.isArray(projectKeysValue) ? projectKeysValue.filter((value): value is string => typeof value === 'string' && !!value.trim()) : [];
		const filterId = this.readStringSelector(selectors, PRODUCT_MANAGER_JIRA_FILTER_ID_SETTING) || this.readStringSelector(selectors, 'filterId') || undefined;
		const jql = this.readStringSelector(selectors, PRODUCT_MANAGER_JIRA_JQL_SETTING) || this.readStringSelector(selectors, 'jql') || undefined;
		const updatedSince = !full ? state.lastSuccessfulWatermark : undefined;

		return {
			projectKeys,
			filterId,
			jql,
			updatedSince,
			maxResults: DEFAULT_PAGE_SIZE,
		};
	}

	private readStringSelector(selectors: ProductManagerJsonObject, key: string): string {
		const value = selectors[key];
		return typeof value === 'string' ? value.trim() : '';
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
