<script lang="ts">
	import { Activity, Cpu, Fan, Thermometer } from '@lucide/svelte';
	import { getColocationContext } from '../../colocation-context.svelte';

	const colo = getColocationContext();

	let sensorData = $derived.by(() => {
		if (colo.selectedUnit?.status === 'offline') return null;
		return {
			cpuTemp: Math.floor(Math.random() * 15 + 45),
			inletTemp: Math.floor(Math.random() * 5 + 22),
			exhaustTemp: Math.floor(Math.random() * 8 + 32),
			disk1Temp: Math.floor(Math.random() * 10 + 30),
			disk2Temp: Math.floor(Math.random() * 10 + 30),
			fan1: Math.floor(Math.random() * 2000 + 5000),
			fan2: Math.floor(Math.random() * 2000 + 5000),
			fan3: Math.floor(Math.random() * 2000 + 5000),
			fan4: Math.floor(Math.random() * 2000 + 5000),
			vCore: (Math.random() * 0.1 + 1.1).toFixed(3),
			v33: (Math.random() * 0.05 + 3.3).toFixed(3),
			v5: (Math.random() * 0.1 + 4.95).toFixed(3),
			v12: (Math.random() * 0.2 + 11.9).toFixed(3)
		};
	});

	let powerPct = $derived.by(() => {
		const selectedUnit = colo.selectedUnit;
		if (!selectedUnit) return 0;
		const draw = parseInt(selectedUnit.powerDraw);
		const budget = parseInt(selectedUnit.powerBudget);
		return budget > 0 ? (draw / budget) * 100 : 0;
	});
</script>

{#if colo.selectedUnit}
	<div class="flex-1 overflow-auto">
		{#if sensorData}
			<div class="divide-y divide-gray-800/50">
				<div class="px-5 py-3">
					<span class="text-xs font-semibold tracking-wider text-gray-500 uppercase"
						>Temperatures</span
					>
				</div>
				{#each [['CPU Package', `${sensorData.cpuTemp}°C`, sensorData.cpuTemp > 70 ? 'text-red-400' : sensorData.cpuTemp > 55 ? 'text-amber-400' : 'text-gray-200', 85], ['Inlet Ambient', `${sensorData.inletTemp}°C`, 'text-gray-200', 40], ['Exhaust', `${sensorData.exhaustTemp}°C`, sensorData.exhaustTemp > 45 ? 'text-amber-400' : 'text-gray-200', 55], ['Disk 0 (sda)', `${sensorData.disk1Temp}°C`, sensorData.disk1Temp > 45 ? 'text-amber-400' : 'text-gray-200', 60], ['Disk 1 (sdb)', `${sensorData.disk2Temp}°C`, sensorData.disk2Temp > 45 ? 'text-amber-400' : 'text-gray-200', 60]] as [name, value, color, max] (name)}
					<div class="flex items-center gap-4 px-5 py-2">
						<Thermometer class="h-3 w-3 shrink-0 text-gray-500" />
						<span class="w-28 shrink-0 text-xs text-gray-400">{name}</span>
						<div class="h-1 flex-1 bg-gray-800">
							<div
								class="h-full bg-gray-600 transition-all"
								style:width={`${(parseInt(String(value)) / Number(max)) * 100}%`}
							></div>
						</div>
						<span class="w-12 shrink-0 text-right text-xs font-medium {color}">{value}</span>
					</div>
				{/each}

				<div class="px-5 py-3">
					<span class="text-xs font-semibold tracking-wider text-gray-500 uppercase"
						>Fan Speeds</span
					>
				</div>
				{#each [['Fan 1', sensorData.fan1], ['Fan 2', sensorData.fan2], ['Fan 3', sensorData.fan3], ['Fan 4', sensorData.fan4]] as [name, rpm] (name)}
					<div class="flex items-center gap-4 px-5 py-2">
						<Fan class="h-3 w-3 shrink-0 text-gray-500" />
						<span class="w-28 shrink-0 text-xs text-gray-400">{name}</span>
						<div class="h-1 flex-1 bg-gray-800">
							<div
								class="h-full bg-gray-600 transition-all"
								style:width={`${(Number(rpm) / 10000) * 100}%`}
							></div>
						</div>
						<span class="w-16 shrink-0 text-right text-xs font-medium text-gray-200">{rpm} RPM</span
						>
					</div>
				{/each}

				<div class="px-5 py-3">
					<span class="text-xs font-semibold tracking-wider text-gray-500 uppercase">Voltages</span>
				</div>
				{#each [['Vcore', `${sensorData.vCore}V`, 0.9, 1.4], ['+3.3V', `${sensorData.v33}V`, 3.1, 3.5], ['+5V', `${sensorData.v5}V`, 4.7, 5.3], ['+12V', `${sensorData.v12}V`, 11.5, 12.5]] as [name, value, lo, hi] (name)}
					<div class="flex items-center gap-4 px-5 py-2">
						<Cpu class="h-3 w-3 shrink-0 text-gray-500" />
						<span class="w-28 shrink-0 text-xs text-gray-400">{name}</span>
						<span class="text-xs text-gray-500">{lo}V</span>
						<div class="h-1 flex-1 bg-gray-800">
							<div
								class="h-full bg-emerald-600 transition-all"
								style:width={`${((parseFloat(String(value)) - Number(lo)) / (Number(hi) - Number(lo))) * 100}%`}
							></div>
						</div>
						<span class="text-xs text-gray-500">{hi}V</span>
						<span class="w-16 shrink-0 text-right font-mono text-xs font-medium text-gray-200"
							>{value}</span
						>
					</div>
				{/each}

				<div class="px-5 py-3">
					<span class="text-xs font-semibold tracking-wider text-gray-500 uppercase">Power</span>
				</div>
				<div class="flex items-center justify-between px-5 py-2.5">
					<span class="text-xs text-gray-400">Current Draw</span>
					<span class="text-xs font-medium text-gray-200">{colo.selectedUnit.powerDraw}</span>
				</div>
				<div class="flex items-center justify-between px-5 py-2.5">
					<span class="text-xs text-gray-400">Budget</span>
					<span class="text-xs font-medium text-gray-200">{colo.selectedUnit.powerBudget}</span>
				</div>
				<div class="px-5 py-3">
					<div class="h-1.5 w-full bg-gray-800">
						<div
							class="h-full transition-all duration-500 {powerPct > 80
								? 'bg-red-500'
								: powerPct > 50
									? 'bg-amber-500'
									: 'bg-emerald-500'}"
							style:width={`${powerPct}%`}
						></div>
					</div>
				</div>
			</div>
		{:else}
			<div class="flex flex-col items-center justify-center py-20 text-gray-500">
				<Activity class="mb-3 h-8 w-8" />
				<p class="text-sm">Server is powered off</p>
				<p class="mt-1 text-xs text-gray-500">Power on via IPMI to view sensor data.</p>
			</div>
		{/if}
	</div>
{/if}
