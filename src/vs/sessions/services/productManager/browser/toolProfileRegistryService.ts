/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IToolProfile, IToolProfileRegistryService, ProductManagerToolId } from '../common/toolProfiles.js';

const STORAGE_KEY = 'productManager.toolProfiles';
const LOG_PREFIX = '[ToolProfileRegistryService]';

export class ToolProfileRegistryService extends Disposable implements IToolProfileRegistryService {

	declare readonly _serviceBrand: undefined;

	constructor(
		@IStorageService private readonly storageService: IStorageService,
		@ILogService private readonly logService: ILogService,
	) {
		super();
	}

	async listProfiles(toolId: ProductManagerToolId): Promise<readonly IToolProfile[]> {
		return this.readProfiles().filter(profile => profile.toolId === toolId);
	}

	async getProfile(profileId: string): Promise<IToolProfile | undefined> {
		return this.readProfiles().find(profile => profile.id === profileId);
	}

	async saveProfile(profile: IToolProfile): Promise<void> {
		const profiles = this.readProfiles().filter(current => current.id !== profile.id);
		profiles.push(profile);
		this.writeProfiles(profiles);
	}

	async deleteProfile(profileId: string): Promise<void> {
		this.writeProfiles(this.readProfiles().filter(profile => profile.id !== profileId));
	}

	async markProfileUsed(profileId: string): Promise<void> {
		const now = new Date().toISOString();
		const profiles = this.readProfiles().map(profile => profile.id === profileId ? { ...profile, lastUsedAt: now } : profile);
		this.writeProfiles(profiles);
	}

	private readProfiles(): IToolProfile[] {
		const raw = this.storageService.get(STORAGE_KEY, StorageScope.APPLICATION);
		if (!raw) {
			return [];
		}

		try {
			const parsed = JSON.parse(raw) as IToolProfile[];
			return Array.isArray(parsed) ? parsed : [];
		} catch (error) {
			this.logService.error(`${LOG_PREFIX} readProfiles: invalid storage payload`, error);
			return [];
		}
	}

	private writeProfiles(profiles: readonly IToolProfile[]): void {
		this.storageService.store(STORAGE_KEY, JSON.stringify(profiles), StorageScope.APPLICATION, StorageTarget.USER);
	}
}
