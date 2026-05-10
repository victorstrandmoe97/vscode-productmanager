/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { InMemoryStorageService, StorageScope } from '../../../../../platform/storage/common/storage.js';
import { JiraSyncService } from '../../browser/jiraSyncService.js';
import { ToolBindingStateStoreService } from '../../browser/toolBindingStateStoreService.js';
import { IJiraApiClient, IJiraAuthService, IJiraAuthSession } from '../../common/jira.js';
import { IResolvedToolBinding } from '../../common/toolBindings.js';

suite('ProductManager - JiraSyncService', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('refresh merges incremental issues and updates the watermark', async () => {
		const storageService = store.add(new InMemoryStorageService());
		const bindingStateStoreService = store.add(new ToolBindingStateStoreService(storageService, store.add(new NullLogService())));

		const session: IJiraAuthSession = {
			profileId: 'jira.company.pm',
			siteUrl: 'https://company.atlassian.net',
			email: 'pm@example.com',
			apiToken: 'secret-token',
		};

		const authService: IJiraAuthService = {
			_serviceBrand: undefined,
			connect: async () => session,
			getConnectionState: async () => ({ status: 'connected', siteUrl: session.siteUrl }),
			getSession: async () => session,
			validateSession: async () => ({ status: 'connected', siteUrl: session.siteUrl }),
			disconnect: async () => {},
		};

		const binding: IResolvedToolBinding = {
			toolId: 'jira',
			enabled: true,
			autoRefresh: true,
			profile: {
				id: session.profileId,
				toolId: 'jira',
				label: 'company.atlassian.net (pm@example.com)',
				baseUrl: session.siteUrl,
				accountEmail: session.email,
			},
			binding: {
				profileId: session.profileId,
				selectors: {
					projectKeys: ['PROJ'],
					filterId: '',
					jql: '',
				},
			},
			selectors: {
				projectKeys: ['PROJ'],
				filterId: '',
				jql: '',
			},
			source: 'repo-local',
			cacheKey: 'productManager.bindingState:repo:jira:jira.company.pm:test',
		};

		let searchCalls = 0;
		const apiClient: IJiraApiClient = {
			_serviceBrand: undefined,
			getAccessibleProjects: async () => [],
			getFieldMap: async () => ({ sprintFieldId: 'customfield_sprint' }),
			searchIssues: async (_jiraSession, request) => {
				searchCalls++;
				if (searchCalls === 1) {
					assert.strictEqual(request.updatedSince, undefined);
					return {
						total: 1,
						issues: [{
							id: '1',
							key: 'PROJ-1',
							url: 'https://company.atlassian.net/browse/PROJ-1',
							projectKey: 'PROJ',
							summary: 'Initial sync issue',
							description: '',
							issueType: 'Story',
							status: 'To Do',
							labels: [],
							components: [],
							sprintNames: [],
							linkedIssues: [],
							created: '2026-05-10T09:00:00.000Z',
							updated: '2026-05-10T10:00:00.000Z',
						}],
					};
				}

				assert.strictEqual(request.updatedSince, '2026-05-10T10:00:00.000Z');
				return {
					total: 1,
					issues: [{
						id: '2',
						key: 'PROJ-2',
						url: 'https://company.atlassian.net/browse/PROJ-2',
						projectKey: 'PROJ',
						summary: 'Incremental sync issue',
						description: '',
						issueType: 'Bug',
						status: 'In Progress',
						labels: [],
						components: [],
						sprintNames: [],
						linkedIssues: [],
						created: '2026-05-10T11:00:00.000Z',
						updated: '2026-05-10T12:00:00.000Z',
					}],
				};
			},
		};

		const service = store.add(new JiraSyncService(
			authService,
			apiClient,
			bindingStateStoreService,
			store.add(new NullLogService()),
		));

		const firstResult = await service.refresh(binding, { full: true });
		assert.strictEqual(firstResult.issues.length, 1);
		assert.strictEqual(firstResult.sync.lastSuccessfulWatermark, '2026-05-10T10:00:00.000Z');

		const secondResult = await service.refresh(binding);
		assert.strictEqual(secondResult.issues.length, 2);
		assert.strictEqual(secondResult.sync.lastSuccessfulWatermark, '2026-05-10T12:00:00.000Z');
		assert.ok(storageService.get(binding.cacheKey, StorageScope.APPLICATION));
	});
});
