/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

export type ProductManagerToolId = 'features' | 'jira';
export type ToolProfileStatus = 'connected' | 'expired' | 'error';

export interface IToolProfile {
	readonly id: string;
	readonly toolId: ProductManagerToolId;
	readonly label: string;
	readonly baseUrl?: string;
	readonly accountEmail?: string;
	readonly accountId?: string;
	readonly lastUsedAt?: string;
	readonly lastValidatedAt?: string;
	readonly status?: ToolProfileStatus;
}

export interface IToolProfileSecretPayload {
	readonly secret: string;
}

export interface IToolSearchResult {
	readonly id: string;
	readonly label: string;
	readonly description?: string;
	readonly detail?: string;
}

export interface IToolProfileRegistryService {
	readonly _serviceBrand: undefined;

	listProfiles(toolId: ProductManagerToolId): Promise<readonly IToolProfile[]>;
	getProfile(profileId: string): Promise<IToolProfile | undefined>;
	saveProfile(profile: IToolProfile): Promise<void>;
	deleteProfile(profileId: string): Promise<void>;
	markProfileUsed(profileId: string): Promise<void>;
}

export interface IToolSecretService {
	readonly _serviceBrand: undefined;

	getSecret(profileId: string): Promise<string | undefined>;
	setSecret(profileId: string, secret: string): Promise<void>;
	deleteSecret(profileId: string): Promise<void>;
}

export const IToolProfileRegistryService = createDecorator<IToolProfileRegistryService>('toolProfileRegistryService');
export const IToolSecretService = createDecorator<IToolSecretService>('toolSecretService');
