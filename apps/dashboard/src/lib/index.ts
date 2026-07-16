// place files you want to import through the `$lib` alias in this folder.
export { Button, buttonVariants } from '$lib/components/ui/button';

export type IconComponent = import('svelte').Component<{ class?: string }>;
