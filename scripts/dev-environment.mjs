export function developmentEnvironment(env) {
  return { ...env, NODE_ENV: 'development', HOST: '127.0.0.1', SERVE_WEB: 'false' };
}
