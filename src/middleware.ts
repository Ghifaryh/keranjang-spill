import { defineMiddleware } from 'astro:middleware';
import { checkAndNotifyStartup } from './lib/startup';

let initStarted = false;

export const onRequest = defineMiddleware(async (context, next) => {
  if (!initStarted) {
    initStarted = true;
    checkAndNotifyStartup().catch(err => {
      console.error('[startup-notify] background execution error:', err);
    });
  }
  return next();
});
