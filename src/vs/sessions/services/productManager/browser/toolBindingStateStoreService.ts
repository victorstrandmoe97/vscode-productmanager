/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IRepoManifestReference, ProductManagerJsonObject } from '../common/repoManifest.js';
import { getBindingFingerprint, IToolBindingStateStoreService } from '../common/toolBindings.js';
import { ProductManagerToolId } from '../common/toolProfiles.js';

const STORAGE_PREFIX = 'productManager.bindingState';
const LOG_PREFIX = '[ToolBindingStateStoreService]';

export class ToolBindingStateStoreService extends Disposable implements IToolBindingStateStoreService {

	declare readonly _serviceBrand: undefined;

	constructor(
		@IStorageService private readonly storageService: IStorageService,
		@ILogService private readonly logService: ILogService,
	) {
		super();
	}

	createCacheKey(reference: IRepoManifestReference, toolId: ProductManagerToolId, profileId: string | undefined, selectors: ProductManagerJsonObject): string {
		return [
			STORAGE_PREFIX,
			reference.repoId,
			toolId,
			profileId ?? 'none',
			getBindingFingerprint(selectors),
		].join(':');
	}

	async loadState<T>(cacheKey: string): Promise<T | undefined> {
		const raw = this.storageService.get(cacheKey, StorageScope.APPLICATION);
		if (!raw) {
			return undefined;
		}

		try {
			return JSON.parse(raw) as T;
		} catch (error) {
			this.logService.error(`${LOG_PREFIX} loadState: invalid JSON for %s`, cacheKey, error);
			return undefined;
		}
	}

	async saveState<T>(cacheKey: string, value: T): Promise<void> {
		this.storageService.store(cacheKey, JSON.stringify(value), StorageScope.APPLICATION, StorageTarget.USER);
	}

	async clearState(cacheKey: string): Promise<void> {
		this.storageService.remove(cacheKey, StorageScope.APPLICATION);
	}
}
