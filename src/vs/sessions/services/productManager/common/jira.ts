/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IProductManagerFeatureModel, IProductManagerLaneModel, IJiraConnectOptions, IJiraConnectionState, IJiraFieldMap, IJiraIssue, IJiraIssuePage, IJiraMappingCandidate, IJiraProjectSummary, IJiraSyncState } from './productManager.js';

export interface IJiraAuthSession {
	readonly siteUrl: string;
	readonly email: string;
	readonly apiToken: string;
}

export interface IJiraSearchRequest {
	readonly projectKeys: readonly string[];
	readonly filterId?: string;
	readonly jql?: string;
	readonly maxResults?: number;
	readonly nextPageToken?: string;
	readonly updatedSince?: string;
}

export interface IJiraSyncResult {
	readonly sync: IJiraSyncState;
	readonly issues: readonly IJiraIssue[];
	readonly fieldMap: IJiraFieldMap;
}

export interface IJiraAuthService {
	readonly _serviceBrand: undefined;

	getConnectionState(): Promise<IJiraConnectionState>;
	connect(options: IJiraConnectOptions): Promise<IJiraAuthSession>;
	getSession(): Promise<IJiraAuthSession | undefined>;
	validateSession(): Promise<IJiraConnectionState>;
	disconnect(): Promise<void>;
}

export interface IJiraApiClient {
	readonly _serviceBrand: undefined;

	getAccessibleProjects(session: IJiraAuthSession): Promise<readonly IJiraProjectSummary[]>;
	getFieldMap(session: IJiraAuthSession): Promise<IJiraFieldMap>;
	searchIssues(session: IJiraAuthSession, request: IJiraSearchRequest): Promise<IJiraIssuePage>;
}

export interface IJiraSyncService {
	readonly _serviceBrand: undefined;

	refresh(options?: { full?: boolean }): Promise<IJiraSyncResult>;
	clear(): Promise<void>;
}

export interface IJiraMappingService {
	readonly _serviceBrand: undefined;

	mapIssuesToProductContext(
		issues: readonly IJiraIssue[],
		features: readonly IProductManagerFeatureModel[],
		lanes: readonly IProductManagerLaneModel[],
	): Promise<readonly IJiraMappingCandidate[]>;
}

export const IJiraAuthService = createDecorator<IJiraAuthService>('jiraAuthService');
export const IJiraApiClient = createDecorator<IJiraApiClient>('jiraApiClient');
export const IJiraSyncService = createDecorator<IJiraSyncService>('jiraSyncService');
export const IJiraMappingService = createDecorator<IJiraMappingService>('jiraMappingService');
