const choices = [
  ["kitten", "cat", "neko", "puppy", "dog", "doggy"],
  ["box", "stack", "rack", "server", "node"],
];

const choose = (i: int) => choices[i][Math.floor(Math.random() * choices[i].length)];

export const generateServerName = () => choose(0) + choose(1);
