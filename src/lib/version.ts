/** 由构建注入的应用版本，唯一来源是 package.json。 */
declare const __APP_VERSION__: string | undefined;

export const APP_VERSION =
  typeof __APP_VERSION__ === 'string' && __APP_VERSION__.length > 0
    ? __APP_VERSION__
    : '1.1.0';
