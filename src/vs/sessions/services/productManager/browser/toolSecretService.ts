/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { ISecretStorageService } from '../../../../platform/secrets/common/secrets.js';
import { IToolProfileSecretPayload, IToolSecretService } from '../common/toolProfiles.js';

const SECRET_PREFIX = 'productManager.toolProfileSecret:';

export class ToolSecretService extends Disposable implements IToolSecretService {

	declare readonly _serviceBrand: undefined;

	constructor(
		@ISecretStorageService private readonly secretStorageService: ISecretStorageService,
	) {
		super();
	}

	async getSecret(profileId: string): Promise<string | undefined> {
		const raw = await this.secretStorageService.get(this.getStorageKey(profileId));
		if (!raw) {
			return undefined;
		}

		try {
			const parsed = JSON.parse(raw) as IToolProfileSecretPayload;
			return parsed.secret || undefined;
		} catch {
			return undefined;
		}
	}

	async setSecret(profileId: string, secret: string): Promise<void> {
		await this.secretStorageService.set(this.getStorageKey(profileId), JSON.stringify({ secret } satisfies IToolProfileSecretPayload));
	}

	async deleteSecret(profileId: string): Promise<void> {
		await this.secretStorageService.delete(this.getStorageKey(profileId));
	}

	private getStorageKey(profileId: string): string {
		return `${SECRET_PREFIX}${profileId}`;
	}
}
