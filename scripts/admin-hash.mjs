/**
 * Admin password-hash generator.
 *
 * Generates the ADMIN_PASS_HASH value used by the admin RBAC login. Paste the
 * output into your environment / CI secret as ADMIN_PASS_HASH (and set
 * ADMIN_USER + JWT_SECRET alongside it).
 *
 *   node scripts/admin-hash.mjs            # prompts for a password
 *   node scripts/admin-hash.mjs 'mySecret' # one-shot from argv
 */
import { hashPassword } from '../packages/auth/adminAuth.mjs'
import { createInterface } from 'readline'

const args = process.argv.slice(2)

if (args.length > 0) {
  const hash = hashPassword(args[0])
  console.log('ADMIN_PASS_HASH=' + hash)
  process.exit(0)
}

const pwPromise = new Promise((resolve) => {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  rl.question('Admin password: ', (pw) => { rl.close(); resolve(pw) })
})
pwPromise.then((pw) => {
  if (!pw) { console.error('No password given'); process.exit(1) }
  const hash = hashPassword(pw)
  console.log('\nADMIN_PASS_HASH=' + hash)
  console.log('\nRecommended env (server):')
  console.log('  ADMIN_USER=admin')
  console.log('  ADMIN_PASS_HASH=' + hash)
  console.log('  JWT_SECRET=<a long random string>')
})
