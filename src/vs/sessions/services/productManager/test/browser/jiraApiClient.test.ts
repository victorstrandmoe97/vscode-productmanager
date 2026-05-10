/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { JiraApiClient, JiraApiError } from '../../browser/jiraApiClient.js';
import { IJiraAuthSession } from '../../common/jira.js';
import { StubRequestService, jsonResponse, plainResponse } from './jiraTestUtils.js';

suite('ProductManager - JiraApiClient', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('adds authorization headers and normalizes search results', async () => {
		const requestService = new StubRequestService();
		requestService.queue('POST', /\/api\/jira\/fields$/, jsonResponse(200, [
			{ id: 'customfield_storyPoints', name: 'Story Points' }
		]));
		requestService.queue('POST', /\/api\/jira\/search$/, jsonResponse(200, {
			isLast: true,
			issues: [{
				id: '1',
				key: 'PROJ-1',
				fields: {
					summary: 'Imported from Jira',
					description: { type: 'doc', content: [] },
					issuetype: { name: 'Story' },
					status: { name: 'To Do' },
					labels: [],
					components: [],
					created: '2026-05-10T09:00:00.000Z',
					updated: '2026-05-10T10:00:00.000Z',
					issuelinks: [],
					customfield_storyPoints: 5,
				},
			}]
		}));

		const client = store.add(new JiraApiClient(
			requestService as never,
			new TestConfigurationService({ 'sessions.productManager.estimatorUrl': 'http://localhost:8000' }),
			store.add(new NullLogService()),
		));
		const session: IJiraAuthSession = {
			siteUrl: 'https://company.atlassian.net',
			email: 'pm@example.com',
			apiToken: 'secret-token',
		};

		const page = await client.searchIssues(session, { projectKeys: ['PROJ'] });
		assert.strictEqual(page.issues.length, 1);
		assert.strictEqual(page.issues[0].storyPoints, 5);
		const firstBody = JSON.parse(String(requestService.requests[0].data));
		assert.strictEqual(firstBody.api_token, 'secret-token');
		const secondBody = JSON.parse(String(requestService.requests[1].data));
		assert.strictEqual(secondBody.fields_by_keys, false);
	});

	test('surfaces retry-after data on failures', async () => {
		const requestService = new StubRequestService();
		requestService.queue('POST', /\/api\/jira\/projects$/, plainResponse(429, undefined, { 'retry-after': '30' }));

		const client = store.add(new JiraApiClient(
			requestService as never,
			new TestConfigurationService({ 'sessions.productManager.estimatorUrl': 'http://localhost:8000' }),
			store.add(new NullLogService()),
		));
		const session: IJiraAuthSession = {
			siteUrl: 'https://company.atlassian.net',
			email: 'pm@example.com',
			apiToken: 'secret-token',
		};

		await assert.rejects(
			() => client.getAccessibleProjects(session),
			(error: unknown) => error instanceof JiraApiError && error.retryAfterSeconds === 30 && error.statusCode === 429,
		);
	});
});
