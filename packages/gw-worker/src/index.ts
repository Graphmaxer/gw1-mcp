import FAVICON_PNG from "../../../assets/brand/favicon-32.png";
import { createApp } from "./app.js";

// Cloudflare Workers entry point. The favicon PNG is imported here (bundled by
// wrangler via the wrangler.jsonc "Data" rule) and handed to the app, so the
// app module itself stays free of binary imports and needs no vitest config.
export default createApp(FAVICON_PNG);
