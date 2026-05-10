/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { Extensions, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import {
	PRODUCT_MANAGER_MODE_SETTING,
	PRODUCT_MANAGER_ESTIMATOR_URL_SETTING,
	PRODUCT_MANAGER_JIRA_FILTER_ID_SETTING,
	PRODUCT_MANAGER_JIRA_JQL_SETTING,
	PRODUCT_MANAGER_JIRA_PROJECT_KEYS_SETTING,
	PRODUCT_MANAGER_JIRA_SITE_URL_SETTING,
	PRODUCT_MANAGER_REPO_ID_SETTING,
	PRODUCT_MANAGER_REPO_URL_SETTING,
	PRODUCT_MANAGER_REPOS_PATH_SETTING,
} from '../../../services/productManager/common/productManager.js';

const configurationRegistry = Registry.as<IConfigurationRegistry>(Extensions.Configuration);

configurationRegistry.registerConfiguration({
	id: 'sessions',
	title: localize('sessionsConfiguration', "Sessions"),
	type: 'object',
	properties: {
		[PRODUCT_MANAGER_MODE_SETTING]: {
			type: 'boolean',
			default: true,
			description: localize('productManagerEnabled', "Enable Product Mode in the agent sessions workbench."),
		},
		[PRODUCT_MANAGER_ESTIMATOR_URL_SETTING]: {
			type: 'string',
			default: 'http://localhost:8000',
			description: localize('productManagerEstimatorUrl', "Base URL of the complexity-estimator backend used for the architecture map."),
		},
		[PRODUCT_MANAGER_REPO_ID_SETTING]: {
			type: 'string',
			default: '',
			description: localize('productManagerRepoId', "Repository ID in the complexity-estimator database. Set automatically when you connect a repository."),
		},
		[PRODUCT_MANAGER_REPO_URL_SETTING]: {
			type: 'string',
			default: '',
			description: localize('productManagerRepoUrl', "GitHub repository URL connected to the complexity-estimator. Set automatically when you connect a repository."),
		},
		[PRODUCT_MANAGER_REPOS_PATH_SETTING]: {
			type: 'string',
			default: '',
			description: localize('productManagerReposPath', "Absolute path to the local repos directory (bind-mounted Docker volume). Leave empty to auto-detect from the complexity-estimator directory."),
		},
		[PRODUCT_MANAGER_JIRA_SITE_URL_SETTING]: {
			type: 'string',
			default: '',
			description: localize('productManagerJiraSiteUrl', "Jira Cloud site URL connected to Product Mode. Set automatically when you connect Jira."),
		},
		[PRODUCT_MANAGER_JIRA_PROJECT_KEYS_SETTING]: {
			type: 'array',
			default: [],
			items: {
				type: 'string',
			},
			description: localize('productManagerJiraProjectKeys', "Jira project keys selected for Product Mode issue sync."),
		},
		[PRODUCT_MANAGER_JIRA_FILTER_ID_SETTING]: {
			type: 'string',
			default: '',
			description: localize('productManagerJiraFilterId', "Optional Jira filter ID used by Product Mode issue sync."),
		},
		[PRODUCT_MANAGER_JIRA_JQL_SETTING]: {
			type: 'string',
			default: '',
			description: localize('productManagerJiraJql', "Optional custom JQL appended to the Product Mode Jira sync query."),
		},
	}
});

configurationRegistry.registerDefaultConfigurations([{
	overrides: {
		'chat.customizationsMenu.userStoragePath': '~/.copilot',
		'github.copilot.chat.claudeCode.enabled': true,
	},
	donotCache: true,
	preventExperimentOverride: true,
	source: 'sessionsDefaults'
}]);
