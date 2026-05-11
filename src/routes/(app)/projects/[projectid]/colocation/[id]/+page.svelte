<script lang="ts">
	import { getColocationContext } from '../colocation-context.svelte';

	const colo = getColocationContext();
	const totalRackSlots = 42;

	type ChartDef = { label: string; color: string; points: string; value: string };
	const charts: ChartDef[] = [
		{
			label: 'Power Draw',
			color: '#fb923c',
			points: '0,50 20,48 40,45 60,42 80,50 100,55 120,52 140,48 160,45 180,50 200,48 240,46',
			value: '180W'
		},
		{
			label: 'CPU Temp',
			color: '#ef6b6b',
			points: '0,55 20,52 40,48 60,45 80,40 100,38 120,42 140,45 160,48 180,44 200,42 240,40',
			value: '52°C'
		},
		{
			label: 'Bandwidth In',
			color: '#4ade80',
			points: '0,65 20,60 40,55 60,50 80,45 100,48 120,52 140,50 160,48 180,45 200,42 240,40',
			value: '42 Mbps'
		},
		{
			label: 'Bandwidth Out',
			color: '#60a5fa',
			points: '0,70 20,68 40,65 60,62 80,60 100,58 120,55 140,58 160,60 180,62 200,60 240,58',
			value: '12 Mbps'
		}
	];

	function parseSlots(location: string): { rack: string; start: number; end: number } {
		const rackMatch = location.match(/Rack\s+([A-Za-z0-9]+)/);
		const slotMatch = location.match(/Slot\s+(\d+)(?:-(\d+))?/);
		const rack = rackMatch?.[1] ?? '??';
		const start = slotMatch ? parseInt(slotMatch[1]) : 1;
		const end = slotMatch?.[2] ? parseInt(slotMatch[2]) : start;
		return { rack, start, end };
	}

	let rackInfo = $derived.by(() => {
		const selectedUnit = colo.selectedUnit;
		if (!selectedUnit) return { rack: '??', occupied: [] };
		const selectedSlots = parseSlots(selectedUnit.location);
		return {
			rack: selectedSlots.rack,
			occupied: colo.units
				.filter((unit) => parseSlots(unit.location).rack === selectedSlots.rack)
				.map((unit) => ({
					...parseSlots(unit.location),
					name: unit.name,
					isCurrent: unit.id === colo.selectedUnitId,
					status: unit.status
				}))
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
	<div class="flex min-h-0 flex-1 flex-col overflow-auto">
		<div class="shrink-0">
			<div class="grid shrink-0 grid-cols-4 divide-x divide-gray-800 border-b border-gray-800">
				{#each charts as chart (chart.label)}
					<div class="relative flex flex-col">
						<div class="flex items-baseline justify-between px-4 pt-3 pb-1">
							<span class="relative z-10 text-xs font-medium text-gray-400">{chart.label}</span>
							<span class="relative z-10 text-xs font-semibold text-gray-200">{chart.value}</span>
						</div>
						<svg viewBox="0 0 240 80" class="block h-28 w-full" preserveAspectRatio="none">
							<polygon points="{chart.points} 240,80 0,80" fill={chart.color} opacity="0.08" />
							<polyline
								points={chart.points}
								fill="none"
								stroke={chart.color}
								stroke-width="2"
								stroke-linejoin="round"
								stroke-linecap="round"
								vector-effect="non-scaling-stroke"
							/>
						</svg>
					</div>
				{/each}
			</div>
		</div>

		<div class="border-b border-gray-800/50 px-5 py-3">
			<span class="text-xs font-semibold tracking-wider text-gray-500 uppercase"
				>Hardware Details</span
			>
		</div>

		<div class="flex min-h-0 flex-1">
			<div class="min-w-0 flex-1">
				<div class="flex items-center justify-between px-5 py-2">
					<span class="text-xs text-gray-500">Rack Size</span>
					<span class="text-xs font-medium text-gray-200">{colo.selectedUnit.rackSize}</span>
				</div>
				<div class="flex items-center justify-between px-5 py-2">
					<span class="text-xs text-gray-500">Location</span>
					<span class="text-xs font-medium text-gray-200"
						>Chicago, IL — {colo.selectedUnit.location}</span
					>
				</div>
				<div class="divide-y divide-gray-800/50 border-t border-gray-800/50">
					{#each [['Created', colo.selectedUnit.created], ['Power Draw', colo.selectedUnit.powerDraw], ['Power Budget', colo.selectedUnit.powerBudget], ['Uplink', '1 Gbps fair-use'], ['Primary IP', colo.selectedUnit.ip]] as [label, value] (label)}
						<div class="flex items-center justify-between px-5 py-2">
							<span class="text-xs text-gray-500">{label}</span>
							<span class="text-xs font-medium text-gray-200">{value}</span>
						</div>
					{/each}
					<div class="px-5 py-3">
						<div class="flex items-center justify-between">
							<span class="text-xs text-gray-500">Power Usage</span>
							<span class="text-xs text-gray-400"
								>{colo.selectedUnit.powerDraw} / {colo.selectedUnit.powerBudget}</span
							>
						</div>
						<div class="mt-2 h-1.5 w-full bg-gray-800">
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
			</div>

			<div class="relative w-32 shrink-0 p-2">
				<div class="absolute top-[2.25rem] bottom-0 left-0 border-l border-gray-800/50"></div>
				<svg
					viewBox="0 0 120 {totalRackSlots * 8 + 16}"
					class="w-full"
					xmlns="http://www.w3.org/2000/svg"
				>
					<rect x="0" y="0" width="7" height={totalRackSlots * 8 + 16} fill="var(--gray-800)" />
					<rect x="113" y="0" width="7" height={totalRackSlots * 8 + 16} fill="var(--gray-800)" />
					<rect x="0" y="0" width="120" height="3" fill="var(--gray-700)" />
					<rect x="0" y={totalRackSlots * 8 + 13} width="120" height="3" fill="var(--gray-700)" />
					{#each Array(totalRackSlots) as _, i (i)}
						<circle cx="3.5" cy={i * 8 + 8} r="1" fill="var(--gray-600)" />
						<circle cx="116.5" cy={i * 8 + 8} r="1" fill="var(--gray-600)" />
					{/each}
					{#each Array(totalRackSlots) as _, i (i)}
						{@const slotNum = totalRackSlots - i}
						{@const y = i * 8 + 4}
						<rect
							x="9"
							{y}
							width="102"
							height="7"
							fill="var(--gray-950)"
							stroke="var(--gray-800)"
							stroke-width="0.5"
						/>
						{#if slotNum % 5 === 0}
							<text x="13" y={y + 5.5} font-size="4" fill="var(--gray-600)" font-family="monospace"
								>{slotNum}</text
							>
						{/if}
					{/each}
					{#each rackInfo.occupied as unit (`${unit.name}-${unit.start}`)}
						{@const startY = (totalRackSlots - unit.end) * 8 + 4}
						{@const h = (unit.end - unit.start + 1) * 8 - 1}
						<rect
							x="9"
							y={startY}
							width="102"
							height={h}
							fill={unit.isCurrent
								? unit.status === 'online'
									? 'var(--red-500)'
									: 'var(--gray-600)'
								: 'var(--gray-700)'}
							opacity={unit.isCurrent ? 0.25 : 0.12}
							stroke={unit.isCurrent ? 'var(--red-500)' : 'var(--gray-600)'}
							stroke-width={unit.isCurrent ? 1.5 : 0.5}
						/>
						{@const midY = startY + h / 2}
						{#each Array(Math.min(Math.floor(h / 4), 5)) as _, vi (vi)}
							<rect
								x={26 + vi * 10}
								y={midY - 2}
								width="7"
								height="4"
								fill="none"
								stroke={unit.isCurrent ? 'var(--red-400)' : 'var(--gray-500)'}
								stroke-width="0.4"
								opacity="0.4"
							/>
						{/each}
						<circle
							cx="15"
							cy={midY}
							r="1.5"
							fill={unit.status === 'online'
								? '#4ade80'
								: unit.status === 'offline'
									? 'var(--gray-600)'
									: '#fbbf24'}
						/>
						<text
							x="108"
							y={midY + 1.5}
							font-size="4"
							fill={unit.isCurrent ? 'var(--gray-200)' : 'var(--gray-500)'}
							font-family="monospace"
							text-anchor="end">{unit.name}</text
						>
					{/each}
				</svg>
			</div>
		</div>
	</div>
{/if}
