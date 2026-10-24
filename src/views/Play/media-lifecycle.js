const sessions = new WeakMap();
const bound = new WeakSet();
export const isCurrentMediaEngine = (player, engine) => sessions.get(player) === engine;
export const currentMediaEngine = player => sessions.get(player);
export function releaseMediaEngine(player) {
  const engine = sessions.get(player);
  sessions.delete(player);
  if (engine) engine.destroy();
}
export function replaceMediaEngine(player, create) {
  releaseMediaEngine(player);
  if (!bound.has(player)) {
    player.on('destroy', () => releaseMediaEngine(player));
    bound.add(player);
  }
  const engine = create();
  sessions.set(player, engine);
  return engine;
}
