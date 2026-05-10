/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { JiraMappingService } from '../../browser/jiraMappingService.js';
import { IJiraIssue, IProductManagerFeatureModel, IProductManagerLaneModel } from '../../common/productManager.js';

suite('ProductManager - JiraMappingService', () => {
	test('maps issues onto matching features and lanes', async () => {
		const service = new JiraMappingService(new NullLogService());
		const issues: readonly IJiraIssue[] = [{
			id: '1',
			key: 'PROJ-1',
			url: 'https://company.atlassian.net/browse/PROJ-1',
			projectKey: 'PROJ',
			summary: 'Improve backlog sync in product mode',
			description: 'Product mode should sync Jira issues into architecture and feature views.',
			issueType: 'Story',
			status: 'In Progress',
			labels: ['product-mode', 'sync'],
			components: ['Sessions'],
			sprintNames: [],
			linkedIssues: [],
			created: '2026-05-10T10:00:00.000Z',
			updated: '2026-05-10T11:00:00.000Z',
		}];
		const features: readonly IProductManagerFeatureModel[] = [{
			title: 'Jira Backlog Sync',
			summary: 'Sync Jira issues into Product Mode for backlog visibility.',
			lanes: ['application', 'presentation'],
		}];
		const lanes: readonly IProductManagerLaneModel[] = [{
			id: 'application',
			title: 'Application',
			summary: 'Workflow orchestration and sync logic.',
			coverageLabel: '1 file',
		}, {
			id: 'presentation',
			title: 'Presentation',
			summary: 'User-facing backlog experiences.',
			coverageLabel: '1 file',
		}];

		const mappings = await service.mapIssuesToProductContext(issues, features, lanes);
		assert.strictEqual(mappings.length, 1);
		assert.strictEqual(mappings[0].issueKey, 'PROJ-1');
		assert.strictEqual(mappings[0].featureTitle, 'Jira Backlog Sync');
		assert.ok(mappings[0].lanes.includes('application'));
		assert.ok(mappings[0].confidence > 0.3);
	});
});
