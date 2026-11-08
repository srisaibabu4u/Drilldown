#!/usr/bin/env node
// Create a login for the site (stored in Netlify, never in the repo).
//
//   npm run add-user -- <username> "<Display name>" [--secret]
//
// Asks for the password (twice, hidden) and prints:
//   - the AUTH_USERS entry for this user (PBKDF2-SHA256 hash, no plain password)
//   - a fresh SESSION_SECRET, if you pass --secret
// Paste them into Netlify → Site configuration → Environment variables, then redeploy.
import { pbkdf2Sync, randomBytes } from 'node:crypto'
import { createInterface } from 'node:readline'

const ITERATIONS = 210000
const args = process.argv.slice(2)
const wantSecret = args.includes('--secret')
const [username, name] = args.filter((a) => !a.startsWith('--'))
if (!username) {
  console.error('Usage: npm run add-user -- <username> "<Display name>" [--secret]')
  process.exit(1)
}

/** Prompt without echoing what is typed. */
function askHidden(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true })
    rl._writeToOutput = (s) => {
      if (s.startsWith(question)) rl.output.write(question)
      else if (s.includes('\n')) rl.output.write('\n')
    }
    rl.question(question, (answer) => {
      rl.close()
      resolve(answer)
    })
  })
}

const b64url = (buf) => buf.toString('base64url')

// NEW_PASSWORD lets scripts/CI supply it without a prompt.
const pw = process.env.NEW_PASSWORD ?? (await askHidden('Password: '))
if (!process.env.NEW_PASSWORD) {
  const again = await askHidden('Repeat password: ')
  if (pw !== again) {
    console.error('Passwords do not match.')
    process.exit(1)
  }
}
if (pw.length < 10) {
  console.error('Use at least 10 characters.')
  process.exit(1)
}

const salt = randomBytes(16)
const hash = pbkdf2Sync(pw, salt, ITERATIONS, 32, 'sha256')
const entry = {
  username: username.toLowerCase(),
  name: name || username,
  hash: ['pbkdf2-sha256', ITERATIONS, b64url(salt), b64url(hash)].join('$'),
}

console.log('\nAdd this object to the AUTH_USERS JSON array:\n')
console.log(JSON.stringify(entry))
console.log('\nFor a single user, AUTH_USERS is:\n')
console.log(JSON.stringify([entry]))
if (wantSecret) {
  console.log('\nSESSION_SECRET (set once; changing it signs everyone out):\n')
  console.log(b64url(randomBytes(48)))
}
console.log('\nThen redeploy the site in Netlify so the functions pick up the new values.')
