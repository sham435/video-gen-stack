# API_REGISTRY.md

> Every REST route (apps/api). Register BEFORE adding a new endpoint.
> RouteId convention: `<domain>.<entity>.<action>`. Do NOT create
> `/api/news/list` + `/api/news/sources` for the same operation.
> Auth: `requireAuth` = admin token (JWT cookie/header, validated in server.js),
> `validateBody(schema)` = zod. Rate limits: renderLimiter on video/render, loginLimiter on auth.

## Mount Points (`apps/api/server.js`)

| prefix | handler | auth |
|---|---|---|
| /api | videoRoutes | mixed (requireAuth on writes) |
| /api/news | newsRoutes | none (public read) |
| /api/render-and-publish | renderRoutes | requireAuth |
| /api/pipeline | pipelineRoutes | requireAuth |
| /api/premium-render | premiumRoutes | requireAuth |
| /api/direct-publish | directRoutes | requireAuth |
| /api/cron-jobs | cronManagerRoutes | requireAuth |
| /api/ai | aiRoutes | requireAuth |
| /api/youtube | youtubeThumbnailRoutes | requireAuth (mixed) |
| /api | publishRoutes | mixed |
| /  | server | static + admin login |

## Route Table

### System / admin
| routeId | method | path | purpose | auth | rate |
|---|---|---|---|---|---|
| system.admin.login | POST | /admin/login | admin token issue | none | loginLimiter |
| system.health | GET | /api/health | liveness | none | — |
| system.health.detailed | GET | /api/health/detailed | detailed health | requireAuth | — |
| system.debug.pipeline | GET | /api/debug/pipeline | pipeline debug view | requireAuth | — |
| system.channel.videos | GET | /api/channel/videos | channel video feed | none | — |

### Video
| routeId | method | path | purpose | auth |
|---|---|---|---|---|
| video.providers.list | GET | /api/providers | provider list | none |
| video.models.list | GET | /api/models | model list | none |
| video.generate | POST | /api/generate | generate video | requireAuth + renderLimiter |
| video.news-video | POST | /api/news-video | news video job | requireAuth + renderLimiter |
| video.jobs.stats | GET | /api/jobs/stats | job stats | requireAuth |
| video.jobs.read | GET | /api/jobs/:id | job detail | requireAuth |
| video.jobs.list | GET | /api/jobs | job list | requireAuth |

### News
| routeId | method | path | purpose | auth |
|---|---|---|---|---|
| news.headlines.list | GET | /api/news/headlines | headlines | none |
| news.search | GET | /api/news/search | search | none |

### Publish / OAuth
| routeId | method | path | purpose | auth |
|---|---|---|---|---|
| publish.youtube.auth | GET | /api/youtube/auth | start YouTube OAuth | requireAuth |
| publish.youtube.callback | GET | /api/auth/youtube/callback | OAuth callback | none |
| publish.linkedin.auth | GET | /api/linkedin/auth | start LinkedIn OAuth | requireAuth |
| publish.linkedin.callback | GET | /api/auth/linkedin/callback | OAuth callback | none |
| publish.linkedin.status | GET | /api/linkedin/status | token/scope status | requireAuth |
| publish.linkedin.share | POST | /api/linkedin/share | share post | requireAuth |
| publish.tiktok.auth | GET | /api/tiktok/auth | start TikTok OAuth | requireAuth |
| publish.tiktok.callback | GET | /api/auth/tiktok/callback | OAuth callback | none |
| publish.news | POST | /api/publish | publish artifact | requireAuth + publishSchema |

### Pipeline / render / cron / ai / premium
| routeId | method | path | purpose | auth |
|---|---|---|---|---|
| pipeline.status | GET | /api/pipeline/status | pipeline status | requireAuth |
| render.and-publish | POST | /api/render-and-publish | render+publish | requireAuth + renderLimiter |
| premium.render | POST | /api/premium-render | premium render | requireAuth |
| cron.jobs.list | GET | /api/cron-jobs | list cron jobs | requireAuth |
| cron.jobs.create | POST | /api/cron-jobs | create cron job | requireAuth + cronJobSchema |
| cron.jobs.update | PATCH | /api/cron-jobs/:id | update cron job | requireAuth |
| cron.jobs.delete | DELETE | /api/cron-jobs/:id | delete cron job | requireAuth |
| cron.jobs.run | POST | /api/cron-jobs/:id/run | trigger job | requireAuth |
| ai.health | GET | /api/ai/health | AI health | requireAuth |
| ai.suggestions | GET | /api/ai/suggestions | suggestions | requireAuth |
| ai.debug | GET | /api/ai/debug | AI debug | requireAuth |
| ai.run | POST | /api/ai/run | run AI op | requireAuth |

## Adding an endpoint

1. Verify no equivalent exists above (search by purpose, not by path shape).
2. Register row here + routeId in change log (`docs/ARCHITECTURE_REGISTRY.md`).
3. zod body schema if POST/PATCH (`validateBody`), auth annotation, tests.

## Contract tests

New endpoints require: positive + failure tests (401 unauthorized, 400 invalid body,
200 success shape). Mirror: route files under `apps/api/` are NOT mirrored to
deploy-staging (server runtime lives in the base image; document any future exception).