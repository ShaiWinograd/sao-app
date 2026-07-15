import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';

const isPublic = createRouteMatcher(['/', '/sign-in(.*)', '/sign-up(.*)', '/q(.*)', '/api/webhooks(.*)']);
const shouldProtectRoutes = process.env.ENABLE_AUTH_PROTECTION === 'true';

export default clerkMiddleware(async (auth, req) => {
  if (shouldProtectRoutes && !isPublic(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: ['/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)', '/(api|trpc)(.*)'],
};
