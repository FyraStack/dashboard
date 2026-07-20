<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Switch } from '$lib/components/ui/switch';
	import { Textarea } from '$lib/components/ui/textarea';
	import {
		saveManagedHostQuadlet,
		type ManagedHost,
		type ManagedHostQuadletScope
	} from '$lib/remote/managed-hosts.remote';
	import { getErrorMessage } from '$lib/utils';
	import Eye from '~icons/lucide/eye';
	import EyeOff from '~icons/lucide/eye-off';
	import Loader2 from '~icons/lucide/loader-2';
	import QuadletEditor from '../lib/QuadletEditor.svelte';
	import {
		buildRecipeDetail,
		defaultComposeOptions,
		defaultNginxSiteOptions,
		defaultNextcloudOptions,
		quadletRecipeOptions,
		validateComposeOptions,
		type ComposeOptions,
		type NextcloudOptions,
		type NginxSiteOptions,
		type QuadletRecipeOption
	} from '../lib/recipes';

	type PageData = {
		host: ManagedHost;
	};

	let { data }: { data: PageData } = $props();
	const host = $derived(data.host);
	const initialScope = $derived<ManagedHostQuadletScope>(
		page.url.searchParams.get('scope') === 'system' ? 'system' : 'user'
	);
	let selectedRecipe = $state<'blank' | QuadletRecipeOption['id'] | null>(null);
	let nginxOptions = $state<NginxSiteOptions>(defaultNginxSiteOptions());
	let nextcloudOptions = $state<NextcloudOptions>(defaultNextcloudOptions());
	let composeOptions = $state<ComposeOptions>(defaultComposeOptions());
	let showGeneratedConfiguration = $state(false);
	let saving = $state(false);
	let actionError = $state('');
	const composeError = $derived(
		selectedRecipe === 'compose' ? validateComposeOptions(composeOptions) : ''
	);
	const recipeDetail = $derived(
		selectedRecipe === null || selectedRecipe === 'blank'
			? null
			: selectedRecipe === 'nginx-site'
				? buildRecipeDetail(selectedRecipe, initialScope, nginxOptions)
				: selectedRecipe === 'nextcloud'
					? buildRecipeDetail(selectedRecipe, initialScope, nextcloudOptions)
					: buildRecipeDetail(selectedRecipe, initialScope, composeOptions)
	);

	function updateNginxOption<Key extends keyof NginxSiteOptions>(
		key: Key,
		value: NginxSiteOptions[Key]
	) {
		nginxOptions = { ...nginxOptions, [key]: value };
	}

	function updateNextcloudOption<Key extends keyof NextcloudOptions>(
		key: Key,
		value: NextcloudOptions[Key]
	) {
		nextcloudOptions = { ...nextcloudOptions, [key]: value };
	}

	function updateComposeOption<Key extends keyof ComposeOptions>(
		key: Key,
		value: ComposeOptions[Key]
	) {
		composeOptions = { ...composeOptions, [key]: value };
	}

	function selectRecipe(recipe: 'blank' | QuadletRecipeOption['id']) {
		selectedRecipe = recipe;
		showGeneratedConfiguration = false;
	}

	async function saveRecipeApp() {
		if (saving || !recipeDetail || composeError) return;
		saving = true;
		actionError = '';
		try {
			await saveManagedHostQuadlet({
				hostId: host.id,
				scope: recipeDetail.scope,
				filename: recipeDetail.filename,
				contents: recipeDetail.contents,
				filesJson: JSON.stringify(recipeDetail.files),
				resourcesJson: JSON.stringify(recipeDetail.resources)
			});
			await goto(
				`/projects/${page.params.projectid}/hosts/${host.id}/quadlets/${encodeURIComponent(recipeDetail.filename)}`
			);
		} catch (err) {
			actionError = getErrorMessage(err, 'Failed to create app.');
		} finally {
			saving = false;
		}
	}
</script>

