// Cloudflare Pages Function: atiende /api/* del panel.
import { manejar, type Env } from "../../servidor/panel";

export const onRequest = (ctx: { request: Request; env: Env }) => manejar(ctx.request, ctx.env);
