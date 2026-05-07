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
	PRODUCT_MANAGER_REPO_ID_SETTING,
	PRODUCT_MANAGER_REPO_URL_SETTING,
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