<section class="min-h-0 flex-1 overflow-auto bg-background p-5">
	<div>
		<h1 class="text-sm font-semibold text-foreground">New Quadlet</h1>
		<p class="mt-1 text-xs text-muted-foreground">
			Create a Quadlet unit with companion files in the host's mutable data directory.
		</p>
	</div>

	<div class="mt-5">
		<h2 class="text-sm font-semibold text-foreground">Recipe</h2>
		<div class="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
			<Button
				variant={selectedRecipe === 'blank' ? 'default' : 'outline'}
				class="h-auto min-w-0 justify-start whitespace-normal p-3 text-left"
				onclick={() => selectRecipe('blank')}
			>
				<span class="min-w-0">
					<span class="block text-xs font-semibold">Blank Quadlet</span>
					<span class="mt-1 block break-words text-xs leading-snug">
						Paste or write a unit from scratch.
					</span>
				</span>
			</Button>
			{#each quadletRecipeOptions as recipe (recipe.id)}
				<Button
					variant={selectedRecipe === recipe.id ? 'default' : 'outline'}
					class="h-auto min-w-0 justify-start whitespace-normal p-3 text-left"
					onclick={() => selectRecipe(recipe.id)}
				>
					<span class="min-w-0">
						<span class="block text-xs font-semibold">{recipe.name}</span>
						<span class="mt-1 block break-words text-xs leading-snug">{recipe.description}</span>
					</span>
				</Button>
			{/each}
		</div>
	</div>

	<div class="mt-5">
		{#if selectedRecipe === 'blank'}
			{#key `${selectedRecipe}:${initialScope}`}
				<QuadletEditor {host} {initialScope} />
			{/key}
		{:else if recipeDetail}
			<div class="mx-auto max-w-5xl space-y-5">
				<div>
					<section class="space-y-5 border border-border p-5">
						<div>
							<h2 class="text-sm font-semibold text-foreground">App Settings</h2>
							<p class="mt-1 text-xs text-muted-foreground">{recipeDetail.recipeName}</p>
						</div>

						{#if selectedRecipe === 'nginx-site'}
							<div class="space-y-2">
								<Label for="nginx-app-id">App ID</Label>
								<Input
									id="nginx-app-id"
									value={nginxOptions.appId}
									oninput={(event) => updateNginxOption('appId', event.currentTarget.value)}
								/>
							</div>

							<div class="space-y-2">
								<Label for="nginx-site-title">Site title</Label>
								<Input
									id="nginx-site-title"
									value={nginxOptions.siteTitle}
									oninput={(event) => updateNginxOption('siteTitle', event.currentTarget.value)}
								/>
							</div>

							<div class="grid gap-3 sm:grid-cols-2">
								<div class="space-y-2">
									<Label for="nginx-host-port">Host port</Label>
									<Input
										id="nginx-host-port"
										type="number"
										min="1"
										max="65535"
										value={nginxOptions.hostPort}
										oninput={(event) =>
											updateNginxOption('hostPort', Number(event.currentTarget.value))}
									/>
								</div>

								<div class="space-y-2">
									<Label for="nginx-server-name">Server name</Label>
									<Input
										id="nginx-server-name"
										value={nginxOptions.serverName}
										oninput={(event) => updateNginxOption('serverName', event.currentTarget.value)}
									/>
								</div>
							</div>
						{:else if selectedRecipe === 'nextcloud'}
							<div class="space-y-2">
								<Label for="nextcloud-app-id">App ID</Label>
								<Input
									id="nextcloud-app-id"
									value={nextcloudOptions.appId}
									oninput={(event) => updateNextcloudOption('appId', event.currentTarget.value)}
								/>
							</div>

							<div class="space-y-2">
								<Label for="nextcloud-domain">Domain</Label>
								<Input
									id="nextcloud-domain"
									value={nextcloudOptions.domain}
									oninput={(event) => updateNextcloudOption('domain', event.currentTarget.value)}
								/>
							</div>

							<div class="grid gap-3 sm:grid-cols-2">
								<div class="space-y-2">
									<Label for="nextcloud-host-port">Host port</Label>
									<Input
										id="nextcloud-host-port"
										type="number"
										min="1"
										max="65535"
										value={nextcloudOptions.hostPort}
										oninput={(event) =>
											updateNextcloudOption('hostPort', Number(event.currentTarget.value))}
									/>
								</div>

								<div class="space-y-2">
									<Label for="nextcloud-protocol">Public protocol</Label>
									<div class="grid grid-cols-2 gap-2">
										<Button
											type="button"
											variant={nextcloudOptions.overwriteProtocol === 'https' ? 'default' : 'outline'}
											onclick={() => updateNextcloudOption('overwriteProtocol', 'https')}
										>
											HTTPS
										</Button>
										<Button
											type="button"
											variant={nextcloudOptions.overwriteProtocol === 'http' ? 'default' : 'outline'}
											onclick={() => updateNextcloudOption('overwriteProtocol', 'http')}
										>
											HTTP
										</Button>
									</div>
								</div>
							</div>

							<div class="grid gap-3 sm:grid-cols-2">
								<div class="space-y-2">
									<Label for="nextcloud-admin-user">Admin user</Label>
									<Input
										id="nextcloud-admin-user"
										value={nextcloudOptions.adminUser}
										oninput={(event) =>
											updateNextcloudOption('adminUser', event.currentTarget.value)}
									/>
								</div>

								<div class="space-y-2">
									<Label for="nextcloud-admin-password">Admin password</Label>
									<Input
										id="nextcloud-admin-password"
										type="password"
										value={nextcloudOptions.adminPassword}
										oninput={(event) =>
											updateNextcloudOption('adminPassword', event.currentTarget.value)}
									/>
								</div>
							</div>

							<div class="grid gap-3 sm:grid-cols-2">
								<div class="space-y-2">
									<Label for="nextcloud-database-name">Database name</Label>
									<Input
										id="nextcloud-database-name"
										value={nextcloudOptions.databaseName}
										oninput={(event) =>
											updateNextcloudOption('databaseName', event.currentTarget.value)}
									/>
								</div>

								<div class="space-y-2">
									<Label for="nextcloud-database-user">Database user</Label>
									<Input
										id="nextcloud-database-user"
										value={nextcloudOptions.databaseUser}
										oninput={(event) =>
											updateNextcloudOption('databaseUser', event.currentTarget.value)}
									/>
								</div>
							</div>

							<div class="space-y-2">
								<Label for="nextcloud-database-password">Database password</Label>
								<Input
									id="nextcloud-database-password"
									type="password"
									value={nextcloudOptions.databasePassword}
									oninput={(event) =>
										updateNextcloudOption('databasePassword', event.currentTarget.value)}
								/>
							</div>

							<div class="grid gap-3 sm:grid-cols-2">
								<div class="space-y-2">
									<Label for="nextcloud-memory-limit">PHP memory limit</Label>
									<Input
										id="nextcloud-memory-limit"
										value={nextcloudOptions.phpMemoryLimit}
										oninput={(event) =>
											updateNextcloudOption('phpMemoryLimit', event.currentTarget.value)}
									/>
								</div>

								<div class="space-y-2">
									<Label for="nextcloud-upload-limit">Upload limit</Label>
									<Input
										id="nextcloud-upload-limit"
										value={nextcloudOptions.uploadLimit}
										oninput={(event) =>
											updateNextcloudOption('uploadLimit', event.currentTarget.value)}
									/>
								</div>
							</div>

							<div class="space-y-2">
								<Label for="nextcloud-trusted-proxies">Trusted proxies</Label>
								<Input
									id="nextcloud-trusted-proxies"
									placeholder="10.0.0.0/8 172.16.0.0/12"
									value={nextcloudOptions.trustedProxies}
									oninput={(event) =>
										updateNextcloudOption('trustedProxies', event.currentTarget.value)}
								/>
							</div>

							<div class="flex items-center justify-between gap-4 border border-border p-3">
								<div class="min-w-0">
									<p class="text-xs font-medium text-foreground">Redis cache</p>
									<p class="mt-1 text-xs text-muted-foreground">
										Add a Redis container and wire it into Nextcloud.
									</p>
								</div>
								<Switch
									bind:checked={() => nextcloudOptions.enableRedis, (checked) =>
										updateNextcloudOption('enableRedis', checked)}
								/>
							</div>
						{:else if selectedRecipe === 'compose'}
							<div class="space-y-2">
								<Label for="compose-app-id">App ID</Label>
								<Input
									id="compose-app-id"
									value={composeOptions.appId}
									oninput={(event) => updateComposeOption('appId', event.currentTarget.value)}
								/>
							</div>

							<div class="space-y-2">
								<Label for="compose-yaml">Compose specification</Label>
								<Textarea
									id="compose-yaml"
									class="min-h-96 font-mono text-xs leading-relaxed"
									value={composeOptions.composeYaml}
									oninput={(event) =>
										updateComposeOption('composeYaml', event.currentTarget.value)}
								/>
							</div>

							{#if composeError}
								<div class="border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
									{composeError}
								</div>
							{:else}
								<div class="border border-border bg-muted/20 p-3 text-xs text-muted-foreground">
									<p>
										Services are converted to container Quadlets. Named volumes and networks become
										managed Quadlet resources, and relative bind paths are rooted under the mutable
										app bundle directory.
									</p>
								</div>
							{/if}
						{/if}

						<div class="border border-border bg-muted/20 p-3">
							<p class="text-xs font-medium text-foreground">Generated paths</p>
							<p class="mt-2 break-all font-mono text-xs text-muted-foreground">
								{recipeDetail.filename}
							</p>
							{#if recipeDetail.resources.length > 1}
								<p class="mt-1 text-xs text-muted-foreground">
									{recipeDetail.resources.length} Quadlet resources
								</p>
							{/if}
							{#if recipeDetail.filesBaseDir}
								<p class="mt-1 break-all font-mono text-xs text-muted-foreground">
									{recipeDetail.filesBaseDir}
								</p>
							{/if}
						</div>

						<Button class="w-full gap-2" onclick={saveRecipeApp} disabled={saving || !!composeError}>
							{#if saving}
								<Loader2 class="size-3.5 animate-spin" />
							{/if}
							Create app
						</Button>

						<Button
							type="button"
							variant="outline"
							class="w-full gap-2"
							onclick={() => (showGeneratedConfiguration = !showGeneratedConfiguration)}
						>
							{#if showGeneratedConfiguration}
								<EyeOff class="size-3.5" />
								Hide generated configuration
							{:else}
								<Eye class="size-3.5" />
								Show generated configuration
							{/if}
						</Button>
					</section>

					{#if showGeneratedConfiguration}
						<section class="mt-5 min-w-0 space-y-4 border border-border p-4">
							<div>
								<h2 class="text-sm font-semibold text-foreground">Generated Configuration</h2>
								<p class="mt-1 text-xs text-muted-foreground">
									Review the generated units and files before creating the app.
								</p>
							</div>

							<div class="grid gap-3 lg:grid-cols-2">
								{#each recipeDetail.resources as resource, index (resource.filename)}
									<div class="min-w-0 border border-border p-3">
										<Label for={`generated-resource-${index}`} class="font-mono text-xs">
											{resource.filename}
										</Label>
										<Textarea
											id={`generated-resource-${index}`}
											class="mt-2 min-h-52 font-mono text-xs leading-relaxed"
											readonly
											value={resource.contents}
										/>
									</div>
								{/each}
							</div>

							{#if recipeDetail.files.length > 0}
								<div class="grid gap-3 lg:grid-cols-2">
									{#each recipeDetail.files as file, index (file.filename)}
										<div class="min-w-0 border border-border p-3">
											<Label for={`generated-file-${index}`} class="font-mono text-xs">
												{file.filename}
											</Label>
											<Textarea
												id={`generated-file-${index}`}
												class="mt-2 min-h-40 font-mono text-xs leading-relaxed"
												readonly
												value={file.contents}
											/>
										</div>
									{/each}
								</div>
							{/if}
						</section>
					{/if}
				</div>

				{#if actionError}
					<div class="border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
						{actionError}
					</div>
				{/if}
			</div>
		{:else}
			<div class="mx-auto max-w-5xl border border-border bg-muted/20 p-5">
				<h2 class="text-sm font-semibold text-foreground">Select a recipe</h2>
				<p class="mt-1 text-xs text-muted-foreground">
					Choose an app recipe above to configure it, or choose Blank Quadlet to write a unit from
					scratch.
				</p>
			</div>
		{/if}
	</div>
</section>
