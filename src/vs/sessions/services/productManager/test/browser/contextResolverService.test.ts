/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { InMemoryStorageService } from '../../../../../platform/storage/common/storage.js';
import { ContextResolverService } from '../../browser/contextResolverService.js';
import { ToolBindingStateStoreService } from '../../browser/toolBindingStateStoreService.js';
import { ToolProfileRegistryService } from '../../browser/toolProfileRegistryService.js';
import { IRepoManifestService } from '../../common/repoManifest.js';

suite('ProductManager - ContextResolverService', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('prefers repo-local jira bindings over legacy settings', async () => {
		const configurationService = new TestConfigurationService({
			'sessions.productManager.repoId': 'repo-1',
			'sessions.productManager.repoUrl': 'https://github.com/example/repo',
			'sessions.productManager.jiraSiteUrl': 'https://legacy.atlassian.net',
			'sessions.productManager.jiraProjectKeys': ['LEGACY'],
		});
		const storageService = store.add(new InMemoryStorageService());
		const logService = store.add(new NullLogService());
		const profileRegistryService = store.add(new ToolProfileRegistryService(storageService, logService));
		const stateStoreService = store.add(new ToolBindingStateStoreService(storageService, logService));
		await profileRegistryService.saveProfile({
			id: 'jira.company.pm',
			toolId: 'jira',
			label: 'company.atlassian.net (pm@example.com)',
			baseUrl: 'https://company.atlassian.net',
			accountEmail: 'pm@example.com',
		});

		const repoManifestService: IRepoManifestService = {
			_serviceBrand: undefined,
			getManifest: async () => ({
				version: 1,
				productManager: {
					tools: {
						jira: {
							enabled: true,
							autoRefresh: true,
							binding: {
								profileId: 'jira.company.pm',
								selectors: { projectKeys: ['PROJ'] },
							},
						},
					},
				},
			}),
			saveManifest: async () => {},
		};
		const workspaceContextService = {
			getWorkspace: () => ({ folders: [{ uri: URI.file('/workspace') }] }),
		};

		const service = store.add(new ContextResolverService(
			configurationService,
			workspaceContextService as never,
			repoManifestService,
			profileRegistryService,
			stateStoreService,
			logService,
		));

		const context = await service.resolveContext();
		assert.strictEqual(context?.bindings.jira?.profile?.id, 'jira.company.pm');
		assert.deepStrictEqual(context?.bindings.jira?.selectors.projectKeys, ['PROJ']);
	});
});
