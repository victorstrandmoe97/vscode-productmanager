/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { InMemoryStorageService } from '../../../../../platform/storage/common/storage.js';
import { ToolBindingStateStoreService } from '../../browser/toolBindingStateStoreService.js';

suite('ProductManager - ToolBindingStateStoreService', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('namespaces state by repo, tool, profile, and selectors', async () => {
		const storageService = store.add(new InMemoryStorageService());
		const service = store.add(new ToolBindingStateStoreService(storageService, store.add(new NullLogService())));

		const cacheKey = service.createCacheKey({
			repoId: 'repo-1',
			repoUrl: 'https://github.com/example/repo',
			repoRootPath: '/repos/repo-1',
		}, 'jira', 'jira.company.pm', { projectKeys: ['PROJ'], jql: 'statusCategory != Done' });

		await service.saveState(cacheKey, { value: 42 });
		const restored = await service.loadState<{ value: number }>(cacheKey);

		assert.strictEqual(restored?.value, 42);
	});
});
