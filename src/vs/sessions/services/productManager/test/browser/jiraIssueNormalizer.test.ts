/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { normalizeJiraIssue } from '../../browser/jiraIssueNormalizer.js';

suite('ProductManager - JiraIssueNormalizer', () => {
	test('normalizes ADF descriptions, custom fields, and links', () => {
		const issue = normalizeJiraIssue({
			id: '100',
			key: 'PROJ-42',
			fields: {
				summary: 'Ship Jira integration',
				description: {
					type: 'doc',
					content: [{
						type: 'paragraph',
						content: [{ type: 'text', text: 'Implement backlog sync' }]
					}]
				},
				issuetype: { name: 'Story' },
				status: { name: 'In Progress', statusCategory: { name: 'In Progress' } },
				priority: { name: 'High' },
				labels: ['jira', 'product-mode'],
				components: [{ name: 'Sessions' }],
				parent: { key: 'PROJ-1' },
				created: '2026-05-10T10:00:00.000Z',
				updated: '2026-05-10T12:00:00.000Z',
				customfield_storyPoints: 8,
				customfield_epicLink: 'PROJ-EPIC',
				customfield_sprint: [{ name: 'Sprint 12' }],
				issuelinks: [{
					type: { outward: 'blocks', name: 'Blocks' },
					outwardIssue: {
						key: 'PROJ-99',
						fields: {
							summary: 'Dependency',
							status: { name: 'Done' },
						},
					},
				}],
			},
		}, 'https://company.atlassian.net', {
			storyPointsFieldId: 'customfield_storyPoints',
			epicLinkFieldId: 'customfield_epicLink',
			sprintFieldId: 'customfield_sprint',
		});

		assert.strictEqual(issue.url, 'https://company.atlassian.net/browse/PROJ-42');
		assert.strictEqual(issue.description, 'Implement backlog sync');
		assert.strictEqual(issue.storyPoints, 8);
		assert.strictEqual(issue.epicKey, 'PROJ-EPIC');
		assert.deepStrictEqual(issue.sprintNames, ['Sprint 12']);
		assert.strictEqual(issue.parentKey, 'PROJ-1');
		assert.strictEqual(issue.linkedIssues[0].direction, 'outward');
		assert.strictEqual(issue.linkedIssues[0].key, 'PROJ-99');
	});
});
