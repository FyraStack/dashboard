import { tv } from 'tailwind-variants';

export const buttonVariants = tv({
	base: 'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded border text-sm font-medium transition-colors duration-200 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
	variants: {
		variant: {
			default: 'border-primary bg-primary/10 text-primary hover:bg-primary/20',
			secondary: 'border-border bg-secondary text-secondary-foreground hover:bg-secondary/80',
			outline: 'border-border bg-transparent text-foreground hover:bg-secondary/50',
			ghost: 'border-transparent bg-transparent text-muted-foreground hover:text-foreground'
		},
		size: {
			default: 'h-10 px-6 py-2',
			sm: 'h-9 rounded px-4',
			lg: 'h-11 px-8 text-[0.95rem]',
			icon: 'size-10'
		}
	},
	defaultVariants: {
		variant: 'default',
		size: 'default'
	}
});
