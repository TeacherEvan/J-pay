/** Registers the test-only React/backend stub loader (see tsx-stub-loader.mjs). */
import { register } from "node:module";

register("./lib/tsx-stub-loader.mjs", import.meta.url);
