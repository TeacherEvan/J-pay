export async function resolve(specifier, context, next) {
  try { return await next(specifier, context); }
  catch (e) {
    if ((specifier.startsWith("./") || specifier.startsWith("../")) && !/\.[cm]?ts?$/.test(specifier)) {
      return await next(`${specifier}.ts`, context);
    }
    throw e;
  }
}
