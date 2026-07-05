const choices = [
  ["kitten", "cat", "neko", "puppy"],
  ["box", "stack", "rack", "server"],
];

const choose = (i: int) => choices[i][Math.floor(Math.random() * choices[i].length)];

export const generateServerName = () => choose(0) + choose(1);
