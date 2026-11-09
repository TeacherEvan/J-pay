export async function resolve(specifier, context, next) {
  let spec = specifier;
  if (spec.startsWith("@/")) {
    spec = new URL(`./src/${spec.slice(2)}`, "file://" + process.cwd() + "/").href;
  }
  try {
    return await next(spec, context);
  } catch (e) {
    if (
      (spec.startsWith("./") || spec.startsWith("../") || spec.startsWith("file://")) &&
      !/\.[cm]?[jt]sx?$/.test(spec)
    ) {
      try {
        return await next(`${spec}.ts`, context);
      } catch {
        return await next(`${spec}.tsx`, context);
      }
    }
    throw e;
  }
}
