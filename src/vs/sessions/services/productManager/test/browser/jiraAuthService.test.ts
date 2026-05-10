/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { TestSecretStorageService } from '../../../../../platform/secrets/test/common/testSecretStorageService.js';
import { InMemoryStorageService, StorageScope } from '../../../../../platform/storage/common/storage.js';
import { JiraAuthService } from '../../browser/jiraAuthService.js';
import { StubRequestService, jsonResponse, plainResponse } from './jiraTestUtils.js';

suite('ProductManager - JiraAuthService', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('connect stores secret-backed session and validates it', async () => {
		const requestService = new StubRequestService();
		const secretStorageService = store.add(new TestSecretStorageService());
		const storageService = store.add(new InMemoryStorageService());
		const configurationService = new TestConfigurationService({
			'sessions.productManager.estimatorUrl': 'http://localhost:8000',
		});
		const logService = store.add(new NullLogService());
		requestService.queue('POST', /\/api\/jira\/validate$/, jsonResponse(200, { emailAddress: 'pm@example.com', site_url: 'https://company.atlassian.net', site_name: 'company.atlassian.net' }));

		const service = store.add(new JiraAuthService(
			requestService as never,
			secretStorageService,
			storageService,
			configurationService,
			logService,
		));

		await service.connect({
			siteUrl: 'https://company.atlassian.net',
			email: 'pm@example.com',
			apiToken: 'secret-token',
			projectKeys: ['PROJ'],
		});

		const session = await service.getSession();
		assert.ok(session);
		assert.strictEqual(session?.siteUrl, 'https://company.atlassian.net');
		assert.strictEqual(session?.apiToken, 'secret-token');
		assert.ok(await secretStorageService.keys());
		assert.ok(storageService.get('productManager.jira.connection', StorageScope.APPLICATION));
	});

	test('validateSession reports expired credentials', async () => {
		const requestService = new StubRequestService();
		const secretStorageService = store.add(new TestSecretStorageService());
		const storageService = store.add(new InMemoryStorageService());
		const configurationService = new TestConfigurationService({
			'sessions.productManager.estimatorUrl': 'http://localhost:8000',
		});
		const logService = store.add(new NullLogService());
		requestService.queue('POST', /\/api\/jira\/validate$/, plainResponse(401));

		const service = store.add(new JiraAuthService(
			requestService as never,
			secretStorageService,
			storageService,
			configurationService,
			logService,
		));

		await secretStorageService.set('productManager.jira.session:https://company.atlassian.net', JSON.stringify({ apiToken: 'bad-token' }));
		storageService.store('productManager.jira.connection', JSON.stringify({
			siteUrl: 'https://company.atlassian.net',
			email: 'pm@example.com',
		}), StorageScope.APPLICATION, 0);

		const state = await service.validateSession();
		assert.strictEqual(state.status, 'expired');
		assert.ok(state.lastError);
	});

	test('disconnect clears stored metadata and secret', async () => {
		const requestService = new StubRequestService();
		const secretStorageService = store.add(new TestSecretStorageService());
		const storageService = store.add(new InMemoryStorageService());
		const configurationService = new TestConfigurationService({
			'sessions.productManager.estimatorUrl': 'http://localhost:8000',
		});
		const logService = store.add(new NullLogService());
		const service = store.add(new JiraAuthService(
			requestService as never,
			secretStorageService,
			storageService,
			configurationService,
			logService,
		));

		await secretStorageService.set('productManager.jira.session:https://company.atlassian.net', JSON.stringify({ apiToken: 'secret-token' }));
		storageService.store('productManager.jira.connection', JSON.stringify({
			siteUrl: 'https://company.atlassian.net',
			email: 'pm@example.com',
		}), StorageScope.APPLICATION, 0);

		await service.disconnect();
		assert.strictEqual(await secretStorageService.get('productManager.jira.session:https://company.atlassian.net'), undefined);
		assert.strictEqual(storageService.get('productManager.jira.connection', StorageScope.APPLICATION), undefined);
	});
});
