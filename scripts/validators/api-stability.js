export const metadata = {
  name: 'api-stability',
  version: '1.1.0',
  dependsOn: ['schema', 'bridge'],
  provides: ['apiStability'],
  group: 'api',
  description: 'Validate public OpenCodeBridge method signatures against declared list in validation_schemas.public_api.OpenCodeBridge; CRITICAL if any method dropped',
}

export default function (ctx) {
  const r = ctx.results
  const b = ctx.bridge
  if (!b) {
    r.add('api', 'public API stability (bridge unavailable)', 'ERROR', false)
    return
  }
  const expectedPublic = (b.config.validation_schemas && b.config.validation_schemas.public_api && b.config.validation_schemas.public_api.OpenCodeBridge) || []
  if (expectedPublic.length === 0) {
    r.add('api', 'public_api.OpenCodeBridge list missing from validation_schemas', 'NOTICE', false)
    return
  }
  const proto = Object.getPrototypeOf(b)
  const missing = []
  const present = []
  for (const m of expectedPublic) {
    if (m === 'constructor') continue
    if (typeof proto[m] === 'function' || typeof b[m] === 'function') present.push(m)
    else missing.push(m)
  }
  if (missing.length === 0) r.add('api', `public API signatures stable (${present.length} methods)`, 'INFO', true, `methods: ${present.join(',')}`)
  else r.add('api', `public API METHODS MISSING: ${missing.join(',')}`, 'CRITICAL', false)
  if (typeof b === 'object' && b.constructor && b.constructor.name === 'OpenCodeBridge') {
    r.add('api', 'OpenCodeBridge constructor present', 'INFO', true)
  } else {
    r.add('api', 'OpenCodeBridge constructor type check failed', 'CRITICAL', false)
  }
}
