/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { InMemoryStorageService } from '../../../../../platform/storage/common/storage.js';
import { ToolProfileRegistryService } from '../../browser/toolProfileRegistryService.js';

suite('ProductManager - ToolProfileRegistryService', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('saves, lists, and marks tool profiles used', async () => {
		const storageService = store.add(new InMemoryStorageService());
		const service = store.add(new ToolProfileRegistryService(storageService, store.add(new NullLogService())));

		await service.saveProfile({
			id: 'jira.company.pm',
			toolId: 'jira',
			label: 'company.atlassian.net (pm@example.com)',
			baseUrl: 'https://company.atlassian.net',
			accountEmail: 'pm@example.com',
		});

		const profiles = await service.listProfiles('jira');
		assert.strictEqual(profiles.length, 1);
		assert.strictEqual(profiles[0].id, 'jira.company.pm');

		await service.markProfileUsed('jira.company.pm');
		const updated = await service.getProfile('jira.company.pm');
		assert.ok(updated?.lastUsedAt);
	});
});
