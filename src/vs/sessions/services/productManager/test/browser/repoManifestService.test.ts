/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Schemas } from '../../../../../base/common/network.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { FileService } from '../../../../../platform/files/common/fileService.js';
import { InMemoryFileSystemProvider } from '../../../../../platform/files/common/inMemoryFilesystemProvider.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { RepoManifestService } from '../../browser/repoManifestService.js';

suite('ProductManager - RepoManifestService', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('writes and reads the local repo manifest', async () => {
		const logService = store.add(new NullLogService());
		const fileService = store.add(new FileService(logService));
		store.add(fileService.registerProvider(Schemas.file, store.add(new InMemoryFileSystemProvider())));
		const service = store.add(new RepoManifestService(fileService, logService));

		const reference = {
			repoId: 'repo-1',
			repoUrl: 'https://github.com/example/repo',
			repoRootPath: '/repos/repo-1',
		};

		await service.saveManifest(reference, {
			version: 1,
			productManager: {
				tools: {
					features: {
						enabled: true,
						autoRefresh: true,
						binding: { selectors: { includeStories: true } },
					},
				},
			},
		});

		const restored = await service.getManifest(reference);
		assert.strictEqual(restored?.productManager.tools.features?.enabled, true);
		assert.strictEqual(restored?.productManager.tools.features?.binding?.selectors?.includeStories, true);
	});
});
