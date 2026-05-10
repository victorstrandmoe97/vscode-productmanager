/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IProductManagerRepoManifest, IRepoManifestReference, IRepoToolBinding, ProductManagerJsonObject, ProductManagerJsonValue } from './repoManifest.js';
import { IToolProfile, ProductManagerToolId } from './toolProfiles.js';

export type ToolBindingSource = 'repo-local' | 'legacy-settings' | 'default';

export interface IResolvedToolBinding {
	readonly toolId: ProductManagerToolId;
	readonly enabled: boolean;
	readonly autoRefresh: boolean;
	readonly profile?: IToolProfile;
	readonly binding?: IRepoToolBinding;
	readonly selectors: ProductManagerJsonObject;
	readonly source: ToolBindingSource;
	readonly cacheKey: string;
}

export interface IResolvedProductManagerContext extends IRepoManifestReference {
	readonly manifest?: IProductManagerRepoManifest;
	readonly bindings: Partial<Record<ProductManagerToolId, IResolvedToolBinding>>;
}

export interface IToolBindingStateStoreService {
	readonly _serviceBrand: undefined;

	createCacheKey(reference: IRepoManifestReference, toolId: ProductManagerToolId, profileId: string | undefined, selectors: ProductManagerJsonObject): string;
	loadState<T>(cacheKey: string): Promise<T | undefined>;
	saveState<T>(cacheKey: string, value: T): Promise<void>;
	clearState(cacheKey: string): Promise<void>;
}

export interface IContextResolverService {
	readonly _serviceBrand: undefined;

	resolveContext(): Promise<IResolvedProductManagerContext | undefined>;
}

export const IToolBindingStateStoreService = createDecorator<IToolBindingStateStoreService>('toolBindingStateStoreService');
export const IContextResolverService = createDecorator<IContextResolverService>('contextResolverService');

export function getBindingFingerprint(selectors: ProductManagerJsonObject): string {
	return hashString(stableStringify(selectors));
}

export function stableStringify(value: ProductManagerJsonValue): string {
	if (Array.isArray(value)) {
		return `[${value.map(stableStringify).join(',')}]`;
	}

	if (value && typeof value === 'object') {
		const entries = Object.entries(value)
			.filter(([, nestedValue]) => nestedValue !== undefined)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, nestedValue]) => `"${key}":${stableStringify(nestedValue!)}`);
		return `{${entries.join(',')}}`;
	}

	return JSON.stringify(value);
}

function hashString(value: string): string {
	let hash = 5381;
	for (let index = 0; index < value.length; index++) {
		hash = ((hash << 5) + hash) ^ value.charCodeAt(index);
	}
	return Math.abs(hash >>> 0).toString(36);
}
