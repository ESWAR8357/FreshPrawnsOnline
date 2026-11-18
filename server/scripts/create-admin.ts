import { createInterface } from 'node:readline/promises'
import argon2 from 'argon2'
import { connectDatabase, disconnectDatabase } from '../src/database.js'
import { loadConfig } from '../src/config.js'
import { User } from '../src/modules/users/user.model.js'

async function readPassword(): Promise<string> {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') {
    throw new Error('Admin setup requires an interactive terminal so the password is not echoed.')
  }
  process.stdout.write('Admin password (12+ characters): ')
  process.stdin.setRawMode(true)
  process.stdin.resume()
  let password = ''
  return new Promise((resolve, reject) => {
    const finish = (error?: Error) => {
      process.stdin.setRawMode(false)
      process.stdin.pause()
      process.stdin.removeListener('data', onData)
      process.stdout.write('\n')
      if (error) reject(error)
      else resolve(password)
    }
    const onData = (chunk: Buffer) => {
      for (const character of chunk.toString('utf8')) {
        if (character === '\u0003') return finish(new Error('Admin setup cancelled.'))
        if (character === '\r' || character === '\n') return finish()
        if (character === '\u007f' || character === '\b') {
          password = password.slice(0, -1)
          continue
        }
        password += character
      }
    }
    process.stdin.on('data', onData)
  })
}

async function main(): Promise<void> {
  const config = loadConfig()
  const prompt = createInterface({ input: process.stdin, output: process.stdout })
  const email = (await prompt.question('Admin email: ')).trim().toLowerCase()
  prompt.close()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    throw new Error('Enter a valid email address.')
  }
  const password = await readPassword()
  if (password.length < 12 || password.length > 128) {
    throw new Error('Admin password must contain 12 to 128 characters.')
  }

  await connectDatabase(config.MONGODB_URI)
  try {
    if (await User.exists({ email })) throw new Error('An account with this email already exists.')
    await User.create({
      email,
      passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
      role: 'admin',
      status: 'active',
    })
    process.stdout.write(`Administrator account created for ${email}.\n`)
  } finally {
    await disconnectDatabase()
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'Admin setup failed.'}\n`)
  process.exitCode = 1
})
