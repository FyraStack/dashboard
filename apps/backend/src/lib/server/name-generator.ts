const choices = [
	['kitten', 'cat', 'neko', 'puppy', 'dog', 'doggy'],
	['box', 'stack', 'rack', 'server', 'node']
];

const choose = (i: number) => choices[i][Math.floor(Math.random() * choices[i].length)];

export const generateServerName = () => choose(0) + choose(1);
